import Link from "next/link";
import { query } from "@/lib/db";
import { GIFT_BRANDS } from "@/lib/catalog";
import { big } from "@/lib/money";
import { Card, Money, PageTitle, StatusBadge } from "@/components/ui";

export const metadata = { title: "Gift card review" };
export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams; const st = ["submitted", "in_review", "approved", "paid", "rejected"].includes(status ?? "") ? status! : "";
  const rows = (await query(`select s.*, u.email from gift_card_submissions s join users u on u.id=s.user_id ${st ? "where s.status=$1" : "where s.status in ('submitted','in_review','approved')"} order by s.submitted_at asc limit 100`, st ? [st] : [])).rows;
  return (
    <div className="space-y-4"><PageTitle title="Gift card review" sub={st ? `Showing ${st.replace("_", " ")}` : "Oldest first. Showing items that need action."} />
      <nav className="flex gap-2 flex-wrap">{[["", "Needs action"], ["paid", "Paid"], ["rejected", "Rejected"]].map(([v, l]) => <Link key={v} href={v ? `/admin/giftcards?status=${v}` : "/admin/giftcards"} className={`px-4 min-h-11 inline-flex items-center rounded-full border ${st === v ? "bg-brand text-brand-fg border-brand" : "border-border bg-surface"}`}>{l}</Link>)}</nav>
      <Card>{!rows.length ? <p className="text-muted py-4">Queue is empty.</p> : <ul className="divide-y divide-border">{rows.map((r: any) => (
        <li key={r.id}><Link href={`/admin/giftcards/${r.id}`} className="flex justify-between gap-3 py-3 min-h-16 hover:bg-surface-2 -mx-2 px-2 rounded-xl">
          <span><span className="block font-medium">{GIFT_BRANDS.find((b) => b.id === r.brand)?.label} {r.currency} {(Number(big(r.face_value)) / 100).toLocaleString()}</span><span className="text-sm text-muted">{r.email} · {new Date(r.submitted_at).toLocaleString("en-NG")}</span></span>
          <span className="text-right"><span className="block tabular"><Money v={big(r.indicative_payout)} asset="NGN" /></span><StatusBadge status={r.status} /></span></Link></li>))}</ul>}</Card>
    </div>
  );
}
