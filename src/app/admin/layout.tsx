import Link from "next/link";
import { requirePageAdmin } from "@/lib/auth";
import { Logo, SandboxBanner } from "@/components/ui";
import { isSandbox } from "@/lib/env";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageAdmin();
  return (<>{isSandbox() && <SandboxBanner />}
    <header className="border-b border-border"><div className="mx-auto max-w-5xl px-4 min-h-14 flex items-center gap-4 flex-wrap"><Logo size={22} /><span className="text-muted">Admin</span>
      <nav aria-label="Admin" className="flex gap-4 ml-auto">{[["/admin", "Overview"], ["/admin/giftcards", "Gift cards"], ["/admin/transactions", "Transactions"], ["/app", "Back to app"]].map(([h, l]) => <Link key={h} href={h} className="min-h-11 inline-flex items-center hover:underline">{l}</Link>)}</nav></div></header>
    <main className="mx-auto max-w-5xl px-4 py-6">{children}</main></>);
}
