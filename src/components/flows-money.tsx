"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, Copy, Check, ShieldCheck } from "lucide-react";
import { Alert, Button, Card, Field, Input, Row, Select } from "./ui";
import { call, useSubmit } from "@/lib/client";
import { ASSETS, Asset, formatAmount, parseAmount } from "@/lib/money";

export interface NetInfo { id: string; label: string; assets: string[]; eta: string; confirmations: number; fee: Record<string, string>; min: Record<string, string> }
type Bal = Record<string, string>; // asset -> available (minor units, string)
const avail = (b: Bal, a: string) => BigInt(b[a] ?? "0");

function tryParse(v: string, a: Asset): bigint | null { try { return v ? parseAmount(v, a) : null; } catch { return null; } }
const ErrorBox = ({ msg }: { msg: string | null }) => (msg ? <Alert tone="bad" title="That did not go through">{msg}</Alert> : null);

/* ----------------------------- Deposit ----------------------------- */
export function DepositFlow({ nets, sandbox }: { nets: NetInfo[]; sandbox: boolean }) {
  const crypto = ["USDT", "USDC", "BTC", "ETH"];
  const [asset, setAsset] = useState("USDT");
  const options = nets.filter((n) => n.assets.includes(asset));
  const [net, setNet] = useState(options[0]?.id ?? "");
  const [addr, setAddr] = useState<{ address: string; network: string; confirmations: number; eta: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const s = useSubmit(); const sim = useSubmit(); const router = useRouter();
  const [simAmt, setSimAmt] = useState("100"); const [simMsg, setSimMsg] = useState<string | null>(null);
  useEffect(() => { setNet(nets.filter((n) => n.assets.includes(asset))[0]?.id ?? ""); setAddr(null); }, [asset, nets]);
  useEffect(() => { setAddr(null); if (net) s.run(() => call<any>("/api/crypto/address", { asset, network: net })).then((r) => r && setAddr(r)); /* eslint-disable-next-line */ }, [net]);
  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <Field label="Asset" id="d-asset"><Select id="d-asset" value={asset} onChange={(e) => setAsset(e.target.value)}>{crypto.map((a) => <option key={a} value={a}>{a}</option>)}</Select></Field>
        <Field label="Network" id="d-net" hint="Send only on this network. Funds sent on a different network can be lost permanently.">
          <Select id="d-net" value={net} onChange={(e) => setNet(e.target.value)}>{options.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}</Select>
        </Field>
        <ErrorBox msg={s.error} />
        {s.busy && !addr && <p className="text-muted" role="status">Generating your address...</p>}
        {addr && (
          <div className="space-y-3">
            <div className="rounded-xl bg-surface-2 p-3"><p className="text-sm text-muted">Your {asset} deposit address</p><p className="font-mono break-all text-lg mt-1" data-testid="deposit-address">{addr.address}</p></div>
            <Button variant="outline" onClick={async () => { await navigator.clipboard?.writeText(addr.address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? <Check className="size-5" /> : <Copy className="size-5" />}{copied ? "Copied" : "Copy address"}</Button>
            <Alert title={`Arrives in ${addr.eta}`}>We show it as <b>Pending</b> immediately and make it spendable after {addr.confirmations} network confirmations. Minimum deposits may apply.</Alert>
          </div>
        )}
      </Card>
      {sandbox && addr && (
        <Card className="space-y-3 border-dashed">
          <p className="font-semibold">Sandbox tools</p>
          <p className="text-sm text-muted">This address is a sandbox address. Simulate an incoming transfer to watch the pending to confirmed flow. It goes through the real signed webhook handler.</p>
          <Field label={`Amount (${asset})`} id="sim-amt"><Input id="sim-amt" inputMode="decimal" value={simAmt} onChange={(e) => setSimAmt(e.target.value)} /></Field>
          <ErrorBox msg={sim.error} />{simMsg && <Alert tone="ok">{simMsg}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button busy={sim.busy} onClick={async () => { const r = await sim.run(() => call<any>("/api/sandbox/simulate-deposit", { asset, network: net, amount: simAmt })); if (r) { setSimMsg("Deposit detected. Open Activity to follow its confirmations."); router.refresh(); } }}>Simulate deposit</Button>
            <Button variant="outline" busy={sim.busy} onClick={async () => { const r = await sim.run(() => call<any>("/api/sandbox/simulate-deposit", { asset, network: net, amount: simAmt, duplicate: true })); if (r) setSimMsg("Sent the same webhook twice. Only one deposit was created."); router.refresh(); }}>Simulate duplicate webhook</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ----------------------------- Withdraw ----------------------------- */
export function WithdrawFlow({ nets, balances, banks }: { nets: NetInfo[]; balances: Bal; banks: { code: string; name: string }[] }) {
  const [mode, setMode] = useState<"crypto" | "bank">("bank");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Withdrawal type" className="grid grid-cols-2 gap-2">
        {(["bank", "crypto"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-12 rounded-xl font-semibold border ${mode === m ? "bg-brand text-brand-fg border-brand" : "border-border bg-surface"}`}>{m === "bank" ? "To bank (NGN)" : "To crypto address"}</button>
        ))}
      </div>
      {mode === "bank" ? <BankWithdraw balances={balances} banks={banks} /> : <CryptoWithdraw nets={nets} balances={balances} />}
    </div>
  );
}

function ConfirmBar({ onBack, onConfirm, busy, label }: { onBack: () => void; onConfirm: () => void; busy: boolean; label: string }) {
  return <div className="grid grid-cols-2 gap-2 pt-2"><Button variant="outline" onClick={onBack} disabled={busy}>Edit</Button><Button onClick={onConfirm} busy={busy}>{label}</Button></div>;
}

function CryptoWithdraw({ nets, balances }: { nets: NetInfo[]; balances: Bal }) {
  const [asset, setAsset] = useState<Asset>("USDT");
  const options = nets.filter((n) => n.assets.includes(asset));
  const [net, setNet] = useState(options[0].id); const [address, setAddress] = useState(""); const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false); const s = useSubmit(); const router = useRouter();
  useEffect(() => { setNet(nets.filter((n) => n.assets.includes(asset))[0].id); }, [asset, nets]);
  const n = nets.find((x) => x.id === net)!; const fee = BigInt(n.fee[asset] ?? "0"); const min = BigInt(n.min[asset] ?? "0");
  const amt = tryParse(amount, asset); const total = (amt ?? 0n) + fee; const have = avail(balances, asset);
  const problem = amt === null ? (amount ? "Enter a valid amount" : "") : amt < min ? `Minimum is ${formatAmount(min, asset)}` : total > have ? `Not enough balance. You have ${formatAmount(have, asset)}.` : "";
  const submit = async () => {
    const r = await s.run((key) => call<any>("/api/crypto/withdraw", { asset, network: net, address, amount }, { key }));
    if (r) router.push(`/app/activity/${r.tx.id}?new=1`);
  };
  return (
    <Card className="space-y-4">
      {!review ? (<>
        <Field label="Asset" id="w-asset"><Select id="w-asset" value={asset} onChange={(e) => setAsset(e.target.value as Asset)}>{["USDT", "USDC", "BTC", "ETH"].map((a) => <option key={a}>{a}</option>)}</Select></Field>
        <Field label="Network" id="w-net"><Select id="w-net" value={net} onChange={(e) => setNet(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select></Field>
        <Field label="Recipient address" id="w-addr" error={s.fields.address}><Input id="w-addr" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste address" error={s.fields.address} /></Field>
        <Field label={`Amount (${asset})`} id="w-amt" error={problem || s.fields.amount} hint={`Available: ${formatAmount(have, asset)}`}><Input id="w-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={problem || s.fields.amount} /></Field>
        <dl><Row k="Network fee">{formatAmount(fee, asset)}</Row><Row k="Total taken from wallet">{formatAmount(total, asset)}</Row><Row k="Recipient gets">{amt ? formatAmount(amt, asset) : "-"}</Row></dl>
        <ErrorBox msg={s.error} />
        <Button disabled={!amt || !!problem || address.length < 10} onClick={() => setReview(true)} className="w-full">Review withdrawal</Button>
      </>) : (<>
        <Alert tone="warn" title="Check carefully. Crypto transfers cannot be undone.">Make sure the address is on the <b>{n.label}</b> network.</Alert>
        <dl><Row k="Send">{formatAmount(amt!, asset)}</Row><Row k="Network">{n.label}</Row><Row k="To"><span className="font-mono text-sm">{address}</span></Row><Row k="Fee">{formatAmount(fee, asset)}</Row><Row k="Total">{formatAmount(total, asset)}</Row></dl>
        <ErrorBox msg={s.error} /><ConfirmBar onBack={() => setReview(false)} onConfirm={submit} busy={s.busy} label="Confirm and send" />
      </>)}
    </Card>
  );
}

function BankWithdraw({ balances, banks }: { balances: Bal; banks: { code: string; name: string }[] }) {
  const [bank, setBank] = useState(banks[0].code); const [acct, setAcct] = useState(""); const [amount, setAmount] = useState("");
  const [name, setName] = useState<string | null>(null); const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [review, setReview] = useState(false); const s = useSubmit(); const router = useRouter();
  const FEE = 5000n; const amt = tryParse(amount, "NGN"); const total = (amt ?? 0n) + FEE; const have = avail(balances, "NGN");
  useEffect(() => {
    setName(null); setResolveErr(null);
    if (!/^\d{10}$/.test(acct)) return;
    let live = true;
    call<any>("/api/crypto/bank-resolve", { bankCode: bank, accountNumber: acct }).then((r) => live && setName(r.accountName)).catch((e) => live && setResolveErr(e.message));
    return () => { live = false; };
  }, [bank, acct]);
  const problem = amt === null ? (amount ? "Enter a valid amount" : "") : amt < 100000n ? "Minimum is ₦1,000" : total > have ? `Not enough balance. You have ${formatAmount(have, "NGN")}.` : "";
  const submit = async () => { const r = await s.run((key) => call<any>("/api/crypto/bank-withdraw", { bankCode: bank, accountNumber: acct, amount }, { key })); if (r) router.push(`/app/activity/${r.tx.id}?new=1`); };
  return (
    <Card className="space-y-4">
      {!review ? (<>
        <Field label="Bank" id="b-bank"><Select id="b-bank" value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</Select></Field>
        <Field label="Account number" id="b-acct" error={resolveErr ?? undefined} hint={name ? undefined : "10 digits"}><Input id="b-acct" inputMode="numeric" maxLength={10} value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} error={resolveErr ?? undefined} /></Field>
        {name && <Alert tone="ok" title="Account found"><span className="font-semibold">{name}</span></Alert>}
        <Field label="Amount (NGN)" id="b-amt" error={problem || s.fields.amount} hint={`Available: ${formatAmount(have, "NGN")}`}><Input id="b-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={problem || s.fields.amount} /></Field>
        <dl><Row k="Fee">{formatAmount(FEE, "NGN")}</Row><Row k="Total taken from wallet">{formatAmount(total, "NGN")}</Row></dl>
        <ErrorBox msg={s.error} />
        <Button disabled={!amt || !!problem || !name} onClick={() => setReview(true)} className="w-full">Review withdrawal</Button>
      </>) : (<>
        <dl><Row k="Amount">{formatAmount(amt!, "NGN")}</Row><Row k="To">{name}</Row><Row k="Bank / account">{banks.find((b) => b.code === bank)?.name} {acct}</Row><Row k="Fee">{formatAmount(FEE, "NGN")}</Row><Row k="Total">{formatAmount(total, "NGN")}</Row></dl>
        <ErrorBox msg={s.error} /><ConfirmBar onBack={() => setReview(false)} onConfirm={submit} busy={s.busy} label="Confirm and send" />
      </>)}
    </Card>
  );
}

/* ----------------------------- Swap ----------------------------- */
interface Q { id: string; fromAmount: string; fee: string; toAmount: string; rate: string; expiresAt: string; ttl: number }
export function SwapFlow({ balances }: { balances: Bal }) {
  const all: Asset[] = ["NGN", "USDT", "USDC", "BTC", "ETH"];
  const [from, setFrom] = useState<Asset>("USDT"); const [to, setTo] = useState<Asset>("NGN"); const [amount, setAmount] = useState("");
  const [q, setQ] = useState<Q | null>(null); const [secs, setSecs] = useState(0); const [qErr, setQErr] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const s = useSubmit(); const router = useRouter();
  const amt = tryParse(amount, from); const have = avail(balances, from);
  const problem = amount && amt === null ? "Enter a valid amount" : amt && amt > have ? `Not enough balance. You have ${formatAmount(have, from)}.` : "";

  async function getQuote() {
    if (!amt || amt <= 0n || problem || from === to) { setQ(null); return; }
    setLoading(true); setQErr(null);
    try { const r = await call<Q>("/api/crypto/quote", { from, to, amount }); setQ(r); } catch (e: any) { setQ(null); setQErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { setQ(null); setQErr(null); const t = setTimeout(getQuote, 450); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [from, to, amount]);
  useEffect(() => {
    if (!q) return;
    const tick = () => { const left = Math.max(0, Math.round((new Date(q.expiresAt).getTime() - Date.now()) / 1000)); setSecs(left); if (left === 0) getQuote(); };
    tick(); const id = setInterval(tick, 500); return () => clearInterval(id); /* eslint-disable-next-line */
  }, [q?.id]);

  const confirm = async () => { if (!q) return; const r = await s.run((key) => call<any>("/api/crypto/swap", { quoteId: q.id }, { key })); if (r) router.push(`/app/activity/${r.tx.id}?new=1`); };
  const flip = () => { setFrom(to); setTo(from); setAmount(""); };
  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
        <Field label="From" id="s-from"><Select id="s-from" value={from} onChange={(e) => setFrom(e.target.value as Asset)}>{all.map((a) => <option key={a}>{a}</option>)}</Select></Field>
        <button onClick={flip} aria-label="Swap direction" className="min-h-12 size-12 grid place-items-center rounded-xl border border-border hover:bg-surface-2"><ArrowDownUp className="size-5" /></button>
        <Field label="To" id="s-to"><Select id="s-to" value={to} onChange={(e) => setTo(e.target.value as Asset)}>{all.map((a) => <option key={a}>{a}</option>)}</Select></Field>
      </div>
      <Field label={`You pay (${from})`} id="s-amt" error={problem || s.fields.amount} hint={`Available: ${formatAmount(have, from)}`}>
        <div className="flex gap-2"><Input id="s-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={problem} />
          <Button variant="outline" onClick={() => setAmount(formatAmount(have, from, { symbol: false }).replace(/,/g, ""))} aria-label="Use maximum">Max</Button></div>
      </Field>
      {from === to && <Alert tone="warn">Choose two different assets.</Alert>}
      {qErr && <Alert tone="bad">{qErr}</Alert>}
      {loading && !q && <p className="text-muted" role="status">Getting your rate...</p>}
      {q && (
        <div aria-live="polite">
          <dl>
            <Row k="Rate">1 {from} = {q.rate.replace(/\.?0+$/, "")} {to}</Row>
            <Row k="Fee (0.5%)">{formatAmount(q.fee, from)}</Row>
            <Row k="You receive"><span className="text-lg font-bold">{formatAmount(q.toAmount, to)}</span></Row>
          </dl>
          <p className="text-sm text-muted mt-2 flex items-center gap-1.5"><ShieldCheck className="size-4" aria-hidden />Rate locked for {secs}s. Simulated rates in sandbox. No hidden spread.</p>
        </div>
      )}
      <ErrorBox msg={s.error} />
      <Button className="w-full" disabled={!q || secs === 0} busy={s.busy} onClick={confirm}>Confirm swap</Button>
    </Card>
  );
}

/* ----------------------------- Bills ----------------------------- */
export interface BillCat { id: string; label: string; identifierLabel: string; fee: string; min: string; max: string; providers: { code: string; label: string; kinds?: string[]; plans?: { code: string; label: string; price: string }[] }[] }
export interface Beneficiary { id: string; category: string; provider_code: string; identifier: string; label: string }
export function BillsFlow({ cats, saved, balance }: { cats: BillCat[]; saved: Beneficiary[]; balance: string }) {
  const [cat, setCat] = useState(cats[0].id); const c = cats.find((x) => x.id === cat)!;
  const [prov, setProv] = useState(c.providers[0].code); const [ident, setIdent] = useState(""); const [plan, setPlan] = useState(""); const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("prepaid"); const [save, setSave] = useState(false); const [review, setReview] = useState(false);
  const [custName, setCustName] = useState<string | null>(null);
  const s = useSubmit(); const router = useRouter();
  const p = c.providers.find((x) => x.code === prov) ?? c.providers[0];
  useEffect(() => { setProv(c.providers[0].code); setPlan(""); setAmount(""); setCustName(null); setReview(false); }, [cat]); // eslint-disable-line
  useEffect(() => { setPlan(""); }, [prov]);
  const price = p.plans ? BigInt(p.plans.find((x) => x.code === plan)?.price ?? "0") : tryParse(amount, "NGN") ?? 0n;
  const fee = BigInt(c.fee); const total = price + fee; const have = BigInt(balance);
  const problem = !price ? "" : total > have ? `Not enough balance. You have ${formatAmount(have, "NGN")}.` : !p.plans && (price < BigInt(c.min) || price > BigInt(c.max)) ? `Between ${formatAmount(c.min, "NGN")} and ${formatAmount(c.max, "NGN")}` : "";
  const ready = ident.length >= 5 && price > 0n && !problem;
  const lookup = async () => { const r = await s.run(() => call<any>("/api/bills/lookup", { category: cat, providerCode: prov, identifier: ident, kind })); if (r) setCustName(r.customerName); };
  const pay = async () => { const r = await s.run((key) => call<any>("/api/bills/pay", { category: cat, providerCode: prov, identifier: ident, planCode: plan || undefined, amount: p.plans ? undefined : amount, kind: cat === "electricity" ? kind : undefined, save }, { key })); if (r) router.push(`/app/activity/${r.tx.id}?new=1`); };
  const mine = saved.filter((b) => b.category === cat);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Bill type" className="grid grid-cols-4 gap-2">
        {cats.map((x) => <button key={x.id} role="tab" aria-selected={cat === x.id} onClick={() => setCat(x.id)} className={`min-h-12 rounded-xl text-sm font-semibold border ${cat === x.id ? "bg-brand text-brand-fg border-brand" : "border-border bg-surface"}`}>{x.label}</button>)}
      </div>
      <Card className="space-y-4">
        {mine.length > 0 && !review && (
          <div><p className="text-sm font-medium mb-2">Saved beneficiaries</p>
            <div className="flex flex-wrap gap-2">{mine.map((b) => (
              <span key={b.id} className="inline-flex rounded-full border border-border overflow-hidden">
                <button className="px-3 min-h-10 hover:bg-surface-2 text-sm" onClick={() => { setProv(b.provider_code); setIdent(b.identifier); }}>{b.label}</button>
                <button aria-label={`Remove ${b.label}`} className="px-2 min-h-10 hover:bg-surface-2 text-muted" onClick={async () => { await call(`/api/bills/${b.id}`, undefined, { method: "DELETE" }).catch(() => {}); router.refresh(); }}>×</button>
              </span>))}</div></div>
        )}
        {!review ? (<>
          <Field label="Provider" id="bl-prov"><Select id="bl-prov" value={prov} onChange={(e) => setProv(e.target.value)}>{c.providers.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</Select></Field>
          {cat === "electricity" && <Field label="Meter type" id="bl-kind"><Select id="bl-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="prepaid">Prepaid</option><option value="postpaid">Postpaid</option></Select></Field>}
          <Field label={c.identifierLabel} id="bl-id" error={s.fields.identifier}><Input id="bl-id" inputMode="numeric" value={ident} onChange={(e) => { setIdent(e.target.value); setCustName(null); }} error={s.fields.identifier} /></Field>
          {(cat === "electricity" || cat === "cable") && ident.length >= 10 && !custName && <Button variant="outline" busy={s.busy} onClick={lookup}>Verify name</Button>}
          {custName && <Alert tone="ok" title="Verified"><span className="font-semibold">{custName}</span></Alert>}
          {p.plans ? (
            <Field label="Plan" id="bl-plan" error={s.fields.planCode}><Select id="bl-plan" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Choose a plan</option>{p.plans.map((x) => <option key={x.code} value={x.code}>{x.label} ({formatAmount(x.price, "NGN")})</option>)}</Select></Field>
          ) : (
            <Field label="Amount (NGN)" id="bl-amt" error={problem || s.fields.amount} hint={`Available: ${formatAmount(have, "NGN")}`}><Input id="bl-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={problem || s.fields.amount} /></Field>
          )}
          {p.plans && problem && <Alert tone="bad">{problem}</Alert>}
          <label className="flex items-center gap-3 min-h-11"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-5 accent-[var(--brand)]" />Save as beneficiary</label>
          <dl><Row k="Price">{formatAmount(price, "NGN")}</Row><Row k="Service fee">{formatAmount(fee, "NGN")}</Row><Row k="Total">{formatAmount(total, "NGN")}</Row></dl>
          <ErrorBox msg={s.error} />
          <Button className="w-full" disabled={!ready} onClick={() => setReview(true)}>Review payment</Button>
        </>) : (<>
          <dl><Row k={c.label}>{p.label}{p.plans ? `: ${p.plans.find((x) => x.code === plan)?.label}` : ""}</Row><Row k={c.identifierLabel}>{ident}</Row>{custName && <Row k="Name">{custName}</Row>}<Row k="Total">{formatAmount(total, "NGN")}</Row></dl>
          <ErrorBox msg={s.error} /><ConfirmBar onBack={() => setReview(false)} onConfirm={pay} busy={s.busy} label={`Pay ${formatAmount(total, "NGN")}`} />
        </>)}
      </Card>
    </div>
  );
}
