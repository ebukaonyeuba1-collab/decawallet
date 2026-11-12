import { z } from "zod";
import { one, query, tx as dbTx, Q } from "../db";
import { cards, sandboxToolsEnabled } from "../providers";
import type { CardSnapshot } from "../providers/types";
import { TIERS, CARD_DEFAULT_LIMITS, CARD_LIMIT_CEILING, CARD_FUNDING_FEE, CARD_FUNDING_MIN } from "../catalog";
import { big, formatAmount, parseAmount } from "../money";
import { ledger } from "../ledger";
import { assertWithinOutflowLimit } from "../limits";
import { dispatchToProvider, insertTx, withIdempotency } from "../transactions";
import { randomToken, sha256 } from "../security";
import { forbidden, notFound, unprocessable } from "../errors";
import type { User } from "../auth";

export const addressSchema = z.object({
  line1: z.string().trim().min(5, "Enter your street address").max(120), city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60), phone: z.string().trim().regex(/^(\+234|0)[789][01]\d{8}$/, "Enter a valid phone number"),
});
export const limitsSchema = z.object({ perTx: z.string(), daily: z.string(), monthly: z.string() });
export const fundCardSchema = z.object({ amount: z.string().trim().min(1).max(14) });

const mapCard = (r: any) => ({ ...r, balance: big(r.balance), per_tx_limit: big(r.per_tx_limit), daily_limit: big(r.daily_limit), monthly_limit: big(r.monthly_limit) });
export type CardRow = ReturnType<typeof mapCard>;

export async function listCards(userId: string): Promise<CardRow[]> {
  return (await query(`select * from cards where user_id=$1 and status <> 'terminated' order by created_at desc`, [userId])).rows.map(mapCard);
}
export async function getCardFor(userId: string, id: string): Promise<CardRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Card not found");
  const r = await query(`select * from cards where id=$1 and user_id=$2`, [id, userId]);
  if (!r.rows[0]) throw notFound("Card not found");
  return mapCard(r.rows[0]);
}
function assertCardsAllowed(u: User) {
  if (u.status !== "active") throw forbidden("Your account is restricted.");
  if (!TIERS[u.kyc_tier].cards) throw unprocessable("Verify your BVN to unlock cards.", "kyc_required");
}
const ev = (q: Q, cardId: string, kind: string, detail?: string) => q.query(`insert into card_events (card_id, kind, detail) values ($1,$2,$3)`, [cardId, kind, detail ?? null]);

async function insertCard(userId: string, p: { providerRef: string; last4: string; expiryMonth: number; expiryYear: number; brand: string }, type: "virtual" | "physical", holder: string, delivery?: object) {
  return dbTx(async (q) => {
    const row = await one(q,
      `insert into cards (user_id,type,status,provider,provider_ref,brand,last4,expiry_month,expiry_year,holder_name,per_tx_limit,daily_limit,monthly_limit,delivery)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (provider, provider_ref) do update set updated_at=now() returning *`,
      [userId, type, type === "virtual" ? "active" : "pending_delivery", cards().name, p.providerRef, p.brand, p.last4, p.expiryMonth, p.expiryYear, holder.toUpperCase().slice(0, 26),
        CARD_DEFAULT_LIMITS.perTx.toString(), CARD_DEFAULT_LIMITS.daily.toString(), CARD_DEFAULT_LIMITS.monthly.toString(), delivery ? JSON.stringify(delivery) : null]);
    await q.query(`insert into card_events (card_id, kind, detail) select $1,$2,$3 where not exists (select 1 from card_events where card_id=$1)`, [row.id, type === "virtual" ? "issued" : "ordered", type === "virtual" ? "Virtual card issued" : "Physical card ordered"]);
    return mapCard(row);
  });
}

export async function requestVirtual(user: User, key?: string) {
  assertCardsAllowed(user);
  const n = await one({ query } as any, `select count(*)::int n from cards where user_id=$1 and type='virtual' and status <> 'terminated'`, [user.id]);
  if (n.n >= 3 && !key) throw unprocessable("You can hold up to 3 virtual cards.", "card_limit");
  const ref = key ? sha256(`${user.id}:${key}`).slice(0, 24) : randomToken(12);
  const p = await cards().issueVirtual({ ref, holderName: user.full_name });
  return insertCard(user.id, p, "virtual", user.full_name);
}
export async function requestPhysical(user: User, addr: z.infer<typeof addressSchema>, key?: string) {
  assertCardsAllowed(user);
  const ref = key ? sha256(`${user.id}:${key}`).slice(0, 24) : randomToken(12);
  const p = await cards().requestPhysical({ ref, holderName: user.full_name, address: addr });
  return insertCard(user.id, p, "physical", user.full_name, addr);
}

