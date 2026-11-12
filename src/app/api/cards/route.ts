import { z } from "zod";
import { api } from "@/lib/http";
import * as c from "@/lib/services/cards";

export const POST = api({}, async ({ body, user, idempotencyKey }) => {
  const b = z.object({ type: z.enum(["virtual", "physical"]), address: c.addressSchema.optional() }).parse(body);
  if (b.type === "virtual") return { id: (await c.requestVirtual(user, idempotencyKey)).id };
  return { id: (await c.requestPhysical(user, c.addressSchema.parse(b.address), idempotencyKey)).id };
});
