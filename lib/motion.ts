// motion tokens — specs/design-contract.md. felt, not seen.
// transform/opacity/filter only. keyboard actions animate at 0ms.

export const snap = { type: "spring", visualDuration: 0.25, bounce: 0 } as const;
export const settle = { type: "spring", visualDuration: 0.3, bounce: 0.15 } as const;
export const morph = { type: "spring", visualDuration: 0.45, bounce: 0.1 } as const;
export const quiet = [0.25, 1, 0.5, 1] as const; // micro fades, 120–200ms

export const pageEnter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: quiet },
} as const;
