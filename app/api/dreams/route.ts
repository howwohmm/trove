import { NextResponse } from "next/server";
import { getDreams } from "@/lib/dreams";
import { activeProvider } from "@/lib/generate";
import { hasClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  const dreams = await getDreams();
  return NextResponse.json({
    dreams,
    provider: activeProvider(),
    enabled: hasClaude(),
  });
}
