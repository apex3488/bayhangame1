// Measures how long the deployed bot takes to handle typical chat commands, end to end
// (webhook request → database → Telegram API calls), and in which region the function ran.
//   node scripts/tg-latency.mjs
import fs from "node:fs";
import { connect } from "./db-env.mjs";

const env = (k) => process.env[k] ?? fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const BASE = `${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/telegram-bot`;
const db = await connect();
const secret = (await db.query("select public.tg_config() ->> 'webhook_secret' s")).rows[0].s;
const U = { id: 9_500_000_000_000 + Math.floor(Math.random() * 1e6), first_name: "Speed", is_bot: false };
const chat = { id: -1009500000000 - Math.floor(Math.random() * 1e6), type: "supergroup", title: "latency" };
let updateId = Math.floor(Math.random() * 1e9) + 3e9;

async function post(url, payload) {
  const t = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(payload) });
  await r.text();
  return { ms: performance.now() - t, region: r.headers.get("x-sb-edge-region") };
}
const msg = (text) => ({ update_id: ++updateId, message: { message_id: updateId, date: 0, chat, from: U, text } });
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];

try {
  await post(BASE, { update_id: ++updateId, callback_query: { id: "1", from: U, data: "reg", chat_instance: "x", message: { message_id: 1, date: 0, chat } } });
  for (const [label, url] of [["auto region", BASE], ["ap-southeast-1 (DB region)", `${BASE}?forceFunctionRegion=ap-southeast-1`]]) {
    const times = {};
    let region = "";
    for (let i = 0; i < 4; i++) {
      for (const cmd of ["б", "казино 100", "топ"]) {
        const r = await post(url, msg(cmd));
        region = r.region ?? region;
        (times[cmd] ??= []).push(r.ms);
      }
    }
    console.log(`${label} [ran in ${region}]: ` + Object.entries(times).map(([c, t]) => `«${c}» ${Math.round(median(t))} ms`).join(", "));
  }
} finally {
  await db.query("begin");
  const ids = (await db.query("select user_id from telegram_accounts where telegram_id = $1", [U.id])).rows.map((r) => r.user_id);
  await db.query("alter table ledger_entries disable trigger ledger_entries_immutable");
  await db.query("delete from ledger_entries where user_id = any($1::uuid[])", [ids]);
  await db.query("alter table ledger_entries enable trigger ledger_entries_immutable");
  await db.query("delete from auth.users where id = any($1::uuid[])", [ids]);
  await db.query("delete from tg_chats where chat_id = $1", [chat.id]);
  await db.query("commit");
  await db.end();
}
