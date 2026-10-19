// Applies supabase/migrations/*.sql in name order, each in its own transaction,
// and records applied files in public.schema_migrations so reruns are safe.
import fs from "node:fs";
import path from "node:path";
import { connect } from "./db-env.mjs";

const dir = path.resolve("supabase/migrations");
const client = await connect();

try {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  await client.query("alter table public.schema_migrations enable row level security");
  await client.query("revoke all on public.schema_migrations from anon, authenticated");

  // 0001 was applied by hand before this table existed: detect it by its tables.
  const { rows: legacy } = await client.query("select to_regclass('public.ledger_entries') is not null as present");
  if (legacy[0].present) {
    await client.query("insert into public.schema_migrations (name) values ('0001_core_economy.sql') on conflict do nothing");
  }

  const { rows } = await client.query("select name from public.schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip    ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query("rollback");
      console.error(`FAILED  ${file}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
