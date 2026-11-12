import { Asset, parseAmount } from "./money";

/** Everything here is SANDBOX PLACEHOLDER configuration. Replace with provider data and your commercial terms. */

export interface Network {
  id: string;
  label: string;
  assets: Asset[];
  address: RegExp;
  confirmations: number;
  eta: string;
}
export const NETWORKS: Network[] = [
  { id: "TRC20", label: "Tron (TRC20)", assets: ["USDT"], address: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, confirmations: 19, eta: "about 1 minute" },
  { id: "ERC20", label: "Ethereum (ERC20)", assets: ["USDT", "USDC"], address: /^0x[a-fA-F0-9]{40}$/, confirmations: 12, eta: "2 to 5 minutes" },
  { id: "BEP20", label: "BNB Smart Chain (BEP20)", assets: ["USDT", "USDC"], address: /^0x[a-fA-F0-9]{40}$/, confirmations: 15, eta: "about 1 minute" },
  { id: "BTC", label: "Bitcoin", assets: ["BTC"], address: /^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, confirmations: 2, eta: "10 to 30 minutes" },
  { id: "ETH", label: "Ethereum", assets: ["ETH"], address: /^0x[a-fA-F0-9]{40}$/, confirmations: 12, eta: "2 to 5 minutes" },
];
export const networksFor = (a: Asset) => NETWORKS.filter((n) => n.assets.includes(a));
export const network = (id: string) => NETWORKS.find((n) => n.id === id);

/** Flat network fees charged on crypto withdrawals, in display units (parsed per asset). */
const WITHDRAW_FEE_DISPLAY: Record<string, string> = {
  "USDT:TRC20": "1", "USDT:ERC20": "5", "USDT:BEP20": "0.5",
  "USDC:ERC20": "5", "USDC:BEP20": "0.5",
  "BTC:BTC": "0.0002", "ETH:ETH": "0.002",
};
const WITHDRAW_MIN_DISPLAY: Record<string, string> = {
  "USDT:TRC20": "5", "USDT:ERC20": "20", "USDT:BEP20": "5", "USDC:ERC20": "20", "USDC:BEP20": "5", "BTC:BTC": "0.0005", "ETH:ETH": "0.01",
};
export const withdrawFee = (a: Asset, n: string) => parseAmount(WITHDRAW_FEE_DISPLAY[`${a}:${n}`] ?? "0", a);
export const withdrawMin = (a: Asset, n: string) => parseAmount(WITHDRAW_MIN_DISPLAY[`${a}:${n}`] ?? "1", a);

export const SWAP_FEE_BPS = 50n;           // 0.50% of the amount being swapped
export const SWAP_QUOTE_TTL_SECONDS = 30;
export const SWAP_MIN_NGN_VALUE = 1_000_00n; // ₦1,000 in kobo
export const NGN_BANK_PAYOUT_FEE = 50_00n;  // ₦50
export const CARD_FUNDING_FEE = 100_00n;    // ₦100 flat
export const CARD_FUNDING_MIN = 500_00n;

/** KYC tiers. Daily limits apply to money leaving the platform (withdrawals, bills, card funding). */
export const TIERS = {
  0: { label: "Tier 0: Email only", dailyOutKobo: 0n, cards: false, requirement: "Verify your phone number to unlock withdrawals" },
  1: { label: "Tier 1: Phone verified", dailyOutKobo: 200_000_00n, cards: false, requirement: "Verify your BVN to raise limits and unlock cards" },
  2: { label: "Tier 2: BVN verified", dailyOutKobo: 5_000_000_00n, cards: true, requirement: "Highest tier available in this release" },
} as const;
export type Tier = keyof typeof TIERS;

export const CARD_LIMIT_CEILING = { perTx: 500_000_00n, daily: 1_000_000_00n, monthly: 5_000_000_00n };
export const CARD_DEFAULT_LIMITS = { perTx: 200_000_00n, daily: 500_000_00n, monthly: 2_000_000_00n };

// ---------------- Bills ----------------
export type BillCategory = "airtime" | "data" | "electricity" | "cable";
export interface BillPlan { code: string; label: string; price: bigint /* kobo */ }
export interface BillProviderEntry { code: string; label: string; plans?: BillPlan[]; kinds?: string[] }

