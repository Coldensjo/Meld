import * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import { TILE_YARDS } from '../terrain/Terrain'
import { seaMaterial, wantLiquid } from './liquidMaterial'

/** The most cells a side of the sea's grid: past it a cell grows beyond a tile (a map wider than 25 tiles). */
const SEA_CELLS_MAX = 256

/**
 * A map's sea: ocean at the sea level, out past the map's edge, drawn like a painted ocean (see
 * liquidMaterial.ts). Its depth comes from the ground under each pixel, so shores fade out as the
 * client's do.
 */
export class Water {
	readonly mesh: THREE.Mesh
	readonly material: THREE.ShaderMaterial
	/** Deep-water floor extending past the map edge (matches the terrain's depth tint). */
	readonly floor: THREE.Mesh

	constructor(terrain: Terrain) {
		const worldSize = terrain.worldSize
		// A grid of cells about a tile wide, not one quad: on a real GPU (D3D11 through ANGLE) the depth of a
		// quad tens of thousands of yards wide, clipped round the camera, came out a little different each
		// frame the camera moved, so the shore against the ground swapped sea and land back and forth in
		// flight (#747). SwiftShader draws it steady. Up to 256 cells a side, about 130k triangles.
		const size = worldSize * 10
		const cells = Math.min(SEA_CELLS_MAX, Math.max(16, Math.ceil(size / TILE_YARDS)))
		const geo = new THREE.PlaneGeometry(size, size, cells, cells)
		geo.rotateX(-Math.PI / 2)
		this.material = seaMaterial(terrain.heightTexture(), terrain.verts, terrain.cellSize)
		this.mesh = new THREE.Mesh(geo, this.material)
		this.mesh.position.set(worldSize / 2, 0, worldSize / 2)
		this.mesh.renderOrder = 10
		this.mesh.name = 'water'

		const floorGeo = new THREE.PlaneGeometry(worldSize * 10, worldSize * 10)
		floorGeo.rotateX(-Math.PI / 2)
		// A backdrop, not a surface: drawn after the sky (-1) and the clouds (-0.5) and before the scene,
		// without writing depth, so it fills only what nothing else covers. As a surface it hid every
		// model below it (#289: the lower halls of Blackrock Depths, seen from above through a pit, were a
		// disc of dark earth).
		this.floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.12, 0.18), depthWrite: false }))
		this.floor.renderOrder = -0.25
		this.floor.name = 'seafloor'
		// The floor is its own scene object, not the sea's child: it also shows, dark, through holes in
		// the ground when the sea is off (else a hole shows the sky dome below the horizon).
		this.floor.position.set(worldSize / 2, -40, worldSize / 2)
	}

	set level(y: number) {
		this.mesh.position.y = y
		this.floor.position.y = y - 40
	}

	set visible(v: boolean) {
		this.mesh.visible = v
		if (v) wantLiquid('ocean')
	}

	/**
	 * Hides the sea unless it meets one of `frustums` (the doorways of the WMO room the camera is in,
	 * #119); null leaves it as it is.
	 */
	gate(frustums: THREE.Frustum[] | null) {
		if (!frustums || !this.mesh.visible) return
		const g = this.mesh.geometry
		if (!g.boundingBox) g.computeBoundingBox()
		this.box.copy(g.boundingBox!).applyMatrix4(this.mesh.matrixWorld)
		let seen = false
		for (let k = 0; !seen && k < frustums.length; k++) seen = frustums[k].intersectsBox(this.box)
		this.mesh.visible = seen
	}

	private box = new THREE.Box3()

	dispose() {
		this.floor.geometry.dispose()
		;(this.floor.material as THREE.Material).dispose()
		this.mesh.geometry.dispose()
		this.material.dispose()
	}
}
