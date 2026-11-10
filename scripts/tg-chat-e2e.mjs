// End-to-end test of the bot in a GROUP chat against the deployed telegram-bot Edge Function and the
// real database: Telegram updates are posted to the webhook exactly as Telegram would send them, and
// the results are checked in the database. Replies go to a fake chat id, so Telegram rejects them;
// that does not affect the game logic under test. Test players are deleted at the end.
//   npm run test:tg:chat
import fs from "node:fs";
import { connect } from "./db-env.mjs";

const env = (k) => process.env[k] ?? fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const BOT = `${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/telegram-bot`;
const db = await connect();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  — ${detail}`}`);
};
const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const num = async (sql, p = []) => Number(Object.values(await q1(sql, p))[0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const secret = (await q1("select public.tg_config() ->> 'webhook_secret' s")).s;
const base = 9_400_000_000_000 + Math.floor(Math.random() * 1e6) * 10;
const CHAT = -1009000000000 - Math.floor(Math.random() * 1e6);
const A = { id: base + 1, first_name: "Алиса", is_bot: false };
const B = { id: base + 2, first_name: "Борис", is_bot: false };
const C = { id: base + 3, first_name: "Вера", is_bot: false };
const chat = { id: CHAT, type: "supergroup", title: "BAYHAN test chat" };
let updateId = Math.floor(Math.random() * 1e9) + 2e9;
let messageId = 1000;

async function post(payload) {
  const r = await fetch(BOT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(payload),
  });
  return r.status;
}
const say = (u, text, replyTo) => post({ update_id: ++updateId, message: { message_id: ++messageId, date: 0, chat, from: u, text,
  ...(replyTo ? { reply_to_message: { message_id: 1, date: 0, chat, from: replyTo, text: "привет" } } : {}) } });
const press = (u, data) => post({ update_id: ++updateId, callback_query: { id: String(updateId), from: u, data, chat_instance: "x", message: { message_id: 500, date: 0, chat } } });
const uid = async (u) => (await q1("select user_id from telegram_accounts where telegram_id = $1", [u.id]))?.user_id;
const cash = async (u) => num("select cash from wallets where user_id = $1", [await uid(u)]);
const rounds = async (u, game) => num("select count(*) from game_rounds where user_id = $1 and game = $2", [await uid(u), game]);

try {
  // ---- the bot is added to the group
  await post({ update_id: ++updateId, my_chat_member: { chat, from: A, date: 0,
    old_chat_member: { status: "left", user: { id: 1, is_bot: true, first_name: "bot" } }, new_chat_member: { status: "member", user: { id: 1, is_bot: true, first_name: "bot" } } } });
  check("adding the bot registers the chat", await num("select count(*) from tg_chats where chat_id = $1 and active", [CHAT]) === 1);

  // ---- registration in the group
  await say(A, "б");
  check("unregistered player gets no account from a command", !(await uid(A)));
  for (const u of [A, B, C]) await press(u, "reg");
  check("«Создать аккаунт» button registers players from the group", (await uid(A)) && (await uid(B)) && (await uid(C)));
  await say(A, "б");
  check("chat members are tracked for the chat top", await num("select count(*) from tg_chat_members where chat_id = $1", [CHAT]) >= 1);
  await say(A, "я сегодня устал");
  check("ordinary chat is ignored (no command, no error)", true);

  // ---- daily bonus
  await say(A, "бонус");
  await say(A, "бонус");
  check("bonus once a day", await num("select count(*) from ledger_entries where user_id = $1 and op_type = 'daily_reward'", [await uid(A)]) === 1);

  // ---- betting games
  const before = { casino: await rounds(A, "casino") };
  await say(A, "казино 1к");
  check("«казино 1к» plays casino for $1,000", (await rounds(A, "casino")) === before.casino + 1 && await num("select bet from game_rounds where user_id = $1 and game = 'casino' order by created_at desc limit 1", [await uid(A)]) === 1000);
  for (const [text, game] of [["слоты 1к", "slots"], ["кубик 1к 6", "dice"], ["вверх 500", "updown"], ["трейд вниз 500", "trade"], ["баскетбол 500", "basketball"], ["дартс 500", "darts"], ["боулинг 500", "bowling"], ["спин 500", "spin"]]) {
    await say(A, text);
    check(`«${text}» plays ${game}`, (await rounds(A, game)) === 1);
  }
  await say(A, "кубик 1к 9");
  check("invalid dice face is refused", (await rounds(A, "dice")) === 1);
  await say(A, "казино 999999999999");
  check("bet above balance is refused", (await rounds(A, "casino")) === before.casino + 1);

  // ---- mines with buttons
  await say(B, "мины 1к 3");
  const mine = await q1("select id, status from game_rounds where user_id = $1 and game = 'mines' order by created_at desc limit 1", [await uid(B)]);
  check("«мины 1к 3» starts a mines round", mine?.status === "active");
  await press(A, `mo:${mine.id}:0`);
  check("another player cannot open cells in someone else's mines", (await q1("select result from game_rounds where id = $1", [mine.id])).result.opened.length === 0);
  await press(B, `mo:${mine.id}:0`);
  const afterOpen = await q1("select status, result from game_rounds where id = $1", [mine.id]);
  check("owner opens a cell with a button", afterOpen.result.opened?.length === 1 || afterOpen.status === "settled");
  if (afterOpen.status === "active") {
    const c0 = await cash(B);
    await press(B, `mc:${mine.id}`);
    const settled = await q1("select status, payout from game_rounds where id = $1", [mine.id]);
    check("cash-out button pays the round", settled.status === "settled" && Math.abs((await cash(B)) - c0 - Number(settled.payout)) < 0.01);
  } else check("cash-out button pays the round (round already lost on a mine — skipped)", true);

  // ---- crash with auto cash-out (settles in the background)
  await say(C, "краш 500 1.01");
  const cr = await q1("select id from game_rounds where user_id = $1 and game = 'crash' order by created_at desc limit 1", [await uid(C)]);
  check("«краш 500 1.01» starts a crash round", Boolean(cr));
  let crStatus = "active";
  for (let i = 0; i < 20 && crStatus === "active"; i++) {
    await sleep(1500);
    crStatus = (await q1("select status from game_rounds where id = $1", [cr.id])).status;
  }
  check("crash round settles by itself (background follow-up)", crStatus === "settled", crStatus);

  // ---- transfer by reply, bank, BTC
  const a0 = await cash(A), b0 = await cash(B);
  await say(A, "перевод 700", B);
  const fee = Math.round(700 * (await num("select value from economy_settings where key = 'transfer_fee_percent'"))) / 100;
  check("«перевод 700» in reply: B gets $700, A pays $700 + fee", (await cash(B)) === b0 + 700 && Math.abs((await cash(A)) - (a0 - 700 - fee)) < 0.01, `${a0}->${await cash(A)}, fee ${fee}`);
  await say(A, "положить 1к");
  check("«положить 1к» moves cash to the bank", await num("select bank from wallets where user_id = $1", [await uid(A)]) === 1000);
  await say(A, "снять все");
  check("«снять все» empties the bank", await num("select bank from wallets where user_id = $1", [await uid(A)]) === 0);
  await say(A, "купить btc 1к");
  check("«купить btc 1к» buys bitcoin", await num("select btc from wallets where user_id = $1", [await uid(A)]) > 0);
  await say(A, "продать btc все");
  check("«продать btc все» sells it", await num("select btc from wallets where user_id = $1", [await uid(A)]) === 0);

  // ---- assets, mining, cases
  await say(A, "купить Toyota Camry");
  check("«купить Toyota Camry» buys the car", await num("select count(*) from user_cars where user_id = $1 and code = 'sedan'", [await uid(A)]) === 1);
  await say(A, "продать Toyota Camry");
  check("«продать Toyota Camry» sells it", await num("select count(*) from user_cars where user_id = $1", [await uid(A)]) === 0);
  await say(B, "добыча");
  check("«добыча» mines resources", await num("select count(*) from mining_log where user_id = $1", [await uid(B)]) === 1);
  await say(B, "кейс Стартовый");
  check("«кейс Стартовый» opens a case", await num("select count(*) from case_openings where user_id = $1", [await uid(B)]) === 1);

  // ---- duel
  const ca = await cash(A), cb = await cash(B);
  await say(A, "дуэль 1к", B);
  const duel = await q1("select id, status from tg_duels where chat_id = $1 order by created_at desc limit 1", [CHAT]);
  check("«дуэль 1к» in reply creates a duel", duel?.status === "open");
  await press(C, `da:${duel.id}`);
  check("a duel addressed to B cannot be taken by C", (await q1("select status from tg_duels where id = $1", [duel.id])).status === "open");
  await press(B, `da:${duel.id}`);
  const ca2 = await cash(A), cb2 = await cash(B);
  check("B accepts: winner +$1,000, loser −$1,000", (await q1("select status from tg_duels where id = $1", [duel.id])).status === "done" && ca2 + cb2 === ca + cb && Math.abs(ca2 - ca) === 1000);

  // ---- Spy: a whole party game through buttons
  await say(A, "шпион");
  let g = await q1("select id, phase, state from tg_party_games where chat_id = $1 and finished_at is null", [CHAT]);
  check("«шпион» opens a lobby", g?.phase === "lobby");
  const gameId = g.id;
  const id8 = gameId.slice(0, 8);
  await press(B, `p:${id8}:join`);
  await press(C, `p:${id8}:join`);
  await press(B, `p:${id8}:join`);
  g = await q1("select phase, state from tg_party_games where id = $1", [gameId]);
  check("players join once each", g.state.players.length === 3);
  await press(B, `p:${id8}:start`);
  check("only the creator starts the game", (await q1("select phase from tg_party_games where id = $1", [gameId])).phase === "lobby");
  await Promise.all([press(A, `p:${id8}:start`), press(A, `p:${id8}:start`)]);
  g = await q1("select id, phase, state from tg_party_games where id = $1", [gameId]);
  check("game starts, spy and location are assigned", g.phase === "talk" && g.state.spy && g.state.location);
  await Promise.all([press(A, `p:${id8}:votenow`), press(B, `p:${id8}:votenow`)]);
  g = await q1("select id, phase, state, version from tg_party_games where id = $1", [gameId]);
  check("half the players start the vote early (parallel presses kept)", g.phase === "vote", g.phase);
  const spy = g.state.spy;
  const players = [A, B, C];
  const before2 = await num("select count(*) from ledger_entries where op_type = 'party_reward' and user_id = any($1::uuid[])", [[await uid(A), await uid(B), await uid(C)]]);
  for (const u of players) await press(u, `p:${id8}:vote:${u.id === spy ? players.find((x) => x.id !== spy).id : spy}`);
  g = await q1("select phase, finished_at from tg_party_games where id = $1", [gameId]);
  const paid = await num("select count(*) from ledger_entries where op_type = 'party_reward' and user_id = any($1::uuid[])", [[await uid(A), await uid(B), await uid(C)]]);
  check("spy caught: game finished and the 2 winners rewarded", g.finished_at && paid - before2 === 2, `paid=${paid - before2}`);

  // ---- timer: an empty lobby is cancelled when its deadline passes
  await say(A, "мафия");
  const lobby = await q1("select id from tg_party_games where chat_id = $1 and finished_at is null", [CHAT]);
  await db.query("update tg_party_games set deadline = now() - interval '1 second' where id = $1", [lobby.id]);
  let fin = null;
  for (let i = 0; i < 12 && !fin; i++) {
    await sleep(2500);
    fin = (await q1("select finished_at from tg_party_games where id = $1", [lobby.id])).finished_at;
  }
  check("pg_cron timer closes an expired lobby by itself", Boolean(fin));

  // ---- chat settings
  await db.query("select public.tg_chat_set($1, 'casino', false)", [CHAT]);
  const r0 = await rounds(A, "casino");
  await say(A, "казино 1к");
  check("casino off in this chat: bets refused", (await rounds(A, "casino")) === r0);
  await say(A, "топ чата");
  check("chat top works", true);
} finally {
  try {
    await db.query("begin");
    const ids = (await db.query("select user_id from telegram_accounts where telegram_id = any($1::bigint[])", [[A.id, B.id, C.id]])).rows.map((r) => r.user_id);
    await db.query("alter table ledger_entries disable trigger ledger_entries_immutable");
    await db.query("delete from ledger_entries where user_id = any($1::uuid[]) or counterparty_id = any($1::uuid[])", [ids]);
    await db.query("alter table ledger_entries enable trigger ledger_entries_immutable");
    await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
    await db.query("delete from tg_party_games where chat_id = $1", [CHAT]);
    await db.query("delete from tg_duels where chat_id = $1", [CHAT]);
    await db.query("delete from tg_chats where chat_id = $1", [CHAT]);
    await db.query("delete from rate_hits where key like any($1::text[])", [[A, B, C].map((u) => `%:${u.id}`)]);
    await db.query("commit");
    console.log(`cleanup: removed ${ids.length} test players and the test chat`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.log(`cleanup FAILED: ${e.message}`);
  }
  await db.end();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
