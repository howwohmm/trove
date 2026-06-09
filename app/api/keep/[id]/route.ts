import { NextRequest, NextResponse } from "next/server";
import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb, tx } from "@/lib/db";
import { libraryDir } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// "let go" from the library — a curation act, not a tombstone.
// delete the file, clear local_path, and flip this image's keep swipes to
// skip so taste forgets it on the next recluster. history rows stay.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = openDb();

  const row = db.prepare("SELECT local_path FROM images WHERE id=?").get(id) as
    | { local_path: string | null }
    | undefined;
  if (!row?.local_path) return NextResponse.json({ error: "not found" }, { status: 404 });

  // path comes from our own db row, never the client — still keep it inside
  // the dirs we own before touching disk.
  const path = resolve(row.local_path);
  const root = resolve(libraryDir());
  const generated = resolve(process.cwd(), "generated");
  if (!path.startsWith(root) && !path.startsWith(generated)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* best-effort: a missing file should never block letting go */
  }

  tx(db, () => {
    db.prepare("UPDATE images SET local_path=NULL WHERE id=?").run(id);
    db.prepare("UPDATE swipes SET action='skip' WHERE image_id=? AND action='keep'").run(id);
  });

  return NextResponse.json({ ok: true });
}
