import { NextResponse } from "next/server";
import { getDreams } from "@/lib/dreams";
import { activeProvider, providerLabel } from "@/lib/generate";
import { hasClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  const dreams = await getDreams();
  return NextResponse.json({
    dreams,
    provider: providerLabel(),
    hasProvider: activeProvider() !== "none",
    enabled: hasClaude(),
  });
}
