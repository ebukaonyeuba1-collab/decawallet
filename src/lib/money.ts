/** Integer minor-unit money. No floating point is ever used for balances. */

export const ASSETS = {
  NGN: { name: "Naira", symbol: "₦", decimals: 2, fiat: true },
  USDT: { name: "Tether", symbol: "USDT", decimals: 6, fiat: false },
  USDC: { name: "USD Coin", symbol: "USDC", decimals: 6, fiat: false },
  BTC: { name: "Bitcoin", symbol: "BTC", decimals: 8, fiat: false },
  ETH: { name: "Ethereum", symbol: "ETH", decimals: 8, fiat: false }, // platform precision: 8dp
} as const;

export type Asset = keyof typeof ASSETS;
export const ASSET_LIST = Object.keys(ASSETS) as Asset[];
export const CRYPTO_ASSETS = ASSET_LIST.filter((a) => !ASSETS[a].fiat);
export const isAsset = (s: unknown): s is Asset => typeof s === "string" && s in ASSETS;

export const big = (v: unknown): bigint => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(String(v ?? "0").split(".")[0]);
};

export const pow10 = (n: number) => 10n ** BigInt(n);

/** Parses a user-entered decimal string ("12.5") into minor units. Throws on bad input. */
export function parseAmount(input: string, asset: Asset): bigint {
  const { decimals } = ASSETS[asset];
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a valid amount");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`${asset} supports up to ${decimals} decimal places`);
  return BigInt(whole) * pow10(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Plain decimal string with full precision, no grouping: "12.500000". */
export function toDecimalString(v: bigint | string, asset: Asset): string {
  const { decimals } = ASSETS[asset];
  const n = big(v);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = pow10(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole}${decimals ? "." + frac : ""}`;
}

/** Display format. NGN: always 2dp. Crypto: trims trailing zeros but keeps >= minDp. */
export function formatAmount(v: bigint | string, asset: Asset, opts: { symbol?: boolean; minDp?: number } = {}): string {
  const { decimals, symbol, fiat } = ASSETS[asset];
  const full = toDecimalString(v, asset);
  const neg = full.startsWith("-");
  let [whole, frac = ""] = full.replace("-", "").split(".");
  const minDp = fiat ? 2 : opts.minDp ?? 2;
  frac = frac.replace(/0+$/, "").padEnd(Math.min(minDp, decimals), "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = `${neg ? "-" : ""}${grouped}${frac ? "." + frac : ""}`;
  if (opts.symbol === false) return num;
  return fiat ? `${symbol}${num}` : `${num} ${symbol}`;
}

export const minOf = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxOf = (a: bigint, b: bigint) => (a > b ? a : b);
