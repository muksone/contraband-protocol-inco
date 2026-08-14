import { NextResponse } from "next/server";
import { getRoom, revealCargoForSettle, waitForRoom, writeAiTx } from "@/lib/exist/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { roomId } = (await req.json()) as { roomId?: string };
    if (!roomId || !/^\d+$/.test(roomId)) throw new Error("roomId must be a number");

    const id = BigInt(roomId);
    const room = await getRoom(id);
    if (room.state !== 3) throw new Error(`room is ${room.stateLabel}, not Inspecting`);

    const cargo = await revealCargoForSettle(id);
    const tx = await writeAiTx("settle", [id, cargo.value, cargo.sigs]);
    return NextResponse.json({
      ok: true,
      action: "settle",
      cargo: { value: cargo.value.toString(), type: cargo.cargoType },
      tx,
      room: await waitForRoom(id, (r) => r.state === 4),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
