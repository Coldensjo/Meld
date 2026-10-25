// How an area paste's heights meet the map's (see clipboard.ts). Kept apart from the clipboard module,
// which pulls in the terrain stroke, so it can be tested on its own under node.

/**
 * How the pasted heights meet the map's: `set` replaces them, `max` only raises the ground (the higher
 * of the two), `min` only lowers it, and `add` and `subtract` raise or lower the ground by how far the
 * clip rises above its own lowest point, so a copied hill lands as a bump or a dent on any ground.
 */
export type PasteHeightMode = 'set' | 'max' | 'min' | 'add' | 'subtract'

/** The height a pasted vertex gives the ground at `cur`, before the edge blend; `offset` raises the paste. */
export function pastedHeight(mode: PasteHeightMode, cur: number, src: number, clipLow: number, offset: number): number {
	switch (mode) {
		case 'max':
			return Math.max(cur, src + offset)
		case 'min':
			return Math.min(cur, src + offset)
		case 'add':
			return cur + (src - clipLow) + offset
		case 'subtract':
			return cur - (src - clipLow) + offset
		default:
			return src + offset
	}
}
