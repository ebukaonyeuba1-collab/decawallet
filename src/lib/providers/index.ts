import { isSandbox, liveMoneyAllowed, mode, providerName } from "../env";
import type { BillsProvider, CardProvider, CryptoProvider, KycProvider } from "./types";
import { mockBills, mockCards, mockCrypto, mockKyc } from "./mock";
import { obiexCrypto } from "./obiex";
import { cardPartner } from "./card-partner";
import { billsAggregator } from "./bills-aggregator";

/** Every provider handle goes through this guard. Live money requires two explicit switches. */
function guard(name: string) {
  if (mode() === "live") {
    if (!liveMoneyAllowed()) throw new Error("DECA_MODE=live requires ALLOW_LIVE_MONEY=true. Refusing to move money.");
    if (name === "mock") throw new Error("The mock provider cannot be used in live mode.");
  }
}
function unknown(kind: string, name: string): never {
  throw new Error(`Unknown ${kind} provider "${name}". Use "mock" or register an adapter in src/lib/providers/index.ts`);
}

export function crypto(): CryptoProvider {
  const n = providerName("CRYPTO"); guard(n);
  if (n === "mock") return mockCrypto;
  if (n === "obiex") return obiexCrypto();
  return unknown("crypto", n);
}
export function bills(): BillsProvider {
  const n = providerName("BILLS"); guard(n);
  if (n === "mock") return mockBills;
  if (n === "aggregator") return billsAggregator();
  return unknown("bills", n);
}
export function cards(): CardProvider {
  const n = providerName("CARDS"); guard(n);
  if (n === "mock") return mockCards;
  if (n === "partner") return cardPartner();
  return unknown("cards", n);
}
export function kyc(): KycProvider {
  const n = providerName("KYC"); guard(n);
  if (n === "mock") return mockKyc;
  return unknown("kyc", n);
}
export const sandboxToolsEnabled = () => isSandbox() && providerName("CRYPTO") === "mock";
