import { NextResponse } from "next/server";
import { getLibrary } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const library = await getLibrary();
  return NextResponse.json({ library });
}
