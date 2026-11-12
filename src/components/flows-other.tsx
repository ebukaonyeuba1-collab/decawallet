"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Row, Select, StatusBadge } from "./ui";
import { call, useSubmit } from "@/lib/client";
import { Asset, formatAmount, parseAmount } from "@/lib/money";
import { STATUS_COPY } from "@/lib/describe";

const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <Alert tone="bad">{msg}</Alert> : null);

/* ----------- Live status for a single transaction (receipt + result screen) ----------- */
export function TxTracker({ id, initial, isNew }: { id: string; initial: { status: string; failureReason: string | null; confirmations?: number; required?: number }; isNew: boolean }) {
  const [st, setSt] = useState(initial); const router = useRouter(); const [lost, setLost] = useState(false);
  useEffect(() => {
    if (!["pending", "processing"].includes(st.status)) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await call<any>(`/api/transactions/${id}`, undefined, { method: "GET" });
        if (stop) return; setLost(false);
        setSt({ status: r.tx.status, failureReason: r.tx.failureReason, confirmations: r.tx.meta.confirmations, required: r.tx.meta.required });
        if (!["pending", "processing"].includes(r.tx.status)) router.refresh();
      } catch { if (!stop) setLost(true); }
    };
    const t = setInterval(tick, 3000); return () => { stop = true; clearInterval(t); };
  }, [id, st.status, router]);
  const c = STATUS_COPY[st.status];
  const big = st.status === "success" ? "Successful" : st.status === "failed" ? "Failed" : st.status === "reversed" ? "Reversed" : "Pending";
  return (
    <div role="status" aria-live="polite" className={`rounded-2xl border p-5 text-center ${c.tone === "ok" ? "border-success/50 bg-success/10" : c.tone === "bad" ? "border-danger/50 bg-danger/10" : "border-border bg-surface"}`}>
      {isNew && <p className="text-sm text-muted mb-1">{st.status === "success" ? "All done" : st.status === "failed" ? "It did not go through" : "We have your request"}</p>}
      <div className="flex justify-center mb-2"><StatusBadge status={st.status} /></div>
      <p className="text-2xl font-bold">{big}</p>
      <p className="text-muted mt-1 max-w-md mx-auto">{c.help}</p>
      {st.failureReason && ["failed", "reversed"].includes(st.status) && <p className="mt-2 font-medium">Reason: {st.failureReason}</p>}
      {st.required ? <p className="mt-2 tabular">{Math.min(st.confirmations ?? 0, st.required)} of {st.required} network confirmations</p> : null}
      {lost && <p className="text-sm text-warning mt-2">Connection lost. Your transaction is unaffected. We will keep trying to refresh.</p>}
    </div>
  );
}

