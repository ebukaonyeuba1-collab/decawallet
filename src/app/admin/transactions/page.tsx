import Link from "next/link";
import { query } from "@/lib/db";
import { mapTx } from "@/lib/transactions";
import { serializeTx } from "@/lib/serialize";
import { describeTx, headline } from "@/lib/describe";
import { Card, PageTitle, StatusBadge } from "@/components/ui";

export const metadata = { title: "Transactions" };
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams; const params: unknown[] = []; const where: string[] = [];
  if (["pending", "processing", "success", "failed", "reversed"].includes(sp.status ?? "")) { params.push(sp.status); where.push(`t.status=$${params.length}`); }
  if (sp.q?.trim()) { params.push(`%${sp.q.trim().toLowerCase()}%`); where.push(`(lower(t.ref) like $${params.length} or lower(u.email) like $${params.length})`); }
  const rows = (await query(`select t.*, u.email from transactions t join users u on u.id=t.user_id ${where.length ? "where " + where.join(" and ") : ""} order by t.created_at desc limit 100`, params)).rows;
  return (
    <div className="space-y-4"><PageTitle title="Transactions" />
      <form className="flex gap-2 flex-wrap" role="search"><input name="q" defaultValue={sp.q} placeholder="Reference or email" aria-label="Search" className="min-h-12 flex-1 min-w-48 rounded-xl border border-border bg-surface-2 px-3" />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="min-h-12 rounded-xl border border-border bg-surface-2 px-3"><option value="">All statuses</option>{["pending", "processing", "success", "failed", "reversed"].map((s) => <option key={s}>{s}</option>)}</select>
        <button className="min-h-12 px-5 rounded-xl bg-brand text-brand-fg font-semibold">Filter</button></form>
      <Card><ul className="divide-y divide-border">{rows.map((r: any) => { const t = mapTx(r); const d = serializeTx(t); return (
        <li key={t.id}><Link href={`/admin/transactions/${t.id}`} className="flex justify-between gap-3 py-3 min-h-16 hover:bg-surface-2 -mx-2 px-2 rounded-xl">
          <span className="min-w-0"><span className="block font-medium truncate">{describeTx(d)}</span><span className="text-sm text-muted truncate block">{t.ref} · {r.email}</span></span>
          <span className="text-right shrink-0"><span className="block tabular">{headline(d)}</span><StatusBadge status={t.status} /></span></Link></li>); })}
        {!rows.length && <li className="py-6 text-muted">No transactions match.</li>}</ul></Card>
    </div>
  );
}
