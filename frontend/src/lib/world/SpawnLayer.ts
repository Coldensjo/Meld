import * as THREE from 'three'
import { vmangos } from '../../../wailsjs/go/models'
import { getAsset, isWowType, onAssetLoaded } from '../models/assets'
import { spawnType } from './spawnInfo'
import type { CullView } from './instanceCull'
import { InstanceBatch, instancedMesh } from './instanceBatch'
import { packedCount } from './shadowReach'
import { firstPick } from './instanceHit'
import { meshTriangles, type ModelCost } from '../engine/perfMeter'
import { spawnQuaternion } from './spawnTilt'
import { SpawnChanges } from './spawnChanges'

/** The spawns of one kind and model, and what's needed to draw the ones in view. */
interface SpawnBatch {
	/** Every spawn of the batch (`rows.items`) with its matrix and sphere, and the ones in view. */
	rows: InstanceBatch<vmangos.WorldSpawn>
	mesh: THREE.InstancedMesh
	/** The spawn drawn by each instance, by instance index (the mesh's `userData.ids`, for picking). */
	ids: vmangos.WorldSpawn[]
	/** Rows rewritten since the last cull (`refresh`), written in place when the packing stays the same (#697). */
	moved: number[]
	kind: SpawnKind
	/** The spawn type every spawn of the batch has, or 'cone' and 'invisible' for the markers. */
	type: string
	ready: boolean
}

export type SpawnKind = 'monster' | 'npc' | 'object'

/** Marker colours, by kind: red monsters, green NPCs, yellow objects. */
export const SPAWN_COLORS: Record<SpawnKind, number> = {
	monster: 0xe0533d,
	npc: 0x4cc56b,
	object: 0xe8c547,
}

const KINDS: SpawnKind[] = ['monster', 'npc', 'object']

/** A spawn's key: its kind and guid, unique within a region. */
export const spawnKey = (s: { kind: string; guid: number }) => `${s.kind}/${s.guid}`

/** A copy of a spawn that edits of the original can't reach. */
export const cloneSpawn = (s: vmangos.WorldSpawn): vmangos.WorldSpawn => vmangos.WorldSpawn.createFrom(JSON.parse(JSON.stringify(s)))

/**
 * The three.js rotation about Y for a server facing. The server's orientation is measured from its
 * +X axis (north) towards +Y (west). Server +X is the editor's -Z and +Y is -X, and a model faces
 * +X in the editor at rest, so facing 0 needs a quarter turn: +X onto -Z.
 */
export function spawnRotation(orientation: number): number {
	return orientation + Math.PI / 2
}

/** The server facing that turns a model to three.js rotation `rotY`, in [0, 2π). */
export function spawnOrientation(rotY: number): number {
	const o = (rotY - Math.PI / 2) % (2 * Math.PI)
	return o < 0 ? o + 2 * Math.PI : o
}

const tmpQ = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()
const tmpPos = new THREE.Vector3()
const eachM = new THREE.Matrix4()
const buildM = new THREE.Matrix4()
const refreshM = new THREE.Matrix4()

/** A spawn's instance matrix: a model turns to the spawn's rotation and takes its size; a cone points up. */
export function spawnMatrix(s: vmangos.WorldSpawn, model: boolean, out: THREE.Matrix4) {
	tmpPos.set(s.x, s.y, s.z)
	if (model) spawnQuaternion(s, tmpQ)
	else tmpQ.identity()
	const k = model && s.scale > 0 ? s.scale : 1
	return out.compose(tmpPos, tmpQ, tmpScale.set(k, k, k))
}

/**
 * The creatures and game objects a region's world database places. Each spawn shows its client
 * model, one instanced mesh per model and kind, as objects are drawn. A spawn whose model is still
 * loading (or failed to load) shows a coloured cone at its spawn point instead, so nothing draws as
 * the loader's placeholder box. A spawn with no model at all (a display of none, such as the damage
 * trap in a campfire) is invisible in the game too, and shows as a small wireframe diamond, so a
 * cone stands out as a model that hasn't come (#140).
 *
 * Spawns can be edited: `touch` keeps a spawn's database state before its first edit, so `edits`
 * can list what changed for the world database (see world/spawnEdits.ts).
 */
