"use client";

// pinterest-style masonry: absolute-positioned cells computed synchronously
// from KNOWN aspect ratios (no measure pass, zero layout shift), windowed so
// only cells near the viewport mount.
//
// perf contract (the audit findings, encoded):
// - scroll handler quantizes the render window to 300px buckets — react only
//   re-renders when the bucket changes, never per frame
// - hover dimming + meta reveal are PURE CSS (:has) — zero react involvement
// - images are requested at the column width they'll render at (?w= for local,
//   url params for unsplash) — never raw originals
// - no filter animations in cells; load-in is a 200ms opacity fade

import { useEffect, useMemo, useRef, useState, memo } from "react";

export interface MasonryItem {
  id: string;
  url: string;
  width: number;
  height: number;
  color?: string | null;
  blurData?: string | null;
  caption?: string | null;
  /** mono strip shown at cell bottom on that cell's hover (facet · date) */
  meta?: string;
}

interface Cell {
  item: MasonryItem;
  top: number;
  left: number;
  w: number;
  h: number;
}

const GAP = 2;
const BUCKET = 300; // window quantization, px

/** request the size we'll actually render — the core photo-speed fix */
export function sizedUrl(url: string, displayW: number): string {
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 2;
  const target = Math.ceil(displayW * dpr);
  if (url.startsWith("/api/img/")) {
    return `${url}?w=${target}`;
  }
  try {
    const u = new URL(url);
    if (u.hostname === "images.unsplash.com") {
      u.searchParams.set("w", String(Math.min(target, 1600)));
      u.searchParams.set("q", "75");
      u.searchParams.set("auto", "format");
      return u.toString();
    }
  } catch {
    /* relative or odd url — leave as is */
  }
  return url;
}

function columnsFor(width: number, density?: 2 | 3 | 5): number {
  if (density === 2) return 2;
  if (density === 5) return width < 560 ? 3 : 5;
  if (width < 560) return 2;
  if (width < 900) return 3;
  if (width < 1200) return 4;
  return 5;
}

function layout(
  items: MasonryItem[],
  containerW: number,
  density?: 2 | 3 | 5
): { cells: Cell[]; height: number } {
  const cols = columnsFor(containerW, density);
  const colW = (containerW - GAP * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  const cells: Cell[] = [];
  for (const item of items) {
    const h = Math.round((item.height / item.width) * colW);
    let col = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
    cells.push({ item, top: heights[col], left: col * (colW + GAP), w: colW, h });
    heights[col] += h + GAP;
  }
  return { cells, height: Math.max(0, ...heights) };
}

const MasonryCell = memo(function MasonryCell({
  cell,
  developIn,
  onClick,
}: {
  cell: Cell;
  developIn?: boolean;
  onClick?: (item: MasonryItem) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const { item } = cell;
  return (
    <div
      data-cell
      onClick={onClick ? () => onClick(item) : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick(item) : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        position: "absolute",
        top: cell.top,
        left: cell.left,
        width: cell.w,
        height: cell.h,
        overflow: "hidden",
        background: item.color ?? "var(--raised)",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      {item.blurData && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.blurData}
          alt=""
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sizedUrl(item.url, cell.w)}
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
          // develop-in keeps the darkroom feel with brightness only — never
          // animate blur across a grid (paint storm, the "weird animations")
          ...(developIn && !loaded ? { filter: "brightness(0.4)" } : {}),
          transition: developIn
            ? "opacity 0.45s cubic-bezier(0.25,1,0.5,1), filter 0.45s cubic-bezier(0.25,1,0.5,1)"
            : "opacity 0.2s ease",
        }}
      />
      {item.meta && (
        <div className="cell-meta">
          <span>{item.meta}</span>
        </div>
      )}
    </div>
  );
});

export function Masonry({
  items,
  onNearEnd,
  density,
  onItemClick,
  developIn,
  dimSiblings,
}: {
  items: MasonryItem[];
  onNearEnd?: () => void;
  /** column override: 2 = fewer/bigger · 3 = default responsive · 5 = denser */
  density?: 2 | 3 | 5;
  onItemClick?: (item: MasonryItem) => void;
  /** load-in develops like a print (dark → clear) instead of plain fade */
  developIn?: boolean;
  /** on cell hover, sibling cells dim — pure css, see .masonry-dim in globals */
  dimSiblings?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [bucket, setBucket] = useState({ top: -1, bottom: 14 }); // in BUCKET units
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
    () => (containerW > 0 ? layout(items, containerW, density) : { cells: [], height: 0 }),
    [items, containerW, density]
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
        // quantized render window: react re-renders only on bucket change
        const top = Math.floor((-rect.top - vh * 0.7) / BUCKET);
        const bottom = Math.ceil((-rect.top + vh * 1.7) / BUCKET);
        setBucket((b) => (b.top === top && b.bottom === bottom ? b : { top, bottom }));
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

  const winTop = bucket.top * BUCKET;
  const winBottom = bucket.bottom * BUCKET;
  const visible = useMemo(
    () => cells.filter((c) => c.top + c.h > winTop && c.top < winBottom),
    [cells, winTop, winBottom]
  );

  return (
    <div
      ref={ref}
      className={dimSiblings ? "masonry masonry-dim" : "masonry"}
      style={{ position: "relative", height }}
    >
      {visible.map((c) => (
        <MasonryCell key={c.item.id} cell={c} developIn={developIn} onClick={onItemClick} />
      ))}
    </div>
  );
}
