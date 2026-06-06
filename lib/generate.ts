// image generation. two providers, picked by which key is present:
//   FAL_KEY            -> fal.ai Flux Pro 1.1  (best output, ~$0.04/image)
//   TOGETHER_API_KEY   -> Together FLUX.1-schnell-Free  (genuinely free tier)
// (keyless services like pollinations are now paywalled, so a key is required.)

import { promises as fs } from "fs";
import path from "path";

export const GENERATED_DIR = path.join(process.cwd(), "generated");

export type GenProvider = "fal-flux-pro" | "together-flux-free" | "none";

export function activeProvider(): GenProvider {
  if (process.env.FAL_KEY) return "fal-flux-pro";
  if (process.env.TOGETHER_API_KEY) return "together-flux-free";
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

// best output, needs FAL_KEY
async function genFalFluxPro(id: string, prompt: string): Promise<string> {
  const res = await fetch("https://fal.run/fal-ai/flux-pro/v1.1", {
    method: "POST",
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: "portrait_4_3",
      num_images: 1,
      safety_tolerance: "5",
    }),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { images?: { url: string }[] };
  const imgUrl = data.images?.[0]?.url;
  if (!imgUrl) throw new Error("fal returned no image");
  return fetchToFile(id, imgUrl);
}

// free tier, needs TOGETHER_API_KEY
async function genTogetherFree(id: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell-Free",
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
  if (provider === "fal-flux-pro") return genFalFluxPro(id, prompt);
  if (provider === "together-flux-free") return genTogetherFree(id, prompt);
  throw new Error(
    "no image provider — set FAL_KEY (best) or TOGETHER_API_KEY (free) in .env.local"
  );
}
