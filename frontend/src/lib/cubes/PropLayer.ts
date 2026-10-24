// Draws a world's props (#133): each model of the game's assets/models (propModels.ts) as one
// instanced mesh a part, holding every prop of that model on the layers the slice shows, placed as the
// client places them (at its origin, turned about the vertical, scaled, then fitted by the model
// table). A village of some 700 props of 40 models is so a hundred draw calls or so. Models load when
// first needed; the props are drawn again as each arrives, and whenever the props, the slice or the
// selection change (props are few enough to place again whole). The selected prop gets an outline.
// A lamp's model (models.toml `light`) gives the place of its light, which the mood lights (3dgame #178).

import * as THREE from 'three'
import type { CubeWorld } from './world'
import { fitMatrix, loadPropModel, modelEntry, propModel } from './propModels'
import { propLayer } from './props'

const SELECTED = 0xffd24a

export class PropLayer {
	readonly group = new THREE.Group()
	private readonly meshes = new THREE.Group()
	private readonly outline: THREE.Box3Helper
	private readonly box = new THREE.Box3()
	private readonly place = new THREE.Matrix4()
	private readonly at = new THREE.Matrix4()
	private readonly m = new THREE.Matrix4()
	private readonly q = new THREE.Quaternion()
	private readonly v = new THREE.Vector3()
	private readonly s = new THREE.Vector3()
	private readonly up = new THREE.Vector3(0, 1, 0)
	/** Set when a model arrived since the last draw, so the owner draws again. */
	stale = false
	/** Where the shown props' lamps hang their light (props.rs spawn_prop), in world metres; the mood lights them (moodLights.ts). */
	readonly lamps: THREE.Vector3[] = []
	/** Counts the times `lamps` changed. */
	lampsVersion = 0
	private readonly hits: THREE.Intersection[] = []

	constructor() {
		this.group.name = 'props'
		this.meshes.name = 'prop models'
		this.group.add(this.meshes)
		this.outline = new THREE.Box3Helper(this.box, SELECTED)
		;(this.outline.material as THREE.LineBasicMaterial).depthTest = false
		this.outline.renderOrder = 9
		this.outline.visible = false
		this.group.add(this.outline)
	}

	/** The matrix placing prop `p` in the world: at its origin, turned and scaled (props.rs spawn_prop). */
	placement(p: { x: number; y: number; z: number; turn: number; scale: number }, out: THREE.Matrix4): THREE.Matrix4 {
		this.q.setFromAxisAngle(this.up, p.turn)
		return out.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.scale, p.scale, p.scale))
	}

	/** Draws the props of the layers `shown` leaves, the prop `selected` (an index into world.props) outlined. */
	draw(world: CubeWorld, shown: (layer: number) => boolean, selected: number | null) {
		this.stale = false
		this.clear()
		const byModel = new Map<string, number[]>()
		world.props.forEach((p, i) => {
			if (!shown(propLayer(p))) return
			let list = byModel.get(p.model)
			if (!list) byModel.set(p.model, (list = []))
			list.push(i)
		})
		this.lamps.length = 0
		this.lampsVersion++
		for (const [name, list] of byModel) {
			const light = modelEntry(name).light
			if (light !== null) {
				const fit = fitMatrix(modelEntry(name))
				for (const i of list) this.lamps.push(new THREE.Vector3(0, light, 0).applyMatrix4(fit).applyMatrix4(this.placement(world.props[i], this.place)))
			}
			const model = propModel(name)
			if (model === undefined) {
				void loadPropModel(name).then(() => (this.stale = true))
				continue
			}
			if (!model) continue
			for (const part of model.parts) {
				const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length)
				mesh.name = name
				mesh.userData.props = list
				list.forEach((i, k) => mesh.setMatrixAt(k, this.at.multiplyMatrices(this.placement(world.props[i], this.place), part.matrix)))
				mesh.instanceMatrix.needsUpdate = true
				mesh.computeBoundingSphere()
				mesh.computeBoundingBox()
				this.meshes.add(mesh)
			}
		}
		const sel = selected === null ? undefined : world.props[selected]
		const model = sel && propModel(sel.model)
		this.outline.visible = !!(sel && model && shown(propLayer(sel)))
		if (sel && model) {
			this.box.copy(model.bounds).applyMatrix4(this.placement(sel, this.m))
			this.box.expandByScalar(0.05)
		}
	}

	/** The prop (its index in world.props) whose model `ray` meets first, its distance; null for none. */
	hit(raycaster: THREE.Raycaster): { index: number; t: number } | null {
		this.hits.length = 0
		raycaster.intersectObject(this.meshes, true, this.hits)
		for (const h of this.hits) {
			const list = h.object.userData.props as number[] | undefined
			if (list && h.instanceId !== undefined && list[h.instanceId] !== undefined) return { index: list[h.instanceId], t: h.distance }
		}
		return null
	}

	/** How many props are drawn now, and in how many meshes (the probes). */
	drawn(): { props: number; meshes: number } {
		const seen = new Set<number>()
		for (const m of this.meshes.children) for (const i of m.userData.props as number[]) seen.add(i)
		return { props: seen.size, meshes: this.meshes.children.length }
	}

	private clear() {
		for (const m of this.meshes.children) (m as THREE.InstancedMesh).dispose()
		this.meshes.clear()
	}

	dispose() {
		this.clear()
		this.outline.geometry.dispose()
		;(this.outline.material as THREE.Material).dispose()
		this.group.removeFromParent()
	}
}
