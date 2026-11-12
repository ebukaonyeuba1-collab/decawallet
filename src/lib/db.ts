import { isProd } from "./env";
import { runMigrations } from "./migrate";

/**
 * Two interchangeable drivers behind one tiny interface:
 *  - DATABASE_URL set  -> node-postgres Pool (production / Vercel)
 *  - otherwise         -> embedded Postgres (PGlite) in ./.data for zero-setup local dev
 *    (PGLITE_DIR=memory:// gives a throwaway in-memory database, used by tests)
 */
export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  driver: "pg" | "pglite";
}

const g = globalThis as unknown as { __decaDb?: Promise<Db> };

async function create(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pg = (await import("pg")).default;
    pg.types.setTypeParser(1700, (v: string) => v); // numeric -> string (exact)
    pg.types.setTypeParser(20, (v: string) => v);   // int8    -> string
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX || 5) });
    const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<any> }): Q => ({
      query: async (sql, params) => {
        const r = await c.query(sql, params as unknown[]);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      },
    });
    return {
      driver: "pg",
      ...wrap(pool),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const out = await fn(wrap(client));
          await client.query("commit");
          return out;
        } catch (e) {
          await client.query("rollback").catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }

  if (isProd() && process.env.ALLOW_EPHEMERAL_DB !== "true") {
    throw new Error("DATABASE_URL is required in production. See README (Vercel deployment).");
  }
  const { PGlite, types } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR || "./.data/pglite";
  if (!dir.startsWith("memory://")) (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir, {
    parsers: { [types.NUMERIC]: (v: string) => v, [types.INT8]: (v: string) => v },
  });
  await lite.waitReady;
  await runMigrations({ query: (s, p) => lite.query(s, p as any[]) as any, exec: (s) => lite.exec(s) });
  const wrap = (c: { query: (s: string, p?: any[]) => Promise<any> }): Q => ({
    query: async (sql, params) => {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    driver: "pglite",
    ...wrap(lite),
    tx: (fn) => lite.transaction(async (t) => fn(wrap(t))),
  };
}

export function db(): Promise<Db> {
  return (g.__decaDb ??= create());
}
export async function query<T = any>(sql: string, params?: unknown[]) {
  return (await db()).query<T>(sql, params);
}
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await db()).tx(fn);
}
export async function one<T = any>(q: Q, sql: string, params?: unknown[]): Promise<T | null> {
  return (await q.query<T>(sql, params)).rows[0] ?? null;
}

export async function migrateRemote(): Promise<string[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await runMigrations({ query: (s, p) => client.query(s, p as unknown[]) as any });
  } finally {
    await client.end();
  }
}
