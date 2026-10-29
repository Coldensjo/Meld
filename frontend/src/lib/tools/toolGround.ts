import type { ToolContext } from './Tool'
import { editor } from '../state/editor.svelte'
import { groundSlopeDeg } from '../world/groundTilt'
import type { GroundProbe } from './doodadBrush'
import { textureWeightAt } from './BrushTool'
import type { Terrain } from '../terrain/Terrain'

// The ground under a brush placement, as the placement rules (`rulesAllow` in doodadBrush.ts) see it,
// shared by the doodad brush and the spawn brush (#196).

/** The ground at a point for the brush's placement rules; filled by `at`, reused for every check. */
export class ToolGround implements GroundProbe {
	height = 0
	sea: number | null = null
	hole = false
	liquid = false
	private t: Terrain | null = null
	private x = 0
	private z = 0

	at(ctx: ToolContext, x: number, z: number) {
		const t = ctx.terrain
		this.t = t
		this.x = x
		this.z = z
		this.height = t.heightAt(x, z)
		this.sea = editor.waterEnabled ? editor.waterLevel : null
		this.hole = t.isHole(x, z)
		this.liquid = ctx.liquids.covers(x, z, t.cellSize, this.height)
	}

	slope() {
		const t = this.t!
		return groundSlopeDeg((px, pz) => t.heightAt(px, pz), this.x, this.z, t.cellSize)
	}

	textureWeight(path: string) {
		const i = editor.palette.indexOf(path)
		return i < 0 ? 0 : textureWeightAt(this.t!, this.x, this.z, i)
	}
}
