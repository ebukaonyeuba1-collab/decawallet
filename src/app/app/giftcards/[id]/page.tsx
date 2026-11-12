import { notFound } from "next/navigation";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { GIFT_BRANDS } from "@/lib/catalog";
import { big } from "@/lib/money";
import { Alert, Card, LinkButton, Money, PageTitle, Row, StatusBadge } from "@/components/ui";

export const metadata = { title: "Gift card status" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params; const sp = await searchParams; const u = await requirePageUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const s = (await query(`select * from gift_card_submissions where id=$1 and user_id=$2`, [id, u.id])).rows[0]; if (!s) notFound();
  const events = (await query(`select to_status, note, created_at from gift_card_events where submission_id=$1 order by id`, [id])).rows;
  const assets = (await query(`select id from gift_card_assets where submission_id=$1`, [id])).rows;
  const rejected = s.status === "rejected";
  const stage = s.status === "paid" ? 3 : ["approved"].includes(s.status) ? 2 : s.status === "in_review" ? 1.5 : 1;
  const steps = [{ k: "Submitted", done: stage >= 1 }, { k: s.status === "approved" ? "Reviewed (approved)" : s.status === "in_review" ? "Being reviewed" : "Reviewed", done: stage >= 2, active: s.status === "in_review" }, { k: "Paid to wallet", done: stage >= 3 }];
  const brand = GIFT_BRANDS.find((b) => b.id === s.brand)?.label;
  return (
    <div className="space-y-4">
      <PageTitle title={`${brand} ${s.currency} ${(Number(big(s.face_value)) / 100).toLocaleString()}`} action={<StatusBadge status={s.status} />} />
      {sp.new && <Alert tone="ok" title="Submitted">We will start reviewing shortly. Expected review time: about {s.est_review_minutes} minutes.</Alert>}
      {rejected ? <Alert tone="bad" title="Not accepted"><p>{s.review_note}</p><p className="mt-2">You can submit a corrected card any time.</p></Alert> : (
        <Card><ol className="space-y-4" aria-label="Progress">{steps.map((st) => (
          <li key={st.k} className="flex items-center gap-3">{st.done ? <CheckCircle2 className="size-6 text-success" aria-hidden /> : <Circle className={`size-6 ${st.active ? "text-warning" : "text-muted"}`} aria-hidden />}<span className={st.done ? "font-semibold" : "text-muted"}>{st.k}{st.done ? " (done)" : st.active ? " (in progress)" : ""}</span></li>))}</ol>
          {!["paid", "approved"].includes(s.status) && <p className="text-muted mt-4">Estimated review time: about {s.est_review_minutes} minutes.</p>}</Card>
      )}
      <Card><dl>
        <Row k="Indicative payout"><Money v={big(s.indicative_payout)} asset="NGN" /></Row>
        {s.payout_amount && <Row k="Approved payout"><Money v={big(s.payout_amount)} asset="NGN" /></Row>}
        <Row k="Type">{s.card_type === "ecode" ? `Digital code ending ${s.code_last4}` : "Physical card"}</Row>
        <Row k="Submitted">{new Date(s.submitted_at).toLocaleString("en-NG")}</Row>
      </dl></Card>
      {assets.length > 0 && <Card><p className="font-semibold mb-2">Your uploads</p><div className="flex gap-2 flex-wrap">{assets.map((a: any, i: number) => <a key={a.id} href={`/api/giftcards/assets/${a.id}`} target="_blank" rel="noopener" className="underline">Image {i + 1}</a>)}</div></Card>}
      <Card><p className="font-semibold mb-2">History</p><ul className="space-y-1 text-sm">{events.map((e: any, i: number) => <li key={i}><span className="text-muted">{new Date(e.created_at).toLocaleString("en-NG")}</span> {e.to_status.replace("_", " ")}{e.note ? `: ${e.note}` : ""}</li>)}</ul></Card>
      {s.transaction_id && <LinkButton variant="outline" href={`/app/activity/${s.transaction_id}`}>View receipt</LinkButton>}
      {rejected && <LinkButton href="/app/giftcards/new">Submit another card</LinkButton>}
      {rejected && <XCircle className="hidden" />}
    </div>
  );
}
