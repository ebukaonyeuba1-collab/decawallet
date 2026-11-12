import { Q, one, query, tx as dbTx } from "./db";
import { Asset, big } from "./money";
import { ledger, lockWallets } from "./ledger";
import { humanRef } from "./security";
import { bills, cards, crypto } from "./providers";
import type { ProviderState } from "./providers/types";

export type TxType = "crypto_deposit" | "crypto_withdrawal" | "ngn_withdrawal" | "swap" | "bill_payment" | "giftcard_payout" | "card_funding";
export type TxStatus = "pending" | "processing" | "success" | "failed" | "reversed";
export type Source = "user" | "provider" | "webhook" | "reconcile" | "admin" | "system";

export interface Tx {
  id: string; ref: string; user_id: string; type: TxType; status: TxStatus; asset: Asset; amount: bigint; fee: bigint;
  counter_asset: Asset | null; counter_amount: bigint | null; rate: string | null; provider: string | null; provider_ref: string | null;
  meta: Record<string, any>; failure_reason: string | null; created_at: Date; updated_at: Date; completed_at: Date | null;
}
export const mapTx = (r: any): Tx => ({
  ...r, amount: big(r.amount), fee: big(r.fee), counter_amount: r.counter_amount == null ? null : big(r.counter_amount), meta: r.meta ?? {},
});

export const FINAL: TxStatus[] = ["failed", "reversed"];
export const isSettling = (s: TxStatus) => s === "pending" || s === "processing";

/** Amount placed on hold for outgoing operations. A swap's fee is already inside `amount`. */
export const holdAmount = (t: Pick<Tx, "type" | "amount" | "fee">) => (t.type === "swap" ? t.amount : t.amount + t.fee);

export async function addEvent(q: Q, txId: string, from: string | null, to: string, source: Source, note?: string) {
  await q.query(`insert into transaction_events (transaction_id, from_status, to_status, source, note) values ($1,$2,$3,$4,$5)`, [txId, from, to, source, note ?? null]);
}

export async function raiseFlag(q: Q, txId: string | null, kind: string, detail: string) {
  await q.query(
    `insert into reconciliation_flags (transaction_id, kind, detail) values ($1,$2,$3) on conflict (transaction_id, kind) where resolved_at is null do nothing`,
    [txId, kind, detail],
  );
}

