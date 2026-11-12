import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Zap } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { dashboardData } from "@/lib/dashboard";
import { reconcileUser } from "@/lib/transactions";
import { limitsFor } from "@/lib/limits";
import { query } from "@/lib/db";
import { Alert, Card, LinkButton, Money } from "@/components/ui";
import { TxList } from "@/components/txlist";

export const metadata = { title: "Home" };
export default async function Home() {
  const u = await requirePageUser();
  await reconcileUser(u.id);
  const d = await dashboardData(u.id);
  const lim = await limitsFor({ query } as any, u);
  const actions = [{ href: "/app/deposit", label: "Deposit", icon: ArrowDownToLine }, { href: "/app/withdraw", label: "Withdraw", icon: ArrowUpFromLine }, { href: "/app/swap", label: "Swap", icon: ArrowLeftRight }, { href: "/app/bills", label: "Bills", icon: Zap }];
  return (
    <div className="space-y-6">
      <p className="text-muted">Hi {u.full_name.split(" ")[0]}</p>
      <Card className="space-y-1"><p className="text-muted">Total balance (approx.)</p><p className="text-4xl font-extrabold tabular tracking-tight"><Money v={d.total} asset="NGN" /></p>
        {d.pendingTotal > 0n && <p className="text-warning tabular">Plus <Money v={d.pendingTotal} asset="NGN" /> pending</p>}</Card>
      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-3">
        {actions.map((a) => <Link key={a.href} href={a.href} className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-3 min-h-24 justify-center hover:bg-surface-2 font-semibold"><a.icon className="size-6 text-brand" aria-hidden />{a.label}</Link>)}
      </nav>
      {d.inflight > 0 && <Alert tone="warn" title={`${d.inflight} transaction${d.inflight > 1 ? "s" : ""} in progress`}>We are tracking {d.inflight > 1 ? "them" : "it"} for you. <Link className="underline" href="/app/activity">See status</Link></Alert>}
      {u.kyc_tier < 2 && <Alert title={u.kyc_tier === 0 ? "Verify your phone to unlock withdrawals and payments" : "Verify your BVN for higher limits and cards"}><Link className="underline" href="/app/profile">Go to verification</Link></Alert>}
      <Card><div className="flex justify-between items-center mb-2"><h2 className="font-semibold text-lg">Recent activity</h2><Link href="/app/activity" className="text-brand">See all</Link></div>
        <TxList txs={d.recent} empty={<LinkButton href="/app/deposit">Make your first deposit</LinkButton>} /></Card>
      {lim.dailyKobo > 0n && <p className="text-sm text-muted">Daily send limit left: <Money v={lim.remainingKobo} asset="NGN" /> of <Money v={lim.dailyKobo} asset="NGN" /></p>}
    </div>
  );
}
