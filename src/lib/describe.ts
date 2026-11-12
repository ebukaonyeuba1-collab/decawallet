import type { TxDTO } from "./serialize";
import { formatAmount, Asset } from "./money";

export const STATUS_COPY: Record<string, { label: string; tone: "warn" | "ok" | "bad" | "info" | "muted"; help: string }> = {
  pending: { label: "Pending", tone: "warn", help: "We have your request and are waiting on the network or provider. Your money is held safely." },
  processing: { label: "Processing", tone: "info", help: "In progress. This usually completes within a few minutes." },
  success: { label: "Successful", tone: "ok", help: "Done. This is final unless the provider reverses it, and we will tell you if that happens." },
  failed: { label: "Failed", tone: "bad", help: "This did not go through. Any money held for it has been returned to your available balance." },
  reversed: { label: "Reversed", tone: "bad", help: "The provider reversed this transaction. The money has been returned to your wallet." },
};

export function describeTx(t: Pick<TxDTO, "type" | "asset" | "counterAsset" | "meta">): string {
  const m = t.meta ?? {};
  switch (t.type) {
    case "crypto_deposit": return `${t.asset} deposit`;
    case "crypto_withdrawal": return `${t.asset} withdrawal`;
    case "ngn_withdrawal": return `Bank withdrawal${m.bankName ? ` to ${m.bankName}` : ""}`;
    case "swap": return `Swap ${t.asset} to ${t.counterAsset}`;
    case "bill_payment": return `${m.categoryLabel ?? "Bill"}${m.providerLabel ? `: ${m.providerLabel}` : ""}`;
    case "giftcard_payout": return `Gift card payout${m.brand ? `: ${m.brand}` : ""}`;
    case "card_funding": return `Card funding${m.last4 ? ` (•••• ${m.last4})` : ""}`;
  }
}
export const isCredit = (t: Pick<TxDTO, "type">) => t.type === "crypto_deposit" || t.type === "giftcard_payout";
export const headline = (t: TxDTO) => {
  const sign = isCredit(t) ? "+" : t.type === "swap" ? "" : "-";
  if (t.type === "swap") return `${formatAmount(t.amount, t.asset as Asset)} → ${formatAmount(t.counterAmount ?? "0", t.counterAsset as Asset)}`;
  return `${sign}${formatAmount(t.amount, t.asset as Asset)}`;
};
