import { query, one } from "../db";
import { appHmac, hmacHex, randomToken } from "../security";
import { big, Asset } from "../money";
import { network } from "../catalog";
import { verifyHmac } from "./webhook";
import type { BillsProvider, CardProvider, CryptoProvider, DepositInfo, KycProvider, ProviderState, ProviderStatus, Submitted, WebhookVerdict } from "./types";

/**
 * SANDBOX PROVIDERS. They behave like asynchronous real providers (pending ->
 * processing -> success/failed/reversed over time) and keep their state in the
 * `mock_provider_ops` table so it survives serverless cold starts.
 *
 * Deterministic triggers (documented in README):
 *   crypto address ending 0000 / 1111 -> withdrawal FAILS; ending 9999 -> succeeds then is REVERSED
 *   bank account / phone / meter / smartcard ending 0000 -> FAILS; ending 9999 -> REVERSED
 *   BVN ending 0000 -> verification fails
 */
export const mockWebhookSecret = () => appHmac("mock-webhook-secret");
const ref = (r: string) => `mock_${r}`;

interface Op { provider_ref: string; kind: string; payload: any; outcome: string; delay_seconds: number; forced_status: string | null; forced_reason: string | null; created_at: Date }

async function createOp(providerRef: string, kind: string, outcome: "success" | "fail" | "reversed", delay: number, payload: object = {}) {
  await query(
    `insert into mock_provider_ops (provider_ref, kind, payload, outcome, delay_seconds) values ($1,$2,$3,$4,$5) on conflict (provider_ref) do nothing`,
    [providerRef, kind, JSON.stringify(payload), outcome, delay],
  );
}
const getOp = (providerRef: string) => one<Op>({ query } as any, `select * from mock_provider_ops where provider_ref=$1`, [providerRef]);
const ageSeconds = (op: Op) => (Date.now() - new Date(op.created_at).getTime()) / 1000;

function stateOf(op: Op): ProviderStatus {
  if (op.forced_status) return { state: op.forced_status as ProviderState, reason: op.forced_reason ?? undefined, providerRef: op.provider_ref };
  const age = ageSeconds(op), d = op.delay_seconds;
  const early: ProviderState = age < d / 2 ? "pending" : "processing";
  if (age < d) return { state: early, providerRef: op.provider_ref };
  if (op.outcome === "fail") return { state: "failed", reason: "Declined by the (sandbox) provider", providerRef: op.provider_ref };
  if (op.outcome === "reversed") return age < d * 4 ? { state: "success", providerRef: op.provider_ref } : { state: "reversed", reason: "Reversed by the (sandbox) provider", providerRef: op.provider_ref };
  return { state: "success", providerRef: op.provider_ref };
}
const verdict = (rawBody: string, headers: Headers): WebhookVerdict => {
  const ok = verifyHmac({ secret: mockWebhookSecret(), rawBody, signature: headers.get("x-deca-signature"), timestamp: headers.get("x-deca-timestamp") });
  if (!ok) return { valid: false, error: "bad signature or stale timestamp" };
  try {
    const e = JSON.parse(rawBody);
    if (typeof e?.id !== "string" || !["deposit", "operation", "card"].includes(e.kind)) return { valid: false, error: "malformed event" };
    return { valid: true, event: { id: e.id, kind: e.kind, ref: e.ref, providerRef: e.providerRef } };
  } catch { return { valid: false, error: "invalid json" }; }
};
const submitted = (op: Op | null, providerRef: string): Submitted => {
  const s = op ? stateOf(op) : { state: "pending" as ProviderState };
  return { providerRef, state: s.state, reason: s.reason };
};
const outcomeFor = (id: string): "success" | "fail" | "reversed" => (id.endsWith("0000") || id.endsWith("1111") ? "fail" : id.endsWith("9999") ? "reversed" : "success");

