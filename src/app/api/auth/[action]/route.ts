import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { createSession, destroySession } from "@/lib/auth";
import { loginSchema, logIn, signUp, signupSchema } from "@/lib/services/account";

export const POST = api({ auth: "none" }, async ({ params, body, req, ip }) => {
  const ua = req.headers.get("user-agent");
  if (params.action === "signup") { const id = await signUp(signupSchema.parse(body)); await createSession(id, { ua, ip }); return { next: "/onboarding" }; }
  if (params.action === "login") { const b = loginSchema.parse(body); const id = await logIn(b.email, b.password, ip); await createSession(id, { ua, ip }); return { next: "/app" }; }
  if (params.action === "logout") { await destroySession(); return { next: "/login" }; }
  throw badRequest("Unknown action");
});
