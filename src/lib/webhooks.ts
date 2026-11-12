import { one, query, tx as dbTx, Q } from "./db";
import { bills, cards, crypto } from "./providers";
import type { CardSnapshot, DepositInfo, ProviderStatus, WebhookEvent } from "./providers/types";
import { applyStatusTx, insertTx, mapTx, raiseFlag } from "./transactions";
import { ledger } from "./ledger";
import { randomToken } from "./security";

export type WebhookCategory = "crypto" | "bills" | "cards";
export interface WebhookResult { status: number; body: { ok: boolean; outcome: string } }

type Prepared =
  | { kind: "deposit"; info: DepositInfo | null }
  | { kind: "operation"; ref: string; status: ProviderStatus }
  | { kind: "card"; providerRef: string; snapshot: CardSnapshot }
  | { kind: "ignored"; why: string };

/**
 * Secure webhook handling, in this order:
 *  1. Verify the signature over the RAW body (+ timestamp window). Invalid -> 401, nothing processed.
 *  2. Do NOT trust the payload's status. Ask the provider server-side what the truth is.
 *  3. In ONE database transaction: record the event id (unique -> duplicates are dropped) and apply
 *     the verified status through the idempotent state machine.
 * If step 2 or 3 throws we return 500 BEFORE the event id is stored, so provider retries still work.
 */
export async function processWebhook(category: WebhookCategory, rawBody: string, headers: Headers): Promise<WebhookResult> {
  const adapter = category === "crypto" ? crypto() : category === "bills" ? bills() : cards();
  const verdict = adapter.verifyWebhook(rawBody, headers);

  if (!verdict.valid || !verdict.event) {
    await query(`insert into webhook_events (provider, event_id, signature_valid, outcome) values ($1,$2,false,$3)`,
      [adapter.name, `invalid-${randomToken(9)}`, (verdict.error ?? "invalid").slice(0, 120)]).catch(() => {});
    return { status: 401, body: { ok: false, outcome: "invalid_signature" } };
  }
  const ev = verdict.event;

  // Cheap duplicate short-circuit (the unique index below is the real guarantee).
  const seen = await query(`select 1 from webhook_events where provider=$1 and event_id=$2`, [adapter.name, ev.id]);
  if (seen.rows.length) return { status: 200, body: { ok: true, outcome: "duplicate" } };

  const prepared = await prepare(category, ev);

  const outcome = await dbTx(async (q) => {
    const ins = await q.query(
      `insert into webhook_events (provider, event_id, signature_valid, payload) values ($1,$2,true,$3) on conflict (provider, event_id) do nothing returning id`,
      [adapter.name, ev.id, rawBody.length < 20_000 ? rawBody : JSON.stringify({ truncated: true })]);
    if (!ins.rows.length) return "duplicate";
    const out = await apply(q, adapter.name, prepared);
    await q.query(`update webhook_events set outcome=$2, processed_at=now() where id=$1`, [ins.rows[0].id, out]);
    return out;
  });
  return { status: 200, body: { ok: true, outcome } };
}

async function prepare(category: WebhookCategory, ev: WebhookEvent): Promise<Prepared> {
  if (category === "crypto" && ev.kind === "deposit") {
    if (!ev.providerRef) return { kind: "ignored", why: "missing_reference" };
    return { kind: "deposit", info: await crypto().getDeposit(ev.providerRef) };
  }
  if ((category === "crypto" || category === "bills") && ev.kind === "operation") {
    if (!ev.ref) return { kind: "ignored", why: "missing_reference" };
    const status = category === "crypto" ? await crypto().getOperationStatus(ev.ref) : await bills().getOperationStatus(ev.ref);
    return { kind: "operation", ref: ev.ref, status };
  }
  if (category === "cards" && ev.kind === "card") {
    if (!ev.providerRef) return { kind: "ignored", why: "missing_reference" };
    return { kind: "card", providerRef: ev.providerRef, snapshot: await cards().getCard(ev.providerRef) };
  }
  return { kind: "ignored", why: "unsupported_event" };
}

async function apply(q: Q, provider: string, p: Prepared): Promise<string> {
  if (p.kind === "ignored") return `ignored:${p.why}`;

  if (p.kind === "operation") {
    const row = await one(q, `select id from transactions where ref=$1`, [p.ref]);
    if (!row) { await raiseFlag(q, null, "webhook_unknown_reference", `Webhook for unknown reference ${p.ref}`); return "unknown_reference"; }
    const r = await applyStatusTx(q, row.id, { state: p.status.state, reason: p.status.reason, detail: p.status.detail }, "webhook");
    return r.flagged ? `flagged:${r.flagged}` : r.changed ? `applied:${r.tx.status}` : "no_change";
  }

  if (p.kind === "card") {
    const { applyCardSnapshot } = await import("./services/cards");
    return applyCardSnapshot(q, p.providerRef, p.snapshot);
  }

  // Deposit: the AMOUNT, ASSET and ADDRESS come from the provider lookup, never from the webhook payload.
  const info = p.info;
  if (!info) { await raiseFlag(q, null, "webhook_unknown_deposit", "Deposit webhook could not be verified with the provider"); return "unverified_deposit"; }
  const addr = await one(q, `select user_id from deposit_addresses where address=$1`, [info.address]);
  if (!addr) { await raiseFlag(q, null, "deposit_unknown_address", `Deposit ${info.providerRef} to unknown address ${info.address}`); return "unknown_address"; }

  let row = await one(q, `select * from transactions where provider=$1 and provider_ref=$2 for update`, [provider, info.providerRef]);
  if (!row) {
    const t = await insertTx(q, {
      userId: addr.user_id, type: "crypto_deposit", asset: info.asset, amount: info.amount, provider, providerRef: info.providerRef,
      meta: { network: info.network, address: info.address, confirmations: info.confirmations, required: info.required },
    }, "webhook", "Deposit detected");
    await ledger.incoming(q, addr.user_id, info.asset, info.amount, t.id);
    row = { id: t.id };
  }
  const r = await applyStatusTx(q, row.id, { state: info.state, reason: info.reason }, "webhook");
  if (!r.changed) {
    await q.query(`update transactions set meta = meta || $2::jsonb where id=$1 and status in ('pending','processing')`, [row.id, JSON.stringify({ confirmations: info.confirmations, required: info.required })]);
  }
  return r.flagged ? `flagged:${r.flagged}` : r.changed ? `applied:${r.tx.status}` : "no_change";
}
export { mapTx };
