import type { CardProvider } from "./types";
import { ProviderNotImplemented } from "./types";

/**
 * CARD PARTNER ADAPTER (stub). The PRD does not name a partner. Sudo Africa publicly
 * markets a virtual and physical card issuing API with a sandbox, so it is a candidate,
 * but confirm endpoints, KYC requirements, funding model and webhooks with the partner
 * you sign. Rules for the finished adapter:
 *  - Never store PAN/CVV. `reveal` must return short-lived data (or use the partner's
 *    secure display widget) and must not be logged.
 *  - Funding must be idempotent on `ref`.
 *  - Every state change should arrive by webhook AND be re-readable via getCard.
 */
export function cardPartner(): CardProvider {
  const nope = (what: string): never => { throw new ProviderNotImplemented("card-partner", what); };
  return {
    name: "partner",
    issueVirtual: async () => nope("issueVirtual"),
    requestPhysical: async () => nope("requestPhysical"),
    setFrozen: async () => nope("setFrozen"),
    setLimits: async () => nope("setLimits"),
    fund: async () => nope("fund"),
    getCard: async () => nope("getCard"),
    getFundingStatus: async () => nope("getFundingStatus"),
    activate: async () => nope("activate"),
    reveal: async () => nope("reveal"),
    verifyWebhook: () => ({ valid: false, error: "card partner webhook verification not implemented" }),
  };
}
