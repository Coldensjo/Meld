// The client's baked terrain shadows (each chunk's MCSH, B-173): a bit per texel, 64 texels a chunk
// (8 a cell), rows running south, bit n of a byte the texel n columns into it, as Go stitches them for a
// region (vmangos.RegionShadows). The client darkens shadowed ground to 70% of its light (Benilla's
// terrain.wgsl, after the client's terrainp_s.bls: diffuse x (0.3 x lit + 0.7)).

/** How much of its light a shadowed texel keeps. */
export const BAKED_SHADOW_LIGHT = 0.7

/** Unpacks the bits into a byte per texel (255 in shadow, 0 lit), `side` texels a side, for an R8 texture. */
export function unpackShadowBits(bits: Uint8Array, side: number): Uint8Array {
  const out = new Uint8Array(side * side)
  for (let i = 0; i < out.length; i++) if ((bits[i >> 3] >> (i & 7)) & 1) out[i] = 255
  return out
}
