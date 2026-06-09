"use client";

// pinterest-style masonry: absolute-positioned cells computed synchronously
// from KNOWN aspect ratios (no measure pass, zero layout shift), windowed so
// only cells near the viewport mount. gestalt-masonry architecture, ~150 LOC.

import { useEffect, useMemo, useRef, useState, memo } from "react";

export interface MasonryItem {
  id: string;
  url: string;
  width: number;
  height: number;
  color?: string | null;
  blurData?: string | null;
  caption?: string | null;
}

interface Cell {
  item: MasonryItem;
  top: number;
  left: number;
  w: number;
  h: number;
}

const GAP = 10;

function columnsFor(width: number): number {
  if (width < 560) return 2;
  if (width < 900) return 3;
  if (width < 1200) return 4;
  return 5;
}

function layout(items: MasonryItem[], containerW: number): { cells: Cell[]; height: number } {
  const cols = columnsFor(containerW);
  const colW = (containerW - GAP * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  const cells: Cell[] = [];
  for (const item of items) {
    const h = Math.round((item.height / item.width) * colW);
    let col = 0; // shortest column
    for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
    cells.push({ item, top: heights[col], left: col * (colW + GAP), w: colW, h });
    heights[col] += h + GAP;
  }
  return { cells, height: Math.max(0, ...heights) };
}

const MasonryCell = memo(function MasonryCell({ cell }: { cell: Cell }) {
  const [loaded, setLoaded] = useState(false);
  const { item } = cell;
  return (
    <div
      style={{
        position: "absolute",
        top: cell.top,
        left: cell.left,
        width: cell.w,
        height: cell.h,
        borderRadius: "var(--radius)",
        overflow: "hidden",
        background: item.color ?? "var(--bg-raised)",
      }}
    >
      {item.blurData && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.blurData}
          alt=""
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(8px)", transform: "scale(1.1)" }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.url}
        alt={item.caption ?? ""}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.35s ease",
        }}
      />
    </div>
  );
});

export function Masonry({
  items,
  onNearEnd,
}: {
  items: MasonryItem[];
  onNearEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [window_, setWindow] = useState({ top: 0, bottom: 4000 });
  const nearEndFired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { cells, height } = useMemo(
    () => (containerW > 0 ? layout(items, containerW) : { cells: [], height: 0 }),
    [items, containerW]
  );

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // render window: viewport ± 70% (gestalt's virtualBufferFactor)
        const top = -rect.top - vh * 0.7;
        const bottom = -rect.top + vh * 1.7;
        setWindow({ top, bottom });
        // prefetch trigger at 2 viewports from the end
        if (onNearEnd && rect.bottom - vh * 2 < vh && !nearEndFired.current) {
          nearEndFired.current = true;
          onNearEnd();
          setTimeout(() => (nearEndFired.current = false), 1000);
        }
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [onNearEnd]);

  const visible = cells.filter((c) => c.top + c.h > window_.top && c.top < window_.bottom);

  return (
    <div ref={ref} style={{ position: "relative", height }}>
      {visible.map((c) => (
        <MasonryCell key={c.item.id} cell={c} />
      ))}
    </div>
  );
}
