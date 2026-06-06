// image generation. premium-first, picked by which key is present:
//   OPENROUTER_API_KEY -> OpenRouter, model from OPENROUTER_IMAGE_MODEL
//                         (default Nano Banana 2 — SOTA, cheap, midjourney-tier)
//   FAL_KEY            -> fal.ai, model from FAL_MODEL (Flux 1.1 Pro Ultra, etc.)
//   TOGETHER_API_KEY   -> Together FLUX.1-schnell (cheap/fast fallback)

import { promises as fs } from "fs";
import path from "path";

export const GENERATED_DIR = path.join(process.cwd(), "generated");

// best image models on OpenRouter — set OPENROUTER_IMAGE_MODEL to one of these.
export const OPENROUTER_MODELS = {
  "nano-banana-2": "google/gemini-3.1-flash-image-preview", // SOTA quality/speed (default)
  "nano-banana-pro": "google/gemini-3-pro-image", // top-tier, pricier
  seedream: "bytedance-seed/seedream-4.5", // flat $0.04/img, great editing (cheapest that takes refs)
  "flux-2-pro": "black-forest-labs/flux.2-pro",
} as const;

// fallback chain (tried in order on any error) — all take image refs, so taste
// conditioning survives a fallback. cheapest-capable last.
const OR_FALLBACKS = [
  OPENROUTER_MODELS.seedream,
  OPENROUTER_MODELS["flux-2-pro"],
];

// 1K is 33% cheaper than 2K with minimal quality loss for the feed
const OR_IMAGE_SIZE = process.env.TROVE_IMAGE_SIZE || "1K";
const MAX_REFS = 4; // more references dilute the strongest one

// best models on fal.ai
export const FAL_MODELS = {
  "flux-ultra": "fal-ai/flux-pro/v1.1-ultra",
  recraft: "fal-ai/recraft/v3/text-to-image",
  ideogram: "fal-ai/ideogram/v3",
} as const;

const OR_MODEL = process.env.OPENROUTER_IMAGE_MODEL || OPENROUTER_MODELS["nano-banana-2"];
const FAL_MODEL = process.env.FAL_MODEL || FAL_MODELS["flux-ultra"];

export type GenProvider = "openrouter" | "fal" | "together-flux-schnell" | "none";

export function activeProvider(): GenProvider {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.FAL_KEY) return "fal";
  if (process.env.TOGETHER_API_KEY) return "together-flux-schnell";
  return "none";
}

export function providerLabel(): string {
  if (process.env.OPENROUTER_API_KEY) return `openrouter · ${OR_MODEL.split("/").pop()}`;
  if (process.env.FAL_KEY) return `fal · ${FAL_MODEL.split("/").slice(1).join("/")}`;
  if (process.env.TOGETHER_API_KEY) return "together · flux-schnell";
  return "none";
}

async function save(id: string, bytes: ArrayBuffer | Buffer, ext = "jpg"): Promise<string> {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const file = `${id}.${ext}`;
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await fs.writeFile(path.join(GENERATED_DIR, file), buf);
  return file;
}

async function fetchToFile(id: string, url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return save(id, await res.arrayBuffer());
}

// "data:image/png;base64,...." -> save with the right extension
async function saveDataUrl(id: string, dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:image\/(\w+);base64,([\s\S]*)$/);
  if (!m) throw new Error("not a base64 image data url");
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  return save(id, Buffer.from(m[2], "base64"), ext); // pass the Buffer directly (exact length)
}

// OpenRouter image gen via the chat-completions endpoint (modalities: image).
// refs = reference image urls (your real kept images) — Nano Banana conditions on
// them so the output actually matches your visual taste, not just the text.
async function genOpenRouter(id: string, prompt: string, refs: string[] = []): Promise<string> {
  const capped = refs.slice(0, MAX_REFS);
  const content: unknown[] = [
    {
      type: "text",
      text: capped.length
        ? `${prompt}\n\nUse the reference images ONLY for aesthetic — palette, light, composition, texture. Create a NEW scene, do not copy them.`
        : prompt,
    },
    ...capped.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  // models[] = native OpenRouter fallback: tried in order on any error, billed
  // only for the one that responds. keeps image-conditioning across fallbacks.
  const models = [OR_MODEL, ...OR_FALLBACKS.filter((m) => m !== OR_MODEL)];
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
      models,
      provider: { sort: "price" },
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "3:4", image_size: OR_IMAGE_SIZE },
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
  };
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("openrouter returned no image");
  return saveDataUrl(id, url);
}

async function genFal(id: string, prompt: string): Promise<string> {
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: "3:4",
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "6",
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { images?: { url: string }[] };
  const imgUrl = data.images?.[0]?.url;
  if (!imgUrl) throw new Error("fal returned no image");
  return fetchToFile(id, imgUrl);
}

async function genTogether(id: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell",
      prompt,
      width: 768,
      height: 1024,
      steps: 4,
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`together ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const item = data.data?.[0];
  if (item?.url) return fetchToFile(id, item.url);
  if (item?.b64_json) return save(id, Buffer.from(item.b64_json, "base64"));
  throw new Error("together returned no image");
}

export async function generateImage(
  id: string,
  prompt: string,
  refs: string[] = []
): Promise<string> {
  const provider = activeProvider();
  if (provider === "openrouter") return genOpenRouter(id, prompt, refs);
  if (provider === "fal") return genFal(id, prompt); // fal/together: text-only
  if (provider === "together-flux-schnell") return genTogether(id, prompt);
  throw new Error(
    "no image provider — set OPENROUTER_API_KEY (recommended), FAL_KEY, or TOGETHER_API_KEY in .env.local"
  );
}
