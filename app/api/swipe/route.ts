import { NextResponse } from "next/server";
import { recordSwipe, addToLibrary, saveImageFile } from "@/lib/store";
import type { Candidate, SwipeDir } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Body {
  candidate: Candidate;
  dir: SwipeDir;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { candidate, dir } = body;
  if (!candidate?.id || (dir !== "like" && dir !== "skip")) {
    return NextResponse.json({ error: "missing candidate or dir" }, { status: 400 });
  }

  await recordSwipe({ id: candidate.id, dir, ts: Date.now() });

  // on like: download the full image into /library so it's on disk for projects
  if (dir === "like") {
    try {
      const file = await saveImageFile(candidate.id, candidate.downloadUrl);
      await addToLibrary({
        id: candidate.id,
        file,
        url: candidate.url,
        author: candidate.author,
        link: candidate.link,
        source: candidate.source,
        ts: Date.now(),
      });
    } catch (e) {
      // swipe is recorded; surface download failure but don't 500 the swipe
      return NextResponse.json(
        { ok: true, saved: false, error: String(e) },
        { status: 200 }
      );
    }
    return NextResponse.json({ ok: true, saved: true });
  }

  return NextResponse.json({ ok: true, saved: false });
}
