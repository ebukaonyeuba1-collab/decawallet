import { z } from "zod";
import { api } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import * as g from "@/lib/services/giftcards";

export const POST = api({ auth: "admin" }, async ({ params, body, user }) => {
  const id = params.id;
  switch (params.action) {
    case "claim": await g.claim(user, id); return {};
    case "approve": { const b = z.object({ payout: z.string().min(1), note: z.string().max(300).optional() }).parse(body); await g.approve(user, id, b.payout, b.note); return {}; }
    case "reject": await g.reject(user, id, z.object({ reason: z.string() }).parse(body).reason); return {};
    case "payout": return g.payout(user, id);
    case "reveal": return { code: await g.revealCode(user, id) };
  }
  throw badRequest("Unknown action");
});
