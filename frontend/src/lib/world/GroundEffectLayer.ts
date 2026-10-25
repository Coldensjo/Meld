import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { CHUNK_CELLS, NO_TEXTURE } from '../terrain/chunkPaint'
import { TILE_CHUNKS } from '../wow/format'
import { getAsset, onAssetLoaded } from '../models/assets'
import { patchCascadeShadows } from '../engine/shadowCascades'
import type { ObjectLayer } from './ObjectLayer'
import {
	BlizzardRandomizer,
	cellTexture,
	chunkSeed,
	coverCells,
	effectAt,
	effectFor,
	hasScopedEffects,
	noScopedEffects,
	scatterChunk,
	TUFT_ALPHA_REF,
	TUFT_FADE_FAR,
	TUFT_FADE_NEAR,
	type GroundEffect,
	type ScopedEffects,
	type CoverBox,
	type GroundEffectTables,
	type TextureEffects,
	type Tuft,
} from './groundEffects'

/** How high above the ground a building's bottom may float and still bare the cells under it. */
const COVER_LIFT = 4

/**
 * The footprints of the map's buildings (root WMOs standing on or in the ground), for the cells
 * they bare. A model still loading has the placeholder's box until it arrives.
 */
export function buildingBoxes(objects: ObjectLayer): CoverBox[] {
	const out: CoverBox[] = []
	for (const o of objects.objects.values()) {
		if (o.parent !== undefined || !o.type.startsWith('wmo:')) continue
		const bb = getAsset(o.type).bbox
		if (bb.isEmpty() || o.yOff + bb.min.y * o.scale > COVER_LIFT) continue
		out.push({ x: o.x, z: o.z, rotY: o.rotY, scale: o.scale, minX: bb.min.x, minZ: bb.min.z, maxX: bb.max.x, maxZ: bb.max.z })
	}
	return out
}

/**
 * The cells that grow no ground effects, one byte per cell in `out`: the client's own no-doodad
 * bits plus the cells under the map's buildings.
 */
export function blockedCells(terrain: Terrain, objects: ObjectLayer, out: Uint8Array): Uint8Array {
	out.set(terrain.noEffect)
	coverCells(buildingBoxes(objects), terrain.cellSize, terrain.size, out)
	return out
}

/** Most tufts drawn at once; past it the chunks built first keep theirs. */
const MAX_TUFTS = 60000
/** The layer is rebuilt no more often than this while the camera moves or the ground changes. */
const REBUILD_MS = 250

interface Batch {
	mesh: THREE.InstancedMesh
	count: number
	/** The last build's instance matrices, which the room gate packs from. */
	full?: Float32Array
}

// The tufts' fade on view depth (groundEffects.ts, tuftFade), multiplied into the alpha the cut-out tests.
const FADE_VERTEX = /* glsl */ `#include <project_vertex>
  vTuftDepth = -mvPosition.z;`
const FADE_FRAGMENT = /* glsl */ `diffuseColor.a *= clamp((254.0 - 256.0 * ((vTuftDepth - ${TUFT_FADE_NEAR.toFixed(1)}) / ${(TUFT_FADE_FAR - TUFT_FADE_NEAR).toFixed(1)})) / 255.0, 0.0, 252.0 / 255.0);
  #include <alphatest_fragment>`

/** Each model material's tuft twin: the same look, faded by view depth and cut out at 128/255. */
const tuftMaterials = new WeakMap<THREE.Material, THREE.Material>()

/**
 * The tuft twin of a model's material. The client draws every tuft as a cut-out with culling off,
 * whatever the batch's own blend. A clone loses the material's shader patch, so the cascade shadows
 * are patched in again and the fade chained after them.
 */
function tuftMaterial(src: THREE.Material): THREE.Material {
	let m = tuftMaterials.get(src)
	if (m) return m
	const twin = src.clone()
	twin.alphaTest = TUFT_ALPHA_REF
	twin.transparent = false
	twin.depthWrite = true
	twin.side = THREE.DoubleSide
	if (twin instanceof THREE.MeshLambertMaterial) patchCascadeShadows(twin)
	const before = twin.onBeforeCompile
	const key = twin.customProgramCacheKey
	twin.onBeforeCompile = (shader, renderer) => {
		before.call(twin, shader, renderer)
		shader.vertexShader = 'varying float vTuftDepth;\n' + shader.vertexShader.replace('#include <project_vertex>', FADE_VERTEX)
		shader.fragmentShader = 'varying float vTuftDepth;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', FADE_FRAGMENT)
	}
	twin.customProgramCacheKey = () => key.call(twin) + '|tuftFade'
	tuftMaterials.set(src, twin)
	// Let go of with its model's material (assets.ts releaseAssets, #505).
	src.addEventListener('dispose', () => {
		tuftMaterials.delete(src)
		twin.dispose()
	})
	return twin
}

