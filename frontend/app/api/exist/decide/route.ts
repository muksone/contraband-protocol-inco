import { NextResponse } from "next/server";
import { chooseAiAction, getAiAccount, getRoom, waitForRoom, writeAiTx } from "@/lib/exist/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { roomId } = (await req.json()) as { roomId?: string };
    if (!roomId || !/^\d+$/.test(roomId)) throw new Error("roomId must be a number");

    const id = BigInt(roomId);
    const bot = getAiAccount();
    const room = await getRoom(id);
    if (room.inspector.toLowerCase() !== bot.address.toLowerCase()) {
      throw new Error("AI wallet is not the inspector for this room");
    }
    if (room.state !== 2) throw new Error(`room is ${room.stateLabel}, not Claimed`);

    const decision = await chooseAiAction(room);
    const functionName = decision.action === "pass" ? "pass" : "inspect";
    const tx = await writeAiTx(functionName, [id]);
    const updated = await waitForRoom(id, (r) => (decision.action === "pass" ? r.state === 4 : r.state === 3));
    return NextResponse.json({
      ok: true,
      action: functionName,
      decision,
      tx,
      needsSettle: decision.action === "inspect",
      room: updated,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
