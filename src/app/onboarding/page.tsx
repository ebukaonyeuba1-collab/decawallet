import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { Onboarding } from "@/components/flows-account";
import { Logo, SandboxBanner } from "@/components/ui";
import { isSandbox } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };
export default async function Page() {
  const u = await requirePageUser();
  if (u.onboarded_at) redirect("/app");
  return (<>{isSandbox() && <SandboxBanner />}<main className="px-5 py-8"><div className="mx-auto max-w-md mb-6"><Logo /></div>
    <Onboarding name={u.full_name} verified={!!u.phone_verified_at} tier={u.kyc_tier} status={u.kyc_status} reason={u.kyc_reject_reason} last4={u.bvn_last4} phone={u.phone} /></main></>);
}
