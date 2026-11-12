import Link from "next/link";
import { query } from "@/lib/db";
import { verifyLedger } from "@/lib/ledger";
import { ngnValue } from "@/lib/rates";
import { Asset } from "@/lib/money";
import { Alert, Card, Money, PageTitle } from "@/components/ui";

export const metadata = { title: "Admin overview" };
export default async function Page() {
  const q = { query } as any;
  const by = (await query(`select status, count(*)::int n from transactions group by status`)).rows;
  const vol = (await query(`select asset, coalesce(sum(amount),0)::text a from transactions where created_at > now() - interval '24 hours' and status='success' and type <> 'giftcard_payout' group by asset`)).rows;
  const volNgn = vol.reduce((s: bigint, r: any) => s + ngnValue(r.asset as Asset, BigInt(r.a)), 0n);
  const stuck = (await query(`select count(*)::int n from transactions where status in ('pending','processing') and created_at < now() - interval '15 minutes'`)).rows[0].n;
  const flags = (await query(`select f.id, f.kind, f.detail, f.transaction_id, f.created_at from reconciliation_flags f where resolved_at is null order by created_at desc limit 20`)).rows;
  const gifts = (await query(`select count(*)::int n from gift_card_submissions where status in ('submitted','in_review')`)).rows[0].n;
  const hooks = (await query(`select provider, event_id, signature_valid, outcome, received_at from webhook_events order by received_at desc limit 8`)).rows;
  const led = await verifyLedger(q);
  const n = (s: string) => by.find((r: any) => r.status === s)?.n ?? 0;
  return (
    <div className="space-y-5"><PageTitle title="Overview" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Pending", n("pending") + n("processing")], ["Successful", n("success")], ["Failed", n("failed")], ["Reversed", n("reversed")]].map(([l, v]) => <Card key={l as string}><p className="text-muted text-sm">{l}</p><p className="text-3xl font-bold tabular">{v}</p></Card>)}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Card><p className="text-muted text-sm">24h volume (approx.)</p><p className="text-xl font-bold"><Money v={volNgn} asset="NGN" /></p></Card>
        <Card><p className="text-muted text-sm">Stuck over 15 min</p><p className="text-xl font-bold">{stuck}</p></Card>
        <Card><p className="text-muted text-sm">Gift cards awaiting review</p><p className="text-xl font-bold"><Link className="underline" href="/admin/giftcards">{gifts}</Link></p></Card>
      </div>
      {led.ok ? <Alert tone="ok" title="Ledger balanced">Every wallet balance equals the sum of its ledger entries.</Alert> : <Alert tone="bad" title="Ledger mismatch">{led.problems.slice(0, 3).join("; ")}</Alert>}
      <Card><h2 className="font-semibold text-lg mb-2">Open reconciliation flags ({flags.length})</h2>
        {!flags.length ? <p className="text-muted">Nothing needs attention.</p> : <ul className="space-y-2">{flags.map((f: any) => <li key={f.id} className="border-b border-border pb-2"><p className="font-medium">{f.kind.replace(/_/g, " ")}</p><p className="text-sm text-muted">{f.detail}</p>{f.transaction_id && <Link className="underline text-sm" href={`/admin/transactions/${f.transaction_id}`}>Open transaction</Link>}</li>)}</ul>}</Card>
      <Card><h2 className="font-semibold text-lg mb-2">Recent webhooks</h2><ul className="text-sm space-y-1">{hooks.map((h: any, i: number) => <li key={i}><span className={h.signature_valid ? "text-success" : "text-danger"}>{h.signature_valid ? "valid" : "REJECTED"}</span> {h.provider} · {h.outcome ?? "-"} · {new Date(h.received_at).toLocaleTimeString("en-NG")}</li>)}{!hooks.length && <li className="text-muted">None yet</li>}</ul></Card>
    </div>
  );
}
