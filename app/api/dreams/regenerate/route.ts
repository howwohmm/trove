import { NextResponse } from "next/server";
import { regenerateDream } from "@/lib/dreams";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let prompt: string;
  try {
    ({ prompt } = (await req.json()) as { prompt: string });
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!prompt?.trim()) return NextResponse.json({ error: "empty prompt" }, { status: 400 });
  return NextResponse.json(await regenerateDream(prompt));
}
