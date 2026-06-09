"use client";

// pinterest-style masonry: absolute-positioned cells computed synchronously
// from KNOWN aspect ratios (no measure pass, zero layout shift), windowed so
// only cells near the viewport mount. gestalt-masonry architecture.
// contract: 2px gaps, radius 0 — one continuous surface of images (cosmos).

import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";

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

// quiet ease — micro fades + dream develop-ins (lib/motion.ts)
const QUIET = "cubic-bezier(0.25, 1, 0.5, 1)";

function columnsFor(width: number, density?: 2 | 3 | 5): number {
  if (density === 2) return 2; // fewer, bigger
  if (density === 5) return width < 560 ? 3 : 5; // denser
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
    let col = 0; // shortest column
    for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
    cells.push({ item, top: heights[col], left: col * (colW + GAP), w: colW, h });
    heights[col] += h + GAP;
  }
  return { cells, height: Math.max(0, ...heights) };
}

const MasonryCell = memo(function MasonryCell({
  cell,
  active,
  dimmed,
  developIn,
  onHover,
  onClick,
}: {
  cell: Cell;
  active: boolean;
  dimmed: boolean;
  developIn?: boolean;
  onHover: (id: string | null) => void;
  onClick?: (item: MasonryItem) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const { item } = cell;
  return (
    <div
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
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
        borderRadius: 0,
        overflow: "hidden",
        background: item.color ?? "var(--raised)",
        cursor: onClick ? "pointer" : undefined,
        // hover is opacity-only — never re-layout
        opacity: dimmed ? 0.75 : 1,
        transition: "opacity 0.15s ease",
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
          ...(developIn
            ? {
                // dream develop-in: blur + dark → clear, 600ms quiet ease
                filter: loaded ? "none" : "blur(12px) brightness(0.4)",
                transition: `opacity 0.6s ${QUIET}, filter 0.6s ${QUIET}`,
              }
            : { transition: "opacity 0.35s ease" }),
        }}
      />
      {item.meta && (
        <div className="cell-meta" style={{ opacity: active ? 1 : 0 }}>
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
  /** load-in develops like a print (blur+dark → clear) instead of plain fade */
  developIn?: boolean;
  /** on cell hover, the other visible cells dim to 0.75 */
  dimSiblings?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [window_, setWindow] = useState({ top: 0, bottom: 4000 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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

  const onHover = useCallback((id: string | null) => setHoveredId(id), []);

  const visible = cells.filter((c) => c.top + c.h > window_.top && c.top < window_.bottom);

  return (
    <div ref={ref} style={{ position: "relative", height }}>
      {visible.map((c) => (
        <MasonryCell
          key={c.item.id}
          cell={c}
          active={hoveredId === c.item.id}
          dimmed={!!dimSiblings && hoveredId !== null && hoveredId !== c.item.id}
          developIn={developIn}
          onHover={onHover}
          onClick={onItemClick}
        />
      ))}
    </div>
  );
}
