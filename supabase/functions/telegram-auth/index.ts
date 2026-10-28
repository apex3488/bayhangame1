// Mini App sign-in. POST JSON { action, initData, ... }:
//   session  — linked Telegram user -> single-use session token; otherwise { status: "not_linked" }
//   register — create a new player for this Telegram user (chosen game name) -> session token
//   link     — attach this Telegram user to the player signed in with the Authorization bearer token
// The Telegram user is taken only from initData whose signature this function has verified.
import { admin, config, ensurePlayer, GameError, linkedUser, rpc, sessionTokenFor, SITE_URL, verifyInitData } from "../_shared/telegram.ts";

const ORIGINS = new Set([SITE_URL, "http://localhost:3000"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_request" });
  }

  try {
    const { bot_token } = await config();
    const init = await verifyInitData(body.initData, bot_token);
    if (!init) return reply(401, { error: "invalid_init_data" });
    const u = init.user;
    if (!(await rpc<boolean>("tg_rate_hit", { p_key: `auth:${u.id}`, p_limit: 20, p_window_seconds: 60 }))) {
      return reply(429, { error: "rate_limited" });
    }

    switch (body.action) {
      case "session": {
        const userId = await linkedUser(u.id);
        if (!userId) {
          return reply(200, { status: "not_linked", telegram: { first_name: u.first_name ?? "", username: u.username ?? "" } });
        }
        await rpc("tg_link_user", { p_user: userId, p_tg: u.id, p_username: u.username ?? null, p_first_name: u.first_name ?? null });
        return reply(200, { status: "ok", user_id: userId, token_hash: await sessionTokenFor(userId) });
      }
      case "register": {
        const ref = typeof body.ref === "string" ? body.ref : init.startParam.replace(/^ref_/, "");
        const { userId, created } = await ensurePlayer(u, { gameName: String(body.gameName ?? ""), ref });
        return reply(200, { status: "ok", created, user_id: userId, token_hash: await sessionTokenFor(userId) });
      }
      case "link": {
        // Proves the second side: the player is signed in to the game in this Mini App.
        const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const { data, error } = await admin().auth.getUser(jwt);
        if (error || !data.user) return reply(401, { error: "not_authenticated" });
        const r = await rpc("tg_link_user", { p_user: data.user.id, p_tg: u.id, p_username: u.username ?? null, p_first_name: u.first_name ?? null });
        return reply(200, { status: "ok", user_id: data.user.id, result: r });
      }
      default:
        return reply(400, { error: "unknown_action" });
    }
  } catch (e) {
    if (e instanceof GameError) {
      const code = e.message.match(/[a-z_]{4,}/)?.[0] ?? "unknown";
      return reply(409, { error: code });
    }
    console.error("telegram-auth failed:", e instanceof Error ? e.message : "unknown");
    return reply(500, { error: "server_error" });
  }
});