export class SpawnLayer {
	readonly group = new THREE.Group()
	/** The spawns drawn now, in the region's coordinates. */
	spawns: vmangos.WorldSpawn[] = []
	private batches: SpawnBatch[] = []
	/** Where each spawn is drawn: its batch, its index in it, and its spawn type when it was drawn. */
	private where = new Map<vmangos.WorldSpawn, { batch: SpawnBatch; i: number; type: string }>()
	private keys = new Map<string, vmangos.WorldSpawn>()
	private readonly cone = new THREE.ConeGeometry(1.2, 4, 6).translate(0, 2, 0)
	private readonly coneMaterials = new Map<SpawnKind, THREE.MeshBasicMaterial>(KINDS.map((k) => [k, new THREE.MeshBasicMaterial({ color: SPAWN_COLORS[k] })]))
	private readonly invisible = new THREE.OctahedronGeometry(0.8).translate(0, 1, 0)
	private readonly invisibleMaterials = new Map<SpawnKind, THREE.MeshBasicMaterial>(KINDS.map((k) => [k, new THREE.MeshBasicMaterial({ color: SPAWN_COLORS[k], wireframe: true })]))
	// A model that loads is noted, and the next cull redraws only the batches it changes (`regroup`):
	// a map's models load in bursts, and each used to rebuild every batch (#329).
	private readonly unsubscribe = onAssetLoaded((type) => {
		if (this.types.has(type)) this.loaded.add(type)
	})
	/** Model types that loaded since the last cull or rebuild. */
	private loaded = new Set<string>()
	private types = new Set<string>()
	private shown: Record<SpawnKind, boolean> = { monster: true, npc: true, object: true }
	/** The world events whose spawns are drawn (`prefs.shownEvents`). */
	private events = new Set<number>()
	/** Bumped whenever what is drawn changes (spawns, their loaded models or the kinds shown). */
	version = 0
	/**
	 * The spawns `refresh` moved or changed in place, oldest first. `version` stays put for these, so a
	 * drag move doesn't make every consumer rebuild: each reads `movedSince` with the `moveSeq` it saw.
	 */
	private moveLog: vmangos.WorldSpawn[] = []
	private moveBase = 0
	/** Counts the in-place changes; with `version` it tells whether anything about the spawns changed. */
	get moveSeq(): number {
		return this.moveBase + this.moveLog.length
	}
	/** Whether the membership, the models or anything in place changed: `version` plus the moves. */
	get changeStamp(): number {
		return this.version + this.moveSeq
	}
	/** The spawns changed in place since `seq` (a `moveSeq`), or null when the log no longer reaches back that far. */
	movedSince(seq: number): readonly vmangos.WorldSpawn[] | null {
		if (seq < this.moveBase) return null
		return this.moveLog.slice(seq - this.moveBase)
	}

	/** The database state of each spawn edited since the last save, by key, as it was read. */
	private originals = new Map<string, vmangos.WorldSpawn>()
	/** Keys of spawns added in the editor, and the database spawns deleted since the last save. */
	private created = new Set<string>()
	private deleted = new Map<string, vmangos.WorldSpawn>()
	/** Which spawns differ from their original, compared only for those marked since the last count. */
	private changes = new SpawnChanges<vmangos.WorldSpawn>()

	/** Replaces the drawn spawns, and starts loading their models. Forgets every edit. */
	set(spawns: vmangos.WorldSpawn[]) {
		if (this.disposed) return
		this.spawns = spawns
		this.keys = new Map(spawns.map((s) => [spawnKey(s), s]))
		this.originals.clear()
		this.created.clear()
		this.deleted.clear()
		this.changes.clear()
		this.retype()
		this.rebuild()
	}

	/** How many `batch` calls are running, and whether one of their changes still needs the layer redrawn. */
	private holds = 0
	private stale = false

	/** Whether a `batch` is running, which redraws the layer once at its end rather than after each change. */
	get batching(): boolean {
		return this.holds > 0
	}

	/**
	 * Runs `fn`, whose adds and removes redraw the layer once afterwards instead of each time: a redraw
	 * walks every spawn, so undoing a stroke of N spawns took N redraws (#193).
	 */
	batch(fn: () => void) {
		this.holds++
		try {
			fn()
		} finally {
			if (--this.holds === 0 && this.stale) {
				this.stale = false
				this.retype()
				this.rebuild()
			}
		}
	}

	/** Redraws the layer after the spawns changed, or marks it to be at the end of the running `batch`. */
	private redraw() {
		if (this.holds > 0) {
			this.stale = true
			return
		}
		this.retype()
		this.rebuild()
	}

	private retype() {
		this.types = new Set(this.spawns.map((s) => spawnType(s)).filter((t) => t !== ''))
		for (const t of this.types) getAsset(t)
	}

	/** The spawn with key `key`, as drawn. */
	get(key: string): vmangos.WorldSpawn | undefined {
		return this.keys.get(key)
	}

