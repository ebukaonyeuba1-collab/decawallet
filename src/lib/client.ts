"use client";
import { useRef, useState } from "react";

export class ApiFail extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); }
}
export const newKey = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, "");

export async function call<T = any>(url: string, body?: unknown, opts: { method?: string; key?: string; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!opts.form) headers["Content-Type"] = "application/json";
  if (opts.key) headers["Idempotency-Key"] = opts.key;
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "POST", headers, body: opts.form ?? (body === undefined ? undefined : JSON.stringify(body)), credentials: "same-origin" });
  } catch {
    throw new ApiFail(0, "network", "We could not reach the server, so we cannot confirm what happened. Check Activity before retrying. Retrying now is safe: you will not be charged twice.");
  }
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    const e = json?.error;
    throw new ApiFail(res.status, e?.code ?? "error", e?.message ?? "Something went wrong. Please try again.", e?.fields);
  }
  return json.data as T;
}

/** Submit helper: busy/error state plus an idempotency key that survives ambiguous failures (network, 5xx) so a retry cannot double-spend. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const key = useRef<string | null>(null);
  async function run<T>(fn: (key: string) => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null); setFields({});
    key.current ??= newKey();
    try {
      const out = await fn(key.current);
      key.current = null;
      return out;
    } catch (e) {
      const f = e as ApiFail;
      if (f.status !== 0 && f.status < 500) key.current = null; // definitive answer: next attempt is a fresh request
      setError(f.message); setFields(f.fields ?? {});
    } finally { setBusy(false); }
  }
  return { busy, error, fields, run, clear: () => { setError(null); setFields({}); } };
}