/**
 * Draws the ground effects of one map: the grass tufts, flowers and pebbles the game scatters on
 * each chunk by the texture on top of each cell, placed as the client places them (`scatterChunk`,
 * seeded by the chunk's place in the client's map, so the tufts stand where the game puts them), and
 * faded out by view depth as the client fades them (`tuftFade`). Only the tufts within `reach` of the
 * camera are built, one InstancedMesh per detail model, and the build is redone when the camera has
 * moved half a chunk, the ground or its paint changed, or a model finished loading.
 */
export class GroundEffectLayer {
	readonly group = new THREE.Group()
	private batches = new Map<string, Batch>()
	private tufts: Tuft[] = []
	private rng = new BlizzardRandomizer()
	/** The effect of each cell of the chunk being built, row by row. */
	private cellEffects = new Array<GroundEffect | null>(CHUNK_CELLS * CHUNK_CELLS).fill(null)
	private m = new THREE.Matrix4()
	private q = new THREE.Quaternion()
	private p = new THREE.Vector3()
	private s = new THREE.Vector3()
	private up = new THREE.Vector3(0, 1, 0)
	private builtAt = new THREE.Vector2(Infinity, Infinity)
	private builtKey = ''
	private heightVersion = -1
	private paintVersion = -1
	private chunkDataVersion = -1
	private lastBuild = 0
	private assetsChanged = true
	private unsubscribe: () => void
	/** The cells that grow nothing (see blockedCells), rebuilt with the layer. */
	private blocked = new Uint8Array(0)
	/** How far from the camera (yd, flat) tufts are built: as far as the fade lets one show (`tuftReach`), set by the Engine. */
	reach = TUFT_FADE_FAR

	constructor(private terrain: Terrain) {
		this.group.name = 'groundEffects'
		this.unsubscribe = onAssetLoaded(() => (this.assetsChanged = true))
	}

	setTerrain(t: Terrain) {
		this.terrain = t
		this.heightVersion = -1
	}

	/**
	 * Keeps the tufts around `eye` current. `key` names everything else the build depends on (the
	 * palette, the map's own effects and the tables), so a change of any redraws. `frill` is the
	 * client's cells per chunk (`frillDensity`), and (`tileX`, `tileY`) the client tile at the map's
	 * north-west corner (a region's first tile, 0 for a map of its own), which seeds each chunk.
	 */
	update(
		eye: THREE.Vector3,
		palette: readonly string[],
		own: TextureEffects,
		tables: GroundEffectTables | null,
		key: string,
		now: number,
		objects: ObjectLayer,
		frill: number,
		scoped: ScopedEffects = noScopedEffects(),
		tileX = 0,
		tileY = 0,
	) {
		if (!this.group.visible || !tables) return
		this.syncTextures()
		const t = this.terrain
		const half = (CHUNK_CELLS * t.cellSize) / 2
		const moved = Math.abs(eye.x - this.builtAt.x) > half || Math.abs(eye.z - this.builtAt.y) > half
		const changed = t.heightVersion !== this.heightVersion || t.paintVersion !== this.paintVersion || t.chunkDataVersion !== this.chunkDataVersion || key !== this.builtKey || this.assetsChanged
		if (!moved && !changed) return
		if (now - this.lastBuild < REBUILD_MS) return
		this.lastBuild = now
		this.builtAt.set(eye.x, eye.z)
		this.builtKey = key
		this.heightVersion = t.heightVersion
		this.paintVersion = t.paintVersion
		this.chunkDataVersion = t.chunkDataVersion
		this.assetsChanged = false
		this.build(eye, palette, own, tables, objects, frill, scoped, tileX, tileY)
	}

