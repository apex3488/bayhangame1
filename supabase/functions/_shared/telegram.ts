// Shared by the telegram-auth and telegram-bot Edge Functions.
// Both use the service role, but never write balances themselves: game operations go through
// public.tg_call(), which runs the same SQL functions the browser game calls.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

export const SITE_URL = Deno.env.get("BAYHAN_SITE_URL") ?? "https://bayhangame1.vercel.app";
export const MINI_APP_URL = `${SITE_URL}/tg`;
export const BOT_USERNAME = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "BayhanGame2_bot";
/** initData older than this is rejected (it is issued fresh every time the Mini App opens). */
export const INIT_DATA_MAX_AGE_S = 60 * 60;

let client: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!client) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("service configuration missing");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

let cfg: { bot_token: string; webhook_secret: string } | null = null;
/** Secrets come from Supabase Vault via a service-only SQL function. */
export async function config() {
  if (!cfg) {
    const { data, error } = await admin().rpc("tg_config");
    if (error || !data?.bot_token) throw new Error("telegram config unavailable");
    cfg = data;
  }
  return cfg!;
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new GameError(error.message);
  return data as T;
}

/** An error whose message is a game error code (e.g. daily_already_claimed). */
export class GameError extends Error {}

// ---------------------------------------------------------------- initData ----
export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

const enc = new TextEncoder();
async function hmac(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Validates Mini App initData as documented at core.telegram.org/bots/webapps
 * ("Validating data received via the Mini App"):
 *   data_check_string = every received field except `hash`, sorted by key, "key=value" joined by "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   valid             = hex(HMAC_SHA256(key = secret_key, message = data_check_string)) == hash
 * plus a freshness check on auth_date. Returns null when anything is wrong.
 */
export async function verifyInitData(raw: unknown, botToken: string, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== "hash") pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  if (!safeEqual(hex(await hmac(secret, pairs.join("\n"))), hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  const age = now / 1000 - authDate;
  if (age > INIT_DATA_MAX_AGE_S || age < -300) return null;

  let user: TgUser;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return null;
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return { user, startParam: params.get("start_param") ?? "", authDate };
}

// ------------------------------------------------------------- accounts ----
export const loginFor = (tgId: number) => `tg${tgId}`;
const emailFor = (login: string) => `${login}@players.bayhan.app`;

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Game names allow [A-Za-z0-9_ ], 3–20 chars (same rule as the browser registration). */
export function validGameName(name: string) {
  const v = name.trim().replace(/\s+/g, " ");
  return v.length >= 3 && v.length <= 20 && /^[A-Za-z0-9_ ]+$/.test(v) ? v : null;
}

/** A readable default name from the Telegram profile, for accounts created in the bot. */
export function defaultGameName(u: TgUser) {
  const src = u.username || [u.first_name, u.last_name].filter(Boolean).join(" ") || "";
  const latin = [...src].map((ch) => {
    const lower = ch.toLowerCase();
    const t = TRANSLIT[lower];
    if (t === undefined) return ch;
    return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }).join("");
  const cleaned = latin.replace(/[^A-Za-z0-9_ ]/g, "").replace(/\s+/g, " ").trim().slice(0, 16).trim();
  return cleaned.length >= 3 ? cleaned : "Player";
}

async function nameTaken(name: string) {
  const { data } = await admin().from("profiles").select("id").ilike("game_name", name.replace(/[\\%_]/g, "\\$&")).limit(1);
  return (data?.length ?? 0) > 0;
}

export async function linkedUser(tgId: number): Promise<string | null> {
  return await rpc<string | null>("tg_user", { p_tg: tgId });
}

/**
 * Returns the player linked to this Telegram id, creating a new account if there is none.
 * The login is derived from the verified Telegram id, so a repeated or concurrent call can never
 * create a second account: profiles.login is unique.
 */
export async function ensurePlayer(u: TgUser, opts: { gameName?: string; ref?: string } = {}) {
  const existing = await linkedUser(u.id);
  if (existing) return { userId: existing, created: false };

  const login = loginFor(u.id);
  // An account this Telegram user created earlier and later unlinked: take it back.
  const { data: own } = await admin().from("profiles").select("id").eq("login", login).maybeSingle();
  if (own?.id) {
    await rpc("tg_link_user", { p_user: own.id, p_tg: u.id, p_username: u.username ?? null, p_first_name: u.first_name ?? null });
    return { userId: own.id as string, created: false };
  }

  const wanted = opts.gameName ? validGameName(opts.gameName) : defaultGameName(u);
  if (!wanted) throw new GameError("invalid_game_name");
  let name = wanted;
  if (await nameTaken(name)) {
    if (opts.gameName) throw new GameError("name_taken"); // the player typed it: let them choose another
    for (let i = 0; i < 5 && (await nameTaken(name)); i++) name = `${wanted.slice(0, 15)}_${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const password = hex(crypto.getRandomValues(new Uint8Array(24)));
  const ref = (opts.ref ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const { data, error } = await admin().auth.admin.createUser({
    email: emailFor(login),
    password,
    email_confirm: true,
    user_metadata: { login, game_name: name, ...(ref ? { ref } : {}) },
  });
  if (error || !data.user) {
    // Lost a race with a parallel request for the same Telegram id: use the account it created.
    const again = await linkedUser(u.id);
    if (again) return { userId: again, created: false };
    const { data: raced } = await admin().from("profiles").select("id").eq("login", login).maybeSingle();
    if (raced?.id) return ensurePlayer(u, opts);
    throw new GameError("registration_failed");
  }
  await rpc("tg_link_user", { p_user: data.user.id, p_tg: u.id, p_username: u.username ?? null, p_first_name: u.first_name ?? null });
  return { userId: data.user.id, created: true };
}

/** A single-use token the client exchanges for a normal Supabase session (auth.verifyOtp). */
export async function sessionTokenFor(userId: string) {
  const { data: u, error } = await admin().auth.admin.getUserById(userId);
  if (error || !u.user?.email) throw new GameError("profile_not_found");
  const { data, error: e2 } = await admin().auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (e2 || !data.properties?.hashed_token) throw new GameError("session_failed");
  return data.properties.hashed_token;
}

// ------------------------------------------------------------- Bot API ----
export async function tg(method: string, body: Record<string, unknown>) {
  const { bot_token } = await config();
  const res = await fetch(`https://api.telegram.org/bot${bot_token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false }));
  // Never log the token or the full request: only the method and Telegram's description.
  if (!json.ok) console.warn(`telegram ${method} failed: ${json.description ?? res.status}`);
  return json;
}

export const money = (v: unknown) =>
  "$" + Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
