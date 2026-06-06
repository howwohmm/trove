import { NextResponse } from "next/server";
import { dreamFromFacet } from "@/lib/dreams";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let facetId: string;
  try {
    ({ facetId } = (await req.json()) as { facetId: string });
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!facetId) return NextResponse.json({ error: "missing facetId" }, { status: 400 });
  return NextResponse.json(await dreamFromFacet(facetId));
}