export interface NewTx {
  userId: string; type: TxType; status?: TxStatus; asset: Asset; amount: bigint; fee?: bigint;
  counterAsset?: Asset; counterAmount?: bigint; rate?: string; provider?: string; providerRef?: string;
  idempotencyKey?: string; requestHash?: string; meta?: Record<string, unknown>;
}
export async function insertTx(q: Q, n: NewTx, source: Source = "user", note = "Created"): Promise<Tx> {
  const status = n.status ?? "pending";
  const row = await one(q,
    `insert into transactions (ref, user_id, type, status, asset, amount, fee, counter_asset, counter_amount, rate, provider, provider_ref, idempotency_key, request_hash, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
    [humanRef(), n.userId, n.type, status, n.asset, n.amount.toString(), (n.fee ?? 0n).toString(), n.counterAsset ?? null, n.counterAmount?.toString() ?? null,
      n.rate ?? null, n.provider ?? null, n.providerRef ?? null, n.idempotencyKey ?? null, n.requestHash ?? null, JSON.stringify(n.meta ?? {})]);
  const t = mapTx(row);
  await addEvent(q, t.id, null, status, source, note);
  return t;
}

export async function getTxForUser(userId: string, id: string): Promise<Tx | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await query(`select * from transactions where id=$1 and user_id=$2`, [id, userId]);
  return r.rows[0] ? mapTx(r.rows[0]) : null;
}

/** Returns the earlier transaction for a retried request, or throws if the key was reused for a different request. */
export async function findIdempotent(userId: string, key: string | undefined, hash: string): Promise<Tx | null> {
  if (!key) return null;
  const r = await query(`select * from transactions where user_id=$1 and idempotency_key=$2`, [userId, key]);
  if (!r.rows[0]) return null;
  if (r.rows[0].request_hash && r.rows[0].request_hash !== hash) {
    const { unprocessable } = await import("./errors");
    throw unprocessable("This request key was already used for a different request. Please start again.", "idempotency_mismatch");
  }
  return mapTx(r.rows[0]);
}

const ALLOWED: Record<TxStatus, TxStatus[]> = {
  pending: ["processing", "success", "failed"],
  processing: ["success", "failed"],
  success: ["reversed"],
  failed: [],
  reversed: [],
};

async function postForTransition(q: Q, t: Tx, to: TxStatus) {
  const hold = holdAmount(t);
  const u = t.user_id;
  switch (t.type) {
    case "crypto_withdrawal":
    case "ngn_withdrawal":
    case "bill_payment":
    case "card_funding":
      if (to === "success") await ledger.settleHold(q, u, t.asset, hold, t.id);
      else if (to === "failed") await ledger.releaseHold(q, u, t.asset, hold, t.id);
      else if (to === "reversed") await ledger.refund(q, u, t.asset, hold, t.id);
      if (t.type === "card_funding" && t.meta.cardId) {
        // Keep the card balance mirror in step with the ledger, whichever path delivered the status.
        if (to === "success") {
          await q.query(`update cards set balance = balance + $2, updated_at=now() where id=$1`, [t.meta.cardId, t.amount.toString()]);
          await q.query(`insert into card_transactions (card_id, user_id, kind, status, merchant, amount, provider_ref) values ($1,$2,'funding','approved','Wallet funding',$3,$4) on conflict (card_id, provider_ref) do nothing`, [t.meta.cardId, u, t.amount.toString(), t.ref]);
        } else if (to === "reversed") {
          await q.query(`update cards set balance = greatest(balance - $2, 0), updated_at=now() where id=$1`, [t.meta.cardId, t.amount.toString()]);
          await q.query(`insert into card_transactions (card_id, user_id, kind, status, merchant, amount, provider_ref) values ($1,$2,'refund','approved','Funding reversed',$3,$4) on conflict (card_id, provider_ref) do nothing`, [t.meta.cardId, u, t.amount.toString(), `${t.ref}-rev`]);
        }
      }
      break;
    case "swap": {
      const to_asset = t.counter_asset as Asset, got = t.counter_amount ?? 0n;
      await lockWallets(q, u, [t.asset, to_asset]);
      if (to === "success") { await ledger.settleHold(q, u, t.asset, hold, t.id); await ledger.credit(q, u, to_asset, got, t.id, "swap_proceeds"); }
      else if (to === "failed") await ledger.releaseHold(q, u, t.asset, hold, t.id);
      else if (to === "reversed") {
        const { deficit } = await ledger.clawback(q, u, to_asset, got, t.id);
        await ledger.refund(q, u, t.asset, hold, t.id);
        if (deficit > 0n) await raiseFlag(q, t.id, "reversal_deficit", `Swap reversed but ${deficit} minor units of ${to_asset} had already been spent.`);
      }
      break;
    }
    case "crypto_deposit":
      if (to === "success") await ledger.confirmIncoming(q, u, t.asset, t.amount, t.id);
      else if (to === "failed") await ledger.cancelIncoming(q, u, t.asset, t.amount, t.id);
      else if (to === "reversed") {
        const { deficit } = await ledger.clawback(q, u, t.asset, t.amount, t.id);
        if (deficit > 0n) await raiseFlag(q, t.id, "reversal_deficit", `Deposit reversed but ${deficit} minor units had already been spent.`);
      }
      break;
    case "giftcard_payout":
      if (to === "reversed") await ledger.clawback(q, u, t.asset, t.amount, t.id);
      break;
  }
}

export interface Applied { tx: Tx; changed: boolean; flagged?: string }

/**
 * THE state machine. Every status change (user action, provider response, webhook,
 * reconciliation, admin tool) goes through here. It is idempotent: replaying the same
 * status is a no-op, stale updates are ignored, and impossible transitions are flagged
 * for a human instead of silently moving money.
 */
export async function applyStatusTx(q: Q, txId: string, next: { state: ProviderState; reason?: string; detail?: Record<string, unknown> }, source: Source, note?: string): Promise<Applied> {
  const row = await one(q, `select * from transactions where id=$1 for update`, [txId]);
  if (!row) throw new Error("Transaction not found");
  const t = mapTx(row);
  if (next.state === "not_found") return { tx: t, changed: false };
  const to = next.state as TxStatus;
  if (to === t.status) return { tx: t, changed: false };
  if (!ALLOWED[t.status].includes(to)) {
    // Stale (e.g. "pending" after "success") is ignored. Contradictions are flagged.
    if (t.status === "failed" && to === "success") {
      await raiseFlag(q, t.id, "late_success_after_failure", "Provider reports SUCCESS after we recorded FAILURE and released the funds. Verify with the provider before taking action.");
      return { tx: t, changed: false, flagged: "late_success_after_failure" };
    }
    if (t.status === "success" && to === "failed") {
      await raiseFlag(q, t.id, "failure_after_success", "Provider reports FAILED after we recorded SUCCESS. Verify with the provider.");
      return { tx: t, changed: false, flagged: "failure_after_success" };
    }
    return { tx: t, changed: false };
  }
  await postForTransition(q, t, to);
  const meta = { ...t.meta, ...(next.detail ?? {}) };
  const updated = await one(q,
    `update transactions set status=$2, failure_reason=$3, meta=$4, updated_at=now(),
       completed_at = case when $2 in ('success','failed','reversed') then coalesce(completed_at, now()) else completed_at end
     where id=$1 returning *`,
    [t.id, to, to === "failed" || to === "reversed" ? next.reason ?? "Declined by provider" : t.failure_reason, JSON.stringify(meta)]);
  await addEvent(q, t.id, t.status, to, source, note ?? next.reason);
  return { tx: mapTx(updated), changed: true };
}
export const applyStatus = (txId: string, next: Parameters<typeof applyStatusTx>[2], source: Source, note?: string) =>
  dbTx((q) => applyStatusTx(q, txId, next, source, note));

// ---------------------------------------------------------------------------
// Reconciliation: ask the provider (server-side) what really happened.
// ---------------------------------------------------------------------------
const NOT_FOUND_GRACE_MS = 10 * 60_000;
const STUCK_AFTER_MS = 30 * 60_000;

export async function reconcileTx(txId: string, source: Source = "reconcile"): Promise<Tx | null> {
  const r = await query(`select * from transactions where id=$1`, [txId]);
  if (!r.rows[0]) return null;
  const t = mapTx(r.rows[0]);
  if (FINAL.includes(t.status) || !t.provider) return t;
  let status;
  try {
    if (t.type === "crypto_deposit") {
      const info = t.provider_ref ? await crypto().getDeposit(t.provider_ref) : null;
      status = info ? { state: info.state, reason: info.reason } : { state: "not_found" as ProviderState };
      if (info && isSettling(t.status)) {
        await query(`update transactions set meta = meta || $2::jsonb where id=$1`, [t.id, JSON.stringify({ confirmations: info.confirmations, required: info.required })]);
      }
    } else if (t.type === "bill_payment") status = await bills().getOperationStatus(t.ref);
    else if (t.type === "card_funding") status = await cards().getFundingStatus(t.ref);
    else status = await crypto().getOperationStatus(t.ref);
  } catch {
    return t; // provider unreachable: leave as is, try again next run
  }
  const age = Date.now() - new Date(t.created_at).getTime();
  if (status.state === "not_found") {
    if (age > NOT_FOUND_GRACE_MS && isSettling(t.status)) {
      return (await applyStatus(t.id, { state: "failed", reason: "The provider has no record of this request, so it was not sent. Your funds were returned." }, source)).tx;
    }
    return t;
  }
  const res = await applyStatus(t.id, { state: status.state, reason: status.reason, detail: status.detail }, source);
  if (isSettling(res.tx.status) && age > STUCK_AFTER_MS) {
    await dbTx((q) => raiseFlag(q, t.id, "stuck", `Still ${res.tx.status} after ${Math.round(age / 60000)} minutes.`));
  }
  return res.tx;
}

/** Lazy reconciliation for one user's in-flight transactions (called when they look at their wallet/activity). */
export async function reconcileUser(userId: string, limit = 10) {
  const r = await query(
    `select id from transactions where user_id=$1 and status in ('pending','processing') and provider is not null and updated_at < now() - interval '2 seconds' order by created_at limit ${limit}`, [userId]);
  await Promise.all(r.rows.map((x: any) => reconcileTx(x.id, "reconcile").catch(() => null)));
}

/** Cron: all in-flight transactions, plus a recent-success sweep to catch late reversals. */
export async function reconcileAll() {
  const open = await query(`select id from transactions where status in ('pending','processing') and provider is not null order by created_at limit 100`);
  const recent = await query(
    `select id from transactions where status='success' and provider is not null and type in ('bill_payment','crypto_withdrawal','ngn_withdrawal','crypto_deposit') and completed_at > now() - interval '24 hours' order by completed_at desc limit 50`);
  let n = 0;
  for (const x of [...open.rows, ...recent.rows]) { await reconcileTx(x.id, "reconcile").catch(() => null); n++; }
  return n;
}

// ---------------------------------------------------------------------------
// Dispatch + idempotency helpers shared by every money-moving service
// ---------------------------------------------------------------------------
import { ProviderNotImplemented, ProviderRejected, Submitted } from "./providers/types";

/**
 * Calls the provider AFTER our database transaction has committed (never hold a DB
 * transaction open across a network call).
 *  - Definitive rejection        -> mark FAILED, funds released
 *  - Ambiguous error / timeout   -> leave PENDING; reconciliation asks the provider by our `ref`
 *  - Accepted                    -> store provider reference, apply the returned state
 */
export async function dispatchToProvider(t: Tx, call: () => Promise<Submitted>): Promise<Tx> {
  let sub: Submitted;
  try {
    sub = await call();
  } catch (e) {
    if (e instanceof ProviderRejected || e instanceof ProviderNotImplemented) {
      const reason = e instanceof ProviderNotImplemented ? "This service is not available right now" : e.message || "Rejected by provider";
      return (await applyStatus(t.id, { state: "failed", reason }, "provider")).tx;
    }
    console.error(`[dispatch] ambiguous provider error for ${t.ref}:`, (e as Error).message);
    return t;
  }
  await query(`update transactions set provider_ref = coalesce(provider_ref, $2), updated_at = now() where id = $1`, [t.id, sub.providerRef]);
  if (sub.state !== "pending") {
    return (await applyStatus(t.id, { state: sub.state, reason: sub.reason, detail: sub.detail }, "provider")).tx;
  }
  const r = await query(`select * from transactions where id=$1`, [t.id]);
  return mapTx(r.rows[0]);
}

export async function withIdempotency(userId: string, key: string | undefined, hash: string, create: () => Promise<Tx>): Promise<{ tx: Tx; replayed: boolean }> {
  const prior = await findIdempotent(userId, key, hash);
  if (prior) return { tx: prior, replayed: true };
  try {
    return { tx: await create(), replayed: false };
  } catch (e: any) {
    if (e?.code === "23505" && key) {
      const again = await findIdempotent(userId, key, hash);
      if (again) return { tx: again, replayed: true };
    }
    throw e;
  }
}
