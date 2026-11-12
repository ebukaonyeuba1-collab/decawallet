process.env.PGLITE_DIR = "memory://";
process.env.DECA_MODE = "sandbox";
import test from "node:test";
import assert from "node:assert/strict";
import { one, query } from "../src/lib/db";
import { signUp } from "../src/lib/services/account";
import { ledger, listWallets, verifyLedger } from "../src/lib/ledger";
import { createCryptoWithdrawal, createQuote, executeSwap } from "../src/lib/services/crypto";
import { payBill } from "../src/lib/services/bills";
import { applyStatus, reconcileTx } from "../src/lib/transactions";
import { processWebhook } from "../src/lib/webhooks";
import { signWebhook } from "../src/lib/providers/webhook";
import { mockCreateDeposit, mockForce, mockWebhookSecret } from "../src/lib/providers/mock";
import { getDepositAddress } from "../src/lib/services/crypto";
import { parseAmount, formatAmount } from "../src/lib/money";
import { computeQuote } from "../src/lib/rates";

const TRON = "TXyz1234567890abcdefghjkmnpqrstuvw"; // 34 chars, base58 body
const TRON_OK = "T" + "a".repeat(32) + "b";
const TRON_FAIL = "T" + "a".repeat(29) + "1111";

async function newUser(tier = 2) {
  const id = await signUp({ fullName: "Test User", email: `u${Math.random().toString(36).slice(2)}@example.com`, password: "password12345" });
  await query(`update users set kyc_tier=$2 where id=$1`, [id, tier]);
  const user = await one({ query } as any, `select * from users where id=$1`, [id]);
  return user;
}
const fund = async (u: any, asset: any, amt: string) => {
  const { tx } = await import("../src/lib/db");
  await tx(async (q) => { await ledger.credit(q, u.id, asset, parseAmount(amt, asset), null as any, "test_fund"); });
};
const bal = async (u: any, asset: string) => (await listWallets({ query } as any, u.id)).find((w) => w.asset === asset)!;
const hook = (category: any, body: object) => {
  const raw = JSON.stringify(body); const s = signWebhook(mockWebhookSecret(), raw);
  return processWebhook(category, raw, new Headers({ "x-deca-signature": s.signature, "x-deca-timestamp": s.timestamp }));
};

test("money formatting is exact", () => {
  assert.equal(parseAmount("12.5", "USDT"), 12_500_000n);
  assert.equal(formatAmount(12_500_000n, "USDT"), "12.50 USDT");
  assert.equal(formatAmount(123456789n, "NGN"), "₦1,234,567.89");
  assert.throws(() => parseAmount("1.1234567", "USDT"));
});

test("withdrawal holds funds, settles on provider success, ledger stays balanced", async () => {
  const u = await newUser(); await fund(u, "USDT", "100");
  const { tx } = await createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "20" }, "key-aaaaaaaa");
  assert.equal(tx.status, "pending");
  let w = await bal(u, "USDT");
  assert.equal(w.available, parseAmount("79", "USDT")); // 100 - 20 - 1 fee
  assert.equal(w.pending_out, parseAmount("21", "USDT"));
  await mockForce(tx.provider_ref!, "success");
  const done = await reconcileTx(tx.id);
  assert.equal(done!.status, "success");
  w = await bal(u, "USDT");
  assert.equal(w.pending_out, 0n);
  assert.equal(w.available, parseAmount("79", "USDT"));
  assert.ok((await verifyLedger({ query } as any)).ok);
});

test("idempotency: same key twice creates one transaction and one hold", async () => {
  const u = await newUser(); await fund(u, "USDT", "100");
  const a = await createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "10" }, "idem-key-001");
  const b = await createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "10" }, "idem-key-001");
  assert.equal(a.tx.id, b.tx.id); assert.equal(b.replayed, true);
  assert.equal((await bal(u, "USDT")).available, parseAmount("89", "USDT"));
  await assert.rejects(createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "11" }, "idem-key-001"), /different request/);
});

test("insufficient funds is rejected and leaves no trace", async () => {
  const u = await newUser(); await fund(u, "USDT", "10");
  await assert.rejects(createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "50" }, "key-insuf-01"), /Insufficient/);
  assert.equal((await bal(u, "USDT")).available, parseAmount("10", "USDT"));
  const n = await query(`select count(*)::int n from transactions where user_id=$1`, [u.id]);
  assert.equal(n.rows[0].n, 0);
});

test("concurrent withdrawals cannot overspend", async () => {
  const u = await newUser(); await fund(u, "USDT", "30");
  const results = await Promise.allSettled([1, 2, 3, 4].map((i) => createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "20" }, `race-key-00${i}`)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const w = await bal(u, "USDT");
  assert.ok(w.available >= 0n && w.available + w.pending_out === parseAmount("30", "USDT"));
});

test("failed withdrawal releases funds; a late success is flagged, not applied", async () => {
  const u = await newUser(); await fund(u, "USDT", "50");
  const { tx } = await createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_FAIL, amount: "10" }, "key-fail-001");
  await mockForce(tx.provider_ref!, "failed", "Declined");
  assert.equal((await reconcileTx(tx.id))!.status, "failed");
  assert.equal((await bal(u, "USDT")).available, parseAmount("50", "USDT"));
  const late = await applyStatus(tx.id, { state: "success" }, "webhook");
  assert.equal(late.flagged, "late_success_after_failure");
  assert.equal((await bal(u, "USDT")).available, parseAmount("50", "USDT"));
  assert.ok((await verifyLedger({ query } as any)).ok);
});

