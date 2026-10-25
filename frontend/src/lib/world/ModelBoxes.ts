import * as THREE from 'three'
import { getAsset } from '../models/assets'
import type { ObjectLayer, WorldObject } from './ObjectLayer'

/** The 12 edges of a box, as pairs of its corners (corner bit 1 is max x, 2 max y, 4 max z). */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]

/**
 * View › Bounding boxes (Noggit Red's model boxes): every shown model's box, turned and scaled with it,
 * as one set of lines. The lines are rebuilt only when the models, the loaded meshes or the ground
 * change, never per frame; a moved model rewrites its own box in place (#511).
 */
export class ModelBoxes {
	readonly lines: THREE.LineSegments
	private geometry = new THREE.BufferGeometry()
	private layer: ObjectLayer | null = null
	private shapeVersion = -1
	private moveSeq = 0
	private heights = -1
	/** Where each drawn model's box starts in the position buffer, by id. */
	private at = new Map<number, number>()
	private corner = new THREE.Vector3()
	private m = new THREE.Matrix4()

	constructor() {
		const material = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.7, fog: false })
		this.lines = new THREE.LineSegments(this.geometry, material)
		this.lines.name = 'model boxes'
		this.lines.frustumCulled = false
		this.lines.visible = false
	}

	/** Shows or hides the boxes and rebuilds them when the map's models or ground changed. */
	update(layer: ObjectLayer, visible: boolean, heightsVersion: number) {
		this.lines.visible = visible
		if (!visible) return
		if (layer === this.layer && layer.shapeVersion === this.shapeVersion && heightsVersion === this.heights) {
			if (layer.moveSeq === this.moveSeq) return
			const moved = layer.movedSince(this.moveSeq)
			this.moveSeq = layer.moveSeq
			if (moved) {
				const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute
				for (let i = 0; i < moved.length; i++) {
					const p = this.at.get(moved[i])
					if (p !== undefined) this.write(layer, layer.objects.get(moved[i])!, attr.array as Float32Array, p)
				}
				if (moved.length) attr.needsUpdate = true
				return
			}
		}
		this.layer = layer
		this.shapeVersion = layer.shapeVersion
		this.moveSeq = layer.moveSeq
		this.heights = heightsVersion
		const objects = layer.list().filter((o) => !layer.isHidden(o.id) && getAsset(o.type).ready)
		const pos = new Float32Array(objects.length * EDGES.length * 3)
		this.at.clear()
		let p = 0
		for (const o of objects) {
			this.at.set(o.id, p)
			p = this.write(layer, o, pos, p)
		}
		this.geometry.dispose()
		this.geometry = new THREE.BufferGeometry()
		this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		this.lines.geometry = this.geometry
	}

	/** Writes an object's box edges into `pos` from `p`, returning where the next one starts. */
	private write(layer: ObjectLayer, o: WorldObject, pos: Float32Array, p: number): number {
		const box = getAsset(o.type).bbox
		const c = this.corner
		layer.matrixOf(o, this.m)
		for (const k of EDGES) {
			c.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(this.m)
			pos[p++] = c.x
			pos[p++] = c.y
			pos[p++] = c.z
		}
		return p
	}

	dispose() {
		this.geometry.dispose()
		;(this.lines.material as THREE.Material).dispose()
	}
}

/**
 * The box around each selection group a selected model is in (Noggit Red draws its groups so), the
 * union of its members' boxes. Rebuilt only when the selection, the models or the ground change.
 */
export class GroupBoxes {
	readonly lines: THREE.LineSegments
	private geometry = new THREE.BufferGeometry()
	private key = ''
	private ids: readonly number[] | null = null
	private layer: ObjectLayer | null = null
	private version = -1
	private heights = -1
	private history = -1
	private box = new THREE.Box3()
	private member = new THREE.Box3()
	private m = new THREE.Matrix4()

	constructor() {
		const material = new THREE.LineBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false, fog: false })
		this.lines = new THREE.LineSegments(this.geometry, material)
		this.lines.name = 'group boxes'
		this.lines.frustumCulled = false
		this.lines.renderOrder = 10
	}

	/** `history` is ui.historyVersion, which moves when models are grouped or ungrouped. */
	update(layer: ObjectLayer, selectedIds: readonly number[], heightsVersion: number, history: number) {
		// Nothing is looked at, nor allocated, on a frame where none of these moved.
		if (selectedIds === this.ids && layer === this.layer && layer.version === this.version && heightsVersion === this.heights && history === this.history) return
		this.ids = selectedIds
		this.layer = layer
		this.version = layer.version
		this.heights = heightsVersion
		this.history = history
		const groups = new Set<number>()
		for (const id of selectedIds) {
			const g = layer.objects.get(id)?.group
			if (g) groups.add(g)
		}
		const key = groups.size ? `${layer.version}:${heightsVersion}:${history}:${[...groups].join(',')}` : ''
		if (key === this.key) return
		this.key = key
		const pos: number[] = []
		for (const g of groups) {
			this.box.makeEmpty()
			for (const o of layer.objects.values()) {
				if (o.group !== g) continue
				const asset = getAsset(o.type)
				if (!asset.ready) continue
				this.box.union(this.member.copy(asset.bbox).applyMatrix4(layer.matrixOf(o, this.m)))
			}
			if (this.box.isEmpty()) continue
			const { min, max } = this.box
			for (const k of EDGES) pos.push(k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z)
		}
		this.geometry.dispose()
		this.geometry = new THREE.BufferGeometry()
		this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
		this.lines.geometry = this.geometry
	}

	dispose() {
		this.geometry.dispose()
		;(this.lines.material as THREE.Material).dispose()
	}
}
