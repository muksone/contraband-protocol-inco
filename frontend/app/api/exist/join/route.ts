import { NextResponse } from "next/server";
import { getAiAccount, getRoom, getStake, waitForRoom, writeAiTx } from "@/lib/exist/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { roomId } = (await req.json()) as { roomId?: string };
    if (!roomId || !/^\d+$/.test(roomId)) throw new Error("roomId must be a number");

    const id = BigInt(roomId);
    const bot = getAiAccount();
    const room = await getRoom(id);
    if (room.inspector.toLowerCase() === bot.address.toLowerCase()) {
      return NextResponse.json({ ok: true, skipped: true, action: "already joined", room });
    }
    if (room.shipper.toLowerCase() === bot.address.toLowerCase()) {
      throw new Error("AI wallet cannot join its own shipment");
    }
    if (room.state !== 1) throw new Error(`room is ${room.stateLabel}, not Dealt`);

    const stake = await getStake();
    const tx = await writeAiTx("joinAsInspector", [id], stake);
    const updated = await waitForRoom(id, (r) => r.inspector.toLowerCase() === bot.address.toLowerCase());
    return NextResponse.json({ ok: true, action: "joinAsInspector", tx, room: updated });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
