import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { GIFT_BRANDS } from "@/lib/catalog";
import { big, toDecimalString } from "@/lib/money";
import { GiftAdmin } from "@/components/flows-other";
import { Card, Money, PageTitle, Row, StatusBadge } from "@/components/ui";

export const metadata = { title: "Review gift card" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = (await query(`select s.*, u.email, u.full_name from gift_card_submissions s join users u on u.id=s.user_id where s.id=$1`, [id])).rows[0]; if (!s) notFound();
  const assets = (await query(`select id, mime from gift_card_assets where submission_id=$1`, [id])).rows;
  const events = (await query(`select to_status, note, created_at from gift_card_events where submission_id=$1 order by id`, [id])).rows;
  return (
    <div className="space-y-4"><PageTitle title={`${GIFT_BRANDS.find((b) => b.id === s.brand)?.label} ${s.currency} ${(Number(big(s.face_value)) / 100).toLocaleString()}`} action={<StatusBadge status={s.status} />} />
      <Card><dl><Row k="Customer">{s.full_name} ({s.email})</Row><Row k="Type">{s.card_type === "ecode" ? `Digital code (ends ${s.code_last4})` : "Physical"}</Row><Row k="Indicative rate">₦{s.indicative_rate} per {s.currency}</Row><Row k="Indicative payout"><Money v={big(s.indicative_payout)} asset="NGN" /></Row>{s.payout_amount && <Row k="Approved payout"><Money v={big(s.payout_amount)} asset="NGN" /></Row>}{s.review_note && <Row k="Note">{s.review_note}</Row>}</dl></Card>
      {assets.length > 0 && <Card><p className="font-semibold mb-2">Uploads</p><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{assets.map((a: any) => <a key={a.id} href={`/api/giftcards/assets/${a.id}`} target="_blank" rel="noopener"><img src={`/api/giftcards/assets/${a.id}`} alt="Gift card upload" className="rounded-xl border border-border w-full" /></a>)}</div></Card>}
      <GiftAdmin id={id} status={s.status} indicative={toDecimalString(big(s.indicative_payout), "NGN")} hasCode={!!s.code_encrypted} />
      <Card><p className="font-semibold mb-2">History</p><ul className="text-sm space-y-1">{events.map((e: any, i: number) => <li key={i}><span className="text-muted">{new Date(e.created_at).toLocaleString("en-NG")}</span> {e.to_status}{e.note ? `: ${e.note}` : ""}</li>)}</ul></Card>
    </div>
  );
}
