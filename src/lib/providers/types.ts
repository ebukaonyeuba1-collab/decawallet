import type { Asset } from "../money";

/** Provider-agnostic lifecycle. Adapters translate their own statuses into these. */
export type ProviderState = "pending" | "processing" | "success" | "failed" | "reversed" | "not_found";

export interface ProviderStatus {
  state: ProviderState;
  reason?: string;
  providerRef?: string;
  /** Extra verified data worth keeping on the receipt (e.g. electricity token). */
  detail?: Record<string, unknown>;
}
export interface Submitted { providerRef: string; state: ProviderState; reason?: string; detail?: Record<string, unknown> }

export interface DepositInfo {
  providerRef: string;       // e.g. on-chain tx hash
  address: string;
  asset: Asset;
  network: string;
  amount: bigint;            // minor units, as VERIFIED by the provider
  confirmations: number;
  required: number;
  state: ProviderState;
  reason?: string;
}

export interface WebhookEvent {
  id: string;                // provider's unique event id (used for de-duplication)
  kind: "deposit" | "operation" | "card";
  ref?: string;              // OUR reference, sent to the provider when the operation was created
  providerRef?: string;
}
export interface WebhookVerdict { valid: boolean; event?: WebhookEvent; error?: string }

export interface CryptoProvider {
  readonly name: string;
  getDepositAddress(i: { userId: string; asset: Asset; network: string }): Promise<{ address: string; memo?: string }>;
  createWithdrawal(i: { ref: string; asset: Asset; network: string; address: string; amount: bigint }): Promise<Submitted>;
  createBankPayout(i: { ref: string; amount: bigint; bankCode: string; accountNumber: string; accountName: string }): Promise<Submitted>;
  executeSwap(i: { ref: string; from: Asset; to: Asset; fromAmount: bigint; toAmount: bigint; rate: string }): Promise<Submitted>;
  getOperationStatus(ref: string): Promise<ProviderStatus>;
  getDeposit(providerRef: string): Promise<DepositInfo | null>;
  resolveBankAccount(i: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>;
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerdict;
}

export interface BillsProvider {
  readonly name: string;
  validateCustomer(i: { category: string; providerCode: string; identifier: string; kind?: string }): Promise<{ customerName: string }>;
  purchase(i: { ref: string; category: string; providerCode: string; identifier: string; amount: bigint; planCode?: string; kind?: string }): Promise<Submitted>;
  getOperationStatus(ref: string): Promise<ProviderStatus>;
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerdict;
}

export interface CardSnapshot {
  providerRef: string;
  status: "active" | "frozen" | "pending_delivery" | "awaiting_activation" | "terminated";
  delivery?: { stage: string; label: string; at: string }[];
}
export interface CardProvider {
  readonly name: string;
  issueVirtual(i: { ref: string; holderName: string }): Promise<{ providerRef: string; last4: string; expiryMonth: number; expiryYear: number; brand: string }>;
  requestPhysical(i: { ref: string; holderName: string; address: Record<string, string> }): Promise<{ providerRef: string; last4: string; expiryMonth: number; expiryYear: number; brand: string }>;
  setFrozen(providerRef: string, frozen: boolean): Promise<void>;
  setLimits(providerRef: string, l: { perTx: bigint; daily: bigint; monthly: bigint }): Promise<void>;
  fund(i: { ref: string; providerRef: string; amount: bigint }): Promise<Submitted>;
  getCard(providerRef: string): Promise<CardSnapshot>;
  getFundingStatus(ref: string): Promise<ProviderStatus>;
  activate(providerRef: string, last4: string): Promise<void>;
  reveal(providerRef: string): Promise<{ pan: string; cvv: string; sandbox: boolean }>;
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerdict;
}

export interface KycProvider {
  readonly name: string;
  verifyBvn(i: { bvn: string; fullName: string }): Promise<{ verified: boolean; reason?: string }>;
}

export class ProviderNotImplemented extends Error {
  constructor(provider: string, what: string) {
    super(`${provider}: ${what} is not implemented. Map it from the provider's official docs (see docs/PROVIDERS.md).`);
  }
}

/** Throw this from an adapter when the provider DEFINITIVELY rejected the request (so no money moved). */
export class ProviderRejected extends Error {}
