import { parse } from 'smol-toml'
import type { ClipObject, ObjectClip } from '../world/clipboard'

// Prefabs (#170): an arrangement of models (a campfire with its logs and bedroll, a market stall) kept
// in a TOML file of the author's prefab folder and placed again as a whole, the way Hammer and Unity
// keep prefabs. A prefab is a model clip (world/clipboard.ts, `copyObjects`) written out: each model
// by its client path and placement only, never its content. Placed, it becomes ordinary models.

export interface Prefab {
	name: string
	objects: ClipObject[]
}

export const PREFAB_FILE_HEADER = '# Meld prefab: models placed together, by their client paths'

/** A TOML string: literal (single quotes, as client paths have backslashes) unless it holds one. */
function tomlString(s: string): string {
	if (!s.includes("'") && !/[\n\r]/.test(s)) return `'${s}'`
	return JSON.stringify(s)
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000))

/** The prefab as TOML: its name, then a `[[model]]` table per model. */
export function formatPrefab(p: Prefab): string {
	const lines = [PREFAB_FILE_HEADER, `name = ${tomlString(p.name)}`]
	for (const o of p.objects) {
		lines.push('', '[[model]]', `type = ${tomlString(o.type)}`, `id = ${o.cid}`)
		if (o.cparent !== undefined) lines.push(`parent = ${o.cparent}`)
		lines.push(`at = [${num(o.x)}, ${num(o.yOff)}, ${num(o.z)}]`, `turn = ${num(o.rotY)}`, `scale = ${num(o.scale)}`)
		if (o.tiltX || o.tiltZ) lines.push(`tilt = [${num(o.tiltX ?? 0)}, ${num(o.tiltZ ?? 0)}]`)
		if (o.group) lines.push(`group = ${o.group}`)
	}
	return lines.join('\n') + '\n'
}

export interface ParsedPrefab {
	prefab: Prefab | null
	errors: string[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isModel = (t: unknown): t is string => typeof t === 'string' && (t.startsWith('m2:') || t.startsWith('wmo:'))

/** Reads a prefab written by `formatPrefab` (or by hand). A model that can't be read is reported and left out, with what hangs on it. */
export function parsePrefab(text: string, fallbackName = 'Prefab'): ParsedPrefab {
	const errors: string[] = []
	let doc: Record<string, unknown>
	try {
		doc = parse(text)
	} catch (e) {
		return { prefab: null, errors: [`not valid TOML: ${e instanceof Error ? e.message : e}`] }
	}
	const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : fallbackName
	const models = doc.model
	if (!Array.isArray(models)) return { prefab: null, errors: ['no [[model]] tables'] }
	const objects: ClipObject[] = []
	models.forEach((m, i) => {
		const where = `model ${i + 1}`
		const t = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
		if (!isModel(t.type)) return errors.push(`${where}: type must be "m2:<path>" or "wmo:<path>"`)
		if (!finite(t.id)) return errors.push(`${where}: id must be a number`)
		const at = t.at
		if (!Array.isArray(at) || at.length !== 3 || !at.every(finite)) return errors.push(`${where}: at must be [x, height, z]`)
		const o: ClipObject = { type: t.type, cid: t.id, x: at[0], yOff: at[1], z: at[2], rotY: finite(t.turn) ? t.turn : 0, scale: finite(t.scale) && t.scale > 0 ? t.scale : 1 }
		if (t.parent !== undefined) {
			if (!finite(t.parent)) return errors.push(`${where}: parent must be the id of another model`)
			o.cparent = t.parent
		}
		const tilt = t.tilt
		if (Array.isArray(tilt) && tilt.length === 2 && tilt.every(finite)) {
			o.tiltX = tilt[0]
			o.tiltZ = tilt[1]
		}
		if (finite(t.group)) o.group = t.group
		objects.push(o)
	})
	const kept = withParents(objects)
	if (kept.length < objects.length) errors.push(`${objects.length - kept.length} attached models lost the model they hang on`)
	return { prefab: kept.length ? { name, objects: kept } : null, errors }
}

/** The objects whose parent chain is all there. */
function withParents(list: ClipObject[]): ClipObject[] {
	const ids = new Set(list.map((o) => o.cid))
	let out = list
	for (;;) {
		const next = out.filter((o) => o.cparent === undefined || ids.has(o.cparent))
		if (next.length === out.length) return out
		out = next
		ids.clear()
		for (const o of out) ids.add(o.cid)
	}
}

/** How a placed prefab varies (#170): each root model turned up to `turn` degrees either way, scaled by up to `scale` (0.1 is ±10%), and left out with the chance `drop`. */
export interface PrefabVariation {
	turn: number
	scale: number
	drop: number
}

/**
 * The prefab's models as a clip to paste, varied when `v` is given: each root model (with what hangs
 * on it) is turned and scaled about its own place, or left out; at least one root always stays.
 */
export function prefabClip(p: Prefab, v: PrefabVariation | null, rand: () => number = Math.random): ObjectClip {
	if (!v) return { objects: p.objects.map((o) => ({ ...o })) }
	const roots = p.objects.filter((o) => o.cparent === undefined)
	const dropped = new Set<number>()
	for (const r of roots) if (rand() < v.drop) dropped.add(r.cid)
	if (dropped.size >= roots.length && roots.length) dropped.delete(roots[Math.floor(rand() * roots.length)].cid)
	const kept = withParents(p.objects.filter((o) => !dropped.has(o.cid)))
	const turn = (v.turn * Math.PI) / 180
	return {
		objects: kept.map((o) => {
			if (o.cparent !== undefined) return { ...o }
			const s = 1 + (rand() * 2 - 1) * v.scale
			return { ...o, rotY: o.rotY + (rand() * 2 - 1) * turn, scale: o.scale * Math.max(0.05, s) }
		}),
	}
}

/** A short hash of a prefab's text, so its thumbnail is drawn again when the file changes. */
export function prefabHash(text: string): string {
	let h = 2166136261
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return (h >>> 0).toString(36)
}
