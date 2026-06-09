import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { openDb } from "@/lib/db";
import { handleSwipe } from "@/lib/feed";

export const dynamic = "force-dynamic";

// the client sends an image ID + the gesture. urls are resolved server-side
// from our own rows — request bodies are never fetched (v1 C2/SSRF, gone).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    imageId?: unknown;
    action?: unknown;
    dwellMs?: unknown;
    deckSource?: unknown;
  } | null;

  const imageId = typeof body?.imageId === "string" ? body.imageId : null;
  const action = body?.action === "keep" || body?.action === "skip" ? body.action : null;
  const dwellMs =
    typeof body?.dwellMs === "number" && Number.isFinite(body.dwellMs)
      ? Math.max(0, Math.min(600000, Math.round(body.dwellMs)))
      : 0;
  const deckSource =
    body?.deckSource === "exploit" || body?.deckSource === "adjacent" || body?.deckSource === "explore"
      ? body.deckSource
      : undefined;

  if (!imageId || !action) {
    return NextResponse.json({ error: "imageId and action required" }, { status: 400 });
  }

  const db = openDb();
  const exists = db.prepare("SELECT 1 FROM images WHERE id=?").get(imageId);
  if (!exists) return NextResponse.json({ error: "unknown image" }, { status: 404 });

  // record synchronously (one transaction); heavy work after the response
  after(async () => {
    await handleSwipe(db, { imageId, action, kind: "real", dwellMs, deckSource });
  });

  return NextResponse.json({ ok: true });
}
