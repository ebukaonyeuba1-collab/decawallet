import { ASSETS, Asset, ASSET_LIST, big, pow10, toDecimalString } from "./money";
import { SWAP_FEE_BPS } from "./catalog";

/**
 * SIMULATED rates. In production, replace `priceOf` with the provider's RFQ quote
 * (Obiex advertises RFQ-based price locking). The quote/lock/expiry mechanics in
 * the swap service stay exactly the same.
 */
const S = 10n ** 18n;                         // price scale
const USD: Record<Asset, bigint> = {          // USD per 1 whole unit (simulated mid prices)
  BTC: 95_000n * S, ETH: 3_300n * S, USDT: 1n * S, USDC: 1n * S, NGN: 0n,
};
export const SIM_NGN_PER_USD = 1550n;
USD.NGN = S / SIM_NGN_PER_USD;

/** Deterministic +/-15bps drift per 30s bucket so quotes feel alive but stay stable while locked. */
function jitterBps(asset: Asset, at: number): bigint {
  if (asset === "USDT" || asset === "USDC" || asset === "NGN") return 0n;
  const bucket = Math.floor(at / 30_000);
  return BigInt(Math.round(15 * Math.sin(bucket * 0.7 + ASSET_LIST.indexOf(asset))));
}
export function priceOf(asset: Asset, at = Date.now()): bigint {
  return (USD[asset] * (10_000n + jitterBps(asset, at))) / 10_000n;
}

export interface Quote { from: Asset; to: Asset; fromAmount: bigint; fee: bigint; toAmount: bigint; rate: string }

/** rate = units of `to` received per 1 unit of `from` (before fee). */
export function rateString(from: Asset, to: Asset, at = Date.now()): string {
  const r = (priceOf(from, at) * 10n ** 8n) / priceOf(to, at);
  const whole = r / 10n ** 8n, frac = (r % 10n ** 8n).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}

export function computeQuote(from: Asset, to: Asset, fromAmount: bigint, at = Date.now()): Quote {
  if (from === to) throw new Error("Choose two different assets");
  const fee = (fromAmount * SWAP_FEE_BPS + 9_999n) / 10_000n; // ceil: never undercharge
  const net = fromAmount - fee;
  const toAmount = (net * priceOf(from, at) * pow10(ASSETS[to].decimals)) / (priceOf(to, at) * pow10(ASSETS[from].decimals));
  return { from, to, fromAmount, fee, toAmount, rate: rateString(from, to, at) };
}

/** NGN (kobo) value of an amount, used for tier limits and dashboard totals. */
export function ngnValue(asset: Asset, amount: bigint, at = Date.now()): bigint {
  if (asset === "NGN") return amount;
  return (amount * priceOf(asset, at) * pow10(2)) / (priceOf("NGN", at) * pow10(ASSETS[asset].decimals));
}

export function rateBoard(at = Date.now()) {
  return (["BTC", "ETH", "USDT", "USDC"] as Asset[]).map((a) => ({
    asset: a,
    ngn: toDecimalString(ngnValue(a, pow10(ASSETS[a].decimals), at), "NGN"),
  }));
}
export { big };
