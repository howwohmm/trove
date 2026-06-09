import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { loadFacets } from "@/lib/feed";
import { getUnsplashRate, hasUnsplash } from "@/lib/sources";
import { recentErrors } from "@/lib/log";

export const dynamic = "force-dynamic";

interface LogItem {
  at: number;
  line: string;
  tone?: "error";
}

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

  const facets = loadFacets(db);
  const errors = recentErrors(db).slice(-10);

  // ---- the log: merged reverse-chron lab notes, pre-formatted server-side ----
  const log: LogItem[] = [];

  const swipeRows = db
    .prepare("SELECT image_id, action, kind, created_at FROM swipes ORDER BY seq DESC LIMIT 25")
    .all() as { image_id: string; action: "keep" | "skip"; kind: string; created_at: number }[];
  for (const s of swipeRows) {
    if (s.action === "keep") {
      const facet = facets.find((f) => f.memberIds.includes(s.image_id));
      log.push({
        at: s.created_at,
        line: facet?.label ? `kept ${s.image_id} → fed ${facet.label}` : `kept ${s.image_id}`,
      });
    } else {
      log.push({ at: s.created_at, line: `let go ${s.image_id}` });
    }
  }

  const dreamRows = db
    .prepare("SELECT id, created_at FROM dreams ORDER BY created_at DESC LIMIT 5")
    .all() as { id: string; created_at: number }[];
  for (const d of dreamRows) log.push({ at: d.created_at, line: `dreamed ${d.id}` });

  for (const e of errors) {
    log.push({ at: e.at, line: `error [${e.where}] ${e.message}`.toLowerCase(), tone: "error" });
  }

  if (facets.length > 0) {
    const maxUpdated = db.prepare("SELECT MAX(updated_at) AS at FROM facets").get() as { at: number | null };
    if (maxUpdated.at) {
      log.push({ at: maxUpdated.at, line: `taste retrained · ${facets.length} facets` });
    }
  }

  log.sort((a, b) => b.at - a.at);

  // ---- judged days: any swipe per calendar day, last 7 (oldest → today) ----
  const judgedDays: boolean[] = [];
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const anySwipe = db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE created_at >= ? AND created_at < ?");
  for (let i = 6; i >= 0; i--) {
    const start = dayStart.getTime() - i * 86400000;
    const end = start + 86400000;
    judgedDays.push((anySwipe.get(start, end) as { n: number }).n > 0);
  }

  return NextResponse.json({
    keeps,
    skips,
    keepRate: keeps + skips > 0 ? Math.round((keeps / (keeps + skips)) * 1000) / 10 : null,
    corpus,
    facets: facets.map((f) => ({
      id: f.id,
      label: f.label,
      members: f.memberIds.length,
      importance: Math.round(f.importance * 100) / 100,
    })),
    pool: poolRows,
    servedMix: served,
    avgDwellMs: dwell.avg ? Math.round(dwell.avg) : null,
    unsplash: { configured: hasUnsplash(), rate: getUnsplashRate() },
    errors,
    log: log.slice(0, 40),
    judgedDays,
  });
}