export async function applyCardSnapshot(q: Q, providerRef: string, snap: CardSnapshot): Promise<string> {
  const c = await one(q, `select * from cards where provider_ref=$1 for update`, [providerRef]);
  if (!c) return "unknown_card";
  let changed = false;
  if (c.status !== "terminated" && c.status !== snap.status) {
    await q.query(`update cards set status=$2, frozen_at = case when $2='frozen' then coalesce(frozen_at, now()) else null end, updated_at=now() where id=$1`, [c.id, snap.status]);
    await ev(q, c.id, `status:${snap.status}`, `Card is now ${snap.status.replace(/_/g, " ")}`); changed = true;
  }
  for (const d of snap.delivery ?? []) {
    const kind = `delivery:${d.stage}`;
    const ex = await one(q, `select 1 from card_events where card_id=$1 and kind=$2`, [c.id, kind]);
    if (!ex) { await ev(q, c.id, kind, d.label); changed = true; }
  }
  return changed ? "applied" : "no_change";
}
/** Lazy sync used when a user opens a card. Webhooks do the same through applyCardSnapshot. */
export async function syncCard(userId: string, id: string) {
  const c = await getCardFor(userId, id);
  try {
    const snap = await cards().getCard(c.provider_ref);
    await dbTx((q) => applyCardSnapshot(q, c.provider_ref, snap));
  } catch { /* provider unreachable: show last known state */ }
  return getCardFor(userId, id);
}

