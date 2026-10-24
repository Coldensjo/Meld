import type * as THREE from 'three'
import { History } from '../state/history'
import type { CubeWorld } from '../cubes/world'
import { CubeLayer } from '../cubes/CubeLayer'

/** Per-world editor settings that are swapped in/out of `editor` on tab switch. */
export interface DocMeta {
	mapName: string
	filePath: string
	dirty: boolean
	/** Named camera views of this world, kept with its tab. */
	bookmarks: Bookmark[]
}

/** A saved camera view: where it looks at, and from what angle and distance. */
export interface Bookmark {
	name: string
	x: number
	y: number
	z: number
	yaw: number
	pitch: number
	distance: number
}

export interface DocCamera {
	target: THREE.Vector3
	yaw: number
	pitch: number
	distance: number
}

let nextId = 1

/**
 * One open cube world of the game (a tab, a .world file, lib/cubes/world.ts): its cubes, the meshes
 * that draw them, its undo history, settings and camera. The Engine renders exactly one document (the
 * active tab).
 */
export class MapDocument {
	readonly id = nextId++
	readonly history = new History()
	meta: DocMeta
	/** The meshes that draw `world` (#30). */
	readonly cubes: CubeLayer
	camera: DocCamera | null = null

	constructor(
		readonly world: CubeWorld,
		name: string,
	) {
		this.cubes = new CubeLayer(world)
		this.meta = { mapName: name, filePath: '', dirty: false, bookmarks: [] }
	}

	/** Untitled, unsaved and untouched: safe to replace when opening a file. */
	get pristine() {
		return !this.meta.dirty && !this.meta.filePath && !this.history.peek()
	}

	dispose() {
		this.cubes.dispose()
	}
}
