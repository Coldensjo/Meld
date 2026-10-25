import * as THREE from 'three'
import { LIQUID_CELLS, LIQUID_VERTS, liquidType, type LiquidMap } from './liquids'
import { KIND_INDEX, liquidLayerMaterial, wantLiquid } from './liquidMaterial'

/** Liquid chunks a side of one mesh: few draw calls, and an edit rebuilds a small mesh. */
const BLOCK = 4

/**
 * Draws a map's liquids: a mesh per block of BLOCK x BLOCK chunks, holding each layer's covered
 * cells at its surface heights. A block is rebuilt when one of its chunks changed (LiquidMap.dirty).
 */
export class LiquidRenderer {
	readonly group = new THREE.Group()
	private blocks = new Map<number, THREE.Mesh>()
	private blocksPerSide: number
	private map: LiquidMap
	private cellSize: number
	/** The only layer index drawn in each chunk, or -1 for all (`setLayer`). */
	private only = -1

	constructor(map: LiquidMap, cellSize: number) {
		this.map = map
		this.cellSize = cellSize
		this.blocksPerSide = Math.ceil(map.side / BLOCK)
		this.group.name = 'liquids'
		// Drawn after the terrain and models, like the sea.
		this.group.renderOrder = 10
	}

	/**
	 * Draws only layer number `n` of each chunk (in the chunk's own order), or every layer for -1:
	 * Noggit Red's Current layer, while the Water tool has Show all layers off.
	 */
	setLayer(n: number) {
		if (n === this.only) return
		this.only = n
		this.rebuildAll()
	}

	/** Rebuilds the blocks whose chunks changed. Call once per frame. */
	update() {
		const map = this.map
		if (!map.dirty.size) return
		const blocks = new Set<number>()
		for (const c of map.dirty) {
			const cx = c % map.side
			const cz = Math.floor(c / map.side)
			blocks.add(Math.floor(cz / BLOCK) * this.blocksPerSide + Math.floor(cx / BLOCK))
		}
		map.dirty.clear()
		for (const b of blocks) this.rebuild(b)
	}

	private rebuild(b: number) {
		const old = this.blocks.get(b)
		if (old) {
			old.geometry.dispose()
			this.group.remove(old)
			this.blocks.delete(b)
		}
		const map = this.map
		const bx = (b % this.blocksPerSide) * BLOCK
		const bz = Math.floor(b / this.blocksPerSide) * BLOCK
		let layers = 0
		let cells = 0
		for (let z = bz; z < Math.min(bz + BLOCK, map.side); z++) {
			for (let x = bx; x < Math.min(bx + BLOCK, map.side); x++) {
				const all = map.layers(z * map.side + x)
				for (let n = 0; n < all.length; n++) {
					if (this.only >= 0 && n !== this.only) continue
					const l = all[n]
					layers++
					for (let i = 0; i < 64; i++) cells += l.cells[i]
				}
			}
		}
		if (!cells) return

		const nv = LIQUID_VERTS * LIQUID_VERTS
		const pos = new Float32Array(layers * nv * 3)
		const depth = new Float32Array(layers * nv)
		const kind = new Float32Array(layers * nv)
		const index = new Uint32Array(cells * 6)
		const cs = this.cellSize
		let v = 0
		let k = 0
		for (let z = bz; z < Math.min(bz + BLOCK, map.side); z++) {
			for (let x = bx; x < Math.min(bx + BLOCK, map.side); x++) {
				const all = map.layers(z * map.side + x)
				for (let n = 0; n < all.length; n++) {
					if (this.only >= 0 && n !== this.only) continue
					const l = all[n]
					const kd = liquidType(l.id).kind
					wantLiquid(kd)
					const first = v
					for (let i = 0; i < nv; i++, v++) {
						pos[v * 3] = (x * LIQUID_CELLS + (i % LIQUID_VERTS)) * cs
						pos[v * 3 + 1] = l.heights[i]
						pos[v * 3 + 2] = (z * LIQUID_CELLS + Math.floor(i / LIQUID_VERTS)) * cs
						depth[v] = l.depth[i]
						kind[v] = KIND_INDEX[kd]
					}
					for (let r = 0; r < LIQUID_CELLS; r++) {
						for (let c = 0; c < LIQUID_CELLS; c++) {
							if (!l.cells[r * LIQUID_CELLS + c]) continue
							const p = first + r * LIQUID_VERTS + c
							// noggit's triangles: (p, p+9, p+10) and (p+10, p+1, p).
							index[k++] = p
							index[k++] = p + LIQUID_VERTS
							index[k++] = p + LIQUID_VERTS + 1
							index[k++] = p + LIQUID_VERTS + 1
							index[k++] = p + 1
							index[k++] = p
						}
					}
				}
			}
		}
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		g.setAttribute('depth', new THREE.BufferAttribute(depth, 1))
		g.setAttribute('kind', new THREE.BufferAttribute(kind, 1))
		g.setIndex(new THREE.BufferAttribute(index, 1))
		g.computeBoundingSphere()
		const mesh = new THREE.Mesh(g, liquidLayerMaterial())
		mesh.renderOrder = 10
		mesh.name = 'liquid-block'
		this.blocks.set(b, mesh)
		this.group.add(mesh)
	}

	/**
	 * Shows only the blocks that meet one of `frustums` (the doorways of the WMO room the camera is
	 * in, #119), or every block for null.
	 */
	gate(frustums: THREE.Frustum[] | null) {
		for (const mesh of this.blocks.values()) {
			if (!frustums) {
				mesh.visible = true
				continue
			}
			const s = mesh.geometry.boundingSphere
			let seen = !s
			for (let k = 0; !seen && k < frustums.length; k++) seen = frustums[k].intersectsSphere(s!)
			mesh.visible = seen
		}
	}

	/** Every chunk again (after the map's liquids were replaced wholesale). */
	rebuildAll() {
		for (const m of this.blocks.values()) m.geometry.dispose()
		this.blocks.clear()
		this.group.clear()
		this.map.dirty.clear()
		for (let b = 0; b < this.blocksPerSide * this.blocksPerSide; b++) this.rebuild(b)
	}

	dispose() {
		for (const m of this.blocks.values()) m.geometry.dispose()
		this.blocks.clear()
		this.group.clear()
	}
}
