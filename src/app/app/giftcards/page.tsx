import Link from "next/link";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { GIFT_BRANDS } from "@/lib/catalog";
import { big } from "@/lib/money";
import { Card, EmptyState, LinkButton, Money, PageTitle, StatusBadge } from "@/components/ui";

export const metadata = { title: "Gift cards" };
export default async function Page() {
  const u = await requirePageUser();
  const rows = (await query(`select * from gift_card_submissions where user_id=$1 order by submitted_at desc limit 50`, [u.id])).rows;
  return (
    <>
      <PageTitle title="Gift cards" sub="Submit a card, track the review, get paid in Naira." action={<LinkButton href="/app/giftcards/new">Sell a card</LinkButton>} />
      <Card>
        {!rows.length ? <EmptyState title="No gift cards yet" body="Submit your first card. Most reviews finish in about 30 minutes." action={<LinkButton href="/app/giftcards/new">Sell a gift card</LinkButton>} /> : (
          <ul className="divide-y divide-border">{rows.map((r: any) => (
            <li key={r.id}><Link href={`/app/giftcards/${r.id}`} className="flex items-center justify-between gap-3 py-3 min-h-16 hover:bg-surface-2 -mx-2 px-2 rounded-xl">
              <span><span className="block font-medium">{GIFT_BRANDS.find((b) => b.id === r.brand)?.label} {r.currency} {(Number(big(r.face_value)) / 100).toLocaleString()}</span><span className="text-sm text-muted">{new Date(r.submitted_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span></span>
              <span className="text-right"><span className="block font-semibold tabular"><Money v={big(r.payout_amount ?? r.indicative_payout)} asset="NGN" /></span><StatusBadge status={r.status} /></span>
            </Link></li>))}</ul>
        )}
      </Card>
    </>
  );
}