/* ----------- Gift card submission ----------- */
export interface BrandInfo { id: string; label: string; ngnPerUsd: number; types: string[]; notes: string }
export function GiftcardForm({ brands, currencies }: { brands: BrandInfo[]; currencies: Record<string, { label: string; perUsd: number }> }) {
  const [brand, setBrand] = useState(brands[0].id); const b = brands.find((x) => x.id === brand)!;
  const [type, setType] = useState(b.types[0]); const [currency, setCurrency] = useState("USD"); const [face, setFace] = useState(""); const [code, setCode] = useState("");
  const [files, setFiles] = useState<File[]>([]); const s = useSubmit(); const router = useRouter();
  useEffect(() => { setType(b.types[0]); }, [brand]); // eslint-disable-line
  let est = "";
  try { if (face) { const minor = parseAmount(face, "NGN"); est = formatAmount((minor * BigInt(Math.round(currencies[currency].perUsd * 100)) * BigInt(b.ngnPerUsd)) / 100n, "NGN"); } } catch {}
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(); fd.set("brand", brand); fd.set("cardType", type); fd.set("currency", currency); fd.set("faceValue", face); if (type === "ecode") fd.set("code", code);
    files.forEach((f) => fd.append("images", f));
    const r = await s.run(() => call<{ id: string }>("/api/giftcards", undefined, { form: fd }));
    if (r) router.push(`/app/giftcards/${r.id}?new=1`);
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card className="space-y-4">
        <Field label="Brand" id="g-brand"><Select id="g-brand" value={brand} onChange={(e) => setBrand(e.target.value)}>{brands.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
        <p className="text-sm text-muted">{b.notes}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Card type" id="g-type" error={s.fields.cardType}><Select id="g-type" value={type} onChange={(e) => setType(e.target.value)}>{b.types.map((t) => <option key={t} value={t}>{t === "ecode" ? "Digital code" : "Physical card"}</option>)}</Select></Field>
          <Field label="Currency" id="g-cur"><Select id="g-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>{Object.entries(currencies).map(([k, v]) => <option key={k} value={k}>{k}: {v.label}</option>)}</Select></Field>
        </div>
        <Field label={`Card value (${currency})`} id="g-face" error={s.fields.faceValue}><Input id="g-face" inputMode="decimal" value={face} onChange={(e) => setFace(e.target.value)} error={s.fields.faceValue} /></Field>
        {type === "ecode" && <Field label="Card code" id="g-code" error={s.fields.code} hint="Copy it exactly. It is encrypted and only a reviewer can see it."><Input id="g-code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} error={s.fields.code} /></Field>}
        <Field label={type === "ecode" ? "Screenshot (optional)" : "Photos of the card (front, back, receipt)"} id="g-img" error={s.fields.images} hint="JPEG, PNG or WebP. Up to 3 images, 1 MB each. Clear, uncropped photos get paid faster.">
          <input id="g-img" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} className="block w-full text-base file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-4 file:py-3 file:text-fg" />
        </Field>
      </Card>
      <Alert title="How it works">1. Submit. 2. We review it (usually about 30 minutes). 3. Once approved, the Naira lands in your wallet. The final amount is confirmed at review.{est && <> Indicative payout: <b>{est}</b>.</>}</Alert>
      <ErrorBox msg={s.error && !Object.keys(s.fields).length ? s.error : Object.keys(s.fields).length ? "Please fix the highlighted fields." : null} />
      <Button type="submit" busy={s.busy} className="w-full">Submit gift card</Button>
    </form>
  );
}

