import { randomBytes } from "node:crypto";
import { one, query, tx } from "../src/lib/db";
import { hashPassword } from "../src/lib/security";
import { ensureWallets, ledger } from "../src/lib/ledger";
import { isProd } from "../src/lib/env";

async function upsert(email: string, name: string, role: "user" | "admin", password: string | undefined, tier: number) {
  const pw = password || randomBytes(9).toString("base64url");
  const existing = await one({ query } as any, `select id from users where lower(email)=lower($1)`, [email]);
  if (existing) { console.log(`exists: ${email} (password unchanged)`); return existing.id as string; }
  const hash = await hashPassword(pw);
  const id = await tx(async (q) => {
    const u = await one(q, `insert into users (email, password_hash, full_name, role, kyc_tier, kyc_status, phone, phone_verified_at, onboarded_at) values ($1,$2,$3,$4,$5,$6,$7,now(),now()) returning id`,
      [email, hash, name, role, tier, tier >= 2 ? "verified" : "none", role === "admin" ? "08000000001" : "08000000002"]);
    await ensureWallets(q, u.id);
    return u.id as string;
  });
  console.log(`created: ${email}  password: ${password ? "(from env)" : pw}`);
  return id;
}

(async () => {
  const admin = await upsert(process.env.SEED_ADMIN_EMAIL || "admin@example.com", "DECA Admin", "admin", process.env.SEED_ADMIN_PASSWORD, 2);
  void admin;
  if (!isProd() && process.env.DECA_MODE !== "live") {
    const demo = await upsert(process.env.SEED_DEMO_EMAIL || "demo@example.com", "Demo Trader", "user", process.env.SEED_DEMO_PASSWORD, 2);
    const w = await one({ query } as any, `select available from wallets where user_id=$1 and asset='NGN'`, [demo]);
    if (w && BigInt(w.available) === 0n) {
      await tx(async (q) => {
        await ledger.credit(q, demo, "NGN", 250_000_00n, null as any, "sandbox_seed");
        await ledger.credit(q, demo, "USDT", 150_000_000n, null as any, "sandbox_seed");
      });
      console.log("Funded demo wallet with sandbox NGN and USDT.");
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
