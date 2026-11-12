import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { cardEvents, cardHistory, syncCard } from "@/lib/services/cards";
import { sandboxToolsEnabled } from "@/lib/providers";
import { reconcileUser } from "@/lib/transactions";
import { CardActions } from "@/components/flows-other";
import { Card, EmptyState, Money, PageTitle, Row, StatusBadge } from "@/components/ui";

export const metadata = { title: "Card" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const u = await requirePageUser();
  let c; try { await reconcileUser(u.id); c = await syncCard(u.id, id); } catch (e) { if (e instanceof ApiError) notFound(); throw e; }
  const [hist, events] = [await cardHistory(u.id, id), await cardEvents(id)];
  return (
    <div className="space-y-4">
      <PageTitle title={`${c.type === "virtual" ? "Virtual" : "Physical"} card •••• ${c.last4}`} action={<StatusBadge status={c.status} />} />
      <Card className="bg-gradient-to-br from-[#1a1a1d] to-black text-white"><p className="text-sm opacity-70">Card balance</p><p className="text-3xl font-extrabold tabular"><Money v={c.balance} asset="NGN" /></p>
        <p className="font-mono mt-4 tracking-widest">•••• •••• •••• {c.last4}</p><p className="text-sm mt-1">{c.holder_name} · {String(c.expiry_month).padStart(2, "0")}/{String(c.expiry_year).slice(-2)}</p></Card>
      <CardActions sandbox={sandboxToolsEnabled()} card={{ id: c.id, status: c.status, type: c.type, last4: c.last4, balance: c.balance.toString(), perTx: c.per_tx_limit.toString(), daily: c.daily_limit.toString(), monthly: c.monthly_limit.toString() }} />
      {c.type === "physical" && <Card><h2 className="font-semibold mb-2">Delivery tracking</h2><ul className="space-y-1">{events.filter((e: any) => e.kind.startsWith("delivery:") || e.kind === "ordered").reverse().map((e: any, i: number) => <li key={i}><span className="text-muted text-sm">{new Date(e.created_at).toLocaleString("en-NG", { timeStyle: "short", dateStyle: "short" })}</span> {e.detail}</li>)}</ul></Card>}
      <Card><h2 className="font-semibold mb-2">Transactions</h2>
        {!hist.length ? <EmptyState title="No card transactions yet" body="Fund your card, then spend. Every purchase and decline appears here." /> : (
          <dl>{hist.map((h: any) => <Row key={h.id} k={`${h.merchant ?? h.kind} · ${new Date(h.created_at).toLocaleDateString("en-NG")}`}><span className={h.status === "declined" ? "text-danger" : ""}><Money v={h.amount} asset="NGN" />{h.status === "declined" ? ` declined (${h.decline_reason})` : ""}</span></Row>)}</dl>)}</Card>
      <Card><h2 className="font-semibold mb-2">Card history</h2><ul className="space-y-1 text-sm">{events.map((e: any, i: number) => <li key={i}><span className="text-muted">{new Date(e.created_at).toLocaleString("en-NG")}</span> {e.detail ?? e.kind}</li>)}</ul></Card>
    </div>
  );
}
