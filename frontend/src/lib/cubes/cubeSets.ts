// The author's sets of cubes (3dgame #73): a named list of the cube palette's tiles (shapes, kinds,
// later objects) kept at hand for a build.
// Sets are preferences (prefs.cubeSets), shared by every world. Pure data, so it runs in the tests.

import { cubeItem } from './palette'

export interface CubeSet {
	name: string
	/** Palette keys (`shape:<id>`, `kind:<id>`), in the order added. */
	items: string[]
}

export const newCubeSet = (name = 'New set'): CubeSet => ({ name, items: [] })

/** The set with the tile added at the end, or the same set if it holds it already or the key is no tile. */
export function withCubeItem(set: CubeSet, key: string): CubeSet {
	if (!cubeItem(key) || set.items.includes(key)) return set
	return { ...set, items: [...set.items, key] }
}

/** The set without the tile. */
export const withoutCubeItem = (set: CubeSet, key: string): CubeSet => ({ ...set, items: set.items.filter((k) => k !== key) })

/** The sets from the preferences, every field checked and keys that are no tile dropped, since the config file may hold anything. */
export function validCubeSets(value: unknown): CubeSet[] {
	if (!Array.isArray(value)) return []
	const out: CubeSet[] = []
	for (const v of value) {
		if (!v || typeof v !== 'object') continue
		const r = v as Record<string, unknown>
		if (typeof r.name !== 'string') continue
		const items = Array.isArray(r.items) ? r.items.filter((k): k is string => typeof k === 'string' && !!cubeItem(k)) : []
		out.push({ name: r.name, items: [...new Set(items)] })
	}
	return out
}

/** `base`, or `base 2`, `base 3`... when it is taken: a name for a new set that no other has. */
export function uniqueName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken)
	if (!set.has(base)) return base
	for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`
}
