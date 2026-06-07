// trove MCP server — exposes YOUR taste as tools any AI client (Claude Code,
// Claude Desktop, Cursor) can call. Read-only + local: no API keys needed for the
// core tools (CLIP runs locally, taste lives in data/trove.db).
//
// run: from the trove project root, `npm run mcp` (or `npx tsx scripts/mcp.ts`).
// wire into a client by pointing it at that command with cwd = the trove dir.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getFacets } from "../lib/facets";
import { getLibrary, readState } from "../lib/store";
import { cachedEmbeddings } from "../lib/embeddings";
import { embedTexts, embedUrl } from "../lib/embed";
import { cosine } from "../lib/taste";
import { tasteScore } from "../lib/rec";

const server = new McpServer({ name: "trove", version: "1.0.0" });

// --- list_facets: the shape of your taste ---
server.tool(
  "list_facets",
  "List the user's visual taste facets (named clusters of what they keep), with sizes and search keywords.",
  {},
  async () => {
    const facets = await getFacets();
    if (!facets.length) return { content: [{ type: "text", text: "No facets yet — the user hasn't kept enough images." }] };
    const text = facets
      .map((f) => `• ${f.label} (${f.size} images) — keywords: ${f.queries.join(", ")}`)
      .join("\n");
    return { content: [{ type: "text", text: `The user's taste, in ${facets.length} facets:\n${text}` }] };
  }
);

// --- search_my_taste: CLIP text→image over their kept library ---
server.tool(
  "search_my_taste",
  "Search the user's kept-image library by a natural-language vibe (CLIP text→image). Returns the best-matching images they've saved.",
  { query: z.string().describe("a vibe, e.g. 'rain on glass at dusk'"), limit: z.number().optional() },
  async ({ query, limit }) => {
    const [lib, emb, [qv]] = await Promise.all([getLibrary(), cachedEmbeddings(), embedTexts([query])]);
    if (!qv) return { content: [{ type: "text", text: "Couldn't embed the query." }] };
    const ranked = lib
      .filter((l) => emb[l.id])
      .map((l) => ({ l, s: cosine(qv, emb[l.id]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit ?? 10);
    const text = ranked
      .map((r) => `• ${r.l.file} (match ${(r.s * 100).toFixed(0)}%)${r.l.author ? ` — by ${r.l.author}` : ""}`)
      .join("\n");
    return { content: [{ type: "text", text: `Top matches for “${query}” in the user's library (files in /library):\n${text}` }] };
  }
);

// --- score_image: how much does an image match the user's taste? ---
server.tool(
  "score_image",
  "Score how well an image (by URL) matches the user's learned visual taste, 0-100. Use to check if something is 'on-brand' for them.",
  { url: z.string().describe("public image URL to score") },
  async ({ url }) => {
    const [facets, state] = await Promise.all([getFacets(), readState()]);
    let vec: number[];
    try {
      vec = await embedUrl(url);
    } catch {
      return { content: [{ type: "text", text: "Couldn't fetch/embed that image URL." }] };
    }
    const score = tasteScore(vec, facets, state.taste, null);
    const nearest = facets
      .map((f) => ({ f, s: cosine(f.centroid, vec) }))
      .sort((a, b) => b.s - a.s)[0];
    const pct = Math.max(0, Math.min(100, Math.round(((score + 1) / 2) * 100)));
    return {
      content: [
        {
          type: "text",
          text: `Taste match: ${pct}/100${nearest ? ` — closest to the user's “${nearest.f.label}” facet` : ""}.`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[trove-mcp] ready");
}
main().catch((e) => {
  console.error("[trove-mcp] fatal", e);
  process.exit(1);
});
