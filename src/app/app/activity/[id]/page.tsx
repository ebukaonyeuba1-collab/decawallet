import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getTxForUser, reconcileTx } from "@/lib/transactions";
import { serializeTx } from "@/lib/serialize";
import { describeTx, headline } from "@/lib/describe";
import { Asset, formatAmount } from "@/lib/money";
import { TxTracker } from "@/components/flows-other";
import { PrintButton } from "@/components/misc";
import { Card, LinkButton, PageTitle, Row } from "@/components/ui";

export const metadata = { title: "Receipt" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params; const sp = await searchParams; const u = await requirePageUser();
  let t = await getTxForUser(u.id, id); if (!t) notFound();
  if (t.status === "pending" || t.status === "processing") t = (await reconcileTx(t.id)) ?? t;
  const d = serializeTx(t); const m = d.meta;
  const events = (await query(`select to_status, source, note, created_at from transaction_events where transaction_id=$1 order by id`, [id])).rows;
  const A = d.asset as Asset;
  return (
    <div className="space-y-4">
      <PageTitle title={describeTx(d)} sub={headline(d)} />
      <TxTracker id={id} isNew={!!sp.new} initial={{ status: d.status, failureReason: d.failureReason, confirmations: m.confirmations, required: m.required }} />
      <Card as="article" className="print-card"><h2 className="font-semibold text-lg mb-1">Receipt</h2>
        <dl>
          <Row k="Reference"><span className="font-mono">{d.ref}</span></Row>
          <Row k="Date">{new Date(d.createdAt).toLocaleString("en-NG")}</Row>
          {d.type === "swap" ? (<><Row k="You paid">{formatAmount(d.amount, A)}</Row><Row k="Rate">1 {d.asset} = {d.rate?.replace(/\.?0+$/, "")} {d.counterAsset}</Row><Row k="Fee included">{formatAmount(d.fee, A)}</Row><Row k="You receive">{formatAmount(d.counterAmount ?? "0", d.counterAsset as Asset)}</Row></>) : (<><Row k="Amount">{formatAmount(d.amount, A)}</Row><Row k="Fee">{formatAmount(d.fee, A)}</Row>{d.type !== "crypto_deposit" && d.type !== "giftcard_payout" && <Row k="Total">{formatAmount(BigInt(d.amount) + BigInt(d.fee), A)}</Row>}</>)}
          {m.address && <Row k="Address"><span className="font-mono text-sm">{m.address}</span></Row>}{m.networkLabel && <Row k="Network">{m.networkLabel}</Row>}{m.network && !m.networkLabel && <Row k="Network">{m.network}</Row>}
          {m.accountName && <Row k="Recipient">{m.accountName} ({m.bankName} {m.accountNumber})</Row>}
          {m.identifier && <Row k={m.categoryLabel ?? "Recipient"}>{m.identifier}{m.customerName ? ` (${m.customerName})` : ""}</Row>}{m.planLabel && <Row k="Plan">{m.planLabel}</Row>}
          {m.token && <Row k="Electricity token"><span className="font-mono text-lg">{m.token}</span></Row>}
          <Row k="Status">{d.status}</Row>
        </dl></Card>
      <Card><h2 className="font-semibold mb-3">Timeline</h2><ol className="space-y-3 border-l border-border pl-4">{events.map((e: any, i: number) => <li key={i}><p className="font-medium capitalize">{e.to_status}</p><p className="text-sm text-muted">{new Date(e.created_at).toLocaleString("en-NG")}{e.note ? `. ${e.note}` : ""}</p></li>)}</ol></Card>
      <div className="flex flex-wrap gap-2 no-print"><PrintButton /><LinkButton variant="outline" href="/app/activity">All activity</LinkButton><Link className="min-h-12 inline-flex items-center underline" href={`/app/support?tx=${id}`}>Report a problem</Link></div>
    </div>
  );
}
