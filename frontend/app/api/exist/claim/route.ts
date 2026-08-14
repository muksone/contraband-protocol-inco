import { NextResponse } from "next/server";
import { getBotStatus, writeAiTx } from "@/lib/exist/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const before = await getBotStatus();
    if (before.payoutWei === "0") {
      return NextResponse.json({ ok: true, skipped: true, action: "nothing to claim", bot: before });
    }
    const tx = await writeAiTx("claim");
    let bot = await getBotStatus();
    for (let i = 0; i < 8 && bot.payoutWei !== "0"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      bot = await getBotStatus();
    }
    return NextResponse.json({ ok: true, action: "claim", tx, bot });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
