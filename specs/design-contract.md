# trove design contract — "darkroom"

The canonical, binding spec for trove's UI. Every surface obeys this. Full
research + explorations: `specs/brand-book.html`. Direction locked 10 Jun 2026 —
do not re-litigate mid-build (v1 burned 1500 LOC on theme thrash).

## the idea

trove is a darkroom: a quiet place where your taste develops. The machine works
overnight; you walk in, judge contact sheets, and prints emerge. Everything is
warm near-black; the only color in the room is the safelight — and your images.

## refusals (the brand IS these)

no badges · no confetti · no like-counts · no streaks-guilt · no second accent ·
no borders on images · no shadows on images · no spinners (breathing opacity
instead) · no animation on keyboard-triggered actions · no uppercase anywhere ·
no exclamation marks · chrome chroma ≤ 0.01 — images are the only color.

## color (oklch, warm hue ~75, Linear 3-variable thinking)

```css
--bg0:    oklch(0.21 0.006 75);  /* the void — deck page ground */
--bg:     oklch(0.24 0.006 75);  /* base page ground */
--raised: oklch(0.27 0.006 75);  /* one elevation step. there is no second. */
--line:   oklch(0.33 0.006 75);  /* hairline borders */
--fg:     oklch(0.92 0.006 85);  /* primary text (warm off-white) */
--muted:  oklch(0.63 0.010 80);  /* secondary text */
--faint:  oklch(0.45 0.008 80);  /* tertiary/hints */
--safelight: oklch(0.75 0.13 60);/* THE accent. keep-moments, loved marks, focus rings. nothing else. */
```

## type (one family, six locked styles, never free-size)

Manrope 300/400 only. Mono = system stack (`ui-monospace, "SF Mono", "Cascadia Mono", monospace`)
for METADATA ONLY (timestamps, counts, dims, facet scores — lab-note voice).

```
display  2.4rem / 300 / lh 1.15 / lowercase
title    1.05rem / 400 / lh 1.3
copy     0.9rem / 300 / lh 1.6
label    0.78rem / 400 / lh 1.4
mono     0.68rem / mono / letter-spacing 0.08em / color muted
hint     0.72rem / 300 / color faint
```

## space + shape

4px base scale. Masonry: 2px gaps, **radius 0** (one continuous surface of
images — cosmos). Cards/sheets elsewhere: radius 8 max. Deck card: radius 12.
Grain: 3% SVG noise overlay on body (the anti-slop signal), pointer-events none.

## motion (felt, not seen — Emil/Rauno rules)

```ts
// lib/motion.ts
export const snap   = { type: "spring", visualDuration: 0.25, bounce: 0 };
export const settle = { type: "spring", visualDuration: 0.3,  bounce: 0.15 };
export const morph  = { type: "spring", visualDuration: 0.45, bounce: 0.1 };
export const quiet  = [0.25, 1, 0.5, 1];   // micro fades 120–200ms
```

Rules: transform/opacity/filter only · keyboard actions animate at 0ms ·
ease-out bias · everything interruptible · `<MotionConfig reducedMotion="user">`
global · page transitions = 180ms fade+4px rise, no exit animation · hover
≤150ms · the slow moments (400–600ms) are reserved for /taste reveals and
dream develop-ins.

## voice

lowercase. verb-first. negations as manifesto. empty states prescribe one
action, never apologize twice. deck verdicts: **keep / let go** (UI copy; schema
stays keep/skip). microcopy examples: "nothing here yet. that's fine." ·
"swipe 20 to wake the engine." · "the pool is developing…" · "done for today."

## surface specs

**/ (deck — absence as design):** ground = --bg0. One card floating in a vast
void, max-width 420. Faint keyboard hints in corners (`←` let go · keep `→`).
Pre-commit feedback: 1px safelight inner ring fades in during right-drag
(opacity ∝ x, 40→120px); NOTHING appears on left-drag — absence is the skip
feedback. Under-card rises during the drag (scale 0.95→1 bound to |x|), commit
only on release (offset>120 or velocity>500), exits carry release velocity.
Session = deck of 30: thin progress dots (mono "14 left", never a big total).
End of deck → reflection card: "you kept 9 of 30 · most fed *motion blur ·
bokeh*" then [one more deck] / [done for today]. Undo: `u` key + a last-5
thumbnail tray (bottom edge, 24px tall, click to reverse) → POST /api/undo.
Keep acknowledgment: kept-count in corner ticks via NumberFlow + a ✦ glyph
fades in 150ms then out. No skip feedback at all.

**/library (the contact sheet):** gapless-sharp masonry (2px, radius 0).
Hover: image lifts nothing — neighbors dim to 0.75 (150ms), mono metadata
strip fades in at cell bottom (facet · date). Click → lightbox (layoutId morph,
backdrop oklch(0.1/0.85), esc/arrow nav): image left, right rail = mono
metadata (kept date, author link, dims, facet chip → filters grid), "more like
this" strip (6 CLIP neighbors from your keeps, /api/similar/:id), actions:
open original · let go (remove). Density toggle: `-`/`+` keys (2/3/5-col
levels, mono indicator). Search placeholder seeded from a real facet keyword:
`try "${keyword}"`. Search results show matched score on hover (mono).

**/taste (the revelation, not a database):** full-bleed facet rows (medoid as
hero image, develop-in on view), display-size lowercase label, one identity
line computed from data ("a third of everything you keep is long exposure").
Importance bar scaleX 0→x (600ms, whileInView once). Facet label click-to-
rename (PATCH /api/taste). Mono annotations everywhere (members · importance ·
last fed). The page should feel like reading a profile of yourself.

**/dreams:** masonry same as library. Dream cards develop-in: blur(12)+
brightness(0.4) → clear, 600ms quiet ease, staggered. ✦ marks dreams. "dream
from your taste" chip stays. Footer line: "kept dreams never touch retrieval
taste."

**/status (the activity log — lab notes):** reverse-chron one-column log,
mono timestamps: "01:12 kept unsplash-x → fed *harsh shadows*" · "01:10
retrained taste · 11 facets" · "00:58 pool refilled +24 explore". Stats row
above as NumberFlow numerals (keeps, keep-rate, corpus, pool depths, unsplash
rate). Errors inline in the log, safelight-tinted. Quiet dot-row: "judged 5 of
the last 7 days" (dots, no streak-guilt copy).

**every page:** footer-as-index — lowercase text-run `swipe / library / taste /
dreams / status` + one negation line ("local-first. no cloud. no one else's
algorithm."). Nav stays top, hints at keys.

## stack delta (from designengineer.tools vetted list)

+ `@number-flow/react` (stats) · oklch tokens · motion layoutId lightbox ·
system mono. NOT added: shadcn (custom css fits), Lottie (v1 lesson), Lenis
(windowed masonry already smooth). Deps stay ≤9.
