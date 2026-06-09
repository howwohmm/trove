import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { refillPool, recomputeFacets } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = openDb();
  await recomputeFacets(db);
  await refillPool(db);
  return NextResponse.json({ ok: true });
}
