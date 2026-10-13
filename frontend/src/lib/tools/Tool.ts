import type * as THREE from 'three'
import type { Terrain } from '../terrain/Terrain'
import type { ObjectLayer } from '../world/ObjectLayer'
import type { SpawnLayer } from '../world/SpawnLayer'
import type { History } from '../state/history'
import type { LiquidMap } from '../water/liquids'

export interface ToolContext {
  readonly terrain: Terrain
  readonly objects: ObjectLayer
  /** The creatures and game objects of a region, drawn as markers or models. */
  readonly spawns: SpawnLayer
  readonly history: History
  /** The map's painted liquids. */
  readonly liquids: LiquidMap
  readonly scene: THREE.Scene
  readonly raycaster: THREE.Raycaster
  /**
   * Surface under the cursor: terrain, or a placed object (then `parent` is
   * its id) — whichever is nearer. `exclude` skips objects (e.g. the one
   * being dragged and its attachments).
   */
  surface(exclude?: Set<number>): { point: THREE.Vector3; parent: number | null } | null
  /**
   * Pen pressure from 0 to 1 while Tablet support is on and a pen is drawing; 1 for a mouse or with the
   * setting off. Brush tools scale their strength by it.
   */
  pressure(): number
}

/**
 * Editor tools receive left-mouse input already resolved to a terrain hit.
 * The camera owns right/middle mouse. `tick` runs every frame while the
 * button is held so brush tools apply continuously, frame-rate independent.
 */
export interface Tool {
  /** Show the circular brush cursor on the terrain. */
  readonly usesBrush: boolean
  activate?(ctx: ToolContext): void
  deactivate?(ctx: ToolContext): void
  onDown?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
  onMove?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
  onUp?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
  tick?(ctx: ToolContext, dt: number, hit: THREE.Vector3 | null): void
  /** Called every frame regardless of input (ghost previews etc.). */
  frame?(ctx: ToolContext, hit: THREE.Vector3 | null): void
  onKey?(ctx: ToolContext, e: KeyboardEvent): boolean
}
