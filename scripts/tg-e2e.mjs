// End-to-end tests of the Telegram integration against the REAL deployed backend:
// the telegram-auth and telegram-bot Edge Functions, Supabase Auth and the game database.
// Test players use Telegram ids >= 9.1e12 (far above real ids) and are deleted at the end.
//   npm run test:tg
// Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, TELEGRAM_BOT_TOKEN.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { connect } from "./db-env.mjs";
import { serverNow, signInitData } from "./tg-initdata.mjs";

const env = (k) => process.env[k] ?? fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const AUTH = `${URL_}/functions/v1/telegram-auth`;
const BOT = `${URL_}/functions/v1/telegram-bot`;

const db = await connect();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  — ${detail}`}`);
};

const base = 9_100_000_000_000 + Math.floor(Math.random() * 1_000_000) * 100;
const tgIds = [];
const tgUser = (n, extra = {}) => {
  const id = base + n;
  tgIds.push(id);
  return { id, first_name: `Тест ${n}`, language_code: "ru", ...extra };
};
const browserUsers = [];
let now = await serverNow();
const init = (user, o = {}) => signInitData(user, { authDate: now, ...o });

async function auth(action, initData, extra = {}, token) {
  const r = await fetch(AUTH, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ action, initData, ...extra }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function sessionFrom(tokenHash) {
  const c = client();
  const { error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) throw new Error(error.message);
  return c;
}
const secret = (await db.query("select public.tg_config() ->> 'webhook_secret' s")).rows[0].s;
let updateId = Math.floor(Math.random() * 1e9) + 1e9;
async function botUpdate(payload, { secretHeader = secret, id = ++updateId } = {}) {
  const r = await fetch(BOT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secretHeader },
    body: JSON.stringify({ update_id: id, ...payload }),
  });
  return r.status;
}
const message = (u, text) => ({ message: { message_id: 1, date: now, chat: { id: u.id, type: "private" }, from: { ...u, is_bot: false }, text } });
const callback = (u, data) => ({ callback_query: { id: String(updateId), from: { ...u, is_bot: false }, data, message: { message_id: 1, chat: { id: u.id, type: "private" } } } });
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const asService = async (sql, p = []) => {
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    const r = await db.query(sql, p);
    await db.query("commit");
    return { rows: r.rows };
  } catch (e) {
    await db.query("rollback");
    return { error: e.message };
  }
};

