// dream generation: pick one facet -> ONE merged claude call (refs + keywords ->
// image prompt; v1 ran describe+decide separately — merged here, half the cost) ->
// openrouter image gen conditioned on the same refs -> store as source='dream'.
// dream images/swipes never enter retrieval taste (kind/source filters in feed.ts).

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { insertImage, setEmbedding, tx, kvGet, kvSet, type Db } from "@/lib/db";
import { loadFacets } from "@/lib/feed";
import { embedImage } from "@/lib/embed";
import { logError } from "@/lib/log";

export const GENERATED_DIR = path.join(process.cwd(), "generated");

const PROMPT_MODEL = "claude-haiku-4-5-20251001";
const OR_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image";
const MAX_REFS = 3;

// serial generation queue (kept from v1): one generation at a time, never
// dropped, never colliding on ids. image gen + claude are the bottleneck.
let genChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = genChain.then(fn, fn);
  genChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

export type DreamResult = { ok: true; id: string; prompt: string } | { ok: false; reason: string };

type LoadedFacet = ReturnType<typeof loadFacets>[number];

// sample one facet ∝ importance (pinnersage: tail facets get occasional airtime)
function sampleFacet(facets: LoadedFacet[]): LoadedFacet {
  const total = facets.reduce((s, f) => s + f.importance, 0) || 1;
  let r = Math.random() * total;
  for (const f of facets) {
    r -= f.importance;
    if (r <= 0) return f;
  }
  return facets[facets.length - 1];
}

// up to 3 member images of the facet as small base64 jpeg data urls — resized
// down so they stay cheap as claude vision input and openrouter conditioning
async function facetRefs(db: Db, facet: LoadedFacet): Promise<string[]> {
  const refs: string[] = [];
  for (const mid of facet.memberIds) {
    if (refs.length >= MAX_REFS) break;
    const row = db.prepare("SELECT local_path FROM images WHERE id=? AND local_path IS NOT NULL").get(mid) as
      | { local_path: string }
      | undefined;
    if (!row) continue;
    try {
      const buf = await fs.readFile(row.local_path);
      const small = await sharp(buf).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      refs.push(`data:image/jpeg;base64,${small.toString("base64")}`);
    } catch (err) {
      logError(db, "dreams.refs", err);
    }
  }
  return refs;
}

// ONE merged claude call: look at the refs + keywords, return just the prompt
// text (no JSON/tool parsing to break on)
async function synthesizePrompt(facet: LoadedFacet, refs: string[]): Promise<string | null> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const images: Anthropic.ImageBlockParam[] = refs.map((dataUrl) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: dataUrl.split(",")[1] },
  }));
  const keywords = facet.keywords.length ? facet.keywords.join(", ") : facet.label ?? "this aesthetic";
  const res = await client.messages.create({
    model: PROMPT_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          ...images,
          {
            type: "text",
            text: `These images belong to ONE coherent aesthetic the user loves (keywords: ${keywords}).

Write ONE concrete text-to-image prompt for a NEW image in this exact aesthetic. Capture the shared palette, light, composition and texture — applied to one fresh subject/scene, not a copy of any reference.

Rules:
- Lead with a concrete SUBJECT, then PALETTE (specific colors), then COMPOSITION/framing, then LIGHT quality, then medium/texture.
- Terse, visual, comma-separated clauses. Not a story.
- One subject only. No artist names, no camera-brand jargon.

Reply with ONLY the prompt text — no preamble, no quotes.`,
          },
        ],
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

// openrouter image gen via chat completions (modalities: image) — the model
// conditions on the same refs so the output matches the actual look
async function generateImageBytes(prompt: string, refs: string[]): Promise<Buffer> {
  const content: unknown[] = [
    {
      type: "text",
      text: refs.length
        ? `${prompt}\n\nUse the reference images ONLY for aesthetic — palette, light, composition, texture. Create a NEW scene, do not copy them.`
        : prompt,
    },
    ...refs.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/howwohmm/trove",
      "X-Title": "trove",
    },
    body: JSON.stringify({
      model: OR_MODEL,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "3:4" },
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  };
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("openrouter returned no image");
  const m = url.match(/^data:image\/\w+;base64,([\s\S]*)$/);
  if (!m) throw new Error("openrouter image was not a base64 data url");
  return Buffer.from(m[1], "base64");
}

// next dream number: kv counter, seeded from the highest imported dream id
// (collision-proof under the serial queue)
function nextDreamNumber(db: Db): number {
  const fromKv = Number(kvGet(db, "dream_counter") ?? "0");
  const row = db
    .prepare("SELECT MAX(CAST(REPLACE(id, 'dream-', '') AS INTEGER)) AS n FROM dreams")
    .get() as { n: number | null };
  return Math.max(fromKv, row.n ?? 0) + 1;
}

export async function generateDream(db: Db, facetId?: string): Promise<DreamResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "no ANTHROPIC_API_KEY" };
  if (!process.env.OPENROUTER_API_KEY) return { ok: false, reason: "no OPENROUTER_API_KEY" };

  return exclusive(async () => {
    try {
      const facets = loadFacets(db);
      if (facets.length === 0) return { ok: false, reason: "no facets yet — keep more images first" };
      const facet = facetId ? facets.find((f) => f.id === facetId) : sampleFacet(facets);
      if (!facet) return { ok: false, reason: `no such facet: ${facetId}` };

      const refs = await facetRefs(db, facet);
      const prompt = await synthesizePrompt(facet, refs);
      if (!prompt) return { ok: false, reason: "claude returned no prompt" };

      const bytes = await generateImageBytes(prompt, refs);

      const n = nextDreamNumber(db);
      const id = `dream-${n}`;
      await fs.mkdir(GENERATED_DIR, { recursive: true });
      const localPath = path.join(GENERATED_DIR, `${id}.png`);
      const png = await sharp(bytes).png().toBuffer();
      await fs.writeFile(localPath, png);

      // placeholder data, same sharp pattern as ingest.materializeKeep
      const img = sharp(png);
      const meta = await img.metadata();
      const { dominant } = await img.stats();
      const color = `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      const tiny = await sharp(png).resize(16).blur(2).jpeg({ quality: 40 }).toBuffer();
      const blurData = `data:image/jpeg;base64,${tiny.toString("base64")}`;

      const vec = await embedImage(localPath);

      tx(db, () => {
        insertImage(db, {
          id,
          source: "dream",
          local_path: localPath,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          color,
          blur_data: blurData,
        });
        setEmbedding(db, id, vec);
        db.prepare(
          "INSERT INTO dreams (id, facet_id, prompt, parent_id, image_id, status, created_at) VALUES (?,?,?,NULL,?,'done',?)"
        ).run(id, facet.id, prompt, id, Date.now());
        kvSet(db, "dream_counter", String(n));
      });

      return { ok: true, id, prompt };
    } catch (err) {
      logError(db, "dreams.generate", err);
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
