"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, LinkButton } from "./ui";
import { call, useSubmit } from "@/lib/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [f, setF] = useState({ fullName: "", email: "", password: "" });
  const s = useSubmit(); const router = useRouter();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await s.run(() => call<{ next: string }>(`/api/auth/${mode}`, mode === "signup" ? f : { email: f.email, password: f.password }));
    if (r) { router.push(r.next); router.refresh(); }
  };
  return (
    <form onSubmit={go} className="space-y-4" noValidate>
      {mode === "signup" && <Field label="Full name" id="fn" error={s.fields.fullName}><Input id="fn" autoComplete="name" value={f.fullName} onChange={set("fullName")} error={s.fields.fullName} required /></Field>}
      <Field label="Email" id="em" error={s.fields.email}><Input id="em" type="email" autoComplete="email" value={f.email} onChange={set("email")} error={s.fields.email} required /></Field>
      <Field label="Password" id="pw" error={s.fields.password} hint={mode === "signup" ? "At least 10 characters, with letters and numbers" : undefined}>
        <Input id="pw" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={f.password} onChange={set("password")} error={s.fields.password} required />
      </Field>
      {s.error && !Object.keys(s.fields).length && <Alert tone="bad">{s.error}</Alert>}
      <Button type="submit" busy={s.busy} className="w-full">{mode === "signup" ? "Create account" : "Sign in"}</Button>
      <p className="text-center text-muted">{mode === "signup" ? <>Already have an account? <Link className="text-brand underline" href="/login">Sign in</Link></> : <>New to DECA? <Link className="text-brand underline" href="/signup">Create an account</Link></>}</p>
    </form>
  );
}

export function PhoneVerify({ verified, phone }: { verified: boolean; phone?: string | null }) {
  const [p, setP] = useState(phone ?? ""); const [code, setCode] = useState(""); const [sent, setSent] = useState<string | null>(null);
  const [step, setStep] = useState<"phone" | "code">("phone"); const s = useSubmit(); const router = useRouter();
  if (verified) return <Alert tone="ok" title="Phone verified">{phone}</Alert>;
  return (
    <div className="space-y-3">
      {step === "phone" ? (<>
        <Field label="Mobile number" id="ph" error={s.fields.phone}><Input id="ph" inputMode="tel" placeholder="0803 123 4567" value={p} onChange={(e) => setP(e.target.value)} error={s.fields.phone} /></Field>
        {s.error && <Alert tone="bad">{s.error}</Alert>}
        <Button busy={s.busy} onClick={async () => { const r = await s.run(() => call<any>("/api/me/phone-request", { phone: p })); if (r) { setSent(r.sandboxCode ?? null); setStep("code"); } }}>Send code</Button>
      </>) : (<>
        {sent && <Alert title="Sandbox mode">No SMS is sent. Your code is <b className="tabular tracking-widest">{sent}</b>.</Alert>}
        <Field label="6 digit code" id="otp" error={s.fields.code}><Input id="otp" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={s.fields.code} /></Field>
        {s.error && !s.fields.code && <Alert tone="bad">{s.error}</Alert>}
        <Button busy={s.busy} onClick={async () => { const r = await s.run(() => call<any>("/api/me/phone-verify", { code })); if (r) router.refresh(); }}>Verify</Button>
      </>)}
    </div>
  );
}

export function BvnForm({ tier, status, reason, last4 }: { tier: number; status: string; reason: string | null; last4: string | null }) {
  const [bvn, setBvn] = useState(""); const s = useSubmit(); const router = useRouter();
  if (tier >= 2) return <Alert tone="ok" title="BVN verified">Ending {last4}. Highest limits unlocked.</Alert>;
  if (tier < 1) return <Alert>Verify your phone first, then you can add your BVN.</Alert>;
  return (
    <div className="space-y-3">
      {status === "rejected" && reason && <Alert tone="bad" title="Last attempt failed">{reason}</Alert>}
      <p className="text-muted">We use your BVN only to confirm who you are, to meet Nigerian regulations. We store a one way fingerprint and the last 4 digits, never the full number.</p>
      <Field label="BVN (11 digits)" id="bvn" error={s.fields.bvn}><Input id="bvn" inputMode="numeric" maxLength={11} value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))} error={s.fields.bvn} /></Field>
      {s.error && !s.fields.bvn && <Alert tone="bad">{s.error}</Alert>}
      <Button busy={s.busy} disabled={bvn.length !== 11} onClick={async () => { const r = await s.run(() => call("/api/me/bvn", { bvn })); if (r) router.refresh(); }}>Verify BVN</Button>
    </div>
  );
}

