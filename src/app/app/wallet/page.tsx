import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { reconcileUser } from "@/lib/transactions";
import { listWallets } from "@/lib/ledger";
import { query } from "@/lib/db";
import { ASSETS } from "@/lib/money";
import { ngnValue } from "@/lib/rates";
import { Card, LinkButton, Money, PageTitle } from "@/components/ui";

export const metadata = { title: "Wallet" };
export default async function Wallet() {
  const u = await requirePageUser(); await reconcileUser(u.id);
  const ws = await listWallets({ query } as any, u.id);
  return (
    <div className="space-y-4">
      <PageTitle title="Wallet" sub="Available is what you can spend now. Pending is money in motion: incoming deposits waiting for confirmations, or amounts held for something that has not finished." />
      {ws.map((w) => (
        <Card key={w.asset} className="space-y-3">
          <div className="flex justify-between items-baseline"><h2 className="font-semibold text-lg">{ASSETS[w.asset].name} <span className="text-muted">{w.asset}</span></h2>{w.asset !== "NGN" && <span className="text-sm text-muted">≈ <Money v={ngnValue(w.asset, w.available)} asset="NGN" /></span>}</div>
          <dl className="grid grid-cols-3 gap-2">
            <div><dt className="text-sm text-muted">Available</dt><dd className="font-bold tabular"><Money v={w.available} asset={w.asset} /></dd></div>
            <div><dt className="text-sm text-muted">Incoming (pending)</dt><dd className={`font-semibold tabular ${w.pending_in > 0n ? "text-warning" : ""}`}><Money v={w.pending_in} asset={w.asset} /></dd></div>
            <div><dt className="text-sm text-muted">On hold (pending)</dt><dd className={`font-semibold tabular ${w.pending_out > 0n ? "text-warning" : ""}`}><Money v={w.pending_out} asset={w.asset} /></dd></div>
          </dl>
          <div className="flex gap-2 flex-wrap">{w.asset !== "NGN" && <LinkButton variant="outline" href="/app/deposit">Deposit</LinkButton>}<LinkButton variant="outline" href="/app/withdraw">Withdraw</LinkButton><LinkButton variant="outline" href="/app/swap">Swap</LinkButton></div>
        </Card>
      ))}
      <p className="text-sm text-muted">Every balance change is recorded in an audit ledger. <Link href="/app/activity" className="underline">View activity</Link></p>
    </div>
  );
}
