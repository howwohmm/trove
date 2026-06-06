// the "taste brain": Claude describes kept images, decides which are worth
// generating from, and synthesizes fresh prompts in your aesthetic.
// needs ANTHROPIC_API_KEY in .env.local.

import Anthropic from "@anthropic-ai/sdk";

// cheap + vision-capable for describe/decide; creative model for prompt-writing
const DESCRIBE_MODEL = "claude-haiku-4-5-20251001";
const DECIDE_MODEL = "claude-haiku-4-5-20251001";
const SYNTH_MODEL = "claude-sonnet-4-6";

export function hasClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// pull the first JSON object out of a model reply, defensively
function parseJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// image block from a public url — Claude fetches + resizes, so we avoid the
// 5MB/full-res limit that base64-ing local files hit.
function imageBlock(url: string): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "url", url } };
}

export interface Description {
  text: string; // one-paragraph aesthetic read
  qualities: string[]; // distinctive tags: palette, mood, composition, style
  distinctiveness: number; // 0..1 — how specific/non-generic the taste signal is
  worth: boolean; // worth generating new images from? (the decider, merged in)
  score: number; // 0..1 confidence
  reason: string; // short why
}

// describe a kept image's aesthetic AND judge if it's worth generating from —
// one call (merged describe+decide → halves per-image cost). The worth judgment
// is made from the image alone; cross-image redundancy is handled by facet clustering.
export async function describe(imageUrl: string): Promise<Description | null> {
  const res = await getClient().messages.create({
    model: DESCRIBE_MODEL,
    max_tokens: 320,
    messages: [
      {
        role: "user",
        content: [
          imageBlock(imageUrl),
          {
            type: "text",
            text: `You read images for their aesthetic. Describe THIS image's taste signal — palette, light, mood, composition, texture, subject treatment, era/style. Focus on what makes it feel the way it does, not literal contents. Then judge whether it's a distinctive enough aesthetic to generate NEW images from (reject generic/stocky/low-signal images).
Reply ONLY with JSON:
{"text":"one vivid sentence","qualities":["4-8 specific descriptors"],"distinctiveness":0.0-1.0,"worth":true|false,"score":0.0-1.0,"reason":"short"}`,
          },
        ],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<Description>(text);
}

// name a visual cluster (facet) from a few representative images, and give
// search keywords to retrieve more like it.
export async function labelFacet(
  urls: string[]
): Promise<{ label: string; queries: string[] } | null> {
  const imgs = urls.slice(0, 3).map(imageBlock);
  if (!imgs.length) return null;
  const res = await getClient().messages.create({
    model: DECIDE_MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          ...imgs,
          {
            type: "text",
            text: `These images share one visual aesthetic. Give a short lowercase label (2-4 words) naming the vibe, and 3 concise image-search keywords to find more like them.
Reply ONLY with JSON: {"label":"...","queries":["...","...","..."]}`,
          },
        ],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<{ label: string; queries: string[] }>(text);
}

export interface Prefs {
  steer: string;
  avoid: string;
}

// user steering appended to any generation prompt
function prefsClause(prefs?: Prefs): string {
  if (!prefs) return "";
  const parts: string[] = [];
  if (prefs.steer?.trim()) parts.push(`Direction to honor strongly: ${prefs.steer.trim()}.`);
  if (prefs.avoid?.trim()) parts.push(`Never include: ${prefs.avoid.trim()}.`);
  return parts.length ? `\n${parts.join(" ")}` : "";
}

// synthesize a fresh, original image-gen prompt that BLENDS the worthy
// aesthetics — not a copy of any single image.
export async function synthesizePrompt(
  descs: Description[],
  prefs?: Prefs
): Promise<string | null> {
  const blob = descs
    .map((d, i) => `${i + 1}. ${d.text} [${d.qualities.join(", ")}]`)
    .join("\n");
  const res = await getClient().messages.create({
    model: SYNTH_MODEL,
    max_tokens: 350,
    messages: [
      {
        role: "user",
        content: `These images all belong to ONE coherent aesthetic the user loves:
${blob}

Write ONE concrete text-to-image prompt for a NEW image in this exact aesthetic. These descriptions share a palette, light, and sensibility — capture THAT, applied to one fresh subject/scene.

Rules:
- Lead with a concrete SUBJECT, then PALETTE (name specific colors), then COMPOSITION/framing, then LIGHT quality, then medium/texture.
- Terse, visual, comma-separated clauses. NOT a story, NOT emotional prose.
- One subject only — do not mash unrelated scenes together.
- No artist names, no camera-brand jargon.${prefsClause(prefs)}
Reply ONLY with JSON: {"prompt":"the prompt"}`,
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<{ prompt: string }>(text)?.prompt ?? null;
}

// the loved one bred: mutate a prompt that produced an image the user KEPT into
// a fresh variation — keep what worked, push into new territory in the same vein.
export async function mutatePrompt(parent: string, prefs?: Prefs): Promise<string | null> {
  const res = await getClient().messages.create({
    model: SYNTH_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `This text-to-image prompt produced an image the user LOVED:
"${parent}"

Write ONE new prompt that evolves it: preserve the palette, mood and sensibility that clearly worked, but change the subject, scene or composition so it feels fresh — a sibling, not a copy. Same soul, new body. Rich visual language, no "in the style of <artist>", no camera-brand jargon.${prefsClause(prefs)}
Reply ONLY with JSON: {"prompt":"the evolved prompt"}`,
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<{ prompt: string }>(text)?.prompt ?? null;
}
