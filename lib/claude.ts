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

// pull the first JSON object out of a model reply, defensively.
// kept as a fallback for the rare case where no tool_use block is returned.
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

// robust JSON extraction via forced tool use: read the structured `.input` off
// the tool_use content block (always valid JSON), falling back to text-parsing
// only if — against the forced tool_choice — no tool_use block appears.
function readToolResult<T>(res: Anthropic.Message): T | null {
  const toolBlock = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (toolBlock) return toolBlock.input as T;
  // defensive fallback: some content arrived but not as a tool_use block
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseJson<T>(text);
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
const DESCRIBE_TOOL: Anthropic.Tool = {
  name: "record_description",
  description: "Record the aesthetic read and worthiness judgment for the image.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "one vivid sentence" },
      qualities: {
        type: "array",
        items: { type: "string" },
        description: "4-8 specific descriptors",
      },
      distinctiveness: {
        type: "number",
        description: "0.0-1.0, how specific/non-generic the taste signal is",
      },
      worth: {
        type: "boolean",
        description: "worth generating new images from?",
      },
      score: { type: "number", description: "0.0-1.0 confidence" },
      reason: { type: "string", description: "short why" },
    },
    required: ["text", "qualities", "distinctiveness", "worth", "score", "reason"],
  },
};

export async function describe(imageUrl: string): Promise<Description | null> {
  const res = await getClient().messages.create({
    model: DESCRIBE_MODEL,
    max_tokens: 320,
    tools: [DESCRIBE_TOOL],
    tool_choice: { type: "tool", name: DESCRIBE_TOOL.name, disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: [
          imageBlock(imageUrl),
          {
            type: "text",
            text: `You read images for their aesthetic. Describe THIS image's taste signal — palette, light, mood, composition, texture, subject treatment, era/style. Focus on what makes it feel the way it does, not literal contents. Then judge whether it's a distinctive enough aesthetic to generate NEW images from (reject generic/stocky/low-signal images). Call the record_description tool with your judgment.`,
          },
        ],
      },
    ],
  });
  return readToolResult<Description>(res);
}

// name a visual cluster (facet) from a few representative images, and give
// search keywords to retrieve more like it.
const LABEL_FACET_TOOL: Anthropic.Tool = {
  name: "record_facet",
  description: "Record the label and search keywords for this visual cluster.",
  input_schema: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "short lowercase label (2-4 words) naming the vibe",
      },
      queries: {
        type: "array",
        items: { type: "string" },
        description: "3 concise image-search keywords to find more like them",
      },
    },
    required: ["label", "queries"],
  },
};

export async function labelFacet(
  urls: string[]
): Promise<{ label: string; queries: string[] } | null> {
  const imgs = urls.slice(0, 3).map(imageBlock);
  if (!imgs.length) return null;
  const res = await getClient().messages.create({
    model: DECIDE_MODEL,
    max_tokens: 200,
    tools: [LABEL_FACET_TOOL],
    tool_choice: { type: "tool", name: LABEL_FACET_TOOL.name, disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: [
          ...imgs,
          {
            type: "text",
            text: `These images share one visual aesthetic. Give a short lowercase label (2-4 words) naming the vibe, and 3 concise image-search keywords to find more like them. Call the record_facet tool with your answer.`,
          },
        ],
      },
    ],
  });
  return readToolResult<{ label: string; queries: string[] }>(res);
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

const PROMPT_TOOL: Anthropic.Tool = {
  name: "record_prompt",
  description: "Record the generated text-to-image prompt.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "the text-to-image prompt" },
    },
    required: ["prompt"],
  },
};

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
    tools: [PROMPT_TOOL],
    tool_choice: { type: "tool", name: PROMPT_TOOL.name, disable_parallel_tool_use: true },
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
Call the record_prompt tool with the prompt.`,
      },
    ],
  });
  return readToolResult<{ prompt: string }>(res)?.prompt ?? null;
}

// the loved one bred: mutate a prompt that produced an image the user KEPT into
// a fresh variation — keep what worked, push into new territory in the same vein.
export async function mutatePrompt(parent: string, prefs?: Prefs): Promise<string | null> {
  const res = await getClient().messages.create({
    model: SYNTH_MODEL,
    max_tokens: 400,
    tools: [PROMPT_TOOL],
    tool_choice: { type: "tool", name: PROMPT_TOOL.name, disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: `This text-to-image prompt produced an image the user LOVED:
"${parent}"

Write ONE new prompt that evolves it: preserve the palette, mood and sensibility that clearly worked, but change the subject, scene or composition so it feels fresh — a sibling, not a copy. Same soul, new body. Rich visual language, no "in the style of <artist>", no camera-brand jargon.${prefsClause(prefs)}
Call the record_prompt tool with the evolved prompt.`,
      },
    ],
  });
  return readToolResult<{ prompt: string }>(res)?.prompt ?? null;
}
