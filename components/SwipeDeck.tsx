"use client";

// the swipe surface — specs/design-contract.md "/ (deck)". discipline:
// - ONE shared MotionValue drives top-card x, the safelight ring, and the
//   under-card rise — zero react re-renders during the gesture
// - transform/opacity only · exits carry release velocity · interruptible
// - ≤3 mounted cards, next 3 decoded ahead => paint-free reveals
// - optimistic: animate immediately, persist async, never block the gesture
// - keep gets the safelight; skip gets nothing — absence is the feedback

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "motion/react";
import NumberFlow from "@number-flow/react";
import { settle, quiet } from "@/lib/motion";

export interface DeckCard {
  id: string;
  url: string;
  width: number;
  height: number;
  color: string | null;
  author: string | null;
  bucket: "exploit" | "adjacent" | "explore";
  facetId: string | null;
  facetLabel: string | null;
}

interface Facet {
  id: string;
  label: string;
  importance: number;
}

interface HistoryEntry {
  card: DeckCard;
  action: "keep" | "skip";
}

const SESSION_SIZE = 30;
const quietEase: [number, number, number, number] = [...quiet];

function TopCard({
  card,
  x,
  onSwipe,
}: {
  card: DeckCard;
  x: MotionValue<number>;
  onSwipe: (action: "keep" | "skip") => void;
}) {
  const rotate = useTransform(x, [-300, 300], [-12, 12]);
  // pre-commit feedback: a 1px safelight inner ring breathes in with the
  // right-drag (40→120px). nothing appears on left-drag.
  const ringOpacity = useTransform(x, [40, 120], [0, 1]);
  const fired = useRef(false);

  const fly = useCallback(
    (action: "keep" | "skip", velocity = 0) => {
      if (fired.current) return;
      fired.current = true;
      onSwipe(action); // optimistic — fire before the animation ends
      const exitX = (typeof window !== "undefined" ? window.innerWidth : 600) * 1.2;
      animate(x, action === "keep" ? exitX : -exitX, {
        type: "spring",
        stiffness: 220,
        damping: 28,
        velocity,
      });
    },
    [onSwipe, x]
  );

  // keyboard path: same spring exit, zero added delay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") fly("keep");
      if (e.key === "ArrowLeft") fly("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fly]);

  return (
    <motion.div
      drag="x"
      dragElastic={0.9}
      style={{
        x,
        rotate,
        position: "absolute",
        inset: 0,
        borderRadius: 12,
        overflow: "hidden",
        background: card.color ?? "var(--raised)",
        touchAction: "pan-y",
        userSelect: "none",
        cursor: "grab",
      }}
      onDragEnd={(_, info) => {
        const commit = Math.abs(info.offset.x) > 120 || Math.abs(info.velocity.x) > 500;
        if (commit) {
          fly(info.offset.x + info.velocity.x * 0.2 > 0 ? "keep" : "skip", info.velocity.x);
        } else {
          animate(x, 0, { ...settle, velocity: info.velocity.x });
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={card.url}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "2rem 0.9rem 0.7rem",
          background: "linear-gradient(transparent, oklch(0.1 0.005 75 / 0.6))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          fontFamily: "var(--mono)",
          fontSize: "0.62rem",
          letterSpacing: "0.08em",
          textTransform: "lowercase",
          color: "oklch(0.92 0.006 85 / 0.85)",
          pointerEvents: "none",
        }}
      >
        <span>{card.author ?? ""}</span>
        <span style={{ opacity: 0.7 }}>{card.facetLabel ?? card.bucket}</span>
      </div>
      <motion.div
        aria-hidden
        style={{
          opacity: ringOpacity,
          position: "absolute",
          inset: 0,
          borderRadius: 12,
          boxShadow: "inset 0 0 0 1px var(--safelight)",
          pointerEvents: "none",
        }}
      />
    </motion.div>
  );
}

export function SwipeDeck() {
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [facetFilter, setFacetFilter] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sessionDone, setSessionDone] = useState(false);
  const [closed, setClosed] = useState(false);
  const [dry, setDry] = useState(false);
  const [spark, setSpark] = useState(false);

  // the gesture value lives at deck level so the under-card can rise with it
  const x = useMotionValue(0);
  const underScale = useTransform(x, [-200, 0, 200], [1, 0.95, 1]);

  const shownAt = useRef(Date.now());
  const fetching = useRef(false);
  const seen = useRef(new Set<string>());
  const historyRef = useRef<HistoryEntry[]>([]);
  const undoing = useRef(false);
  const sparkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const judged = history.length;
  const kept = useMemo(() => history.filter((h) => h.action === "keep").length, [history]);
  const mostFed = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of history) {
      if (h.action !== "keep" || !h.card.facetLabel) continue;
      counts.set(h.card.facetLabel, (counts.get(h.card.facetLabel) ?? 0) + 1);
    }
    let best: string | null = null;
    let n = 0;
    for (const [label, c] of counts) {
      if (c > n) {
        n = c;
        best = label;
      }
    }
    return best;
  }, [history]);

  const fetchMore = useCallback(async (filter: string | null, reset = false) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetch(`/api/deck${filter ? `?facet=${encodeURIComponent(filter)}` : ""}`);
      const data = (await res.json()) as { cards: DeckCard[] };
      const fresh = data.cards.filter((c) => !seen.current.has(c.id));
      fresh.forEach((c) => seen.current.add(c.id));
      setDry(fresh.length === 0);
      setQueue((q) => (reset ? fresh : [...q, ...fresh]));
    } catch (err) {
      console.error("deck fetch failed", err);
    } finally {
      fetching.current = false;
    }
  }, []);

  useEffect(() => {
    setDry(false);
    fetchMore(facetFilter, true);
  }, [facetFilter, fetchMore]);

  useEffect(() => {
    fetch("/api/taste")
      .then((r) => r.json())
      .then((d: { facets: Facet[] }) => setFacets(d.facets.slice(0, 8)))
      .catch((err) => console.error("taste fetch failed", err));
  }, []);

  // decode-ahead: the next 3 cards are in the gpu before they surface
  useEffect(() => {
    queue.slice(1, 4).forEach((c) => {
      const img = new Image();
      img.src = c.url;
      img.decode().catch(() => {}); // decode-ahead is best-effort
    });
  }, [queue]);

  const top = queue[0];
  const topId = top?.id;

  // a new card surfaces: reset the gesture value and the dwell clock
  useEffect(() => {
    x.jump(0);
    shownAt.current = Date.now();
  }, [topId, x]);

  // queue exhausted mid-session → reflect on what was judged
  useEffect(() => {
    if (dry && queue.length === 0 && history.length > 0 && !sessionDone) setSessionDone(true);
  }, [dry, queue.length, history.length, sessionDone]);

  useEffect(
    () => () => {
      if (sparkTimer.current) clearTimeout(sparkTimer.current);
    },
    []
  );

  const handleSwipe = useCallback(
    (action: "keep" | "skip") => {
      if (!top || sessionDone || closed) return;
      const dwellMs = Date.now() - shownAt.current;
      fetch("/api/swipe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageId: top.id, action, dwellMs, deckSource: top.bucket }),
      }).catch((err) => console.error("swipe persist failed", err));

      historyRef.current = [...historyRef.current, { card: top, action }];
      setHistory(historyRef.current);
      const judgedNow = historyRef.current.length;

      if (action === "keep") {
        setSpark(true);
        if (sparkTimer.current) clearTimeout(sparkTimer.current);
        sparkTimer.current = setTimeout(() => setSpark(false), 400);
      }

      // delay removal so the exit animation plays under the next card reveal
      setTimeout(() => {
        setQueue((q) => q.filter((c) => c.id !== top.id));
        if (judgedNow >= SESSION_SIZE) setSessionDone(true);
      }, 240);

      if (queue.length < 5 && judgedNow < SESSION_SIZE) fetchMore(facetFilter);
    },
    [top, queue.length, sessionDone, closed, fetchMore, facetFilter]
  );

  // undo walks the server back one swipe at a time; the client already holds
  // the card data, so each undone card goes straight back on top of the queue
  const undo = useCallback(async (steps: number) => {
    if (undoing.current) return;
    undoing.current = true;
    try {
      for (let i = 0; i < steps; i++) {
        const entry = historyRef.current[historyRef.current.length - 1];
        if (!entry) break;
        const res = await fetch("/api/undo", { method: "POST" });
        const data = (await res.json()) as { ok: boolean };
        if (!data.ok) break;
        historyRef.current = historyRef.current.slice(0, -1);
        setHistory(historyRef.current);
        setQueue((q) => [entry.card, ...q]);
      }
    } catch (err) {
      console.error("undo failed", err);
    } finally {
      undoing.current = false;
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "u" && !e.repeat && !sessionDone && !closed) undo(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, sessionDone, closed]);

  const oneMoreDeck = useCallback(() => {
    historyRef.current = [];
    setHistory([]);
    setSessionDone(false);
    setDry(false);
    fetchMore(facetFilter);
  }, [fetchMore, facetFilter]);

  const left = SESSION_SIZE - judged;
  const trayItems = history.slice(-5);

  return (
    <>
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.75rem",
        }}
      >
        {!sessionDone && !closed && (
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              overflowX: "auto",
              maxWidth: "100%",
              padding: "0 0.5rem",
            }}
          >
            <button
              className={`chip ${facetFilter === null ? "on" : ""}`}
              onClick={() => setFacetFilter(null)}
            >
              everything
            </button>
            {facets.map((f) => (
              <button
                key={f.id}
                className={`chip ${facetFilter === f.id ? "on" : ""}`}
                onClick={() => setFacetFilter(facetFilter === f.id ? null : f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            position: "relative",
            width: "min(92vw, 420px)",
            height: "min(68dvh, 600px)",
          }}
        >
          {!sessionDone && !closed && queue.length > 0 && (
            <span className="t-mono" style={{ position: "absolute", top: "-1.4rem", right: 0 }}>
              {left} left
            </span>
          )}

          {closed ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, ease: quietEase }}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <p className="t-title">
                the darkroom is closed. <span style={{ color: "var(--safelight)" }}>✦</span>
              </p>
            </motion.div>
          ) : sessionDone ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...settle }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 12,
                background: "var(--raised)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.9rem",
                padding: "2rem",
                textAlign: "center",
              }}
            >
              <p className="t-display">
                you kept {kept} of {judged}
              </p>
              <p className="t-copy muted">
                {mostFed ? (
                  <>
                    most fed <em>{mostFed}</em>
                  </>
                ) : (
                  "your taste is developing"
                )}
              </p>
              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
                <button className="chip" onClick={oneMoreDeck}>
                  one more deck
                </button>
                <button className="chip" onClick={() => setClosed(true)}>
                  done for today
                </button>
              </div>
            </motion.div>
          ) : queue.length === 0 ? (
            <p
              className="t-copy muted breathing"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              the pool is developing…
            </p>
          ) : (
            queue.slice(0, 3).map((card, i) =>
              i === 0 ? (
                <div key={card.id} style={{ position: "absolute", inset: 0, zIndex: 3 }}>
                  <TopCard card={card} x={x} onSwipe={handleSwipe} />
                </div>
              ) : i === 1 ? (
                // the under-card rises with the top card's |x| — 0.95→1 over 0→200px
                <motion.div
                  key={card.id}
                  style={{
                    scale: underScale,
                    position: "absolute",
                    inset: 0,
                    zIndex: 2,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: card.color ?? "var(--raised)",
                    pointerEvents: "none",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </motion.div>
              ) : (
                <div
                  key={card.id}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 1,
                    borderRadius: 12,
                    overflow: "hidden",
                    background: card.color ?? "var(--raised)",
                    transform: "scale(0.95)",
                    pointerEvents: "none",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
              )
            )
          )}
        </div>
      </div>

      {/* keep acknowledgment — the only other safelight in the room */}
      {judged > 0 && !closed && (
        <div
          className="t-mono"
          style={{
            position: "absolute",
            right: "0.2rem",
            bottom: "2.2rem",
            display: "flex",
            alignItems: "baseline",
            gap: "0.4rem",
          }}
        >
          <AnimatePresence>
            {spark && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: quietEase }}
                style={{ color: "var(--safelight)" }}
              >
                ✦
              </motion.span>
            )}
          </AnimatePresence>
          <span>kept</span>
          <NumberFlow value={kept} />
        </div>
      )}

      {/* last-5 undo tray — most recent on the right */}
      {history.length > 0 && !sessionDone && !closed && (
        <div
          style={{
            position: "absolute",
            bottom: "0.4rem",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.4rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.3rem", height: 24 }}>
            <AnimatePresence mode="popLayout">
              {trayItems.map((entry, i) => (
                <motion.button
                  key={entry.card.id}
                  onClick={() => undo(trayItems.length - i)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: quietEase }}
                  style={{ padding: 0, lineHeight: 0 }}
                  aria-label="undo back to this card"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.card.url}
                    alt=""
                    style={{
                      height: 24,
                      width: "auto",
                      maxWidth: 44,
                      objectFit: "cover",
                      borderRadius: 2,
                      display: "block",
                    }}
                  />
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
          <span className="t-mono">u to undo</span>
        </div>
      )}
    </>
  );
}