	/** Adds the model types of the spawns to `into` (#505: what a closed map lets go of). */
	modelTypes(into: Set<string>): Set<string> {
		for (const t of this.types) into.add(t)
		return into
	}

	/** Whether any spawn uses the model `type`. */
	hasType(type: string): boolean {
		return this.types.has(type)
	}

	/** The model types the last cull drew (of a kind shown, with a spawn in view). */
	private drawn = new Set<string>()

	/**
	 * Whether the last cull drew a spawn of model `type`. The cull keeps what lies in a shadow camera's
	 * frustum too, so a spawn just off screen that throws a shadow into view counts (#328).
	 */
	drawsType(type: string): boolean {
		return this.drawn.has(type)
	}

	/** Shows the kinds that are `true` and hides the rest; the choice holds across rebuilds. */
	setKinds(shown: Record<SpawnKind, boolean>) {
		this.shown = { ...shown }
		this.applyKinds()
	}

	/** Shows the spawns of the world events `ids` (and hides the ones they take away); the rest are left out. */
	setEvents(ids: readonly number[]) {
		if (ids.length === this.events.size && ids.every((id) => this.events.has(id))) return
		this.events = new Set(ids)
		this.rebuild()
	}

	/** Whether a spawn shows with the world events shown: one of its events is, and none that takes it away. */
	eventShown(s: vmangos.WorldSpawn): boolean {
		const ev = s.events
		if (!ev?.length) return true
		let during = false
		let spawns = false
		for (const e of ev) {
			if (e < 0 && this.events.has(-e)) return false
			if (e > 0) {
				spawns = true
				if (this.events.has(e)) during = true
			}
		}
		return during || !spawns
	}

	private applyKinds() {
		// An empty mesh is hidden too: three would still set up each of its groups in every pass (#323).
		for (const b of this.batches) b.mesh.visible = this.shown[b.kind] && packedCount(b.mesh) > 0
		this.version++
	}

	/** The spawn under the ray, nearest first, among the kinds shown; null when none is. */
	pick(raycaster: THREE.Raycaster): vmangos.WorldSpawn | null {
		return this.pickHit(raycaster)?.spawn ?? null
	}

	/** The spawn under the ray and how far along the ray it was hit, or null. */
	pickHit(raycaster: THREE.Raycaster): { spawn: vmangos.WorldSpawn; distance: number } | null {
		const meshes: THREE.Object3D[] = []
		for (const b of this.batches) if (b.mesh.visible && b.mesh.count > 0) meshes.push(b.mesh)
		const hit = firstPick<vmangos.WorldSpawn>(raycaster.intersectObjects(meshes, false))
		return hit ? { spawn: hit.id, distance: hit.distance } : null
	}

	/** What each spawn type drew in the last cull, and how many instanced meshes there are (#179). */
	drawnCosts(out: ModelCost[]): number {
		for (const b of this.batches) out.push({ type: b.type, triangles: meshTriangles(b.mesh), instances: b.mesh.visible ? b.mesh.count : 0 })
		return this.batches.length
	}

	/** Draws only the spawns in `view`, packed to the front of each batch's instance buffer. Call once per frame. */
	cull(view: CullView) {
		if (this.loaded.size) this.regroup()
		this.drawn.clear()
		for (const b of this.batches) {
			if (b.rows.cull(view)) {
				b.rows.pack(b.mesh, b.ids)
				b.mesh.visible = this.shown[b.kind] && packedCount(b.mesh) > 0
			} else if (b.moved.length) b.rows.patch(b.mesh, b.moved)
			b.moved.length = 0
			if (b.mesh.visible && b.ready) this.drawn.add(b.type)
		}
	}

	/** Calls `fn` for each spawn the last cull drew: of a kind shown, in view and through a room's doorways. */
	forEachDrawn(fn: (s: vmangos.WorldSpawn) => void) {
		for (const b of this.batches) {
			if (!b.mesh.visible) continue
			for (let k = 0; k < b.mesh.count; k++) fn(b.ids[k])
		}
	}

	/** Counts of the spawns drawn, by kind. */
	counts(): Record<SpawnKind, number> {
		const out: Record<SpawnKind, number> = { monster: 0, npc: 0, object: 0 }
		for (const s of this.spawns) out[s.kind as SpawnKind]++
		return out
	}

	/**
	 * Keeps a spawn's database state before it is first edited. Call before changing a spawn, then
	 * `refresh` it.
	 */
	touch(s: vmangos.WorldSpawn) {
		const key = spawnKey(s)
		if (!this.originals.has(key)) this.originals.set(key, cloneSpawn(s))
		this.changes.mark(key)
	}

