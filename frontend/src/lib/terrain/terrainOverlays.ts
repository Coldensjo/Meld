import * as THREE from 'three'

/**
 * The terrain shader's editing overlays (uniforms of `createTerrainMaterial`) and the value that turns
 * each off; a vector one (chunkHover) is zeroed. `withOverlaysOff` draws the client's minimap tiles and
 * the world map's zones with every one of them off, so an overlay listed here can't be drawn into them
 * (#561). A new overlay uniform goes here; one `frame` sets from the editor also goes in FRAME_OVERLAYS.
 */
export const OVERLAYS_OFF = {
	brushVisible: 0,
	gridVisible: 0,
	unpaintable: -1,
	climbCos: 0,
	contourStep: 0,
	chunkLineWorld: 0,
	maskVisible: 0,
	chunkHover: 0,
	tileWorld: 0,
	selMode: 0,
	mapDataMode: 0,
	refOpacity: 0,
	refEdit: 0,
} as const satisfies Record<string, number>

export type OverlayName = keyof typeof OVERLAYS_OFF

/**
 * The overlays `frame` sets from the editor's state each frame, through `updateTerrainOverlays`. The
 * others have their own setters: chunkHover (`updateHoverChunk`), tileWorld (`Terrain.setTileBorders`),
 * selMode (`updateSelectionUniforms`), mapDataMode (`Terrain.setMapDataOverlay`) and the reference's.
 */
export const FRAME_OVERLAYS = ['brushVisible', 'gridVisible', 'unpaintable', 'climbCos', 'contourStep', 'chunkLineWorld', 'maskVisible'] as const satisfies readonly OverlayName[]

/** What `frame` sets the FRAME_OVERLAYS to; each is an overlay with an off value, which the type checks. */
export type OverlayState = Pick<Record<OverlayName, number>, (typeof FRAME_OVERLAYS)[number]>

type Uniforms = Record<string, THREE.IUniform>

/** Writes `s` into the terrain material's uniforms `u`. Allocates nothing: it runs every frame. */
export function updateTerrainOverlays(u: Uniforms, s: OverlayState) {
	for (let i = 0; i < FRAME_OVERLAYS.length; i++) {
		const k = FRAME_OVERLAYS[i]
		u[k].value = s[k]
	}
}

/**
 * Runs `fn` with every overlay of `u` off, and puts them back as they were after it, also when it
 * throws. Throws on an overlay the material lacks, rather than drawing on with it as it is.
 */
export function withOverlaysOff<T>(u: Uniforms, fn: () => T): T {
	const saved: [THREE.IUniform, unknown][] = []
	try {
		for (const [name, off] of Object.entries(OVERLAYS_OFF)) {
			const un = u[name]
			if (!un) throw new Error(`the terrain material has no overlay uniform ${name}`)
			if (un.value instanceof THREE.Vector4) {
				saved.push([un, un.value.clone()])
				un.value.set(0, 0, 0, 0)
			} else {
				saved.push([un, un.value])
				un.value = off
			}
		}
		return fn()
	} finally {
		for (const [un, v] of saved) {
			if (un.value instanceof THREE.Vector4 && v instanceof THREE.Vector4) un.value.copy(v)
			else un.value = v
		}
	}
}
