import * as THREE from 'three'
import { RegionHorizon } from '../../../wailsjs/go/main/App'
import type { RegionRef } from '../engine/MapDocument'
import { TILE_YARDS } from '../terrain/Terrain'
import { horizonMesh, type HorizonTile } from './horizonMesh'

/**
 * The far horizon past an open region (View › Far Horizon, B-167): the map's WDL tiles around the block,
 * drawn as the client draws them (Benilla's wdl.wgsl): unlit, untextured, in the flat fog colour, a
 * silhouette against the sky. Read from the client once per document; a map of its own has none.
 */
export class HorizonLayer {
	readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
	private docId = -1

	constructor() {
		this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ fog: false }))
		this.mesh.name = 'horizon'
		this.mesh.frustumCulled = false
		this.mesh.visible = false
	}

	/** Keeps the horizon of document `docId` (with its `region`) shown or hidden, in `color`; reads it once a document. */
	update(docId: number, region: RegionRef | null, on: boolean, color: THREE.Color) {
		this.mesh.material.color.copy(color)
		if (docId !== this.docId && on) {
			this.docId = docId
			this.set([])
			if (region) {
				RegionHorizon(region.mapName, region.x, region.y, region.size)
					.then((tiles) => {
						if (this.docId === docId) this.set((tiles ?? []) as HorizonTile[])
					})
					.catch((err) => console.warn('horizon not read', err))
			}
		}
		this.mesh.visible = on && docId === this.docId && this.mesh.geometry.index !== null
	}

	private set(tiles: HorizonTile[]) {
		this.mesh.geometry.dispose()
		const g = new THREE.BufferGeometry()
		if (tiles.length) {
			const { positions, indices } = horizonMesh(tiles, TILE_YARDS)
			g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
			g.setIndex(new THREE.BufferAttribute(indices, 1))
		}
		this.mesh.geometry = g
	}

	dispose() {
		this.mesh.geometry.dispose()
		this.mesh.material.dispose()
	}
}
