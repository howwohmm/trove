import { NextResponse } from "next/server";
import { getFacets, computeFacets } from "@/lib/facets";

export const dynamic = "force-dynamic";

// lightweight list (no centroids) for the UI chip bar / filters
export async function GET() {
  const facets = await getFacets();
  return NextResponse.json({
    facets: facets.map((f) => ({
      id: f.id,
      label: f.label,
      size: f.size,
      queries: f.queries,
    })),
  });
}

// force a recompute (e.g. a "refresh facets" action)
export async function POST() {
  await computeFacets();
  const facets = await getFacets();
  return NextResponse.json({
    ok: true,
    facets: facets.map((f) => ({ id: f.id, label: f.label, size: f.size })),
  });
}
