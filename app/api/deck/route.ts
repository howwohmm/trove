import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { openDb } from "@/lib/db";
import { popDeck, refillPool } from "@/lib/feed";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = openDb();
  const facet = req.nextUrl.searchParams.get("facet") ?? undefined;

  let cards = popDeck(db, 12, facet);
  if (cards.length < 4) {
    // pool dry — refill inline once, then pop again
    try {
      await refillPool(db);
    } catch (err) {
      logError(db, "deck.refill", err);
    }
    cards = popDeck(db, 12, facet);
  } else {
    // healthy pool — top up in the background
    after(async () => {
      try {
        await refillPool(db);
      } catch (err) {
        logError(db, "deck.refill.bg", err);
      }
    });
  }
  return NextResponse.json({ cards });
}
