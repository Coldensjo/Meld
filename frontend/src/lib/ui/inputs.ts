// Reading number inputs in the dialogs and panels (#594).

/** An input event's value as a number, NaN when it is not one (pair with `clamp`). */
export const num = (e: Event): number => parseFloat((e.target as HTMLInputElement).value)

/** An input event's value as a number, 0 when it is empty or not a number. */
export const numOr0 = (e: Event): number => Number((e.target as HTMLInputElement).value) || 0

/** `v` kept to [lo, hi]; NaN or infinity (an empty or unfinished field) gives `lo`. */
export const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
