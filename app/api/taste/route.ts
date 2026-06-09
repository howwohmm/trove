import { NextResponse } from "next/server";
import { openDb } from "@/lib/db";
import { loadFacets } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb();
  const facets = loadFacets(db);
  const total = facets.reduce((s, f) => s + f.importance, 0) || 1;
  const hasLocal = db.prepare("SELECT local_path FROM images WHERE id=?");

  const totalKeeps =
    (db.prepare("SELECT COUNT(*) AS n FROM swipes WHERE action='keep' AND kind='real'").get() as { n: number }).n ||
    1;

  return NextResponse.json({
    facets: facets
      .sort((a, b) => b.importance - a.importance)
      .map((f) => {
        const medoidRow = hasLocal.get(f.medoidId) as { local_path: string | null } | undefined;
        let lastFed: number | null = null;
        if (f.memberIds.length > 0) {
          const placeholders = f.memberIds.map(() => "?").join(",");
          const row = db
            .prepare(
              `SELECT MAX(created_at) AS at FROM swipes
               WHERE action='keep' AND kind='real' AND image_id IN (${placeholders})`
            )
            .get(...f.memberIds) as { at: number | null };
          lastFed = row.at;
        }
        return {
          id: f.id,
          label: f.label ?? "unlabeled",
          keywords: f.keywords,
          importance: Math.round((f.importance / total) * 1000) / 10,
          members: f.memberIds.length,
          medoid: medoidRow?.local_path ? `/api/img/${encodeURIComponent(f.medoidId)}` : null,
          keptShare: Math.round((f.memberIds.length / totalKeeps) * 100),
          lastFed,
        };
      }),
  });
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { id, label } = (body ?? {}) as { id?: unknown; label?: unknown };

  if (typeof id !== "string" || !/^f\d+$/.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  if (typeof label !== "string") {
    return NextResponse.json({ error: "bad label" }, { status: 400 });
  }
  const clean = label.trim().toLowerCase();
  if (clean.length < 1 || clean.length > 60) {
    return NextResponse.json({ error: "label must be 1–60 chars" }, { status: 400 });
  }

  const db = openDb();
  const res = db.prepare("UPDATE facets SET label=? WHERE id=?").run(clean, id);
  if (Number(res.changes) === 0) {
    return NextResponse.json({ error: "no such facet" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id, label: clean });
}
