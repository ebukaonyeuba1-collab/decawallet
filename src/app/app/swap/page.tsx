import { requirePageUser } from "@/lib/auth";
import { SwapFlow } from "@/components/flows-money";
import { balancesRecord } from "@/lib/clientcatalog";
import { listWallets } from "@/lib/ledger";
import { query } from "@/lib/db";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Swap" };
export default async function Page() { const u = await requirePageUser(); const ws = await listWallets({ query } as any, u.id); return <><PageTitle title="Swap" sub="Convert between crypto and Naira at a locked rate." /><SwapFlow balances={balancesRecord(ws)} /></>; }
