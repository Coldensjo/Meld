import { parse } from 'smol-toml'
import { tomlString } from '../tools/doodadBrush'

// The author's own sets of models (#124): a named list of doodads and buildings, shown in the asset
// browser's Sets tab to place from. Sets are preferences (prefs.modelSets), shared by every map, and
// travel as TOML files so they can be shared and edited by hand, as doodad brushes do.

export interface ModelSet {
	name: string
	/** Model types as the catalog keys them, "m2:<path>" or "wmo:<path>", in the order added. */
	models: string[]
}

export const SET_FILE_HEADER = '# Meld model set: doodads and buildings to place from'

/** A doodad or building type (not a texture, a template or one of the editor's helper shapes). */
export const isModelKey = (key: string) => key.startsWith('m2:') || key.startsWith('wmo:')

/** Two keys of the same model: the client's paths aren't case-sensitive, and old tiles say .mdx for .m2. */
export const sameModel = (a: string, b: string) => normModel(a) === normModel(b)
const normModel = (k: string) => k.toLowerCase().replace(/\.mdx$/, '.m2')

export function newSet(name = 'New set'): ModelSet {
	return { name, models: [] }
}

/** The set with the model added at the end, or the same set if it holds it already. */
export function withModel(set: ModelSet, key: string): ModelSet {
	if (!isModelKey(key) || set.models.some((m) => sameModel(m, key))) return set
	return { ...set, models: [...set.models, key] }
}

/** The set without the model. */
export function withoutModel(set: ModelSet, key: string): ModelSet {
	return { ...set, models: set.models.filter((m) => !sameModel(m, key)) }
}

/** The set as TOML: its name and its models, one a line. */
export function formatSet(set: ModelSet): string {
	const lines = [SET_FILE_HEADER, `name = ${tomlString(set.name)}`, 'models = [']
	for (const m of set.models) lines.push(`  ${tomlString(m)},`)
	lines.push(']')
	return lines.join('\n') + '\n'
}

export interface ParsedSet {
	set: ModelSet | null
	/** One message per thing that couldn't be read. A set with a bad model is still returned without it. */
	errors: string[]
}

/** Reads a set written by `formatSet` (or by hand). */
export function parseSet(text: string): ParsedSet {
	let doc: Record<string, unknown>
	try {
		doc = parse(text)
	} catch (e) {
		return { set: null, errors: [`not valid TOML: ${e instanceof Error ? e.message : e}`] }
	}
	const errors: string[] = []
	const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : ''
	if (!name) errors.push('the set has no name')
	let set = newSet(name || 'Imported set')
	if (doc.models !== undefined && !Array.isArray(doc.models)) {
		errors.push('models must be a list of "m2:<path>" or "wmo:<path>" strings')
	} else {
		;((doc.models as unknown[] | undefined) ?? []).forEach((m, i) => {
			if (typeof m !== 'string' || !isModelKey(m)) errors.push(`model ${i + 1}: must be "m2:<path>" or "wmo:<path>"`)
			else set = withModel(set, m)
		})
	}
	return { set, errors }
}

/** The sets from the preferences, every field checked, since the config file may hold anything. */
export function validSets(value: unknown): ModelSet[] {
	if (!Array.isArray(value)) return []
	const out: ModelSet[] = []
	for (const v of value) {
		if (!v || typeof v !== 'object') continue
		const r = v as Record<string, unknown>
		if (typeof r.name !== 'string') continue
		out.push({ name: r.name, models: Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === 'string' && isModelKey(m)) : [] })
	}
	return out
}
