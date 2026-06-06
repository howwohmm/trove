// image generation. premium-first, single key (fal.ai hosts the best models).
//   FAL_KEY          -> fal.ai, model from FAL_MODEL (default Flux 1.1 Pro Ultra)
//   TOGETHER_API_KEY -> Together FLUX.1-schnell  (cheap/fast fallback, ~$0.003)
// pick the look via FAL_MODEL (see PREMIUM_MODELS below).

import { promises as fs } from "fs";
import path from "path";

export const GENERATED_DIR = path.join(process.cwd(), "generated");

// best aesthetic models on fal — set FAL_MODEL to one of these slugs.
// default is the "midjourney-type" cinematic, most-finished option.
export const PREMIUM_MODELS = {
  "flux-ultra": "fal-ai/flux-pro/v1.1-ultra", // cinematic / photoreal / most finished
  recraft: "fal-ai/recraft/v3/text-to-image", // art-directed / design / illustration
  ideogram: "fal-ai/ideogram/v3", // editorial / typography
} as const;

const FAL_MODEL = process.env.FAL_MODEL || PREMIUM_MODELS["flux-ultra"];

export type GenProvider = "fal" | "together-flux-schnell" | "none";

export function activeProvider(): GenProvider {
  if (process.env.FAL_KEY) return "fal";
  if (process.env.TOGETHER_API_KEY) return "together-flux-schnell";
  return "none";
}

// human-readable label of what's actually generating (shown in the UI)
export function providerLabel(): string {
  if (process.env.FAL_KEY) return `fal · ${FAL_MODEL.split("/").slice(1).join("/")}`;
  if (process.env.TOGETHER_API_KEY) return "together · flux-schnell";
  return "none";
}

async function save(id: string, bytes: ArrayBuffer): Promise<string> {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const file = `${id}.jpg`;
  await fs.writeFile(path.join(GENERATED_DIR, file), Buffer.from(bytes));
  return file;
}

async function fetchToFile(id: string, url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return save(id, await res.arrayBuffer());
}

// best output. fal's premium models all share a compatible request shape.
async function genFal(id: string, prompt: string): Promise<string> {
  const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: "3:4", // portrait, matches the card
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

// cheap/fast fallback
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
  const data = (await res.json()) as {
    data?: { url?: string; b64_json?: string }[];
  };
  const item = data.data?.[0];
  if (item?.url) return fetchToFile(id, item.url);
  if (item?.b64_json) return save(id, Buffer.from(item.b64_json, "base64").buffer);
  throw new Error("together returned no image");
}

export async function generateImage(id: string, prompt: string): Promise<string> {
  const provider = activeProvider();
  if (provider === "fal") return genFal(id, prompt);
  if (provider === "together-flux-schnell") return genTogether(id, prompt);
  throw new Error(
    "no image provider — set FAL_KEY (best) or TOGETHER_API_KEY (cheap) in .env.local"
  );
}
