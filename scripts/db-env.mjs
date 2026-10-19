// Server-side helper: reads DATABASE_URL from the environment or .env.local.
// Never imported by the Next.js app.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.resolve(process.cwd(), ".env.local");
  const match = fs.existsSync(file) && fs.readFileSync(file, "utf8").match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error("DATABASE_URL is not set (environment or .env.local)");
  return match[1].trim();
}

export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  // If the network drops mid-test, the server ends the orphaned transaction by itself
  // instead of holding its locks until someone kills it.
  await client.query("set idle_in_transaction_session_timeout = '60s'");
  return client;
}
