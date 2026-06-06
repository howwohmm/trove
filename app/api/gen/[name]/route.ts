import { promises as fs } from "fs";
import path from "path";
import { GENERATED_DIR } from "@/lib/generate";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (name.includes("/") || name.includes("..")) {
    return new Response("bad name", { status: 400 });
  }
  try {
    const buf = await fs.readFile(path.join(GENERATED_DIR, name));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
