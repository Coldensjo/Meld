// How a texture layer looks in the client besides its picture: the MCLY layer flags of the 1.12 tile.
// The layer can scroll (animate) in one of eight directions at one of eight speeds, and glow
// (overbright). A map may set a look per texture (`editor.textureLooks`, saved with the map); a
// texture it doesn't set keeps whatever the client's tile gives it. Kept free of three.js.

/** A texture's own look per texture path: the look flags (`lookFlags`). */
export type TextureLooks = Record<string, number>

/** The MCLY flag bits for a look (adt.LayerLookFlags on the Go side, less the cube map reflection). */
export const ANIM_TURN = 0x7
export const ANIM_SPEED = 0x38
export const ANIM_ON = 0x40
export const OVERBRIGHT = 0x80

export interface Look {
	/** Scrolls the texture. */
	animate: boolean
	/** The scroll's direction, in 45-degree steps (0 to 7). */
	turn: number
	/** The scroll's speed, 0 to 7. */
	speed: number
	/** Draws the texture brighter, as lava glows. */
	overbright: boolean
}

/** A look as the layer flags the tile stores. */
export function lookFlags(l: Look): number {
	return (l.animate ? ANIM_ON : 0) | (l.turn & 7) | ((l.speed & 7) << 3) | (l.overbright ? OVERBRIGHT : 0)
}

/** The look a tile's layer flags give. */
export function lookOf(flags: number): Look {
	return { animate: (flags & ANIM_ON) !== 0, turn: flags & ANIM_TURN, speed: (flags & ANIM_SPEED) >> 3, overbright: (flags & OVERBRIGHT) !== 0 }
}

/** The flags to send for each palette entry: its own look, or -1 to keep what the client's tile has. */
export function looksByIndex(palette: readonly string[], own: TextureLooks): number[] {
	return palette.map((p) => own[p] ?? -1)
}
