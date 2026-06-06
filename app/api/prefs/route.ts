import { NextResponse } from "next/server";
import { getPrefs, setPrefs } from "@/lib/store";
import type { Prefs } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPrefs());
}

export async function POST(req: Request) {
  let body: Prefs;
  try {
    body = (await req.json()) as Prefs;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  await setPrefs({ steer: body.steer ?? "", avoid: body.avoid ?? "" });
  return NextResponse.json({ ok: true });
}
