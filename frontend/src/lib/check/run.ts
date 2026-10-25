// File › Check Map (#176): gathers the open map's models, spawns, chunks and liquids for the checks in
// this folder, gives them the probes they ask for (ground, slope, water, floors, walls), and runs them
// one at a time, yielding between them so a big region never freezes the editor.
import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer } from '../world/ObjectLayer'
import type { SpawnLayer } from '../world/SpawnLayer'
import { spawnKey } from '../world/SpawnLayer'
import type { LiquidMap } from '../water/liquids'
import { getAsset, displayName } from '../models/assets'
import { isHelper } from '../models/helpers'
import { groundSlopeDeg } from '../world/groundTilt'
import { CHUNK_CELLS } from '../terrain/chunkPaint'
import type { Box, Finding } from './findings'
import { checkDuplicateModels, checkModelHeights, type CheckModel } from './models'
import { checkPaths, checkSpawnIds, checkSpawns, checkSpawnsInModels, type CheckSpawn, type IdReport, type IdSpawn, type SpawnProbes } from './spawns'
import { checkHiddenWater, checkPalette, checkRegionEdges, checkZones, type EdgeSegment } from './terrainChecks'

export interface CheckInput {
	terrain: Terrain
	objects: ObjectLayer
	spawns: SpawnLayer
	liquids: LiquidMap
	palette: readonly string[]
	/** The sea's level, or null without a sea. */
	sea: number | null
	/** The steepest walkable slope, in degrees. */
	maxSlope: number
	/** Whether the client has a texture (lowercase path); null when the client's list isn't read. */
	knownTexture: ((path: string) => boolean) | null
	/** Whether the client's AreaTable has an area; null when it isn't read. */
	knownArea: ((id: number) => boolean) | null
	/** The client's border rows of the tiles around a region; null for a map of its own or when unread. */
	edges: EdgeSegment[] | null
	/** Asks the world database what it has under the unsaved spawns' guids and entries; null without a server. */
	spawnIds: ((q: SpawnIdQuery) => Promise<IdReport>) | null
	/** Says what runs now, for the status bar. */
	progress?: (what: string) => void
}

/** The guids of the created spawns and the entries of every unsaved one, by kind (Go's `vmangos.SpawnIDQuery`). */
export interface SpawnIdQuery {
	creatureGuids: number[]
	objectGuids: number[]
	creatureEntries: number[]
	objectEntries: number[]
}

/** The six ways the inside test looks from a creature's chest. */
const AROUND: ReadonlyArray<[number, number, number]> = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 0, 1],
	[0, 0, -1],
	[0, 1, 0],
	[0, -1, 0],
]
/** How many of them must meet the model from behind for the point to be inside it: a gap or two (a hollow log's ends) still counts. */
const INSIDE_HITS = 5

/** How deep a liquid must be over the ground for a creature on the bottom to be in deep water (yards). */
const DEEP = 2
/** Model boxes are bucketed on a grid this many yards wide, for the floor and wall probes. */
const BUCKET = 32

/** A turn for the editor between checks: a message, not a timeout, which a hidden window throttles. */
const yieldTurn = () =>
	new Promise<void>((done) => {
		const ch = new MessageChannel()
		ch.port1.onmessage = () => done()
		ch.port2.postMessage(0)
	})