export async function setFrozen(user: User, id: string, frozen: boolean) {
  const c = await getCardFor(user.id, id);
  if (!["active", "frozen"].includes(c.status)) throw unprocessable("This card cannot be frozen right now", "bad_state");
  await cards().setFrozen(c.provider_ref, frozen);
  await dbTx(async (q) => {
    await q.query(`update cards set status=$2, frozen_at=$3, updated_at=now() where id=$1`, [id, frozen ? "frozen" : "active", frozen ? new Date() : null]);
    await ev(q, id, frozen ? "frozen" : "unfrozen", frozen ? "You froze this card" : "You unfroze this card");
  });
}
export async function setLimits(user: User, id: string, input: z.infer<typeof limitsSchema>) {
  const c = await getCardFor(user.id, id);
  let perTx: bigint, daily: bigint, monthly: bigint;
  try { perTx = parseAmount(input.perTx, "NGN"); daily = parseAmount(input.daily, "NGN"); monthly = parseAmount(input.monthly, "NGN"); }
  catch (e) { throw unprocessable((e as Error).message, "bad_amount"); }
  if (perTx <= 0n || perTx > daily || daily > monthly) throw unprocessable("Limits must satisfy: per transaction <= daily <= monthly", "bad_limits");
  if (perTx > CARD_LIMIT_CEILING.perTx || daily > CARD_LIMIT_CEILING.daily || monthly > CARD_LIMIT_CEILING.monthly)
    throw unprocessable(`Maximums: ${formatAmount(CARD_LIMIT_CEILING.perTx, "NGN")} per transaction, ${formatAmount(CARD_LIMIT_CEILING.daily, "NGN")} daily, ${formatAmount(CARD_LIMIT_CEILING.monthly, "NGN")} monthly`, "limit_ceiling");
  await cards().setLimits(c.provider_ref, { perTx, daily, monthly });
  await dbTx(async (q) => {
    await q.query(`update cards set per_tx_limit=$2, daily_limit=$3, monthly_limit=$4, updated_at=now() where id=$1`, [id, perTx.toString(), daily.toString(), monthly.toString()]);
    await ev(q, id, "limits", "Spending limits updated");
  });
}
export async function fundCard(user: User, id: string, amountStr: string, key?: string) {
  const c = await getCardFor(user.id, id);
  if (!["active", "frozen"].includes(c.status)) throw unprocessable("This card cannot be funded yet", "bad_state");
  let amount: bigint;
  try { amount = parseAmount(amountStr, "NGN"); } catch (e) { throw unprocessable((e as Error).message, "bad_amount", { amount: (e as Error).message }); }
  if (amount < CARD_FUNDING_MIN) throw unprocessable(`The minimum funding amount is ${formatAmount(CARD_FUNDING_MIN, "NGN")}`, "below_minimum", { amount: "Below minimum" });
  const fee = CARD_FUNDING_FEE, hash = sha256(`f:${id}:${amount}`);
  return withIdempotency(user.id, key, hash, async () => {
    const t = await dbTx(async (q) => {
      await assertWithinOutflowLimit(q, user, "NGN", amount + fee);
      const t = await insertTx(q, { userId: user.id, type: "card_funding", asset: "NGN", amount, fee, provider: cards().name, idempotencyKey: key, requestHash: hash, meta: { cardId: id, last4: c.last4 } });
      await ledger.hold(q, user.id, "NGN", amount + fee, t.id);
      return t;
    });
    return dispatchToProvider(t, () => cards().fund({ ref: t.ref, providerRef: c.provider_ref, amount }));
  });
}
export async function activate(user: User, id: string, last4: string) {
  const c = await getCardFor(user.id, id);
  if (c.status !== "awaiting_activation") throw unprocessable("This card is not ready to activate", "bad_state");
  try { await cards().activate(c.provider_ref, last4); } catch (e) { throw unprocessable((e as Error).message, "activation_failed", { last4: "Digits do not match" }); }
  await syncCard(user.id, id);
}
export async function reveal(user: User, id: string) {
  const c = await getCardFor(user.id, id);
  if (!["active", "frozen"].includes(c.status)) throw unprocessable("Card details are not available yet", "bad_state");
  await query(`insert into audit_log (actor_id, action, entity, entity_id) values ($1,'reveal_card','card',$2)`, [user.id, id]);
  return cards().reveal(c.provider_ref); // returned to the browser once; never stored or logged
}
export const cardHistory = async (userId: string, id: string) =>
  (await query(`select * from card_transactions where card_id=$1 and user_id=$2 order by created_at desc limit 50`, [id, userId])).rows.map((r: any) => ({ ...r, amount: big(r.amount) }));
export const cardEvents = async (id: string) => (await query(`select kind, detail, created_at from card_events where card_id=$1 order by id desc`, [id])).rows;

/** SANDBOX ONLY: pretend the card was used at a merchant, honouring status, balance and limits. */
export async function simulateSpend(user: User, id: string, merchant: string, amountStr: string) {
  if (!sandboxToolsEnabled()) throw notFound();
  const amount = parseAmount(amountStr, "NGN");
  return dbTx(async (q) => {
    const c = mapCard(await one(q, `select * from cards where id=$1 and user_id=$2 for update`, [id, user.id]));
    let reason: string | null = null;
    if (c.status !== "active") reason = c.status === "frozen" ? "Card is frozen" : "Card is not active";
    else if (amount > c.balance) reason = "Insufficient card balance";
    else if (amount > c.per_tx_limit) reason = "Above per-transaction limit";
    else {
      const d = await one(q, `select coalesce(sum(amount) filter (where created_at > now() - interval '1 day'),0)::text day, coalesce(sum(amount) filter (where created_at > now() - interval '30 days'),0)::text mon from card_transactions where card_id=$1 and kind='spend' and status='approved'`, [id]);
      if (big(d.day) + amount > c.daily_limit) reason = "Above daily limit";
      else if (big(d.mon) + amount > c.monthly_limit) reason = "Above monthly limit";
    }
    await q.query(`insert into card_transactions (card_id,user_id,kind,status,merchant,amount,decline_reason,provider_ref) values ($1,$2,'spend',$3,$4,$5,$6,$7)`,
      [id, user.id, reason ? "declined" : "approved", merchant.slice(0, 40), amount.toString(), reason, `sim_${randomToken(8)}`]);
    if (!reason) await q.query(`update cards set balance = balance - $2, updated_at=now() where id=$1`, [id, amount.toString()]);
    return { approved: !reason, reason };
  });
}