const N = (v: number) => BigInt(v) * 100n;
const dataPlans = (p: string): BillPlan[] => [
  { code: `${p}-1gb-7d`, label: "1 GB, 7 days", price: N(500) },
  { code: `${p}-3gb-30d`, label: "3 GB, 30 days", price: N(1500) },
  { code: `${p}-10gb-30d`, label: "10 GB, 30 days", price: N(3500) },
];
const NETWORKS_TELCO = [
  { code: "mtn", label: "MTN" }, { code: "airtel", label: "Airtel" }, { code: "glo", label: "Glo" }, { code: "9mobile", label: "9mobile" },
];
export const BILLS: Record<BillCategory, { label: string; identifierLabel: string; identifier: RegExp; fee: bigint; min: bigint; max: bigint; providers: BillProviderEntry[] }> = {
  airtime: { label: "Airtime", identifierLabel: "Phone number", identifier: /^0[789][01]\d{8}$/, fee: 0n, min: N(50), max: N(50_000), providers: NETWORKS_TELCO },
  data: { label: "Data", identifierLabel: "Phone number", identifier: /^0[789][01]\d{8}$/, fee: 0n, min: N(50), max: N(50_000), providers: NETWORKS_TELCO.map((n) => ({ ...n, plans: dataPlans(n.code) })) },
  electricity: {
    label: "Electricity", identifierLabel: "Meter number", identifier: /^\d{10,13}$/, fee: N(100), min: N(1_000), max: N(500_000),
    providers: ["Ikeja Electric", "Eko Electric", "Abuja Electric", "Ibadan Electric", "Port Harcourt Electric", "Enugu Electric"].map((l) => ({
      code: l.toLowerCase().replace(/\s+/g, "-"), label: l, kinds: ["prepaid", "postpaid"],
    })),
  },
  cable: {
    label: "Cable TV", identifierLabel: "Smartcard / IUC number", identifier: /^\d{10,11}$/, fee: N(100), min: N(1_000), max: N(100_000),
    providers: [
      { code: "dstv", label: "DStv", plans: [{ code: "dstv-padi", label: "Padi", price: N(4_400) }, { code: "dstv-yanga", label: "Yanga", price: N(6_000) }, { code: "dstv-compact", label: "Compact", price: N(15_700) }] },
      { code: "gotv", label: "GOtv", plans: [{ code: "gotv-smallie", label: "Smallie", price: N(1_900) }, { code: "gotv-jinja", label: "Jinja", price: N(3_900) }, { code: "gotv-max", label: "Max", price: N(8_500) }] },
      { code: "startimes", label: "StarTimes", plans: [{ code: "st-nova", label: "Nova", price: N(1_900) }, { code: "st-basic", label: "Basic", price: N(3_700) }] },
    ],
  },
};
export const isBillCategory = (s: string): s is BillCategory => s in BILLS;
export const normalizePhone = (s: string) => s.replace(/[\s-]/g, "").replace(/^\+234/, "0").replace(/^234/, "0");

// ---------------- Banks (placeholder list; replace with the provider's bank list endpoint) ----------------
export const BANKS = [
  { code: "058", name: "GTBank" }, { code: "044", name: "Access Bank" }, { code: "057", name: "Zenith Bank" },
  { code: "033", name: "UBA" }, { code: "011", name: "First Bank" }, { code: "232", name: "Sterling Bank" },
  { code: "035", name: "Wema Bank" }, { code: "50515", name: "Moniepoint" }, { code: "999992", name: "OPay" }, { code: "999991", name: "PalmPay" },
];

// ---------------- Gift cards ----------------
export interface GiftBrand { id: string; label: string; ngnPerUsd: number; types: ("ecode" | "physical")[]; notes: string }
export const GIFT_BRANDS: GiftBrand[] = [
  { id: "amazon", label: "Amazon", ngnPerUsd: 1090, types: ["ecode", "physical"], notes: "Receipts are not required for e-codes." },
  { id: "apple", label: "Apple / iTunes", ngnPerUsd: 1120, types: ["ecode", "physical"], notes: "Include the full 16-character code." },
  { id: "steam", label: "Steam", ngnPerUsd: 1040, types: ["ecode", "physical"], notes: "Wallet cards only. No game keys." },
  { id: "googleplay", label: "Google Play", ngnPerUsd: 980, types: ["ecode"], notes: "US region cards only." },
  { id: "razer", label: "Razer Gold", ngnPerUsd: 960, types: ["ecode"], notes: "PIN must be unredeemed." },
  { id: "vanilla", label: "Vanilla Visa", ngnPerUsd: 900, types: ["physical"], notes: "Upload the front and back, plus the receipt." },
  { id: "walmart", label: "Walmart", ngnPerUsd: 880, types: ["physical", "ecode"], notes: "Clear, uncropped photos only." },
  { id: "ebay", label: "eBay", ngnPerUsd: 950, types: ["ecode"], notes: "US region cards only." },
];
export const GIFT_CURRENCIES: Record<string, { label: string; perUsd: number; country: string }> = {
  USD: { label: "US Dollar", perUsd: 1, country: "United States" },
  GBP: { label: "British Pound", perUsd: 1.27, country: "United Kingdom" },
  EUR: { label: "Euro", perUsd: 1.08, country: "Europe" },
  CAD: { label: "Canadian Dollar", perUsd: 0.73, country: "Canada" },
};
export const GIFT_EST_REVIEW_MINUTES = 30;
export const GIFT_MAX_IMAGES = 3;
export const GIFT_MAX_IMAGE_BYTES = 1_000_000;
export const GIFT_MIN_USD = 10;
export const GIFT_MAX_USD = 2_000;
