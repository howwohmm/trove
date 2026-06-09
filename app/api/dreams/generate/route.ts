import { NextRequest, NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { generateDream } from "@/lib/dreams";

export const dynamic = "force-dynamic";

// generate one dream, optionally from a chosen facet. facetId is only ever
// matched against our own facet rows — never fetched or interpolated.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { facetId?: unknown } | null;
  if (body?.facetId !== undefined && typeof body.facetId !== "string") {
    return NextResponse.json({ error: "facetId must be a string" }, { status: 400 });
  }
  const db = openDb();
  const result = await generateDream(db, body?.facetId as string | undefined);
  if (!result.ok) return NextResponse.json(result, { status: 200 });
  return NextResponse.json({ ok: true, id: result.id });
}