	private build(eye: THREE.Vector3, palette: readonly string[], own: TextureEffects, tables: GroundEffectTables, objects: ObjectLayer, frill: number, scoped: ScopedEffects, tileX: number, tileY: number) {
		const t = this.terrain
		const cs = t.cellSize
		const cells = t.size
		if (this.blocked.length !== cells * cells) this.blocked = new Uint8Array(cells * cells)
		const blocked = blockedCells(t, objects, this.blocked)
		const r = this.reach
		const side = t.paintChunksPerSide
		const per = CHUNK_CELLS * cs
		const gx0 = Math.max(0, Math.floor((eye.x - r) / per))
		const gx1 = Math.min(side - 1, Math.floor((eye.x + r) / per))
		const gz0 = Math.max(0, Math.floor((eye.z - r) / per))
		const gz1 = Math.min(side - 1, Math.floor((eye.z + r) / per))
		for (const b of this.batches.values()) b.count = 0
		// The effect of each palette entry, looked up once per build.
		const effectOf = palette.map((p) => {
			const id = effectFor(p, own, tables)
			return id ? (tables.effects[id] ?? null) : null
		})
		// With zone or tile choices, a cell's effect depends on its chunk's zone and its tile too: looked up
		// once per texture, zone and tile in a build.
		const scopedOn = hasScopedEffects(scoped)
		const byScope = new Map<number, GroundEffect | null>()
		const cellEffects = this.cellEffects
		const r2 = r * r
		let total = 0
		for (let gz = gz0; gz <= gz1; gz++) {
			const nz = Math.min(Math.max(eye.z, gz * per), (gz + 1) * per) - eye.z
			for (let gx = gx0; gx <= gx1; gx++) {
				const nx = Math.min(Math.max(eye.x, gx * per), (gx + 1) * per) - eye.x
				if (nx * nx + nz * nz > r2) continue
				const area = t.areaIds[gz * side + gx]
				const tx = Math.floor(gx / TILE_CHUNKS)
				const tz = Math.floor(gz / TILE_CHUNKS)
				// Each cell's effect, by the texture that weighs most on it; none where it grows nothing.
				let any = false
				for (let row = 0; row < CHUNK_CELLS; row++) {
					const cz = gz * CHUNK_CELLS + row
					for (let col = 0; col < CHUNK_CELLS; col++) {
						const cx = gx * CHUNK_CELLS + col
						let effect: GroundEffect | null = null
						if (!blocked[cz * cells + cx] && !t.isHole((cx + 0.5) * cs, (cz + 0.5) * cs)) {
							const tex = cellTexture(t.weights, t.chunkSlots, t.splatRes, side, cx, cz)
							if (tex !== NO_TEXTURE) {
								effect = effectOf[tex]
								if (scopedOn) {
									const k = ((area * 64 + tz) * 64 + tx) * 256 + tex
									let e = byScope.get(k)
									if (e === undefined) {
										const id = effectAt(palette[tex] ?? '', own, scoped, area, tx, tz, tables)
										e = id ? (tables.effects[id] ?? null) : null
										byScope.set(k, e)
									}
									effect = e
								}
							}
						}
						if (effect && effect.doodads.length === 0) effect = null
						cellEffects[row * CHUNK_CELLS + col] = effect
						if (effect) any = true
					}
				}
				if (!any) continue
				const n = scatterChunk(this.rng, chunkSeed(tileX * TILE_CHUNKS + gx, tileY * TILE_CHUNKS + gz), frill, cellEffects, this.tufts)
				if (total + n > MAX_TUFTS) continue
				for (let i = 0; i < n; i++) {
					const tuft = this.tufts[i]
					const x = (gx * CHUNK_CELLS + (tuft.cell % CHUNK_CELLS) + tuft.u) * cs
					const z = (gz * CHUNK_CELLS + Math.floor(tuft.cell / CHUNK_CELLS) + tuft.v) * cs
					const dx = x - eye.x
					const dz = z - eye.z
					if (dx * dx + dz * dz > r2) continue
					const effect = cellEffects[tuft.cell] as GroundEffect
					this.place(effect.doodads[tuft.doodad], x, t.heightAt(x, z), z, tuft.rotY, tuft.scale)
				}
				total += n
			}
		}
		for (const [type, b] of this.batches) {
			b.mesh.count = b.count
			b.mesh.instanceMatrix.needsUpdate = true
			// The full set, for the room gate to pack from.
			b.full = (b.mesh.instanceMatrix.array as Float32Array).slice(0, b.count * 16)
			if (b.count === 0 && b.mesh.instanceMatrix.count > 4096) {
				// A model no longer in range gives its buffer back.
				this.group.remove(b.mesh)
				b.mesh.dispose()
				this.batches.delete(type)
			}
		}
	}

