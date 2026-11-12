import { requirePageUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { SupportForm } from "@/components/flows-account";
import { Card, PageTitle } from "@/components/ui";

export const metadata = { title: "Support" };
const FAQ = [
  ["Why is my transaction pending?", "Pending means we have your request and are waiting for the network or provider to confirm. Your money is held safely and returned automatically if it fails."],
  ["How long do gift cards take?", "Most reviews finish in about 30 minutes. You can track Submitted, Reviewed and Paid on the gift card page."],
  ["What is the difference between available and pending?", "Available is spendable now. Pending is money in motion, such as a deposit waiting for confirmations."],
  ["I was charged but nothing happened", "Open the transaction in Activity. If it shows Failed, funds are already back in your wallet. If something looks wrong, use Report a problem there."],
];
export default async function Page({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const u = await requirePageUser(); const { tx } = await searchParams;
  const tickets = (await query(`select subject, status, created_at from support_tickets where user_id=$1 order by created_at desc limit 10`, [u.id])).rows;
  return (
    <div className="space-y-4"><PageTitle title="Support" />
      <Card><h2 className="font-semibold text-lg mb-2">Common questions</h2>{FAQ.map(([q, a]) => <details key={q} className="border-b border-border last:border-0 py-3"><summary className="font-medium cursor-pointer min-h-8">{q}</summary><p className="text-muted mt-2">{a}</p></details>)}</Card>
      <Card><h2 className="font-semibold text-lg mb-3">Contact us</h2><SupportForm transactionId={tx && /^[0-9a-f-]{36}$/i.test(tx) ? tx : undefined} /></Card>
      {tickets.length > 0 && <Card><h2 className="font-semibold mb-2">Your messages</h2><ul className="space-y-1">{tickets.map((t: any, i: number) => <li key={i}>{t.subject} <span className="text-muted">({t.status}, {new Date(t.created_at).toLocaleDateString("en-NG")})</span></li>)}</ul></Card>}
    </div>
  );
}