/** Runs every check on the map and returns the findings, worst first within each check. */
export async function runMapChecks(input: CheckInput): Promise<{ findings: Finding[]; unchecked: number }> {
	const { terrain: t, objects, progress } = input
	const ground = (x: number, z: number) => (t.contains(x, z) && !t.isHole(x, z) ? t.heightAt(x, z) : -Infinity)

	progress?.('models')
	const models: CheckModel[] = []
	const m = new THREE.Matrix4()
	const b3 = new THREE.Box3()
	let unchecked = 0
	for (const o of objects.objects.values()) {
		if (isHelper(o.type)) continue
		const asset = getAsset(o.type)
		let box: Box | null = null
		if (asset.ready) {
			b3.copy(asset.bbox).applyMatrix4(objects.matrixOf(o, m))
			box = { min: [b3.min.x, b3.min.y, b3.min.z], max: [b3.max.x, b3.max.y, b3.max.z] }
		} else unchecked++
		const w = objects.worldPosition(o, new THREE.Vector3())
		models.push({ id: o.id, type: o.type, name: displayName(o.type), parent: o.parent, x: o.parent === undefined ? o.x : w.x, z: o.parent === undefined ? o.z : w.z, yOff: o.yOff, rotY: o.rotY, scale: o.scale, box })
	}
	// A foot within a yard and a half of a liquid's surface or the sea floats on it.
	const onWater = (x: number, y: number, z: number) => (input.sea !== null && Math.abs(y - input.sea) < 1.5) || (input.liquids.covers(x, z, t.cellSize, y - 1.5) && !input.liquids.covers(x, z, t.cellSize, y + 1.5))
	const findings: Finding[] = [...checkDuplicateModels(models), ...checkModelHeights(models, ground, onWater)]
	await yieldTurn()

	// The probes for the spawns: floors and walls through the models' own bounds trees, so what is off
	// screen counts too (an instanced mesh only holds the instances in view).
	const grid = new Map<string, number[]>()
	const wmos = new Set<number>()
	for (const md of models) {
		if (!md.box) continue
		if (md.type.startsWith('wmo:')) wmos.add(md.id)
		const b = md.box
		for (let gx = Math.floor(b.min[0] / BUCKET); gx <= Math.floor(b.max[0] / BUCKET); gx++) {
			for (let gz = Math.floor(b.min[2] / BUCKET); gz <= Math.floor(b.max[2] / BUCKET); gz++) {
				const k = `${gx},${gz}`
				let list = grid.get(k)
				if (!list) grid.set(k, (list = []))
				list.push(md.id)
			}
		}
	}
	const boxes = new Map(models.filter((md) => md.box).map((md) => [md.id, md.box!]))
	const ray = new THREE.Ray()
	const ids: number[] = []
	const near = (x0: number, z0: number, x1: number, z1: number, only?: Set<number>) => {
		ids.length = 0
		const seen = new Set<number>()
		for (let gx = Math.floor(Math.min(x0, x1) / BUCKET); gx <= Math.floor(Math.max(x0, x1) / BUCKET); gx++) {
			for (let gz = Math.floor(Math.min(z0, z1) / BUCKET); gz <= Math.floor(Math.max(z0, z1) / BUCKET); gz++) {
				for (const id of grid.get(`${gx},${gz}`) ?? []) {
					if (seen.has(id) || (only && !only.has(id))) continue
					seen.add(id)
					ids.push(id)
				}
			}
		}
		return ids
	}
	const probes: SpawnProbes = {
		ground,
		slope: (x, z) => groundSlopeDeg((px, pz) => t.heightAt(px, pz), x, z, t.cellSize),
		deepWater: (x, z, g) => (input.sea !== null && input.sea - g > DEEP) || input.liquids.covers(x, z, t.cellSize, g + DEEP),
		floorNear: (x, y, z) => {
			const list = near(x, z, x, z).filter((id) => {
				const b = boxes.get(id)!
				return b.min[0] <= x && b.max[0] >= x && b.min[2] <= z && b.max[2] >= z && b.min[1] <= y + 1 && b.max[1] >= y - 4
			})
			if (!list.length) return false
			ray.origin.set(x, y + 1, z)
			ray.direction.set(0, -1, 0)
			const hit = objects.raycastAmong(ray, list, list.length)
			return !!hit && hit.distance <= 5
		},
		wallBetween: (a, b) => {
			const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
			if (len < 0.01) return false
			const list = near(a.x, a.z, b.x, b.z, wmos)
			if (!list.length) return false
			ray.origin.set(a.x, a.y + 1.5, a.z)
			ray.direction.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize()
			const hit = objects.raycastAmong(ray, list, list.length)
			return !!hit && hit.distance < len
		},
	}

	progress?.('creatures and objects')
	const spawns: CheckSpawn[] = input.spawns.spawns.map((s) => ({ key: spawnKey(s), name: s.name || `#${s.entry}`, kind: s.kind, x: s.x, y: s.y, z: s.z, path: s.pathFromTemplate ? undefined : s.waypoints }))
	findings.push(...checkSpawns(spawns, probes, input.maxSlope, t.cellSize))
	await yieldTurn()
	progress?.('paths')
	findings.push(...checkPaths(spawns, probes, t.cellSize))
	await yieldTurn()

	// Inside a solid model: from inside a closed mesh every way out meets a face from behind. Buildings
	// are left out, as their rooms hold creatures, and so are models still loading.
	progress?.('spawns inside models')
	const inside = (x: number, y: number, z: number): string | null => {
		for (const id of near(x, z, x, z)) {
			if (wmos.has(id)) continue
			const b = boxes.get(id)!
			if (x < b.min[0] || x > b.max[0] || y < b.min[1] || y > b.max[1] || z < b.min[2] || z > b.max[2]) continue
			let back = 0
			for (const [dx, dy, dz] of AROUND) {
				ray.origin.set(x, y, z)
				ray.direction.set(dx, dy, dz)
				if (objects.raycastModel(ray, id)?.back) back++
			}
			if (back >= INSIDE_HITS) return models.find((md) => md.id === id)?.name ?? 'a model'
		}
		return null
	}
	findings.push(...checkSpawnsInModels(spawns, inside))
	await yieldTurn()

	if (input.spawnIds) {
		progress?.('spawn guids and entries')
		const edits = input.spawns.edits().filter((e) => !e.deleted)
		const ids: IdSpawn[] = edits.map((e) => ({ key: spawnKey(e.spawn), name: e.spawn.name || `#${e.spawn.entry}`, kind: e.spawn.kind, guid: e.spawn.guid, entry: e.spawn.entry, created: e.created, x: e.spawn.x, z: e.spawn.z }))
		if (ids.length) {
			const of = (obj: boolean) => ids.filter((s) => (s.kind === 'object') === obj)
			try {
				const report = await input.spawnIds({
					creatureGuids: of(false)
						.filter((s) => s.created)
						.map((s) => s.guid),
					objectGuids: of(true)
						.filter((s) => s.created)
						.map((s) => s.guid),
					creatureEntries: of(false).map((s) => s.entry),
					objectEntries: of(true).map((s) => s.entry),
				})
				findings.push(...checkSpawnIds(ids, report))
			} catch (err) {
				findings.push({ check: 'Spawn guids taken', severity: 'info', message: `The world database could not be asked about the unsaved spawns: ${err}`, x: NaN, z: NaN, target: { kind: 'none' } })
			}
		}
	}

	if (input.edges) {
		progress?.('region edges')
		findings.push(...checkRegionEdges(input.edges, t.heights, t.verts, t.cellSize))
	}

	progress?.('zones, textures and water')
	const side = t.paintChunksPerSide
	const chunkWorld = CHUNK_CELLS * t.cellSize
	findings.push(...checkZones(t.areaIds, side, chunkWorld, input.knownArea))
	findings.push(...checkPalette(input.palette, t.chunkSlots, input.knownTexture, (c) => ({ x: ((c % side) + 0.5) * chunkWorld, z: (Math.floor(c / side) + 0.5) * chunkWorld })))
	const V = t.verts
	findings.push(
		...checkHiddenWater(
			input.liquids.side,
			(c) => input.liquids.layers(c),
			(gx, gz) => t.heights[Math.min(V - 1, gz) * V + Math.min(V - 1, gx)],
			chunkWorld,
		),
	)

	const rank = { error: 0, warning: 1, info: 2 }
	findings.sort((a, b) => a.check.localeCompare(b.check) || rank[a.severity] - rank[b.severity])
	return { findings, unchecked }
}