test("reversal after success refunds the user once (replays are no-ops)", async () => {
  const u = await newUser(); await fund(u, "NGN", "10000");
  const { tx } = await payBill(u, { category: "airtime", providerCode: "mtn", identifier: "08031234567", amount: "1000" }, "key-bill-0001");
  await applyStatus(tx.id, { state: "success" }, "provider");
  assert.equal((await bal(u, "NGN")).available, parseAmount("9000", "NGN"));
  await applyStatus(tx.id, { state: "reversed", reason: "x" }, "webhook");
  await applyStatus(tx.id, { state: "reversed", reason: "x" }, "webhook");
  assert.equal((await bal(u, "NGN")).available, parseAmount("10000", "NGN"));
  assert.ok((await verifyLedger({ query } as any)).ok);
});

test("webhooks: bad signature rejected, duplicates dropped, status verified server-side", async () => {
  const u = await newUser(); await fund(u, "NGN", "5000");
  const { tx } = await payBill(u, { category: "airtime", providerCode: "mtn", identifier: "08031234567", amount: "500" }, "key-bill-0002");
  const bad = await processWebhook("bills", JSON.stringify({ id: "e1", kind: "operation", ref: tx.ref }), new Headers({ "x-deca-signature": "00", "x-deca-timestamp": String(Math.floor(Date.now() / 1000)) }));
  assert.equal(bad.status, 401);
  // Payload CLAIMS success but the provider says it is still pending: we must not credit/settle.
  const r1 = await hook("bills", { id: "evt-1", kind: "operation", ref: tx.ref, status: "success" });
  assert.equal(r1.body.outcome, "no_change");
  await mockForce(tx.provider_ref!, "success");
  const r2 = await hook("bills", { id: "evt-2", kind: "operation", ref: tx.ref });
  assert.equal(r2.body.outcome, "applied:success");
  const r3 = await hook("bills", { id: "evt-2", kind: "operation", ref: tx.ref });
  assert.equal(r3.body.outcome, "duplicate");
  const stale = signWebhook(mockWebhookSecret(), "{}", Math.floor(Date.now() / 1000) - 3600);
  assert.equal((await processWebhook("bills", "{}", new Headers({ "x-deca-signature": stale.signature, "x-deca-timestamp": stale.timestamp }))).status, 401);
});

test("deposit via webhook: pending then confirmed, amount taken from provider lookup", async () => {
  const u = await newUser(0);
  const addr = await getDepositAddress(u, "USDT", "TRC20");
  const hash = "0xtesthash" + Math.random().toString(16).slice(2);
  await mockCreateDeposit({ txHash: hash, userId: u.id, address: addr.address, asset: "USDT", network: "TRC20", amount: parseAmount("250", "USDT"), delay: 3600 });
  const r1 = await hook("crypto", { id: "dep-1", kind: "deposit", providerRef: hash, amount: "999999" });
  assert.match(r1.body.outcome, /no_change|applied/);
  let w = await bal(u, "USDT");
  assert.equal(w.pending_in, parseAmount("250", "USDT")); assert.equal(w.available, 0n);
  await mockForce(hash, "success");
  assert.equal((await hook("crypto", { id: "dep-2", kind: "deposit", providerRef: hash })).body.outcome, "applied:success");
  w = await bal(u, "USDT");
  assert.equal(w.available, parseAmount("250", "USDT")); assert.equal(w.pending_in, 0n);
  assert.equal((await hook("crypto", { id: "dep-3", kind: "deposit", providerRef: hash })).body.outcome, "no_change");
  assert.equal((await bal(u, "USDT")).available, parseAmount("250", "USDT")); // never double-credited
  assert.ok((await verifyLedger({ query } as any)).ok);
});

test("swap quotes are single-use, expire, and convert without float math", async () => {
  const u = await newUser(0); await fund(u, "USDT", "100");
  const q = await createQuote(u, { from: "USDT", to: "NGN", amount: "10" });
  assert.equal(BigInt(q.fee), parseAmount("0.05", "USDT"));
  const a = await executeSwap(u, q.id, "swap-key-001");
  assert.ok(["success", "pending", "processing"].includes(a.tx.status));
  await assert.rejects(executeSwap(u, q.id, "swap-key-002"), /already used/);
  const q2 = await createQuote(u, { from: "USDT", to: "NGN", amount: "10" });
  await query(`update quotes set expires_at = now() - interval '1 minute' where id=$1`, [q2.id]);
  await assert.rejects(executeSwap(u, q2.id, "swap-key-003"), /expired/);
  assert.ok(computeQuote("BTC", "NGN", parseAmount("0.01", "BTC")).toAmount > 0n);
  assert.ok((await verifyLedger({ query } as any)).ok);
});

test("tier 0 users cannot withdraw", async () => {
  const u = await newUser(0); await fund(u, "USDT", "100");
  await assert.rejects(createCryptoWithdrawal(u, { asset: "USDT", network: "TRC20", address: TRON_OK, amount: "10" }, "key-tier0-01"), /Verify your phone/);
});
