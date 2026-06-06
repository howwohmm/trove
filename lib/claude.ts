// the "taste brain": Claude describes kept images, decides which are worth
// generating from, and synthesizes fresh prompts in your aesthetic.
// needs ANTHROPIC_API_KEY in .env.local.

import { promises as fs } from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { LIBRARY_DIR } from "./store";

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

function mediaType(file: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const ext = file.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

export interface Description {
  text: string; // one-paragraph aesthetic read
  qualities: string[]; // distinctive tags: palette, mood, composition, style
  distinctiveness: number; // 0..1 — how specific/non-generic the taste signal is
}

// describe a kept image's aesthetic qualities from the file on disk
export async function describe(file: string): Promise<Description | null> {
  const buf = await fs.readFile(path.join(LIBRARY_DIR, file));
  const b64 = buf.toString("base64");
  const res = await getClient().messages.create({
    model: DESCRIBE_MODEL,
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType(file), data: b64 },
          },
          {
            type: "text",
            text: `You read images for their aesthetic. Describe THIS image's taste signal — palette, light, mood, composition, texture, subject treatment, era/style. Focus on what makes it feel the way it does, not literal contents.
Reply ONLY with JSON:
{"text":"one vivid sentence on its aesthetic","qualities":["4-8 specific descriptors"],"distinctiveness":0.0-1.0}
distinctiveness = how specific/unusual the taste is (generic stock = low, singular vision = high).`,
          },
        ],
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<Description>(text);
}

export interface Verdict {
  worth: boolean;
  score: number; // 0..1
  reason: string;
}

// the decider: is this description worth generating from? rejects generic /
// low-signal / redundant taste so we don't waste generations on slop.
export async function decide(
  desc: Description,
  existingQualities: string[]
): Promise<Verdict | null> {
  const res = await getClient().messages.create({
    model: DECIDE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are a strict taste curator deciding whether an image's aesthetic is worth generating NEW images from.

Candidate description: ${desc.text}
Qualities: ${desc.qualities.join(", ")}
Self-rated distinctiveness: ${desc.distinctiveness}

Aesthetics we've already mined a lot: ${existingQualities.slice(0, 30).join(", ") || "none yet"}

Reject if: generic/stocky, weak taste signal, or near-duplicate of what we've already mined. Approve only genuinely distinctive, generative aesthetics.
Reply ONLY with JSON: {"worth":true|false,"score":0.0-1.0,"reason":"short"}`,
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<Verdict>(text);
}

// synthesize a fresh, original image-gen prompt that BLENDS the worthy
// aesthetics — not a copy of any single image.
export async function synthesizePrompt(descs: Description[]): Promise<string | null> {
  const blob = descs
    .map((d, i) => `${i + 1}. ${d.text} [${d.qualities.join(", ")}]`)
    .join("\n");
  const res = await getClient().messages.create({
    model: SYNTH_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `These describe the aesthetic taste of one person, learned from images they kept:
${blob}

Write ONE original text-to-image prompt for a NEW image that embodies the THROUGHLINE of this taste — the shared palette, mood, light and sensibility — without copying any single image. It should feel inevitable to this person, fresh, and specific. Rich visual language, no camera-brand jargon, no "in the style of <artist>".
Reply ONLY with JSON: {"prompt":"the prompt"}`,
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<{ prompt: string }>(text)?.prompt ?? null;
}

// the loved one bred: mutate a prompt that produced an image the user KEPT into
// a fresh variation — keep what worked, push into new territory in the same vein.
export async function mutatePrompt(parent: string): Promise<string | null> {
  const res = await getClient().messages.create({
    model: SYNTH_MODEL,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `This text-to-image prompt produced an image the user LOVED:
"${parent}"

Write ONE new prompt that evolves it: preserve the palette, mood and sensibility that clearly worked, but change the subject, scene or composition so it feels fresh — a sibling, not a copy. Same soul, new body. Rich visual language, no "in the style of <artist>", no camera-brand jargon.
Reply ONLY with JSON: {"prompt":"the evolved prompt"}`,
      },
    ],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson<{ prompt: string }>(text)?.prompt ?? null;
}
