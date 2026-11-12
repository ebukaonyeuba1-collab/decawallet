import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RotateCcw, XCircle, Info } from "lucide-react";
import { formatAmount, Asset } from "@/lib/money";
import { STATUS_COPY } from "@/lib/describe";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(" ");

const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-12 font-semibold text-base transition disabled:opacity-50 disabled:cursor-not-allowed";
const variants = {
  primary: "bg-brand text-brand-fg hover:brightness-95",
  outline: "border border-border bg-surface hover:bg-surface-2 text-fg",
  danger: "bg-danger text-black hover:brightness-95",
  ghost: "text-fg hover:bg-surface-2",
};
export const btnClass = (v: keyof typeof variants = "primary", extra = "") => cx(base, variants[v], extra);

export function Button({ variant = "primary", busy, children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; busy?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || busy} aria-busy={busy || undefined} className={btnClass(variant, className)}>
      {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}{children}
    </button>
  );
}
export const LinkButton = ({ href, variant = "primary", children, className }: { href: string; variant?: keyof typeof variants; children: ReactNode; className?: string }) =>
  <Link href={href} className={btnClass(variant, className)}>{children}</Link>;

export const Card = ({ children, className, as: T = "section" }: { children: ReactNode; className?: string; as?: any }) =>
  <T className={cx("rounded-2xl border border-border bg-surface p-4 sm:p-5 print-card", className)}>{children}</T>;

export const PageTitle = ({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 mb-5">
    <div><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{sub && <p className="text-muted mt-1">{sub}</p>}</div>{action}
  </div>
);

export function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="text-sm text-danger flex gap-1.5"><AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />{error}</p>}
    </div>
  );
}
const inputBase = "w-full min-h-12 rounded-xl border border-border bg-surface-2 px-3 text-base text-fg placeholder:text-muted";
export const Input = ({ className, error, ...p }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) =>
  <input {...p} aria-invalid={!!error || undefined} aria-describedby={p.id ? (error ? `${p.id}-err` : `${p.id}-hint`) : undefined} className={cx(inputBase, error && "border-danger", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputBase, className)} />;

const tones = { ok: "text-success bg-success/10", warn: "text-warning bg-warning/10", bad: "text-danger bg-danger/10", info: "text-fg bg-surface-2", muted: "text-muted bg-surface-2" };
/** Status is conveyed by icon AND text, never colour alone. */
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COPY[status] ?? { label: status.replace(/_/g, " "), tone: "muted" as const };
  const Icon = s.tone === "ok" ? CheckCircle2 : s.tone === "bad" ? XCircle : s.tone === "warn" ? Clock3 : status === "reversed" ? RotateCcw : Info;
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium capitalize", tones[s.tone])}><Icon className="size-4" aria-hidden />{s.label}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "ok"; title?: string; children?: ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex gap-3 rounded-xl border p-3 text-sm", tone === "bad" ? "border-danger/50 bg-danger/10" : tone === "warn" ? "border-warning/50 bg-warning/10" : tone === "ok" ? "border-success/50 bg-success/10" : "border-border bg-surface-2")}>
      <Icon className="size-5 shrink-0 mt-0.5" aria-hidden /><div>{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}
export const EmptyState = ({ title, body, action }: { title: string; body: string; action?: ReactNode }) => (
  <div className="text-center py-10 px-4"><p className="font-semibold text-lg">{title}</p><p className="text-muted mt-1 mb-4 max-w-sm mx-auto">{body}</p>{action}</div>
);
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cx("skeleton", className)} />;
export const Money = ({ v, asset, className }: { v: string | bigint; asset: Asset; className?: string }) => <span className={cx("tabular", className)}>{formatAmount(v, asset)}</span>;
export const SandboxBanner = () => (
  <div className="bg-brand text-brand-fg text-center text-sm font-semibold py-1.5 px-3 no-print">Sandbox mode: simulated providers and fake money. Nothing here moves real funds.</div>
);
export const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex justify-between gap-4 py-2.5 border-b border-border last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right font-medium break-all">{children}</dd></div>
);
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-extrabold tracking-tight text-xl">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="9" fill="#111" /><path d="M9 22V10h6.5c4 0 6.5 2.3 6.5 6s-2.5 6-6.5 6H9z" fill="none" stroke="#F2C230" strokeWidth="3" strokeLinejoin="round" /><circle cx="23.5" cy="9" r="2.5" fill="#FF5A47" /></svg>
      DECA
    </span>
  );
}
