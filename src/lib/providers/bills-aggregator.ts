import type { BillsProvider } from "./types";
import { ProviderNotImplemented } from "./types";

/**
 * BILLS AGGREGATOR ADAPTER (stub). The PRD does not name a bills provider. Evaluate a
 * Nigerian aggregator (airtime, data, electricity tokens, cable) for sandbox quality,
 * requery endpoints and webhook support before choosing. Requirements:
 *  - Send `ref` as the unique request id so retries are idempotent.
 *  - Treat "pending/processing" as pending, never as failed (money may still be taken).
 *  - Always requery before refunding a customer.
 */
export function billsAggregator(): BillsProvider {
  const nope = (what: string): never => { throw new ProviderNotImplemented("bills-aggregator", what); };
  return {
    name: "aggregator",
    validateCustomer: async () => nope("validateCustomer"),
    purchase: async () => nope("purchase"),
    getOperationStatus: async () => nope("getOperationStatus"),
    verifyWebhook: () => ({ valid: false, error: "bills webhook verification not implemented" }),
  };
}
