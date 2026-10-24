import type * as THREE from 'three'
import type { History } from '../state/history'
import type { CubeLayer } from '../cubes/CubeLayer'

export interface ToolContext {
	readonly history: History
	readonly scene: THREE.Scene
	readonly raycaster: THREE.Raycaster
	/** The camera's yaw, for camera-relative keys (the arrows move the way the view faces). */
	cameraYaw(): number
	/** The cubes of the active world tab (#31, the world is `cubes.world`). */
	readonly cubes: CubeLayer | null
	/** Whether the pointer is over the viewport, so `raycaster` holds the ray under it. */
	pointerInside(): boolean
}

/**
 * Editor tools receive left-mouse input with `hit`, the point under the cursor where the ray meets the
 * cubes (null for none); they aim through `ctx.raycaster`. The camera owns right/middle mouse.
 */
export interface Tool {
	activate?(ctx: ToolContext): void
	deactivate?(ctx: ToolContext): void
	onDown?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
	onMove?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
	onUp?(ctx: ToolContext, hit: THREE.Vector3 | null, e: PointerEvent): void
	/** Called every frame regardless of input (ghost previews etc.). */
	frame?(ctx: ToolContext, hit: THREE.Vector3 | null): void
	onKey?(ctx: ToolContext, e: KeyboardEvent): boolean
}