	/**
	 * Calls `fn` for each spawn drawn with its model (of a kind shown): its key, model type and
	 * instance matrix (one matrix, reused between calls).
	 */
	forEachModel(fn: (key: string, type: string, m: THREE.Matrix4) => void) {
		for (const b of this.batches) {
			if (!b.ready || !this.shown[b.kind]) continue
			for (const s of b.rows.items) fn(spawnKey(s), b.type, spawnMatrix(s, true, eachM))
		}
	}

	/**
	 * The world-space box of a spawn's drawn model (or its marker cone while the model loads), for
	 * the selection handles. Null for a spawn that is not drawn.
	 */
	boundsOf(s: vmangos.WorldSpawn, out: THREE.Box3): THREE.Box3 | null {
		const at = this.where.get(s)
		if (!at) return null
		const g = at.batch.mesh.geometry
		if (!g.boundingBox) g.computeBoundingBox()
		return out.copy(g.boundingBox!).applyMatrix4(spawnMatrix(s, at.batch.ready, refreshM))
	}

	/** Redraws a spawn after it moved, turned or changed its look. */
	refresh(s: vmangos.WorldSpawn) {
		this.changes.mark(spawnKey(s))
		const at = this.where.get(s)
		if (!at || at.type !== spawnType(s)) {
			this.redraw()
			return
		}
		at.batch.rows.setRow(at.i, spawnMatrix(s, at.batch.ready, refreshM), at.batch.mesh.geometry)
		// The next cull writes the row in place, or packs it with the rest if the spawns in view changed.
		at.batch.moved.push(at.i)
		if (this.moveLog.length >= 4096) {
			this.moveBase += this.moveLog.length
			this.moveLog.length = 0
		}
		this.moveLog.push(s)
	}

	/**
	 * The model type and instance matrix a spawn is drawn with (written to `out`), or null when it is
	 * not drawn with its model (a marker, or a kind not shown).
	 */
	modelOf(s: vmangos.WorldSpawn, out: THREE.Matrix4): string | null {
		const at = this.where.get(s)
		if (!at || !at.batch.ready || !this.shown[at.batch.kind]) return null
		spawnMatrix(s, true, out)
		return at.batch.type
	}

	/**
	 * Changes a spawn the way the world database already has it (its creature template was saved),
	 * so the change is not an edit to save: its saved state changes with it.
	 */
	rebase(s: vmangos.WorldSpawn, vals: Partial<vmangos.WorldSpawn>) {
		Object.assign(s, vals)
		const o = this.originals.get(spawnKey(s))
		if (o) Object.assign(o, vals)
		this.refresh(s)
	}

	/**
	 * Adds a spawn made in the editor. `original` is what it was when placed, which the world
	 * database is told of with it.
	 */
	add(s: vmangos.WorldSpawn) {
		const key = spawnKey(s)
		this.spawns.push(s)
		this.keys.set(key, s)
		if (this.deleted.has(key)) {
			// Deleted and added back (an undo): it is the database's spawn again.
			this.deleted.delete(key)
			this.changes.mark(key)
		} else if (!this.originals.has(key)) {
			this.created.add(key)
			this.originals.set(key, cloneSpawn(s))
		}
		this.changes.mark(key)
		this.redraw()
	}

	/** Removes a spawn; one the database has is deleted from it on save. */
	remove(s: vmangos.WorldSpawn) {
		const key = spawnKey(s)
		const i = this.spawns.indexOf(s)
		if (i < 0) return
		this.spawns.splice(i, 1)
		this.keys.delete(key)
		this.changes.mark(key)
		if (!this.created.has(key)) this.deleted.set(key, this.originals.get(key) ?? cloneSpawn(s))
		this.redraw()
	}

	/** Compares the spawns touched since the last call with their originals, and only those. */
	private settle() {
		this.changes.settle(
			(k) => this.keys.get(k),
			(k) => this.originals.get(k),
			(k) => this.created.has(k),
		)
	}

	/** How many edits `edits()` would return, without building them. */
	editCount(): number {
		this.settle()
		return this.changes.size + this.deleted.size
	}

	/** The edits to tell the world database of: changed, added and deleted spawns. */
	edits(): vmangos.SpawnEdit[] {
		this.settle()
		const out: vmangos.SpawnEdit[] = []
		for (const [key, original] of this.originals) {
			if (!this.changes.has(key)) continue
			const s = this.keys.get(key)!
			const created = this.created.has(key)
			out.push(vmangos.SpawnEdit.createFrom({ spawn: s, original, created, deleted: false }))
		}
		for (const original of this.deleted.values()) {
			out.push(vmangos.SpawnEdit.createFrom({ spawn: original, original, created: false, deleted: true }))
		}
		return out
	}

