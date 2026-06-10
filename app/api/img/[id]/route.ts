import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import sharp from "sharp";
import { openDb, dataDir } from "@/lib/db";
import { libraryDir } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// serves local images by IMAGE ID, resized on demand (?w=) with a disk cache.
// the v1 import brought full-res originals (avg 3.3MB, up to 26MB) — serving
// those raw into 250px grid cells was the whole "photos load slow" problem.
// widths snap to fixed steps so the cache stays small.

const STEPS = [200, 320, 480, 640, 800, 1200, 1600, 2000];

function snapWidth(w: number): number {
  for (const s of STEPS) if (w <= s) return s;
  return STEPS[STEPS.length - 1];
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const headers = {
    "cache-control": "public, max-age=31536000, immutable",
  };

  const wParam = Number(req.nextUrl.searchParams.get("w") ?? 0);
  if (!wParam || !Number.isFinite(wParam)) {
    // explicit full-size request (lightbox "open original")
    return new NextResponse(new Uint8Array(readFileSync(path)), {
      headers: { ...headers, "content-type": "image/jpeg" },
    });
  }

  const w = snapWidth(Math.max(1, wParam));
  const cacheDir = join(dataDir(), "thumbs");
  const cachePath = join(cacheDir, `${id}-${w}.webp`);

  if (existsSync(cachePath)) {
    return new NextResponse(new Uint8Array(readFileSync(cachePath)), {
      headers: { ...headers, "content-type": "image/webp" },
    });
  }

  try {
    const buf = await sharp(path)
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, buf);
    return new NextResponse(new Uint8Array(buf), {
      headers: { ...headers, "content-type": "image/webp" },
    });
  } catch {
    // corrupt/unsupported file — fall back to the original bytes
    return new NextResponse(new Uint8Array(readFileSync(path)), {
      headers: { ...headers, "content-type": "image/jpeg" },
    });
  }
}
