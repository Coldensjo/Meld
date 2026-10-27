import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer, WorldObject } from '../world/ObjectLayer'
import type { Command } from '../state/history'
import { TerrainStroke } from '../tools/brush'
import { groupTransformCommand } from '../tools/ObjectTools'
import { addedCommand, removedCommand } from '../world/objectCommands'
import { clampScale } from '../world/placement'
import type { ScriptHost, ScriptModel } from '../script/scriptApi'

// The script API's host for the active map (#28): what a Lua script reads and writes of its terrain and
// models, with every change gathered into one undo step (`finish`). Rotations cross as Noggit Red gives
// them, in degrees: y the file's yaw (the editor's turn plus 90, as adt.EditorTurn reads it), x and z the
// tilts.

/** What the host reads of the editor besides the map's terrain and models. */
export interface ScriptView {
	print(text: string): void
	camera(): { x: number; y: number; z: number; pitch: number; yaw: number }
	target(): { x: number; y: number; z: number }
	mapId: number
	areaAt(x: number, z: number): number
	/** The Select tool's area as a vertex rect, or null. */
	area: { x0: number; z0: number; x1: number; z1: number } | null
}

const DEG = 180 / Math.PI

/** The client path a model type names: `m2:World\x.m2` and `wmo:World\x.wmo?set=1` give `World\x...`. */
function fileOf(type: string): string {
	return type.slice(type.indexOf(':') + 1).replace(/\?set=\d+$/, '')
}

const isModel = (type: string) => type.startsWith('m2:') || type.startsWith('wmo:')

export class EngineScriptHost implements ScriptHost {
	private stroke: TerrainStroke
	private heightsChanged = false
	/** Models the script added that are still there. */
	private added = new Set<number>()
	/** The map's own models the script moved, turned or scaled, as they were before. */
	private before = new Map<number, WorldObject>()
	/** The map's own models the script removed, as they were when removed (attached ones with them). */
	private removed = new Map<number, WorldObject>()
	private pos = new THREE.Vector3()

	constructor(
		private ground: Terrain,
		private objects: ObjectLayer,
		private view: ScriptView,
		label: string,
	) {
		const cs = ground.cellSize
		this.stroke = new TerrainStroke(ground, label, { heights: true }, (q) => objects.markRegionDirty(q.x0 * cs, q.z0 * cs, q.x1 * cs, q.z1 * cs))
	}

	print(text: string) {
		this.view.print(text)
	}

	terrain() {
		return { verts: this.ground.verts, cell: this.ground.cellSize }
	}

	heights(x0: number, z0: number, x1: number, z1: number): number[] {
		const t = this.ground
		const V = t.verts
		const out: number[] = []
		for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(t.heights[z * V + x])
		return out
	}

	setHeights(x0: number, z0: number, w: number, h: number, hs: number[]) {
		const t = this.ground
		const V = t.verts
		const r = { x0: Math.max(0, x0), z0: Math.max(0, z0), x1: Math.min(V - 1, x0 + w - 1), z1: Math.min(V - 1, z0 + h - 1) }
		if (r.x0 > r.x1 || r.z0 > r.z1) return
		this.stroke.reserveHeights(r)
		for (let z = r.z0; z <= r.z1; z++) {
			for (let x = r.x0; x <= r.x1; x++) {
				const v = hs[(z - z0) * w + x - x0]
				if (Number.isFinite(v)) t.heights[z * V + x] = v
			}
		}
		t.markDirty(r.x0, r.z0, r.x1, r.z1)
		this.stroke.touchHeights(r)
		const cs = t.cellSize
		this.objects.markRegionDirty(r.x0 * cs, r.z0 * cs, r.x1 * cs, r.z1 * cs)
		this.heightsChanged = true
	}

	/** The model as the script sees it. */
	private model(o: WorldObject): ScriptModel {
		const w = this.objects.worldPlacement(o)
		return {
			id: o.id,
			file: fileOf(o.type),
			x: w.pos.x,
			y: w.pos.y,
			z: w.pos.z,
			rx: (o.tiltX ?? 0) * DEG,
			ry: w.rot * DEG + 90,
			rz: (o.tiltZ ?? 0) * DEG,
			scale: w.scale,
		}
	}

