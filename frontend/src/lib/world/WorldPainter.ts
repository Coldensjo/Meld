import * as THREE from 'three'
import { PaletteArray } from '../terrain/paletteArray'
import { createTerrainMaterial } from '../terrain/TerrainMaterial'
import { CELL_SIZE } from '../terrain/Terrain'
import { CHUNK_CELLS, NO_TEXTURE } from '../terrain/chunkPaint'
import { TILE_CHUNKS, TILE_YARDS } from '../wow/format'
import { PaletteSlots, PAINT_SIDE, sharedSlots, type TilePaintIn } from './worldPaint'

/** The colour a chunk with no texture layer is drawn in, as a tile with no minimap image is (WorldStream's BARE). */
const BARE = '#8a9078'

/**
 * The terrain shader's uniforms a painted tile takes from the stand-in terrain's material, which the
 * frame sets for the active map: the light (the editor's and Client Lighting's), the texture looks'
 * clock and the view's overlays that read the world position alone. The rest are the tile's own, or
 * stay off: the brush, the selection, the mask and the map data are the tools', which a world view
 * has none of.
 */
const SHARED = [
	'sunDir',
	'sunColor',
	'skyAmbient',
	'groundAmbient',
	'clientLit',
	'clientAmbient',
	'clientDiffuse',
	'clientSpecular',
	'clientPointCount',
	'clientPointPos',
	'clientPointColor',
	'lookTime',
	'gridVisible',
	'climbCos',
	'contourStep',
	'chunkLineWorld',
] as const

/** A tile's paint as it is drawn: its material and the palette entries it holds. */
export interface PaintedTile {
	material: THREE.ShaderMaterial
	/** The shared palette's entries the tile uses, one use each (PaletteSlots.release on drop). */
	entries: number[]
	/** Every texture the tile's material shows has loaded (or failed), so it can be swapped in without a grey flash. */
	ready(): boolean
}

/**
 * Draws the world view's near tiles in the client's texture layers through the terrain shader, as a
 * region's ground is drawn (#15): one material a tile, with its own chunk slots and texel weights, over
 * one texture palette all of them share (`PaletteSlots`), and the light and fog of the stand-in
 * terrain's material, which the frame keeps up to date.
 */
export class WorldPainter {
	private readonly palette: PaletteArray
	private readonly slots: PaletteSlots
	/** One uniform object in every tile's material, so a palette that grows reaches them all. */
	private readonly paletteUniform: THREE.IUniform

	constructor(private readonly source: THREE.ShaderMaterial) {
		this.palette = new PaletteArray((t) => (this.paletteUniform.value = t))
		this.paletteUniform = { value: this.palette.texture }
		this.slots = new PaletteSlots((i, path) => this.palette.setEntry(i, path))
	}

	/**
	 * The material for tile (x, y)'s paint `p`, or null when the shared palette has no room left for
	 * its textures (the tile then keeps its minimap image).
	 */
	paint(x: number, y: number, p: TilePaintIn): PaintedTile | null {
		const entries: number[] = []
		const take = (path: string) => {
			const i = this.slots.acquire(path)
			if (i >= 0) entries.push(i)
			return i
		}
		const named = p.names.map(take)
		let bare = NO_TEXTURE
		for (let c = 0; c < p.slots.length; c += 4) {
			if (p.slots[c] !== NO_TEXTURE) continue
			bare = take(BARE)
			break
		}
		if (named.includes(-1) || bare === -1) {
			for (const i of entries) this.slots.release(i)
			return null
		}
		const slotTex = dataTexture(sharedSlots(p, named, bare), TILE_CHUNKS)
		// The weights are the reply's own bytes, sent as they are.
		const weightTex = dataTexture(p.weights, PAINT_SIDE)
		const m = createTerrainMaterial(this.palette.texture, slotTex, weightTex, TILE_YARDS, CELL_SIZE, CHUNK_CELLS * CELL_SIZE, TILE_CHUNKS)
		const u = m.uniforms
		for (const k of SHARED) u[k] = this.source.uniforms[k]
		u.palette = this.paletteUniform
		;(u.paintOrigin.value as THREE.Vector2).set(x * TILE_YARDS, y * TILE_YARDS)
		// The client's own paint, as it has it: no rock on the slopes, and no sea of the editor's.
		u.cliffAuto.value = 0
		u.waterEnabled.value = 0
		const paths = entries.map((i) => this.slots.paths[i])
		return { material: m, entries, ready: () => paths.every((path) => this.palette.settled(path)) }
	}

	/** Lets go of a tile's paint: its textures, its material and its palette entries. */
	drop(t: PaintedTile) {
		const u = t.material.uniforms
		;(u.slotTex.value as THREE.Texture).dispose()
		;(u.weightTex.value as THREE.Texture).dispose()
		t.material.dispose()
		for (const i of t.entries) this.slots.release(i)
	}

	/** The shared palette's entries, for the probes. */
	get entries(): readonly string[] {
		return this.slots.paths
	}

	dispose() {
		this.palette.dispose()
	}
}

/** A nearest-sampled RGBA texture of `side` squared texels, as the terrain's slot and weight textures are. */
function dataTexture(data: Uint8Array, side: number): THREE.DataTexture {
	const t = new THREE.DataTexture(data, side, side, THREE.RGBAFormat)
	t.magFilter = THREE.NearestFilter
	t.minFilter = THREE.NearestFilter
	t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
	t.generateMipmaps = false
	t.needsUpdate = true
	return t
}
