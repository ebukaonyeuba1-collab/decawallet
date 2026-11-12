import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { LinkButton, Logo, SandboxBanner } from "@/components/ui";
import { isSandbox } from "@/lib/env";

export const dynamic = "force-dynamic";
export default async function Landing() {
  if (await getUser()) redirect("/app");
  return (
    <>
      {isSandbox() && <SandboxBanner />}
      <main className="mx-auto max-w-3xl px-5 py-12 min-h-dvh flex flex-col">
        <Logo size={34} />
        <section className="mt-16 flex-1">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">Trade with a smile.<br /><span className="text-brand">Know exactly what happened.</span></h1>
          <p className="mt-5 text-lg text-muted max-w-xl">Swap crypto, sell gift cards, pay bills and spend with a card. Every fee shown up front. Every action ends with a clear result: pending, successful or failed.</p>
          <div className="mt-8 flex flex-wrap gap-3"><LinkButton href="/signup">Create account</LinkButton><LinkButton href="/login" variant="outline">Sign in</LinkButton></div>
          <ul className="mt-12 grid sm:grid-cols-3 gap-4">
            {[["Fast", "Start any transaction in under two taps."], ["Clear", "Rates, fees and balances you can read at a glance."], ["Trusted", "Your money is held and tracked line by line."]].map(([h, b]) => <li key={h} className="rounded-2xl border border-border bg-surface p-4"><p className="font-bold">{h}</p><p className="text-muted mt-1">{b}</p></li>)}
          </ul>
        </section>
        <footer className="mt-12 text-sm text-muted">DECA is the rebuilt ACEDXTRADES. <Link href="/login" className="underline">Sign in</Link></footer>
      </main>
    </>
  );
}
