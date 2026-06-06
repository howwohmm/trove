import { NextResponse } from "next/server";
import { dreamTick } from "@/lib/dreams";

export const dynamic = "force-dynamic";

// manual trigger — runs one pipeline pass and reports what happened.
// useful for testing and a future "dream now" button.
export async function POST() {
  const result = await dreamTick();
  return NextResponse.json(result);
}
