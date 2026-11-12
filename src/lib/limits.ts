import { Q, one } from "./db";
import { TIERS } from "./catalog";
import { Asset, ASSETS, formatAmount } from "./money";
import { ngnValue } from "./rates";
import { forbidden, unprocessable } from "./errors";
import type { User } from "./auth";

const OUT_TYPES = ["crypto_withdrawal", "ngn_withdrawal", "bill_payment", "card_funding"];

export function assertActive(u: User) {
  if (u.status !== "active") throw forbidden("Your account is restricted. Please contact support.");
}

/** NGN (kobo) that has left or is leaving the platform since local midnight (Africa/Lagos). */
export async function usedToday(q: Q, userId: string): Promise<bigint> {
  const r = await q.query(
    `select asset, amount::text a, fee::text f from transactions
     where user_id=$1 and type = any($2) and status in ('pending','processing','success')
       and created_at >= (date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')`, [userId, OUT_TYPES]);
  let sum = 0n;
  for (const x of r.rows) sum += ngnValue(x.asset as Asset, BigInt(x.a) + BigInt(x.f));
  return sum;
}

export async function limitsFor(q: Q, u: User) {
  const t = TIERS[u.kyc_tier];
  const used = await usedToday(q, u.id);
  return { tier: u.kyc_tier, label: t.label, dailyKobo: t.dailyOutKobo, usedKobo: used, remainingKobo: t.dailyOutKobo > used ? t.dailyOutKobo - used : 0n };
}

/**
 * Call INSIDE the creating transaction. Locking the user row serialises concurrent
 * requests, so two simultaneous withdrawals cannot both slip under the daily limit.
 */
export async function assertWithinOutflowLimit(q: Q, u: User, asset: Asset, amountInclFee: bigint) {
  assertActive(u);
  await one(q, `select id from users where id=$1 for update`, [u.id]);
  const t = TIERS[u.kyc_tier];
  if (t.dailyOutKobo === 0n) {
    throw unprocessable("Verify your phone number to unlock withdrawals and payments.", "kyc_required");
  }
  const used = await usedToday(q, u.id);
  const want = ngnValue(asset, amountInclFee);
  if (used + want > t.dailyOutKobo) {
    const left = t.dailyOutKobo > used ? t.dailyOutKobo - used : 0n;
    throw unprocessable(
      `This is above your daily limit. You can still send about ${formatAmount(left, "NGN")} today. ${u.kyc_tier < 2 ? "Verify your BVN to raise your limit." : ""}`.trim(),
      "limit_exceeded");
  }
}
export { ASSETS };
