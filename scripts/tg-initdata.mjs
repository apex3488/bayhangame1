// Test helper: builds Mini App initData signed with the bot token, exactly as Telegram does,
// for a test Telegram user. Uses the server clock (this machine's clock may drift).
//   node scripts/tg-initdata.mjs <telegram_id> [first_name] [username]
import crypto from "node:crypto";
import fs from "node:fs";

const env = (k) => process.env[k] ?? fs.readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();

export async function serverNow() {
  const r = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/telegram-auth`, { method: "OPTIONS" });
  return Math.floor(new Date(r.headers.get("date")).getTime() / 1000);
}

export function signInitData(user, { authDate, token = env("TELEGRAM_BOT_TOKEN"), extra = {} } = {}) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: "AAtest" + user.id, user: JSON.stringify(user), signature: "test", ...extra });
  const dcs = [...p].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}

if (process.argv[1]?.endsWith("tg-initdata.mjs")) {
  const [id, first = "Test", username = ""] = process.argv.slice(2);
  const user = { id: Number(id), first_name: first, ...(username ? { username } : {}), language_code: "ru" };
  console.log(signInitData(user, { authDate: await serverNow() }));
}
