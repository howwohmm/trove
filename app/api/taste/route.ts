import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { loadFacets } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb();
  const facets = loadFacets(db);
  const total = facets.reduce((s, f) => s + f.importance, 0) || 1;
  const hasLocal = db.prepare("SELECT local_path FROM images WHERE id=?");

  return NextResponse.json({
    facets: facets
      .sort((a, b) => b.importance - a.importance)
      .map((f) => {
        const medoidRow = hasLocal.get(f.medoidId) as { local_path: string | null } | undefined;
        return {
          id: f.id,
          label: f.label ?? "unlabeled",
          keywords: f.keywords,
          importance: Math.round((f.importance / total) * 1000) / 10,
          members: f.memberIds.length,
          medoid: medoidRow?.local_path ? `/api/img/${encodeURIComponent(f.medoidId)}` : null,
        };
      }),
  });
}
