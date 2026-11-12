import { z } from "zod";
import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { currentSessionHash } from "@/lib/auth";
import { changePassword, passwordSchema, requestPhoneOtp, revokeOtherSessions, setOnboardingStep, submitBvn, verifyPhoneOtp } from "@/lib/services/account";
import { query } from "@/lib/db";

export const POST = api({}, async ({ params, body, user }) => {
  switch (params.action) {
    case "phone-request": return requestPhoneOtp(user.id, z.object({ phone: z.string().max(20) }).parse(body).phone);
    case "phone-verify": await verifyPhoneOtp(user.id, z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6 digit code") }).parse(body).code); return { tier: 1 };
    case "bvn": await submitBvn(user, z.object({ bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits") }).parse(body).bvn); return { tier: 2 };
    case "onboarding": { const b = z.object({ step: z.number().int().min(0).max(4), done: z.boolean().optional() }).parse(body); await setOnboardingStep(user.id, b.step, b.done); return {}; }
    case "password": { const b = z.object({ current: z.string().max(128), next: passwordSchema }).parse(body); await changePassword(user.id, b.current, b.next, await currentSessionHash()); return {}; }
    case "sessions-revoke": await revokeOtherSessions(user.id, await currentSessionHash()); return {};
    case "support": {
      const b = z.object({ subject: z.string().trim().min(3).max(120), body: z.string().trim().min(10, "Tell us a bit more").max(2000), transactionId: z.string().uuid().optional() }).parse(body);
      await query(`insert into support_tickets (user_id, subject, body, transaction_id) values ($1,$2,$3,$4)`, [user.id, b.subject, b.body, b.transactionId ?? null]); return {};
    }
  }
  throw badRequest("Unknown action");
});
