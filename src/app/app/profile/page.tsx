import Link from "next/link";
import { requirePageUser, currentSessionHash } from "@/lib/auth";
import { query } from "@/lib/db";
import { limitsFor } from "@/lib/limits";
import { listSessions } from "@/lib/services/account";
import { TIERS } from "@/lib/catalog";
import { BvnForm, PasswordForm, PhoneVerify, SignOutOthers } from "@/components/flows-account";
import { Card, Money, PageTitle, Row } from "@/components/ui";

export const metadata = { title: "Profile and security" };
export default async function Page() {
  const u = await requirePageUser(); const lim = await limitsFor({ query } as any, u); const sessions = await listSessions(u.id, await currentSessionHash());
  return (
    <div className="space-y-4">
      <PageTitle title="Profile and security" />
      <Card><dl><Row k="Name">{u.full_name}</Row><Row k="Email">{u.email}</Row><Row k="Account status"><span className="capitalize">{u.status}</span></Row></dl></Card>
      <Card className="space-y-3"><h2 className="font-semibold text-lg">Verification (KYC)</h2>
        <p><b>{TIERS[u.kyc_tier].label}</b></p><p className="text-muted">{TIERS[u.kyc_tier].requirement}</p>
        <dl><Row k="Daily send limit">{lim.dailyKobo === 0n ? "None until phone is verified" : <Money v={lim.dailyKobo} asset="NGN" />}</Row><Row k="Used today"><Money v={lim.usedKobo} asset="NGN" /></Row><Row k="Cards">{TIERS[u.kyc_tier].cards ? "Unlocked" : "Needs BVN verification"}</Row></dl>
        <h3 className="font-semibold pt-2">Phone</h3><PhoneVerify verified={!!u.phone_verified_at} phone={u.phone} />
        <h3 className="font-semibold pt-2">BVN</h3><BvnForm tier={u.kyc_tier} status={u.kyc_status} reason={u.kyc_reject_reason} last4={u.bvn_last4} /></Card>
      <Card className="space-y-3"><h2 className="font-semibold text-lg">Security</h2><PasswordForm />
        <h3 className="font-semibold pt-2">Signed-in devices ({sessions.length})</h3>
        <ul className="text-sm text-muted space-y-1">{sessions.map((s) => <li key={s.id}>{s.current ? "This device" : "Other device"}: {s.userAgent?.slice(0, 60) ?? "unknown"} · {new Date(s.createdAt).toLocaleDateString("en-NG")}</li>)}</ul>
        {sessions.length > 1 && <SignOutOthers />}
        <p className="text-sm text-muted">Two factor authentication is on the launch checklist (see README).</p></Card>
      <p><Link href="/app/support" className="underline">Contact support</Link></p>
    </div>
  );
}