export const mockCrypto: CryptoProvider = {
  name: "mock",
  async getDepositAddress({ userId, asset, network: net }) {
    return { address: `SBX-${net}-${hmacHex("mock-addr", `${userId}:${asset}:${net}`).slice(0, 26).toUpperCase()}` };
  },
  async createWithdrawal({ ref: r, asset, network: net, address, amount }) {
    await createOp(ref(r), "withdrawal", outcomeFor(address), 6, { asset, net, address, amount: amount.toString() });
    return submitted(await getOp(ref(r)), ref(r));
  },
  async createBankPayout({ ref: r, bankCode, accountNumber, amount }) {
    await createOp(ref(r), "bank_payout", outcomeFor(accountNumber), 8, { bankCode, accountNumber, amount: amount.toString() });
    return submitted(await getOp(ref(r)), ref(r));
  },
  async executeSwap({ ref: r, from, to, fromAmount, toAmount }) {
    await createOp(ref(r), "swap", "success", 0, { from, to, fromAmount: fromAmount.toString(), toAmount: toAmount.toString() });
    return submitted(await getOp(ref(r)), ref(r));
  },
  async getOperationStatus(r) {
    const op = await getOp(ref(r));
    return op ? stateOf(op) : { state: "not_found" };
  },
  async getDeposit(providerRef): Promise<DepositInfo | null> {
    const op = await getOp(providerRef);
    if (!op || op.kind !== "deposit") return null;
    const p = op.payload;
    const required = network(p.network)?.confirmations ?? 1;
    const age = ageSeconds(op);
    const confirmations = op.forced_status === "success" ? required : Math.min(required, Math.floor((age / op.delay_seconds) * required));
    let st = stateOf({ ...op, delay_seconds: op.delay_seconds });
    if (!op.forced_status && st.state === "success" && confirmations < required) st = { state: "processing" };
    return { providerRef, address: p.address, asset: p.asset as Asset, network: p.network, amount: big(p.amount), confirmations, required, state: st.state, reason: st.reason };
  },
  async resolveBankAccount({ accountNumber }) {
    if (!/^\d{10}$/.test(accountNumber) || accountNumber.endsWith("0000")) throw new Error("Account not found. Check the number and bank.");
    return { accountName: "SANDBOX ACCOUNT HOLDER" };
  },
  verifyWebhook: verdict,
};

export const mockBills: BillsProvider = {
  name: "mock",
  async validateCustomer({ identifier }) {
    return { customerName: identifier.endsWith("0000") ? "SANDBOX CUSTOMER (will fail)" : "SANDBOX CUSTOMER" };
  },
  async purchase({ ref: r, category, identifier, amount, providerCode }) {
    await createOp(ref(r), "bill", outcomeFor(identifier), 5, { category, identifier, providerCode, amount: amount.toString() });
    return submitted(await getOp(ref(r)), ref(r));
  },
  async getOperationStatus(r) {
    const op = await getOp(ref(r));
    if (!op) return { state: "not_found" };
    const s = stateOf(op);
    if (s.state === "success" && op.payload.category === "electricity") {
      const t = hmacHex("mock-token", r).replace(/\D/g, "").padEnd(20, "7").slice(0, 20);
      s.detail = { token: t.replace(/(\d{4})(?=\d)/g, "$1-") };
    }
    return s;
  },
  verifyWebhook: verdict,
};

