import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>; exec?: (sql: string) => Promise<unknown> };

/** Applies db/migrations/*.sql in order, once each. Safe to re-run. */
export async function runMigrations(q: Runner, dir = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  await q.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await q.query(`select name from schema_migrations`)).rows.map((r) => r.name as string));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await q.query("begin");
    try {
      if (q.exec) await q.exec(sql); else await q.query(sql);
      await q.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await q.query("commit");
      applied.push(file);
    } catch (e) {
      await q.query("rollback");
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return applied;
}