	/** The world database now has every edit: they become the spawns' saved state. */
	markSaved() {
		this.originals.clear()
		this.created.clear()
		this.deleted.clear()
		this.changes.clear()
	}

	private rebuild() {
		if (this.disposed) return
		this.version++
		this.clearMeshes()
		this.loaded.clear()
		this.build(this.spawns)
		this.applyKinds()
	}

	/**
	 * Redraws the batches the models in `loaded` change: their own (a model loaded again) and the
	 * markers that hold a spawn of one, whose spawns are grouped again. The rest are kept as they are.
	 */
	private regroup() {
		const loaded = this.loaded
		const redo = new Set<SpawnBatch>()
		for (const b of this.batches) {
			if (loaded.has(b.type)) redo.add(b)
			else if (!b.ready && b.type === 'cone') {
				for (const s of b.rows.items) {
					if (loaded.has(this.where.get(s)?.type ?? '')) {
						redo.add(b)
						break
					}
				}
			}
		}
		loaded.clear()
		if (!redo.size) return
		const spawns: vmangos.WorldSpawn[] = []
		for (const b of redo) {
			for (const s of b.rows.items) spawns.push(s)
			this.group.remove(b.mesh)
			b.mesh.dispose()
		}
		this.batches = this.batches.filter((b) => !redo.has(b))
		this.build(spawns)
		this.applyKinds()
	}

	/** Groups `spawns` (none of them in a batch) into new batches by kind and model, and adds them. */
	private build(spawns: vmangos.WorldSpawn[]) {
		// Group the spawns by kind and model; a spawn with a ready model joins that model's batch.
		const batches = new Map<string, { kind: SpawnKind; type: string; items: vmangos.WorldSpawn[]; types: string[] }>()
		for (const s of spawns) {
			// A spawn of a world event that isn't shown is left out of the batches, so nothing draws, picks or names it.
			if (!this.eventShown(s)) continue
			const type = spawnType(s)
			const asset = type && isWowType(type) ? getAsset(type) : null
			const ready = asset?.ready === true
			const marker = type === '' ? 'invisible' : 'cone'
			const key = ready ? `${s.kind}|${type}` : `${s.kind}|${marker}`
			let b = batches.get(key)
			if (!b) {
				b = { kind: s.kind as SpawnKind, type: ready ? type : marker, items: [], types: [] }
				batches.set(key, b)
			}
			b.items.push(s)
			b.types.push(type)
		}
		const m = buildM
		for (const b of batches.values()) {
			const invisible = b.type === 'invisible'
			const asset = b.type !== 'cone' && !invisible ? getAsset(b.type) : null
			const ready = asset?.ready === true
			const geometry = ready ? asset.geometry : invisible ? this.invisible : this.cone
			// A model the game draws nothing of (#333) is its hull in the kind's wireframe, as a spawn with no model is.
			const marker = ready && !!asset.marker
			const material = ready && !marker ? asset.material : (invisible || marker ? this.invisibleMaterials : this.coneMaterials).get(b.kind)!
			// Nothing is drawn until the first cull packs the spawns in view.
			const ids: vmangos.WorldSpawn[] = []
			const mesh = instancedMesh(geometry, material, b.items.length, ready ? asset.skeleton : null, ids)
			mesh.castShadow = ready && !marker
			mesh.receiveShadow = ready && !marker
			const rows = new InstanceBatch<vmangos.WorldSpawn>()
			rows.items = b.items
			rows.reserve(b.items.length)
			const batch: SpawnBatch = { rows, mesh, ids, moved: [], kind: b.kind, type: b.type, ready }
			b.items.forEach((s, i) => {
				rows.setRow(i, spawnMatrix(s, ready, m), geometry)
				this.where.set(s, { batch, i, type: b.types[i] })
			})
			this.batches.push(batch)
			this.group.add(mesh)
		}
	}

	private clearMeshes() {
		for (const b of this.batches) {
			this.group.remove(b.mesh)
			// Shared model geometry and materials belong to the asset loader; only the instances are freed.
			b.mesh.dispose()
		}
		this.batches = []
		this.where.clear()
	}

	/** Set by dispose: a late set (a database read that outlived its tab) then draws and loads nothing. */
	private disposed = false

	dispose() {
		this.disposed = true
		this.unsubscribe()
		this.clearMeshes()
		this.cone.dispose()
		for (const m of this.coneMaterials.values()) m.dispose()
		this.invisible.dispose()
		for (const m of this.invisibleMaterials.values()) m.dispose()
	}
}
