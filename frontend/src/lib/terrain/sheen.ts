// The terrain's sheen masks: a tileset texture's `_s` twin (`Foo_s.blp`) carries in its alpha where
// the client's terrain specular shines (Benilla's terrain.rs). paletteArray.ts puts it in the alpha of
// the texture's palette layer.

/** The `_s` twin of a tileset path, whose alpha is the texture's sheen mask. */
export function sheenPath(path: string): string {
	return path.replace(/\.blp$/i, '_s.blp')
}

/** Writes the sheen mask (the alpha of `sheen`, resampled, or 0 without one) into the alpha of `px`. */
export function applySheen(px: Uint8Array, sheen: Uint8Array | null) {
	for (let i = 3; i < px.length; i += 4) px[i] = sheen ? sheen[i] : 0
}
