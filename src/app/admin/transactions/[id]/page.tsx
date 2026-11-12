import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { mapTx } from "@/lib/transactions";
import { serializeTx } from "@/lib/serialize";
import { describeTx, headline } from "@/lib/describe";
import { sandboxToolsEnabled } from "@/lib/providers";
import { TxAdmin } from "@/components/flows-other";
import { Alert, Card, PageTitle, Row, StatusBadge } from "@/components/ui";

export const metadata = { title: "Transaction" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = (await query(`select t.*, u.email from transactions t join users u on u.id=t.user_id where t.id=$1`, [id])).rows[0]; if (!r) notFound();
  const t = mapTx(r); const d = serializeTx(t);
  const events = (await query(`select from_status, to_status, source, note, created_at from transaction_events where transaction_id=$1 order by id`, [id])).rows;
  const ledger = (await query(`select l.op, l.d_available::text a, l.d_pending_in::text i, l.d_pending_out::text o, l.created_at, w.asset from ledger_entries l join wallets w on w.id=l.wallet_id where l.transaction_id=$1 order by l.id`, [id])).rows;
  const flags = (await query(`select kind, detail, resolved_at from reconciliation_flags where transaction_id=$1 order by id`, [id])).rows;
  const open = flags.filter((f: any) => !f.resolved_at);
  return (
    <div className="space-y-4"><PageTitle title={describeTx(d)} sub={headline(d)} action={<StatusBadge status={t.status} />} />
      {open.map((f: any, i: number) => <Alert key={i} tone="warn" title={f.kind.replace(/_/g, " ")}>{f.detail}</Alert>)}
      <Card><dl><Row k="Reference"><span className="font-mono">{t.ref}</span></Row><Row k="Customer">{r.email}</Row><Row k="Provider">{t.provider ?? "-"} {t.provider_ref ? `(${t.provider_ref})` : ""}</Row><Row k="Created">{new Date(t.created_at).toLocaleString("en-NG")}</Row>{t.failure_reason && <Row k="Failure reason">{t.failure_reason}</Row>}</dl></Card>
      <TxAdmin id={id} sandbox={sandboxToolsEnabled()} flagged={open.length > 0} />
      <Card><h2 className="font-semibold mb-2">Status timeline</h2><ul className="text-sm space-y-1">{events.map((e: any, i: number) => <li key={i}><span className="text-muted">{new Date(e.created_at).toLocaleString("en-NG")}</span> {e.from_status ?? "new"} → <b>{e.to_status}</b> via {e.source}{e.note ? ` (${e.note})` : ""}</li>)}</ul></Card>
      <Card><h2 className="font-semibold mb-2">Ledger entries</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="py-1">Op</th><th>Asset</th><th>Δ available</th><th>Δ in</th><th>Δ out</th></tr></thead><tbody>{ledger.map((l: any, i: number) => <tr key={i} className="border-t border-border"><td className="py-1">{l.op}</td><td>{l.asset}</td><td className="tabular">{l.a}</td><td className="tabular">{l.i}</td><td className="tabular">{l.o}</td></tr>)}</tbody></table></div><p className="text-xs text-muted mt-2">Amounts in minor units.</p></Card>
    </div>
  );
}