	models(x0: number, z0: number, x1: number, z1: number): ScriptModel[] {
		const out: ScriptModel[] = []
		for (const o of this.objects.list()) {
			if (!isModel(o.type)) continue
			const p = this.objects.worldPosition(o, this.pos)
			if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) out.push(this.model(o))
		}
		return out
	}

	/** Puts `o` at a world placement, in degrees as the script gives it, keeping what it hangs on. */
	private put(o: WorldObject, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) {
		this.objects.place(o, o.parent ?? null, { pos: new THREE.Vector3(x, y, z), rot: (ry - 90) / DEG, scale: clampScale(scale) })
		if (rx) o.tiltX = rx / DEG
		else delete o.tiltX
		if (rz) o.tiltZ = rz / DEG
		else delete o.tiltZ
		this.objects.touch(o.id)
	}

	addModel(kind: 'm2' | 'wmo', file: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number): ScriptModel | string {
		const path = file.replace(/\//g, '\\').replace(/\.md[xl]$/i, '.m2')
		const ext = kind === 'wmo' ? '.wmo' : '.m2'
		if (!path.toLowerCase().endsWith(ext)) return `add_${kind}: ${file} is not a ${ext} file`
		if (![x, y, z, rx, ry, rz, scale].every(Number.isFinite)) return `add_${kind}: the position, turn and scale must be numbers`
		if (!this.ground.contains(x, z)) return `add_${kind}: (${x.toFixed(1)}, ${z.toFixed(1)}) is off the map`
		const o = this.objects.add({ type: `${kind}:${path}`, x, z, yOff: 0, rotY: 0, scale: 1 })
		this.put(o, x, y, z, rx, ry, rz, scale)
		this.added.add(o.id)
		return this.model(o)
	}

	setModel(id: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, scale: number) {
		const o = this.objects.objects.get(id)
		if (!o || ![x, y, z, rx, ry, rz, scale].every(Number.isFinite)) return
		if (!this.added.has(id) && !this.before.has(id)) this.before.set(id, { ...o })
		this.put(o, x, y, z, rx, ry, rz, scale)
	}

	removeModel(id: number) {
		if (!this.objects.objects.has(id)) return
		for (const d of this.objects.descendantIds(id)) {
			const o = this.objects.objects.get(d)
			if (!o) continue
			if (this.added.has(d)) this.added.delete(d)
			else this.removed.set(d, { ...o })
			this.objects.remove(d)
		}
	}

	replaceModel(id: number, file: string): ScriptModel | string {
		const o = this.objects.objects.get(id)
		if (!o) return 'replace: the model is gone'
		const m = this.model(o)
		const kind = /\.wmo$/i.test(file) ? 'wmo' : 'm2'
		const added = this.addModel(kind, file, m.x, m.y, m.z, m.rx, m.ry, m.rz, m.scale)
		if (typeof added !== 'string') this.removeModel(id)
		return added
	}

	camera() {
		return this.view.camera()
	}

	target() {
		return this.view.target()
	}

	mapId() {
		return this.view.mapId
	}

	areaId(x: number, z: number) {
		return this.view.areaAt(x, z)
	}

	area() {
		const a = this.view.area
		const cs = this.ground.cellSize
		return a ? { x0: a.x0 * cs, z0: a.z0 * cs, x1: a.x1 * cs, z1: a.z1 * cs } : null
	}

	/** Whether the script changed anything. */
	get changed(): boolean {
		return this.heightsChanged || this.added.size > 0 || this.before.size > 0 || this.removed.size > 0
	}

	/** Everything the run changed as one undo step (already applied), or null for nothing. */
	finish(label: string): Command | null {
		const parts: Command[] = []
		const terrain = this.heightsChanged ? this.stroke.finish() : null
		if (terrain) parts.push(terrain)
		const objects = this.objects
		if (this.before.size) {
			const ids = [...this.before.keys()]
			const after = ids.map((id) => this.removed.get(id) ?? objects.objects.get(id)!)
			parts.push(groupTransformCommand(objects, [...this.before.values()], after))
		}
		if (this.removed.size) parts.push(removedCommand(objects, [...this.removed.values()]))
		const added = [...this.added].map((id) => objects.objects.get(id)).filter((o): o is WorldObject => !!o)
		if (added.length) parts.push(addedCommand(objects, added, label))
		if (!parts.length) return null
		return {
			label,
			bytes: terrain?.bytes,
			undo: () => {
				for (let i = parts.length - 1; i >= 0; i--) parts[i].undo()
			},
			redo: () => {
				for (const p of parts) p.redo()
			},
		}
	}
}
