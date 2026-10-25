import type { WorldObject } from './ObjectLayer'

/**
 * The text form of a list of models, one per line, tab-separated: type, x, z, height above the
 * ground, turn in radians, scale, then tilt forward-back and roll in radians. Tabs (not spaces)
 * separate the fields, because model paths can contain spaces. Lines starting with '#' are
 * comments. Lists written before tilt have six fields, and still read; their models are not tilted.
 */
export const OBJECT_LIST_HEADER = '# Meld object list: type, x, z, height above ground, turn (radians), scale, tilt forward-back (radians), roll (radians)'

/** The models that stand on their own (attached models are placed relative to their parent, so they're left out). */
export function formatObjectList(objects: Iterable<WorldObject>): string {
	const lines = [OBJECT_LIST_HEADER]
	for (const o of objects) {
		if (o.parent !== undefined) continue
		lines.push([o.type, o.x, o.z, o.yOff, o.rotY, o.scale, o.tiltX ?? 0, o.tiltZ ?? 0].join('\t'))
	}
	return lines.join('\n') + '\n'
}

export interface ParsedObjectList {
	objects: Array<Omit<WorldObject, 'id'>>
	/** One message per line that couldn't be read, with its line number. */
	errors: string[]
}

export function parseObjectList(text: string): ParsedObjectList {
	const objects: Array<Omit<WorldObject, 'id'>> = []
	const errors: string[] = []
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim()
		if (line === '' || line.startsWith('#')) return
		const f = raw.split('\t')
		if (f.length !== 6 && f.length !== 8) {
			errors.push(`line ${i + 1}: expected 6 or 8 tab-separated fields, found ${f.length}`)
			return
		}
		const [type, x, z, yOff, rotY, scale, tiltX, tiltZ] = f.map((s) => s.trim())
		if (!type.startsWith('m2:') && !type.startsWith('wmo:')) {
			errors.push(`line ${i + 1}: "${type}" is not a model`)
			return
		}
		const nums = [x, z, yOff, rotY, scale].map(Number)
		if (nums.some((n, k) => (k === 4 ? !(n > 0) : !Number.isFinite(n)))) {
			errors.push(`line ${i + 1}: a number is missing or not valid`)
			return
		}
		const tilts = f.length === 8 ? [tiltX, tiltZ].map(Number) : []
		if (tilts.some((n) => !Number.isFinite(n))) {
			errors.push(`line ${i + 1}: a tilt is missing or not valid`)
			return
		}
		const [px, pz, py, prot, pscale] = nums
		const o: Omit<WorldObject, 'id'> = { type, x: px, z: pz, yOff: py, rotY: prot, scale: pscale }
		if (tilts.length) [o.tiltX, o.tiltZ] = tilts
		objects.push(o)
	})
	return { objects, errors }
}
