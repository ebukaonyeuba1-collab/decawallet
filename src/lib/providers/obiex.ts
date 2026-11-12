import type { CryptoProvider } from "./types";
import { ProviderNotImplemented } from "./types";

/**
 * OBIEX ADAPTER (stub, intentionally not wired to guessed endpoints).
 *
 * Verified from Obiex's own public pages: REST API with bearer-token auth, sandbox
 * access, wallets, swaps with RFQ price locking, NGN on/off-ramp rails, and
 * real-time webhooks. Endpoint-level docs are shared via Obiex (Postman collection).
 *
 * To finish this adapter, using Obiex's official docs and sandbox:
 *  1. Map getDepositAddress to their wallet/address creation call.
 *  2. Map createWithdrawal / createBankPayout, passing `ref` as the client reference
 *     (idempotency key) so retries cannot double-pay.
 *  3. Map executeSwap to their quote-then-execute flow (store their quote id in meta).
 *  4. Map getOperationStatus / getDeposit to their status lookups (this is what
 *     server-side verification of webhooks relies on).
 *  5. Implement verifyWebhook exactly as documented (header names, algorithm,
 *     timestamp tolerance). providers/webhook.ts has an HMAC helper.
 *  6. Translate their statuses to ProviderState in ONE place.
 */
export function obiexCrypto(): CryptoProvider {
  const nope = (what: string): never => { throw new ProviderNotImplemented("obiex", what); };
  return {
    name: "obiex",
    getDepositAddress: async () => nope("getDepositAddress"),
    createWithdrawal: async () => nope("createWithdrawal"),
    createBankPayout: async () => nope("createBankPayout"),
    executeSwap: async () => nope("executeSwap"),
    getOperationStatus: async () => nope("getOperationStatus"),
    getDeposit: async () => nope("getDeposit"),
    resolveBankAccount: async () => nope("resolveBankAccount"),
    verifyWebhook: () => ({ valid: false, error: "obiex webhook verification not implemented" }),
  };
}
