import { api } from "@/lib/http";
import { createSubmission, giftSchemaFields } from "@/lib/services/giftcards";

export const POST = api({ parse: "form" }, async ({ form, user }) => {
  const fields = giftSchemaFields.parse({
    brand: form!.get("brand"), currency: form!.get("currency"), cardType: form!.get("cardType"),
    faceValue: form!.get("faceValue"), code: (form!.get("code") as string) || undefined,
  });
  return createSubmission(user, fields, form!.getAll("images").filter((f): f is File => typeof f !== "string"));
});
