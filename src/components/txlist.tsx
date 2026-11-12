import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Receipt, CreditCard, Gift, Zap } from "lucide-react";
import type { Tx } from "@/lib/transactions";
import { serializeTx } from "@/lib/serialize";
import { describeTx, headline, isCredit } from "@/lib/describe";
import { StatusBadge, EmptyState } from "./ui";

const icon = (t: Tx) => t.type === "swap" ? ArrowLeftRight : t.type === "bill_payment" ? Zap : t.type === "card_funding" ? CreditCard : t.type === "giftcard_payout" ? Gift : isCredit(serializeTx(t)) ? ArrowDownLeft : ArrowUpRight;
export function TxList({ txs, empty }: { txs: Tx[]; empty?: React.ReactNode }) {
  if (!txs.length) return <EmptyState title="No activity yet" body="Your deposits, swaps, payments and withdrawals will show up here with their live status." action={empty} />;
  return (
    <ul className="divide-y divide-border">
      {txs.map((t) => { const d = serializeTx(t); const I = icon(t) ?? Receipt; return (
        <li key={t.id}><Link href={`/app/activity/${t.id}`} className="flex items-center gap-3 py-3 min-h-16 hover:bg-surface-2 -mx-2 px-2 rounded-xl">
          <span className="size-10 rounded-full bg-surface-2 grid place-items-center shrink-0"><I className="size-5" aria-hidden /></span>
          <span className="flex-1 min-w-0"><span className="block font-medium truncate">{describeTx(d)}</span><span className="block text-sm text-muted">{new Date(t.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span></span>
          <span className="text-right shrink-0"><span className="block font-semibold tabular">{headline(d)}</span><StatusBadge status={t.status} /></span>
        </Link></li>); })}
    </ul>
  );
}