try {
  // ------------------------------------------------ 4. initData verification ----
  const A = tgUser(1, { username: "tgtest_a" });
  check("health: function answers CORS preflight", (await fetch(AUTH, { method: "OPTIONS", headers: { origin: "https://bayhangame1.vercel.app" } })).status === 204);
  check("forged hash rejected", (await auth("session", init(A).replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`))).status === 401);
  check("expired initData (2 h old) rejected", (await auth("session", init(A, { authDate: now - 7200 }))).status === 401);
  check("wrong bot token signature rejected", (await auth("session", init(A, { token: "123:fake" }))).status === 401);
  const tampered = init(A).replace(encodeURIComponent(`"id":${A.id}`), encodeURIComponent(`"id":${A.id + 1}`));
  check("tampered user id rejected", (await auth("session", tampered)).status === 401);
  check("missing initData rejected", (await auth("session", "")).status === 401);
  check("valid unlinked user -> not_linked", (await auth("session", init(A))).body.status === "not_linked");

  // ------------------------------------------------ 1/3. register + session ----
  check("invalid game name rejected", (await auth("register", init(A), { gameName: "!!" })).body.error === "invalid_game_name");
  const taken = (await q1("select game_name from profiles order by created_at limit 1")).game_name;
  check("taken game name rejected", (await auth("register", init(A), { gameName: taken })).body.error === "name_taken");
  const nameA = `TgT ${String(A.id).slice(-6)}`;
  const regA = await auth("register", init(A), { gameName: nameA });
  check("Mini App registration creates a player", regA.body.status === "ok" && regA.body.created === true, JSON.stringify(regA.body));
  const userA = regA.body.user_id;
  const cA = await sessionFrom(regA.body.token_hash);
  const snapA = (await cA.rpc("get_my_snapshot")).data;
  check("session token signs in to the same player", snapA?.user_id === userA && snapA?.game_name === nameA);
  check("new player has the normal starting capital", Number(snapA?.cash) === 50000, String(snapA?.cash));
  const again = await auth("register", init(A), { gameName: "Other Name" });
  check("repeated registration returns the same account", again.body.user_id === userA && again.body.created === false);
  const sess = await auth("session", init(A));
  check("linked user -> session for the same player", sess.body.status === "ok" && sess.body.user_id === userA);
  check("token_hash is single-use", await sessionFrom(regA.body.token_hash).then(() => false, () => true));

  // ------------------------------------------------ 8. concurrency: registration ----
  const B = tgUser(2);
  const par = await Promise.all(Array.from({ length: 5 }, () => auth("register", init(B), { gameName: `TgP ${String(B.id).slice(-6)}` })));
  const idsB = new Set(par.filter((r) => r.body.user_id).map((r) => r.body.user_id));
  const countB = Number((await q1("select count(*) n from profiles where login = $1", [`tg${B.id}`])).n);
  check("5 parallel registrations -> exactly one account", countB === 1 && idsB.size === 1, `accounts=${countB} ids=${idsB.size} statuses=${par.map((r) => r.status)}`);

  // ------------------------------------------------ 5/2. existing browser account linking ----
  const loginC = `tgt_${String(base).slice(-8)}c`.slice(0, 20);
  const cC = client();
  const su = await cC.auth.signUp({ email: `${loginC}@players.bayhan.app`, password: "TestPass123!", options: { data: { login: loginC, game_name: `TgB ${String(base).slice(-7)}` } } });
  const userC = su.data.user?.id;
  if (userC) browserUsers.push(userC);
  check("browser account registered (normal sign-up)", Boolean(su.data.session), su.error?.message);
  const C = tgUser(3);
  check("link without a session is rejected", (await auth("link", init(C))).status === 401);
  const linkC = await auth("link", init(C), {}, su.data.session.access_token);
  check("Mini App links Telegram to the existing browser account", linkC.body.status === "ok" && linkC.body.user_id === userC, JSON.stringify(linkC.body));
  const sessC = await auth("session", init(C));
  check("Telegram now opens the browser account (no new player)", sessC.body.user_id === userC);
  check("no extra profile created for the linked Telegram", Number((await q1("select count(*) n from profiles where login = $1", [`tg${C.id}`])).n) === 0);
  check("same Telegram cannot be linked to a second account", (await auth("link", init(C), {}, (await cA.auth.getSession()).data.session.access_token)).body.error === "telegram_already_linked");
  const D = tgUser(4);
  check("second Telegram cannot be linked to an already linked account", (await auth("link", init(D), {}, su.data.session.access_token)).body.error === "account_already_linked");

  // ------------------------------------------------ 6. one balance everywhere ----
  const before = Number((await cC.rpc("get_my_snapshot")).data.cash);
  const claim = await cC.rpc("claim_daily", { p_idempotency_key: `test-${base}-c1` });
  const browserCash = Number((await cC.rpc("get_my_snapshot")).data.cash);
  const botView = await asService("select public.tg_call($1, 'snapshot') s", [C.id]);
  const miniApp = await sessionFrom((await auth("session", init(C))).body.token_hash);
  const miniCash = Number((await miniApp.rpc("get_my_snapshot")).data.cash);
  check("browser action is visible in the bot and the Mini App", claim.data?.status === "ok" && browserCash > before && Number(botView.rows?.[0]?.s.cash) === browserCash && miniCash === browserCash,
    `before=${before} browser=${browserCash} bot=${botView.rows?.[0]?.s.cash} mini=${miniCash}`);

  // ------------------------------------------------ 7/8. daily reward cannot be doubled ----
  const E = tgUser(5);
  check("bot webhook rejects a wrong secret", (await botUpdate(message(E, "/start"), { secretHeader: "wrong" })) === 401);
  check("/start for a new user answers", (await botUpdate(message(E, "/start"))) === 200);
  check("/start alone does not create an account", Number((await q1("select count(*) n from telegram_accounts where telegram_id = $1", [E.id])).n) === 0);
  await Promise.all([botUpdate(callback(E, "reg")), botUpdate(callback(E, "reg"))]);
  await botUpdate(message(E, "/start"));
  const userE = (await q1("select user_id from telegram_accounts where telegram_id = $1", [E.id]))?.user_id;
  check("bot registration creates exactly one account (double tap + restart)", userE && Number((await q1("select count(*) n from profiles where login = $1", [`tg${E.id}`])).n) === 1);
  await Promise.all(Array.from({ length: 4 }, () => botUpdate(message(E, "/daily"))));
  await botUpdate(message(E, "🎁 Ежедневная награда"));
  const dailyE = Number((await q1("select count(*) n from ledger_entries where user_id = $1 and op_type = 'daily_reward'", [userE])).n);
  check("5 daily claims (4 parallel) -> one reward", dailyE === 1, `rewards=${dailyE}`);
  const dupId = ++updateId;
  await Promise.all([botUpdate(message(E, "/balance"), { id: dupId }), botUpdate(message(E, "/balance"), { id: dupId })]);
  check("a re-delivered update is processed once", Number((await q1("select count(*) n from telegram_updates where update_id = $1", [dupId])).n) === 1);
  const eMini = await sessionFrom((await auth("session", init(E))).body.token_hash);
  const miniDaily = await eMini.rpc("claim_daily", { p_idempotency_key: `test-${base}-e2` });
  check("reward taken in the bot cannot be taken again in the Mini App", String(miniDaily.error?.message).includes("daily_already_claimed"));

  // ------------------------------------------------ link code via bot ----
  const loginF = `tgt_${String(base).slice(-8)}f`.slice(0, 20);
  const cF = client();
  const suF = await cF.auth.signUp({ email: `${loginF}@players.bayhan.app`, password: "TestPass123!", options: { data: { login: loginF, game_name: `TgF ${String(base).slice(-7)}` } } });
  if (suF.data.user) browserUsers.push(suF.data.user.id);
  const code = (await cF.rpc("telegram_link_code_create")).data?.code;
  const F = tgUser(6);
  await botUpdate(message(F, `/start link_${code}`));
  check("bot link code attaches the browser account", (await cF.rpc("my_telegram")).data?.linked === true);
  const G = tgUser(7);
  await botUpdate(message(G, `/start link_${code}`));
  check("a used link code cannot be reused", Number((await q1("select count(*) n from telegram_accounts where telegram_id = $1", [G.id])).n) === 0);

  // ------------------------------------------------ 9/10/16. permissions ----
  const anon = client();
  check("anon cannot read the bot token", Boolean((await anon.rpc("tg_config")).error));
  check("player cannot read the bot token", Boolean((await cA.rpc("tg_config")).error));
  check("player cannot act as another Telegram user (tg_call)", Boolean((await cA.rpc("tg_call", { p_tg: C.id, p_fn: "snapshot" })).error));
  check("player cannot link arbitrary accounts (tg_link_user)", Boolean((await cA.rpc("tg_link_user", { p_user: userC, p_tg: A.id, p_username: null, p_first_name: null })).error));
  const upd = await cA.from("wallets").update({ cash: 1e12 }).eq("user_id", userA).select();
  const cashA = Number((await cA.rpc("get_my_snapshot")).data.cash);
  check("client cannot set its own balance", (upd.error || !upd.data?.length) && cashA === 50000, `cash=${cashA}`);
  check("client cannot write ledger entries", Boolean((await cA.from("ledger_entries").insert({ user_id: userA, amount: 1e9 })).error));
  const otherTg = await cA.from("telegram_accounts").select("user_id");
  check("player sees only their own Telegram link", otherTg.data?.length === 1 && otherTg.data[0].user_id === userA);
  const otherProfiles = await cA.from("profiles").select("id").neq("id", userA);
  check("player cannot read other players' private profile rows", (otherProfiles.data ?? []).length === 0);
  check("admin stats refused for a regular player", String((await asService("select public.tg_call($1, 'admin_stats')", [E.id])).error).includes("forbidden"));
  check("unknown bot operation refused", String((await asService("select public.tg_call($1, 'drop_everything')", [E.id])).error).includes("unknown_operation"));
  check("leaderboard via bot comes from the shared database", Array.isArray((await asService("select public.tg_call(0, 'leaderboard', '5') r")).rows?.[0]?.r));
} finally {
  // ------------------------------------------------ cleanup ----
  try {
    await db.query("begin");
    const { rows } = await db.query(
      `select id from profiles where login = any($1::text[]) or id = any($2::uuid[]) or id in (select user_id from telegram_accounts where telegram_id = any($3::bigint[]))`,
      [tgIds.map((i) => `tg${i}`), browserUsers, tgIds],
    );
    const ids = rows.map((r) => r.id);
    await db.query("alter table ledger_entries disable trigger ledger_entries_immutable");
    await db.query("delete from ledger_entries where user_id = any($1::uuid[]) or counterparty_id = any($1::uuid[])", [ids]).catch(async () => {
      await db.query("rollback"); await db.query("begin");
      await db.query("alter table ledger_entries disable trigger ledger_entries_immutable");
      await db.query("delete from ledger_entries where user_id = any($1::uuid[])", [ids]);
    });
    await db.query("alter table ledger_entries enable trigger ledger_entries_immutable");
    await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
    await db.query("delete from rate_hits where key like any($1::text[])", [tgIds.map((i) => `%:${i}`)]);
    await db.query("commit");
    console.log(`cleanup: removed ${ids.length} test players`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.log(`cleanup FAILED: ${e.message}`);
  }
  await db.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
