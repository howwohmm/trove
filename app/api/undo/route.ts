import { NextResponse } from "next/server";
import { openDb, tx } from "@/lib/db";

export const dynamic = "force-dynamic";

// reverses the most recent swipe in one transaction: delete the row, return
// its pool slot to 'shown' (so popDeck never re-serves it — the client holds
// the card). no body — "undo" can only mean the latest judgment.
export async function POST() {
  const db = openDb();
  const undone = tx(db, () => {
    const row = db
      .prepare("SELECT seq, image_id, action FROM swipes ORDER BY seq DESC LIMIT 1")
      .get() as { seq: number; image_id: string; action: "keep" | "skip" } | undefined;
    if (!row) return null;
    db.prepare("DELETE FROM swipes WHERE seq=?").run(row.seq);
    db.prepare("UPDATE pool SET status='shown' WHERE image_id=?").run(row.image_id);
    return { imageId: row.image_id, action: row.action };
  });
  if (!undone) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, imageId: undone.imageId, action: undone.action });
}
