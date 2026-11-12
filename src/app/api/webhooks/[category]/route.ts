import { NextRequest, NextResponse } from "next/server";
import { processWebhook, WebhookCategory } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!["crypto", "bills", "cards"].includes(category)) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await req.text(); // RAW body: signatures are computed over exact bytes
  if (raw.length > 200_000) return NextResponse.json({ ok: false }, { status: 413 });
  try {
    const r = await processWebhook(category as WebhookCategory, raw, req.headers);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("[webhook]", (e as Error).message);
    return NextResponse.json({ ok: false, outcome: "error" }, { status: 500 }); // provider will retry
  }
}
