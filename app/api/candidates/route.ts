import { NextResponse } from "next/server";
import { getCandidates } from "@/lib/sources";
import { seenIds } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const n = Math.min(Number(searchParams.get("n")) || 20, 50);
  const seen = await seenIds();
  const candidates = await getCandidates(n, seen);
  return NextResponse.json({ candidates });
}
