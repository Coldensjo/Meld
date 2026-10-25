import * as THREE from 'three'
import type { ModelAsset } from '../models/assets'
import { hasSkeleton, modelMesh } from '../world/Animator'
import { previewParticles } from '../world/ParticleLayer'

/**
 * The preview models a tool draws ahead of a placement (the Place tool's ghost, a paste's models, the
 * doodad and spawn brushes' plans): one group in the scene while the tool is active, a mesh a slot,
 * grown as needed and never shrunk. `show` swaps a slot's mesh when its asset's geometry or skeleton
 * changed (a model still loading turns from the placeholder into the real one) and runs the asset's
 * particles on it, so every tool's ghosts preview particles alike.
 */
export class GhostPool {
	readonly group = new THREE.Group()
	private meshes: THREE.Mesh[] = []

	/** `matrixAutoUpdate` false: the tool composes each mesh's matrix itself (the paste's attached models). */
	constructor(private matrixAutoUpdate = true) {
		this.group.renderOrder = 20
	}

	get length() {
		return this.meshes.length
	}

	/** Adds the group to the scene (the tool's activate). */
	attach(scene: THREE.Scene) {
		scene.add(this.group)
	}

	/** Takes the group out of the scene (the tool's deactivate). */
	detach(scene: THREE.Scene) {
		scene.remove(this.group)
	}

	/** Makes room for `n` ghosts. */
	grow(n: number) {
		while (this.meshes.length < n) this.meshes.push(this.add(new THREE.Mesh(new THREE.BufferGeometry())))
	}

	/** The mesh of slot `i` as it stands, for hiding it. */
	at(i: number): THREE.Mesh {
		return this.meshes[i]
	}

	/** The mesh of slot `i` drawing `asset`, swapped for a new one when the asset's geometry or skeleton changed. */
	show(i: number, asset: ModelAsset): THREE.Mesh {
		const old = this.meshes[i]
		if (old.geometry === asset.geometry && hasSkeleton(old, asset.skeleton)) return old
		// An animated model's ghost is a skinned mesh, so it moves as the placed copies will.
		const g = this.add(modelMesh(asset.geometry, asset.material, asset.skeleton))
		g.visible = old.visible
		previewParticles(old, null)
		previewParticles(g, asset)
		this.group.remove(old)
		this.meshes[i] = g
		return g
	}

	hideAll() {
		for (const g of this.meshes) g.visible = false
	}

	private add(m: THREE.Mesh) {
		m.renderOrder = this.group.renderOrder
		m.matrixAutoUpdate = this.matrixAutoUpdate
		this.group.add(m)
		return m
	}
}
