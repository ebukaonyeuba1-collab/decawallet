import { requirePageUser } from "@/lib/auth";
import { DepositFlow } from "@/components/flows-money";
import { netsForClient } from "@/lib/clientcatalog";
import { sandboxToolsEnabled } from "@/lib/providers";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Deposit crypto" };
export default async function Page() { await requirePageUser(); return <><PageTitle title="Deposit crypto" sub="Send crypto to your personal address." /><DepositFlow nets={netsForClient()} sandbox={sandboxToolsEnabled()} /></>; }
