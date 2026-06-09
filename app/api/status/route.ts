import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { loadFacets } from "@/lib/feed";
import { getUnsplashRate, hasUnsplash } from "@/lib/sources";
import { recentErrors } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb();

  const counts = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const keeps = counts("SELECT COUNT(*) AS n FROM swipes WHERE action='keep' AND kind='real'");
  const skips = counts("SELECT COUNT(*) AS n FROM swipes WHERE action='skip' AND kind='real'");
  const corpus = counts("SELECT COUNT(*) AS n FROM images WHERE embedding IS NOT NULL");

  const poolRows = db
    .prepare("SELECT bucket, status, COUNT(*) AS n FROM pool GROUP BY bucket, status")
    .all() as { bucket: string; status: string; n: number }[];

  const served = db
    .prepare(
      "SELECT deck_source, COUNT(*) AS n FROM (SELECT deck_source FROM swipes ORDER BY seq DESC LIMIT 100) GROUP BY deck_source"
    )
    .all() as { deck_source: string | null; n: number }[];

  const dwell = db
    .prepare(
      "SELECT AVG(dwell_ms) AS avg FROM (SELECT dwell_ms FROM swipes WHERE dwell_ms > 0 ORDER BY seq DESC LIMIT 100)"
    )
    .get() as { avg: number | null };

  return NextResponse.json({
    keeps,
    skips,
    keepRate: keeps + skips > 0 ? Math.round((keeps / (keeps + skips)) * 1000) / 10 : null,
    corpus,
    facets: loadFacets(db).map((f) => ({
      id: f.id,
      label: f.label,
      members: f.memberIds.length,
      importance: Math.round(f.importance * 100) / 100,
    })),
    pool: poolRows,
    servedMix: served,
    avgDwellMs: dwell.avg ? Math.round(dwell.avg) : null,
    unsplash: { configured: hasUnsplash(), rate: getUnsplashRate() },
    errors: recentErrors(db).slice(-10),
  });
}
