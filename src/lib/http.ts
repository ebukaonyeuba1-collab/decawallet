import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";
import { ApiError, badRequest } from "./errors";
import { InsufficientFunds } from "./ledger";
import { requireApiAdmin, requireApiUser, User } from "./auth";
import { ProviderNotImplemented } from "./providers/types";
import { randomToken } from "./security";

export interface Ctx<B> {
  req: NextRequest; user: User; body: B; params: Record<string, string>; idempotencyKey?: string; ip: string; form?: FormData;
}
type Opts<B> = { auth?: "user" | "admin" | "none"; schema?: ZodType<B>; parse?: "json" | "form" | "none" };

const ok = (data: unknown, status = 200) => NextResponse.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  NextResponse.json({ ok: false, error: { code, message, fields } }, { status, headers: { "Cache-Control": "no-store" } });

export const clientIp = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

/**
 * Wraps a route handler with: auth, same-origin check for state-changing requests,
 * body parsing + zod validation, idempotency-key extraction and uniform error mapping.
 */
export function api<B = unknown>(opts: Opts<B>, handler: (ctx: Ctx<B>) => Promise<unknown>) {
  return async (req: NextRequest, route: { params: Promise<Record<string, string>> }) => {
    try {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating) {
        const origin = req.headers.get("origin");
        if (origin) {
          const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
          if (new URL(origin).host !== host) throw new ApiError(403, "bad_origin", "Cross-site request blocked");
        }
      }
      const auth = opts.auth ?? "user";
      const user = (auth === "admin" ? await requireApiAdmin() : auth === "user" ? await requireApiUser() : (null as unknown as User));

      let body: unknown = undefined, form: FormData | undefined;
      const parse = opts.parse ?? (mutating ? "json" : "none");
      if (parse === "json") {
        const raw = await req.text();
        if (raw.length > 100_000) throw badRequest("Request too large");
        try { body = raw ? JSON.parse(raw) : {}; } catch { throw badRequest("Invalid JSON"); }
      } else if (parse === "form") {
        form = await req.formData();
      }
      if (opts.schema) body = opts.schema.parse(body);

      const idem = req.headers.get("idempotency-key") ?? undefined;
      if (idem && !/^[A-Za-z0-9_-]{8,80}$/.test(idem)) throw badRequest("Invalid Idempotency-Key");

      const data = await handler({ req, user, body: body as B, params: await route.params, idempotencyKey: idem, ip: clientIp(req), form });
      return ok(data ?? { done: true });
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.code, e.message, e.fields);
      if (e instanceof ZodError) {
        const fields: Record<string, string> = {};
        for (const i of e.issues) fields[i.path.join(".") || "_"] ??= i.message;
        return fail(400, "validation_failed", Object.values(fields)[0] ?? "Please check the highlighted fields", fields);
      }
      if (e instanceof InsufficientFunds) return fail(422, "insufficient_funds", e.message);
      if (e instanceof ProviderNotImplemented) return fail(503, "provider_not_configured", "This service is not available yet. Please try again later.");
      const id = randomToken(6);
      console.error(`[api:${id}]`, e instanceof Error ? e.stack ?? e.message : e);
      return fail(500, "internal_error", `Something went wrong on our side (ref ${id}). Your money is safe. Check Activity before trying again.`);
    }
  };
}
export { ok, fail };