const STAGES = [
  { at: 0, stage: "processing", label: "Order received, card being personalised" },
  { at: 20, stage: "printed", label: "Card printed" },
  { at: 40, stage: "dispatched", label: "Dispatched with courier" },
  { at: 70, stage: "out_for_delivery", label: "Out for delivery" },
  { at: 100, stage: "delivered", label: "Delivered" },
];
export const mockCards: CardProvider = {
  name: "mock",
  async issueVirtual({ ref: r }) {
    const h = hmacHex("mock-card", r);
    const last4 = String(parseInt(h.slice(0, 6), 16) % 10000).padStart(4, "0");
    await createOp(ref(`card_${r}`), "card", "success", 0, { type: "virtual", last4, frozen: false, activated: true });
    return { providerRef: ref(`card_${r}`), last4, expiryMonth: new Date().getMonth() + 1, expiryYear: new Date().getFullYear() + 4, brand: "Sandbox Visa" };
  },
  async requestPhysical({ ref: r }) {
    const h = hmacHex("mock-card", r);
    const last4 = String(parseInt(h.slice(0, 6), 16) % 10000).padStart(4, "0");
    await createOp(ref(`card_${r}`), "card", "success", 0, { type: "physical", last4, frozen: false, activated: false });
    return { providerRef: ref(`card_${r}`), last4, expiryMonth: new Date().getMonth() + 1, expiryYear: new Date().getFullYear() + 4, brand: "Sandbox Visa" };
  },
  async setFrozen(p, frozen) { await query(`update mock_provider_ops set payload = payload || $2::jsonb where provider_ref=$1`, [p, JSON.stringify({ frozen })]); },
  async setLimits(p, l) { await query(`update mock_provider_ops set payload = payload || $2::jsonb where provider_ref=$1`, [p, JSON.stringify({ limits: { perTx: l.perTx.toString(), daily: l.daily.toString(), monthly: l.monthly.toString() } })]); },
  async fund({ ref: r, providerRef, amount }) {
    await createOp(ref(r), "card_fund", "success", 0, { providerRef, amount: amount.toString() });
    return submitted(await getOp(ref(r)), ref(r));
  },
  async getCard(p) {
    const op = await getOp(p);
    if (!op) throw new Error("Card not found at provider");
    const age = ageSeconds(op);
    const pay = op.payload;
    if (pay.type === "virtual") return { providerRef: p, status: pay.frozen ? "frozen" : "active" };
    const reached = STAGES.filter((s) => age >= s.at);
    const delivery = reached.map((s) => ({ stage: s.stage, label: s.label, at: new Date(new Date(op.created_at).getTime() + s.at * 1000).toISOString() }));
    const delivered = age >= 100;
    const status = !delivered ? "pending_delivery" : !pay.activated ? "awaiting_activation" : pay.frozen ? "frozen" : "active";
    return { providerRef: p, status, delivery };
  },
  async getFundingStatus(r) {
    const op = await getOp(ref(r));
    return op ? stateOf(op) : { state: "not_found" };
  },
  async activate(p, last4) {
    const op = await getOp(p);
    if (!op || op.payload.last4 !== last4) throw new Error("Those digits do not match this card");
    if (ageSeconds(op) < 100) throw new Error("This card has not been delivered yet");
    await query(`update mock_provider_ops set payload = payload || '{"activated":true}'::jsonb where provider_ref=$1`, [p]);
  },
  async reveal(p) {
    const op = await getOp(p);
    if (!op) throw new Error("Card not found");
    return { pan: `4000 00${randomToken(3).replace(/\D/g, "7").slice(0, 2)}00 00${op.payload.last4.slice(0, 2)} ${op.payload.last4}`.replace(/\s+/g, " "), cvv: "000", sandbox: true };
  },
  verifyWebhook: verdict,
};

export const mockKyc: KycProvider = {
  name: "mock",
  async verifyBvn({ bvn }) {
    if (!/^\d{11}$/.test(bvn)) return { verified: false, reason: "BVN must be 11 digits" };
    if (bvn.endsWith("0000")) return { verified: false, reason: "We could not match this BVN to your name" };
    return { verified: true };
  },
};

/** Sandbox-only helper: force a provider-side state (used by the admin simulator). */
export async function mockForce(providerRef: string, state: ProviderState, reason?: string) {
  await query(`update mock_provider_ops set forced_status=$2, forced_reason=$3 where provider_ref=$1`, [providerRef, state, reason ?? null]);
}
export async function mockCreateDeposit(i: { txHash: string; userId: string; address: string; asset: Asset; network: string; amount: bigint; delay?: number }) {
  await createOp(i.txHash, "deposit", "success", i.delay ?? 15, { userId: i.userId, address: i.address, asset: i.asset, network: i.network, amount: i.amount.toString() });
}
export const mockRefOf = ref;