/* ----------- Cards ----------- */
export function NewCard({ canCreate }: { canCreate: boolean }) {
  const [phys, setPhys] = useState(false); const [a, setA] = useState({ line1: "", city: "", state: "", phone: "" }); const s = useSubmit(); const router = useRouter();
  const create = async (type: "virtual" | "physical") => { const r = await s.run((key) => call<{ id: string }>("/api/cards", { type, address: type === "physical" ? a : undefined }, { key })); if (r) router.push(`/app/cards/${r.id}`); };
  return (
    <div className="space-y-3">
      <ErrorBox msg={s.error} />
      {!phys ? (
        <div className="grid sm:grid-cols-2 gap-3"><Button disabled={!canCreate} busy={s.busy} onClick={() => create("virtual")}>Create virtual card</Button><Button variant="outline" disabled={!canCreate} onClick={() => setPhys(true)}>Order physical card</Button></div>
      ) : (
        <Card className="space-y-3"><p className="font-semibold">Delivery address</p>
          <Field label="Street address" id="a1" error={s.fields["address.line1"]}><Input id="a1" value={a.line1} onChange={(e) => setA({ ...a, line1: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="City" id="a2"><Input id="a2" value={a.city} onChange={(e) => setA({ ...a, city: e.target.value })} /></Field><Field label="State" id="a3"><Input id="a3" value={a.state} onChange={(e) => setA({ ...a, state: e.target.value })} /></Field></div>
          <Field label="Phone for the courier" id="a4" error={s.fields["address.phone"]}><Input id="a4" inputMode="tel" value={a.phone} onChange={(e) => setA({ ...a, phone: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setPhys(false)}>Back</Button><Button busy={s.busy} onClick={() => create("physical")}>Order card</Button></div></Card>
      )}
    </div>
  );
}

export function CardActions({ card, sandbox }: { card: { id: string; status: string; type: string; last4: string; balance: string; perTx: string; daily: string; monthly: string }; sandbox: boolean }) {
  const router = useRouter(); const s = useSubmit(); const [msg, setMsg] = useState<string | null>(null);
  const [fund, setFund] = useState(""); const [lim, setLim] = useState({ perTx: String(Number(card.perTx) / 100), daily: String(Number(card.daily) / 100), monthly: String(Number(card.monthly) / 100) });
  const [rev, setRev] = useState<{ pan: string; cvv: string } | null>(null); const [last4, setLast4] = useState(""); const [spend, setSpend] = useState({ merchant: "Sandbox Store", amount: "1000" });
  const act = async (path: string, body?: unknown, ok?: string, key = false) => { setMsg(null); const r = await s.run((k) => call<any>(`/api/cards/${card.id}/${path}`, body, key ? { key: k } : {})); if (r !== undefined) { if (ok) setMsg(ok); router.refresh(); if (path === "fund" && r?.tx) router.push(`/app/activity/${r.tx.id}?new=1`); return r; } };
  const live = card.status === "active" || card.status === "frozen";
  return (
    <div className="space-y-4">
      <ErrorBox msg={s.error} />{msg && <Alert tone="ok">{msg}</Alert>}
      {card.status === "awaiting_activation" && (
        <Card className="space-y-3"><p className="font-semibold">Activate your card</p><Field label="Last 4 digits printed on the card" id="act" error={s.fields.last4}><Input id="act" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button busy={s.busy} disabled={last4.length !== 4} onClick={() => act("activate", { last4 }, "Card activated")}>Activate</Button>{sandbox && <p className="text-sm text-muted">Sandbox hint: the digits are {card.last4}.</p>}</Card>
      )}
      {live && (<>
        <div className="grid grid-cols-2 gap-2">
          <Button variant={card.status === "frozen" ? "primary" : "outline"} busy={s.busy} onClick={() => act(card.status === "frozen" ? "unfreeze" : "freeze", {}, card.status === "frozen" ? "Card unfrozen" : "Card frozen. All spending is blocked.")}>{card.status === "frozen" ? "Unfreeze card" : "Freeze card"}</Button>
          <Button variant="outline" busy={s.busy} onClick={async () => { const r = await act("reveal", {}); if (r) setRev(r); }}>Show details</Button>
        </div>
        {rev && <Card className="font-mono space-y-1"><p>{rev.pan}</p><p>CVV {rev.cvv}</p><p className="text-sm text-muted font-sans">Sandbox card, not usable anywhere. Details are fetched from the provider each time and never stored.</p><Button variant="ghost" onClick={() => setRev(null)}>Hide</Button></Card>}
        <Card className="space-y-3"><p className="font-semibold">Fund card from your Naira wallet</p>
          <Field label="Amount (NGN)" id="fa" error={s.fields.amount} hint="Fee: ₦100. Minimum ₦500."><Input id="fa" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} error={s.fields.amount} /></Field>
          <Button busy={s.busy} disabled={!fund} onClick={() => act("fund", { amount: fund }, undefined, true)}>Fund card</Button></Card>
        <Card className="space-y-3"><p className="font-semibold">Spending limits (NGN)</p>
          {(["perTx", "daily", "monthly"] as const).map((k) => <Field key={k} label={k === "perTx" ? "Per transaction" : k === "daily" ? "Daily" : "Monthly"} id={`l-${k}`}><Input id={`l-${k}`} inputMode="decimal" value={lim[k]} onChange={(e) => setLim({ ...lim, [k]: e.target.value })} /></Field>)}
          <Button variant="outline" busy={s.busy} onClick={() => act("limits", lim, "Limits updated")}>Save limits</Button></Card>
        {sandbox && <Card className="space-y-3 border-dashed"><p className="font-semibold">Sandbox: simulate a purchase</p>
          <div className="grid grid-cols-2 gap-3"><Field label="Merchant" id="sm"><Input id="sm" value={spend.merchant} onChange={(e) => setSpend({ ...spend, merchant: e.target.value })} /></Field><Field label="Amount (NGN)" id="sa"><Input id="sa" inputMode="decimal" value={spend.amount} onChange={(e) => setSpend({ ...spend, amount: e.target.value })} /></Field></div>
          <Button variant="outline" busy={s.busy} onClick={async () => { const r = await act("simulate-spend", spend); if (r) setMsg(r.approved ? "Approved" : `Declined: ${r.reason}`); }}>Simulate purchase</Button></Card>}
      </>)}
      {card.status === "pending_delivery" && <Alert title="On its way">Delivery tracking updates below. You can activate the card once it arrives.</Alert>}
    </div>
  );
}

/* ----------- Admin ----------- */
export function GiftAdmin({ id, status, indicative, hasCode }: { id: string; status: string; indicative: string; hasCode: boolean }) {
  const router = useRouter(); const s = useSubmit(); const [payout, setPayout] = useState(indicative); const [reason, setReason] = useState(""); const [code, setCode] = useState<string | null>(null);
  const act = async (a: string, body: object = {}) => { const r = await s.run(() => call<any>(`/api/admin/giftcards/${id}/${a}`, body)); if (r) router.refresh(); return r; };
  const open = ["submitted", "in_review"].includes(status);
  return (
    <Card className="space-y-4"><h2 className="font-semibold text-lg">Review actions</h2><ErrorBox msg={s.error} />
      {hasCode && <div>{code ? <p className="font-mono break-all bg-surface-2 rounded-xl p-3">{code}</p> : <Button variant="outline" busy={s.busy} onClick={async () => { const r = await s.run(() => call<any>(`/api/admin/giftcards/${id}/reveal`, {})); if (r) setCode(r.code); }}>Reveal code (audited)</Button>}</div>}
      {status === "submitted" && <Button busy={s.busy} onClick={() => act("claim")}>Start review</Button>}
      {open && (<>
        <Field label="Payout to customer (NGN)" id="po" error={s.fields.payout}><Input id="po" inputMode="decimal" value={payout} onChange={(e) => setPayout(e.target.value)} /></Field>
        <Button busy={s.busy} onClick={() => act("approve", { payout })}>Approve</Button>
      </>)}
      {["submitted", "in_review", "approved"].includes(status) && (<>
        <Field label="Rejection reason (shown to customer)" id="rr" error={s.fields.reason}><Input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Button variant="danger" busy={s.busy} onClick={() => act("reject", { reason })}>Reject</Button>
      </>)}
      {status === "approved" && <Button busy={s.busy} onClick={() => act("payout")}>Pay customer now (credits wallet)</Button>}
      {status === "paid" && <Alert tone="ok">Paid. Wallet credited.</Alert>}
    </Card>
  );
}

export function TxAdmin({ id, sandbox, flagged }: { id: string; sandbox: boolean; flagged: boolean }) {
  const router = useRouter(); const s = useSubmit(); const [out, setOut] = useState<string | null>(null);
  const act = async (a: string, body: object = {}) => { setOut(null); const r = await s.run(() => call<any>(`/api/admin/transactions/${id}/${a}`, body)); if (r) { setOut(r.outcome ? `Result: ${r.outcome}` : "Done"); router.refresh(); } };
  return (
    <Card className="space-y-3"><h2 className="font-semibold text-lg">Tools</h2><ErrorBox msg={s.error} />{out && <Alert tone="ok">{out}</Alert>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" busy={s.busy} onClick={() => act("reconcile")}>Re-verify with provider</Button>{flagged && <Button variant="outline" busy={s.busy} onClick={() => act("resolve-flag")}>Mark flags resolved</Button>}</div>
      {sandbox && <div><p className="text-sm text-muted mb-2">Sandbox: force the provider outcome and deliver a signed webhook.</p><div className="flex flex-wrap gap-2">{["processing", "success", "failed", "reversed"].map((st) => <Button key={st} variant="outline" busy={s.busy} onClick={() => act("simulate", { state: st })}>{st}</Button>)}</div></div>}
    </Card>
  );
}
export { Row, Select };
