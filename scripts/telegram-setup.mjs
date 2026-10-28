// Configures the Telegram bot: webhook -> Supabase Edge Function, commands, menu button (Mini App),
// descriptions. Idempotent; run again after changing the site URL or rotating the token.
//   node scripts/telegram-setup.mjs
// Needs TELEGRAM_BOT_TOKEN and DATABASE_URL (environment or .env.local). The webhook secret is read
// from Supabase Vault, so this script and the bot always agree on it.
import fs from "node:fs";
import { connect } from "./db-env.mjs";

const env = (k) => process.env[k] ?? fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const token = env("TELEGRAM_BOT_TOKEN");
const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const site = env("NEXT_PUBLIC_SITE_URL") ?? "https://bayhangame1.vercel.app";
if (!token || !supabaseUrl) throw new Error("TELEGRAM_BOT_TOKEN and NEXT_PUBLIC_SUPABASE_URL are required");

const c = await connect();
const { rows } = await c.query("select public.tg_config() ->> 'webhook_secret' as s");
await c.end();
const secret = rows[0]?.s;
if (!secret) throw new Error("telegram_webhook_secret is missing in Supabase Vault (docs/TELEGRAM.md)");

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then((x) => x.json());
  console.log(`${r.ok ? "ok  " : "FAIL"} ${method}${r.ok ? "" : `: ${r.description}`}`);
  if (!r.ok) process.exitCode = 1;
  return r;
}

await api("setWebhook", {
  url: `${supabaseUrl}/functions/v1/telegram-bot`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
  max_connections: 40,
});
const commands = [
  ["start", "Главное меню"], ["play", "Открыть игру"], ["profile", "Профиль"], ["balance", "Баланс"],
  ["daily", "Ежедневная награда"], ["top", "Рейтинг игроков"], ["tasks", "Задания"], ["invite", "Пригласить друга"], ["help", "Помощь"],
].map(([command, description]) => ({ command, description }));
await api("setMyCommands", { commands });
await api("setChatMenuButton", { menu_button: { type: "web_app", text: "Играть", web_app: { url: `${site}/tg` } } });
await api("setMyName", { name: "BAYHAN GAME" });
await api("setMyShortDescription", { short_description: "Экономическая игра BAYHAN GAME: бизнес, машины, острова, Crash и Мины. Один аккаунт в Telegram и в браузере." });
await api("setMyDescription", {
  description:
    "👑 BAYHAN GAME — экономическая онлайн-игра.\n\nРаботай, открывай бизнес, покупай машины, недвижимость и острова, играй в Crash и Мины, " +
    "вступай в корпорации и поднимайся в рейтинге.\n\nИгра открывается прямо в Telegram. Аккаунт, баланс и прогресс общие с браузерной версией. Только игровая валюта.",
});
const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((x) => x.json());
console.log("webhook:", info.result.url, "pending:", info.result.pending_update_count, info.result.last_error_message ?? "");
