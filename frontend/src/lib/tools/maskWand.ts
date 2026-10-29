// Paint › Mask › Select by (#183): the magic wand's click, and Grow, Shrink and Feather Mask. The texel
// arithmetic is `terrain/maskSelect.ts`; this reads the map under each texel and records the undo step.
import * as THREE from 'three'
import { editor, setStatus } from '../state/editor.svelte'
import type { History } from '../state/history'
import type { Terrain } from '../terrain/Terrain'
import type { LiquidMap } from '../water/liquids'
import { combineMask, featherMask, growMask, shrinkMask, wandSelect, type MaskOp } from '../terrain/maskSelect'
import { dominantTexel, textureWeightTexel } from '../terrain/chunkPaint'
import { groundSlopeDeg } from '../world/groundTilt'
import { TerrainStroke } from './brush'
import { texName } from '../wow/texName'

/** Runs `fn` on the whole mask as one undo step labelled `label`. */
export function editWholeMask(t: Terrain, history: History, label: string, fn: (m: Uint8Array) => void) {
	const R = t.splatRes
	const all = { x0: 0, z0: 0, x1: R - 1, z1: R - 1 }
	const stroke = new TerrainStroke(t, label, { mask: true })
	stroke.reserveMask(all)
	fn(t.mask)
	stroke.touchMask(all)
	t.markMaskDirty()
	const cmd = stroke.finish()
	if (cmd) history.push(cmd)
}

/**
 * The wand's click at `hit`: selects texels by `editor.maskSelect.by` and puts them into the mask by
 * `op`, one undo step. Says in the status bar what it took.
 */
export function wandClick(t: Terrain, liquids: LiquidMap, history: History, hit: THREE.Vector3, op: MaskOp) {
	const s = editor.maskSelect
	const R = t.splatRes
	const ts = t.worldSize / R
	const tx = Math.min(R - 1, Math.max(0, Math.floor(hit.x / ts)))
	const tz = Math.min(R - 1, Math.max(0, Math.floor(hit.z / ts)))
	const seed = tz * R + tx
	const at = (p: number) => {
		px = ((p % R) + 0.5) * ts
		pz = (Math.floor(p / R) + 0.5) * ts
	}
	let px = 0
	let pz = 0
	let inside: (p: number) => boolean
	let what: string
	if (s.by === 'texture') {
		const tex = dominantTexel(t.paintChunksPerSide, R, t.chunkSlots, t.weights, seed)
		if (tex < 0) {
			setStatus('No texture under the click to select by.', 3000)
			return
		}
		const min = Math.max(1 / 255, s.minWeight)
		inside = (p) => textureWeightTexel(t.paintChunksPerSide, R, t.chunkSlots, t.weights, p, tex) >= min
		const path = editor.palette[tex] ?? ''
		what = texName(path)
	} else if (s.by === 'height') {
		const h0 = t.heightAt(hit.x, hit.z)
		inside = (p) => {
			at(p)
			return Math.abs(t.heightAt(px, pz) - h0) <= s.height
		}
		what = `height ${h0.toFixed(1)} ± ${s.height} yd`
	} else if (s.by === 'slope') {
		const lo = Math.min(s.slopeMin, s.slopeMax)
		const hi = Math.max(s.slopeMin, s.slopeMax)
		const height = (x: number, z: number) => t.heightAt(x, z)
		inside = (p) => {
			at(p)
			const d = groundSlopeDeg(height, px, pz, t.cellSize)
			return d >= lo && d <= hi
		}
		what = `slope ${lo}° to ${hi}°`
	} else if (s.by === 'water') {
		const sea = editor.waterEnabled ? editor.waterLevel : null
		inside = (p) => {
			at(p)
			const g = t.heightAt(px, pz)
			return (sea !== null && g < sea) || liquids.covers(px, pz, t.cellSize, g)
		}
		what = 'water'
	} else return
	const sel = new Uint8Array(R * R)
	const n = wandSelect(R, inside, seed, s.contiguous, sel)
	if (n === 0) {
		setStatus(`Nothing to select by ${what} there.`, 3000)
		return
	}
	if (s.feather > 0) featherMask(sel, R, s.feather / ts)
	const verb = op === 'add' ? 'Add to mask' : op === 'subtract' ? 'Take from mask' : 'Mask'
	editWholeMask(t, history, `${verb} by ${s.by}`, (m) => combineMask(m, sel, op))
	setStatus(`${verb}: ${Math.round(n * ts * ts)} square yards by ${what}${s.contiguous ? ', joined to the click' : ''}.`, 4000)
}

/** Mask › Grow, Shrink or Feather by `editor.maskSelect.step` yards, one undo step. */
export function modifyMask(t: Terrain, history: History, how: 'grow' | 'shrink' | 'feather') {
	const R = t.splatRes
	const texels = editor.maskSelect.step / (t.worldSize / R)
	const label = how === 'grow' ? 'Grow mask' : how === 'shrink' ? 'Shrink mask' : 'Feather mask'
	editWholeMask(t, history, label, (m) => {
		if (how === 'grow') growMask(m, R, texels)
		else if (how === 'shrink') shrinkMask(m, R, texels)
		else featherMask(m, R, texels)
	})
}