	private place(path: string, x: number, y: number, z: number, rotY: number, scale: number) {
		const type = 'm2:' + path
		const asset = getAsset(type)
		// A model still loading has nothing to draw yet; it is built in when it arrives.
		if (!asset.ready) return
		let b = this.batches.get(type)
		if (!b || b.mesh.geometry !== asset.geometry) {
			if (b) {
				this.group.remove(b.mesh)
				b.mesh.dispose()
			}
			b = { mesh: this.makeMesh(asset.geometry, asset.material, 1024), count: 0 }
			this.batches.set(type, b)
		}
		if (b.count >= b.mesh.instanceMatrix.count) {
			const bigger = this.makeMesh(asset.geometry, asset.material, b.mesh.instanceMatrix.count * 2)
			bigger.instanceMatrix.array.set(b.mesh.instanceMatrix.array)
			this.group.remove(b.mesh)
			b.mesh.dispose()
			b.mesh = bigger
		}
		this.q.setFromAxisAngle(this.up, rotY)
		this.m.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale))
		b.mesh.setMatrixAt(b.count++, this.m)
	}

	private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number): THREE.InstancedMesh {
		const m = new THREE.InstancedMesh(geometry, Array.isArray(material) ? material.map(tuftMaterial) : tuftMaterial(material), capacity)
		m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
		// The instances spread over the whole range; three's per-mesh sphere would cull them wrongly.
		m.frustumCulled = false
		m.castShadow = false
		m.receiveShadow = true
		m.count = 0
		this.group.add(m)
		return m
	}

	/** Gives each tuft twin its model's texture, which may arrive after the twin was made. */
	private syncTextures() {
		for (const [type, b] of this.batches) {
			const src = getAsset(type).material
			const twins = b.mesh.material
			if (!Array.isArray(src) || !Array.isArray(twins)) {
				if (!Array.isArray(src) && !Array.isArray(twins)) syncMap(src, twins)
				continue
			}
			for (let i = 0; i < src.length && i < twins.length; i++) syncMap(src[i], twins[i])
		}
	}

	/**
	 * With the camera in a WMO room (#119), draws only the tufts within one of `frustums` (its
	 * doorways), packed from the last build's full set; null draws them all again.
	 */
	gate(frustums: THREE.Frustum[] | null) {
		if (!frustums && !this.gated) return
		this.gated = !!frustums
		for (const b of this.batches.values()) {
			const full = b.full
			if (!full) continue
			const arr = b.mesh.instanceMatrix.array as Float32Array
			if (!frustums) {
				arr.set(full)
				b.mesh.count = full.length / 16
			} else {
				let k = 0
				for (let i = 0; i < full.length; i += 16) {
					this.gateSphere.center.set(full[i + 12], full[i + 13], full[i + 14])
					let seen = false
					for (let f = 0; !seen && f < frustums.length; f++) seen = frustums[f].intersectsSphere(this.gateSphere)
					if (!seen) continue
					if (k !== i) for (let j = 0; j < 16; j++) arr[k + j] = full[i + j]
					k += 16
				}
				b.mesh.count = k / 16
			}
			b.mesh.instanceMatrix.needsUpdate = true
		}
	}

	private gated = false
	/** A tuft's reach for the gate: a sphere about its foot. */
	private gateSphere = new THREE.Sphere(new THREE.Vector3(), 1.5)

	/** How many tufts are drawn now. */
	get count(): number {
		let n = 0
		for (const b of this.batches.values()) n += b.count
		return n
	}

	/** Adds the models of the tufts built now to `into` (#505: what a closed map lets go of). */
	modelTypes(into: Set<string>): Set<string> {
		for (const t of this.batches.keys()) into.add(t)
		return into
	}

	dispose() {
		this.unsubscribe()
		for (const b of this.batches.values()) {
			this.group.remove(b.mesh)
			b.mesh.dispose()
		}
		this.batches.clear()
	}
}

/** Copies a material's texture to its twin when it changed. */
function syncMap(src: THREE.Material, twin: THREE.Material) {
	const a = src as THREE.MeshLambertMaterial
	const b = twin as THREE.MeshLambertMaterial
	if (a.map !== b.map) {
		b.map = a.map
		b.needsUpdate = true
	}
}
