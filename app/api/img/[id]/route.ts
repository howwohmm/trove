import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "@/lib/db";
import { libraryDir } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// serves local image files by IMAGE ID — the path comes from our own db row,
// never from the client, and must resolve inside the library dir.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = openDb();
  const row = db.prepare("SELECT local_path FROM images WHERE id=?").get(id) as
    | { local_path: string | null }
    | undefined;
  if (!row?.local_path) return new NextResponse("not found", { status: 404 });

  const path = resolve(row.local_path);
  const root = resolve(libraryDir());
  const generated = resolve(process.cwd(), "generated");
  if (!path.startsWith(root) && !path.startsWith(generated)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!existsSync(path)) return new NextResponse("gone", { status: 410 });

  return new NextResponse(new Uint8Array(readFileSync(path)), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
