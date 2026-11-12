import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { mapTx, reconcileUser } from "@/lib/transactions";
import { Card, PageTitle } from "@/components/ui";
import { TxList } from "@/components/txlist";

export const metadata = { title: "Activity" };
const FILTERS = [["", "All"], ["pending", "Pending"], ["success", "Successful"], ["failed", "Failed"], ["reversed", "Reversed"]];
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const u = await requirePageUser(); const { status } = await searchParams; await reconcileUser(u.id);
  const st = FILTERS.some(([v]) => v === status) && status ? status : "";
  const where = st === "pending" ? `and status in ('pending','processing')` : st ? `and status = '${st}'` : "";
  const txs = (await query(`select * from transactions where user_id=$1 ${where} order by created_at desc limit 50`, [u.id])).rows.map(mapTx);
  return (
    <>
      <PageTitle title="Activity" sub="Every transaction, with its live status." />
      <nav aria-label="Filter by status" className="flex gap-2 overflow-x-auto mb-4 pb-1">{FILTERS.map(([v, l]) => <Link key={v} href={v ? `/app/activity?status=${v}` : "/app/activity"} aria-current={st === v ? "page" : undefined} className={`px-4 min-h-11 inline-flex items-center rounded-full border whitespace-nowrap ${st === v ? "bg-brand text-brand-fg border-brand font-semibold" : "border-border bg-surface"}`}>{l}</Link>)}</nav>
      <Card><TxList txs={txs} /></Card>
    </>
  );
}
