import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { AuthForm } from "@/components/flows-account";
import { Logo, SandboxBanner } from "@/components/ui";
import { isSandbox } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign up" };
export default async function Page() {
  if (await getUser()) redirect("/app");
  return (<>{isSandbox() && <SandboxBanner />}<main className="mx-auto max-w-md px-5 py-10"><div className="mb-8"><Logo size={32} /></div><h1 className="text-2xl font-bold mb-6">Create your account</h1><AuthForm mode="signup" /></main></>);
}