export function PasswordForm() {
  const [cur, setCur] = useState(""); const [next, setNext] = useState(""); const [ok, setOk] = useState(false); const s = useSubmit();
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setOk(false); const r = await s.run(() => call("/api/me/password", { current: cur, next })); if (r) { setOk(true); setCur(""); setNext(""); } }}>
      <Field label="Current password" id="cp" error={s.fields.current}><Input id="cp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={s.fields.current} /></Field>
      <Field label="New password" id="np" error={s.fields.next} hint="At least 10 characters, with letters and numbers"><Input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={s.fields.next} /></Field>
      {s.error && !Object.keys(s.fields).length && <Alert tone="bad">{s.error}</Alert>}{ok && <Alert tone="ok">Password changed. Other devices were signed out.</Alert>}
      <Button type="submit" busy={s.busy}>Change password</Button>
    </form>
  );
}

export function SignOutOthers() {
  const s = useSubmit(); const [done, setDone] = useState(false); const router = useRouter();
  return <div className="space-y-2">{done && <Alert tone="ok">Signed out everywhere else.</Alert>}<Button variant="outline" busy={s.busy} onClick={async () => { await s.run(() => call("/api/me/sessions-revoke")); setDone(true); router.refresh(); }}>Sign out other devices</Button></div>;
}

export function SupportForm({ transactionId }: { transactionId?: string }) {
  const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [ok, setOk] = useState(false); const s = useSubmit(); const router = useRouter();
  return (
    <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await s.run(() => call("/api/me/support", { subject, body, transactionId })); if (r) { setOk(true); setSubject(""); setBody(""); router.refresh(); } }}>
      <Field label="Subject" id="sb" error={s.fields.subject}><Input id="sb" value={subject} onChange={(e) => setSubject(e.target.value)} error={s.fields.subject} /></Field>
      <Field label="How can we help?" id="bd" error={s.fields.body}><textarea id="bd" rows={5} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-xl border border-border bg-surface-2 p-3 text-base" /></Field>
      {s.error && <Alert tone="bad">{s.error}</Alert>}{ok && <Alert tone="ok">Message received. We will reply by email.</Alert>}
      <Button type="submit" busy={s.busy}>Send message</Button>
    </form>
  );
}

export function Onboarding({ name, verified, tier, status, reason, last4, phone }: { name: string; verified: boolean; tier: number; status: string; reason: string | null; last4: string | null; phone: string | null }) {
  const [step, setStep] = useState(verified ? 2 : 0); const router = useRouter();
  const go = async (n: number, done = false, to?: string) => { await call("/api/me/onboarding", { step: n, done }).catch(() => {}); if (to) { router.push(to); router.refresh(); } else setStep(n); };
  const dots = [0, 1, 2, 3];
  return (
    <div className="mx-auto max-w-md">
      <ol className="flex gap-2 mb-6" aria-label={`Step ${step + 1} of 4`}>{dots.map((d) => <li key={d} className={`h-1.5 flex-1 rounded-full ${d <= step ? "bg-brand" : "bg-surface-2"}`} />)}</ol>
      {step === 0 && (
        <Card className="space-y-4"><h1 className="text-2xl font-bold">Welcome, {name.split(" ")[0]}</h1>
          <ul className="space-y-3 text-lg"><li><b>Fast.</b> Swap, pay and withdraw in a few taps.</li><li><b>Clear.</b> Every fee and rate shown before you confirm.</li><li><b>Never guessing.</b> Every action tells you: pending, successful or failed.</li></ul>
          <Button className="w-full" onClick={() => go(1)}>Get started</Button></Card>
      )}
      {step === 1 && (
        <Card className="space-y-4"><h1 className="text-2xl font-bold">Verify your phone</h1><p className="text-muted">This unlocks withdrawals and payments. It takes under a minute.</p>
          <PhoneVerify verified={verified} phone={phone} />
          {verified ? <Button className="w-full" onClick={() => go(2)}>Continue</Button> : <Button variant="ghost" className="w-full" onClick={() => go(2)}>Do this later</Button>}</Card>
      )}
      {step === 2 && (
        <Card className="space-y-4"><h1 className="text-2xl font-bold">Raise your limits</h1><p className="text-muted">Adding your BVN lifts your daily limit and unlocks cards. You can skip this and do it any time from Profile.</p>
          <BvnForm tier={tier} status={status} reason={reason} last4={last4} />
          <Button className="w-full" variant={tier >= 2 ? "primary" : "ghost"} onClick={() => go(3)}>{tier >= 2 ? "Continue" : "Skip for now"}</Button></Card>
      )}
      {step === 3 && (
        <Card className="space-y-4"><h1 className="text-2xl font-bold">Make your first move</h1><p className="text-muted">Pick one. We will guide you through it.</p>
          <div className="grid gap-3">
            <Button onClick={() => go(4, true, "/app/deposit")}>Deposit crypto</Button>
            <Button variant="outline" onClick={() => go(4, true, "/app/giftcards/new")}>Sell a gift card</Button>
            <Button variant="outline" onClick={() => go(4, true, "/app/bills")}>Pay a bill</Button>
            <Button variant="ghost" onClick={() => go(4, true, "/app")}>Explore the dashboard</Button>
          </div></Card>
      )}
    </div>
  );
}
