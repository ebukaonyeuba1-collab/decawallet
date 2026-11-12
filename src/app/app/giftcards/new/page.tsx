import { requirePageUser } from "@/lib/auth";
import { GiftcardForm } from "@/components/flows-other";
import { GIFT_BRANDS, GIFT_CURRENCIES } from "@/lib/catalog";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Sell a gift card" };
export default async function Page() { await requirePageUser(); return <><PageTitle title="Sell a gift card" sub="Rates are indicative. The final amount is confirmed at review." /><GiftcardForm brands={GIFT_BRANDS} currencies={GIFT_CURRENCIES} /></>; }
