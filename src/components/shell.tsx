"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreditCard, Home, LifeBuoy, ListChecks, LogOut, ReceiptText, Shield, User, Wallet, Zap } from "lucide-react";
import { Logo } from "./ui";
import { call } from "@/lib/client";
import type { ReactNode } from "react";

const NAV = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/wallet", label: "Wallet", icon: Wallet },
  { href: "/app/bills", label: "Pay bills", icon: Zap },
  { href: "/app/giftcards", label: "Gift cards", icon: ReceiptText },
  { href: "/app/cards", label: "Cards", icon: CreditCard },
  { href: "/app/activity", label: "Activity", icon: ListChecks },
];

export function Shell({ children, name, admin }: { children: ReactNode; name: string; admin: boolean }) {
  const path = usePathname(); const router = useRouter();
  const active = (n: (typeof NAV)[number]) => (n.exact ? path === n.href : path.startsWith(n.href));
  const out = async () => { await call("/api/auth/logout").catch(() => {}); router.push("/login"); router.refresh(); };
  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 bg-brand text-brand-fg px-3 py-2 rounded-lg">Skip to content</a>
      <aside className="hidden md:flex md:w-64 md:flex-col md:sticky md:top-0 md:h-dvh border-r border-border p-4 gap-1 no-print">
        <Link href="/app" className="px-2 py-3"><Logo /></Link>
        <nav aria-label="Main" className="flex flex-col gap-1 mt-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 min-h-11 font-medium ${active(n) ? "bg-brand text-brand-fg" : "hover:bg-surface-2"}`}><n.icon className="size-5" aria-hidden />{n.label}</Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          {admin && <Link href="/admin" className="flex items-center gap-3 rounded-xl px-3 min-h-11 hover:bg-surface-2"><Shield className="size-5" aria-hidden />Admin</Link>}
          <Link href="/app/support" className="flex items-center gap-3 rounded-xl px-3 min-h-11 hover:bg-surface-2"><LifeBuoy className="size-5" aria-hidden />Support</Link>
          <Link href="/app/profile" className="flex items-center gap-3 rounded-xl px-3 min-h-11 hover:bg-surface-2"><User className="size-5" aria-hidden /><span className="truncate">{name}</span></Link>
          <button onClick={out} className="flex items-center gap-3 rounded-xl px-3 min-h-11 hover:bg-surface-2 text-left"><LogOut className="size-5" aria-hidden />Sign out</button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border no-print">
          <Link href="/app"><Logo size={24} /></Link>
          <div className="flex gap-1">
            {admin && <Link href="/admin" aria-label="Admin" className="size-11 grid place-items-center rounded-xl hover:bg-surface-2"><Shield className="size-5" /></Link>}
            <Link href="/app/support" aria-label="Support" className="size-11 grid place-items-center rounded-xl hover:bg-surface-2"><LifeBuoy className="size-5" /></Link>
            <Link href="/app/profile" aria-label="Profile and security" className="size-11 grid place-items-center rounded-xl hover:bg-surface-2"><User className="size-5" /></Link>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 md:pb-10">{children}</main>
      </div>
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-6 border-t border-border bg-bg/95 backdrop-blur pb-[env(safe-area-inset-bottom)] no-print">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n) ? "page" : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-medium ${active(n) ? "text-brand" : "text-muted"}`}><n.icon className="size-5" aria-hidden />{n.label.replace("Pay bills", "Bills").replace("Gift cards", "Gift")}</Link>
        ))}
      </nav>
    </div>
  );
}
