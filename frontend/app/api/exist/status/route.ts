import { NextResponse } from "next/server";
import { getBotStatus, getRoom } from "@/lib/exist/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const roomId = url.searchParams.get("roomId");
    const [bot, room] = await Promise.all([
      getBotStatus(),
      roomId && /^\d+$/.test(roomId) ? getRoom(BigInt(roomId)) : Promise.resolve(null),
    ]);
    return NextResponse.json({ ok: true, bot, room });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
