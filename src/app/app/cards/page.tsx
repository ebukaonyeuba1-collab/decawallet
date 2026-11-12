import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { listCards } from "@/lib/services/cards";
import { TIERS } from "@/lib/catalog";
import { NewCard } from "@/components/flows-other";
import { Alert, Card, Money, PageTitle, StatusBadge } from "@/components/ui";

export const metadata = { title: "Cards" };
export default async function Page() {
  const u = await requirePageUser(); const cards = await listCards(u.id); const ok = TIERS[u.kyc_tier].cards;
  return (
    <div className="space-y-4">
      <PageTitle title="Cards" sub="Spend your crypto value anywhere cards are accepted." />
      {!ok && <Alert tone="warn" title="Verify your BVN to unlock cards"><Link className="underline" href="/app/profile">Go to verification</Link></Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.id} href={`/app/cards/${c.id}`} className="block rounded-2xl p-5 min-h-44 bg-gradient-to-br from-[#1a1a1d] to-black border border-border text-white hover:brightness-110">
            <div className="flex justify-between"><span className="font-bold text-[#F2C230]">DECA</span><span className="text-sm capitalize">{c.type}</span></div>
            <p className="font-mono text-xl mt-8 tracking-widest">•••• •••• •••• {c.last4}</p>
            <div className="flex justify-between items-end mt-4"><span className="text-sm">{c.holder_name}</span><span className="tabular font-semibold"><Money v={c.balance} asset="NGN" /></span></div>
            <div className="mt-2"><StatusBadge status={c.status} /></div>
          </Link>))}
      </div>
      {!cards.length && ok && <Card><p className="text-muted">You have no cards yet. Create a virtual card instantly.</p></Card>}
      <NewCard canCreate={ok} />
    </div>
  );
}
