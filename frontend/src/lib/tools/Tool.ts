import type * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer } from '../world/ObjectLayer'
import type { SpawnLayer } from '../world/SpawnLayer'
import type { SpawnPaths } from '../world/SpawnPaths'
import type { History } from '../state/history'
import type { LiquidMap } from '../water/liquids'
import type { HoleWalls } from './HoleWalls'

export interface ToolContext {
	readonly terrain: Terrain
	readonly objects: ObjectLayer
	/** The creatures and game objects of a region, drawn as markers or models. */
	readonly spawns: SpawnLayer
	/** The drawn waypoint paths, for picking the selected creature's points. */
	readonly paths: SpawnPaths
	readonly history: History
	/** The map's painted liquids. */
	readonly liquids: LiquidMap
	readonly scene: THREE.Scene
	readonly raycaster: THREE.Raycaster
	/**
	 * The holes' edges as handles, one for the editor, driven by the tool that shows them (the Select
	 * tool, Sculpt's Hole mode), which attaches it to the scene while active and detaches it after.
	 */
	readonly holeWalls: HoleWalls
	/**
	 * Surface under the cursor: terrain, or a placed object (then `parent` is
	 * its id) — whichever is nearer. `exclude` skips objects (e.g. the one
	 * being dragged and its attachments).
	 */
	surface(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null
	/**
	 * The floor under the cursor a creature or game object stands on (#660): like `surface`, but a
	 * model surface must face up (a ceiling or a wall is passed through), and the terrain is
	 * see-through while the camera is under it or the terrain is hidden, so a cave's or a dungeon's
	 * floor is found below the ground.
	 */
	floor(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null
	/**
	 * Pen pressure from 0 to 1 while Tablet support is on and a pen is drawing; 1 for a mouse or with the
	 * setting off. Brush tools scale their strength by it.
	 */
	pressure(): number
	/**
	 * What the pen's pressure does to the brush radius, 0.05 to 1: the pressure while "Pen pressure
	 * sizes the brush" is on and a pen is drawing (#42), else 1.
	 */
	radiusPressure(): number
	/** The camera's yaw, for camera-relative keys (the arrows move the way the view faces). */
	cameraYaw(): number
}

/**
 * Editor tools receive left-mouse input already resolved to a terrain hit.
 * The camera owns right/middle mouse. `tick` runs every frame while the
 * button is held so brush tools apply continuously, frame-rate independent.
 */
export interface Tool {
	/** Show the circular brush cursor on the terrain. */
	readonly usesBrush: boolean
	/** Whether the brush image shapes this tool's strokes, so the cursor shows it (brushImage.ts). */
	imageShaped?(): boolean
	activate?(ctx: ToolContext): void
	deactivate?(ctx: ToolContext): void
	/**
	 * The press, the drag and the release, with the pointer event that made them. `e` is missing when
	 * the Engine ends a stroke itself (a tool or tab switch with the button held), so read it as `e?.`.
	 */
	onDown?(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent): void
	onMove?(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent): void
	onUp?(ctx: ToolContext, hit: THREE.Vector3 | null, e?: PointerEvent): void
	tick?(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null): void
	/** Called every frame regardless of input (ghost previews etc.). */
	frame?(ctx: ToolContext, hit: THREE.Vector3 | null): void
	onKey?(ctx: ToolContext, e: KeyboardEvent): boolean
}
