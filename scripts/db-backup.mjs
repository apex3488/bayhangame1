// Dumps every table in the public schema (and the auth.users rows the game needs) to
// backups/<timestamp>/<table>.json. Read-only. Restore notes: docs/TELEGRAM.md#backup.
import fs from "node:fs";
import path from "node:path";
import { connect } from "./db-env.mjs";

const c = await connect();
const dir = path.resolve("backups", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(dir, { recursive: true });
try {
  await c.query("begin isolation level repeatable read read only");
  const { rows } = await c.query("select tablename from pg_tables where schemaname = 'public' order by 1");
  let total = 0;
  for (const { tablename } of rows) {
    const r = await c.query(`select * from public."${tablename}"`);
    fs.writeFileSync(path.join(dir, `${tablename}.json`), JSON.stringify(r.rows));
    total += r.rows.length;
  }
  const u = await c.query("select id, email, encrypted_password, raw_user_meta_data, created_at from auth.users");
  fs.writeFileSync(path.join(dir, "auth_users.json"), JSON.stringify(u.rows));
  await c.query("commit");
  console.log(`backup: ${rows.length} tables, ${total} rows, ${u.rows.length} users -> ${dir}`);
} finally {
  await c.end();
}
