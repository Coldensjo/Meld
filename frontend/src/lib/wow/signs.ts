import type { SearchItem } from './search'

// The client's sign models, for Swap sign (#843): in 1.12 a road sign's words are painted in its
// model's texture, so changing what a signpost says means swapping its model for another sign.

/** A doodad path with "sign" in it, but not "design" or "assign". */
const SIGN = /(?<!de|as)sign/i
/** Of those, the road signs: posts, pointers and the directional signs along the roads. */
const ROAD = /signpost|pointer|directional|streetsign/i

/** The path of an `m2:` type, else null. */
function m2Path(type: string): string | null {
	return type.startsWith('m2:') ? type.slice(3).split('?')[0] : null
}

/** Whether a placed object's type is a sign doodad (`m2:` with "sign" in its path). */
export function isSignModel(type: string): boolean {
	const p = m2Path(type)
	return p !== null && SIGN.test(p)
}

/** Whether a sign model's path is a road sign's (a post, pointer or directional sign). */
export function isRoadSign(path: string): boolean {
	return ROAD.test(path)
}

/**
 * The sign doodads of the client's catalog, in the order Swap sign lists them: those in the folder of
 * `current` (the selected sign's type) first, then by path, so the signs that go with it are on top.
 */
export function signModels(catalog: readonly SearchItem[], current = ''): SearchItem[] {
	const p = m2Path(current)
	const folder = p ? p.slice(0, p.lastIndexOf('\\') + 1).toLowerCase() : ''
	const inFolder = (it: SearchItem) => (folder && it.path.toLowerCase().startsWith(folder) && !it.path.slice(folder.length).includes('\\') ? 0 : 1)
	return catalog.filter((it) => it.kind === 'm2' && it.key.startsWith('m2:') && SIGN.test(it.path)).sort((a, b) => inFolder(a) - inFolder(b) || a.path.localeCompare(b.path))
}
