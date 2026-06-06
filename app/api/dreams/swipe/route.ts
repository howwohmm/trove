import { NextResponse } from "next/server";
import { getDreams, markDream, scheduleEvolve } from "@/lib/dreams";
import { getEmbedding } from "@/lib/embeddings";
import { updateTaste } from "@/lib/store";
import type { SwipeDir } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Body {
  dreamId: string;
  dir: SwipeDir;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { dreamId, dir } = body;
  if (!dreamId || (dir !== "like" && dir !== "skip")) {
    return NextResponse.json({ error: "missing dreamId or dir" }, { status: 400 });
  }

  if (dir === "skip") {
    await markDream(dreamId, "passed");
    return NextResponse.json({ ok: true, status: "passed" });
  }

  // keep: reinforce taste from the generated image, then breed a child
  await markDream(dreamId, "kept");
  const dream = (await getDreams()).find((d) => d.id === dreamId);
  if (dream) {
    try {
      const origin = new URL(req.url).origin;
      const vec = await getEmbedding(dream.id, `${origin}/api/gen/${dream.file}`);
      await updateTaste(vec);
    } catch {
      // taste reinforce is best-effort
    }
    scheduleEvolve(dreamId); // mutate the prompt → generate the next generation
  }
  return NextResponse.json({ ok: true, status: "kept", evolving: true });
}
