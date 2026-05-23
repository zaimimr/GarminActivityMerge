import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

if (!process.env.SUPABASE_DB_URL) {
  console.error("Set SUPABASE_DB_URL to a Postgres connection string (Settings → Database → Connection string).");
  process.exit(1);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await client.connect();

await client.query(`create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
);`);

const applied = new Set((await client.query("select filename from schema_migrations")).rows.map((r) => r.filename));

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  console.log(`Applying ${file}...`);
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("insert into schema_migrations (filename) values ($1)", [file]);
    await client.query("commit");
    count++;
  } catch (e) {
    await client.query("rollback");
    console.error(`Failed on ${file}:`, e.message);
    process.exit(1);
  }
}
console.log(`Done. Applied ${count} new migration(s).`);
await client.end();
