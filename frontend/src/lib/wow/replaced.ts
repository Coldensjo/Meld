// The client files an import wrote over the current client's own copy (#878's Replace, the result's
// `replaced`), sorted into what the page caches of them (#922): the models (a WMO group file stands
// for its root, whose model holds the groups) and the textures. Paths are kept lower-case with
// backslashes, as `loadTexture` keys its cache and materials name their texture.

export interface ReplacedFiles {
	/** The models: `.m2`/`.mdx` paths and WMO roots. */
	models: Set<string>
	/** The `.blp` textures. */
	textures: Set<string>
}

/** `path` lower-case with backslashes. */
export function normPath(path: string): string {
	return path.replace(/\//g, '\\').toLowerCase()
}

/** Sorts the replaced client paths into models and textures; other files (sounds, tables) are left out. */
export function replacedFiles(paths: Iterable<string>): ReplacedFiles {
	const out: ReplacedFiles = { models: new Set(), textures: new Set() }
	for (const raw of paths) {
		const p = normPath(raw)
		if (p.endsWith('.blp')) out.textures.add(p)
		else if (p.endsWith('.m2') || p.endsWith('.mdx')) out.models.add(p)
		else if (p.endsWith('.wmo')) out.models.add(p.replace(/_\d{3}\.wmo$/, '.wmo'))
	}
	return out
}

/**
 * The model path of a model type or thumbnail key (`m2:<path>`, `wmo:<path>`, either with a query
 * after '?': a spawn's look, a WMO's doodad set), lower-case; '' for anything else.
 */
export function modelPathOf(key: string): string {
	if (!key.startsWith('m2:') && !key.startsWith('wmo:')) return ''
	const p = key.slice(key.indexOf(':') + 1)
	const q = p.indexOf('?')
	return normPath(q < 0 ? p : p.slice(0, q))
}

/** Whether the thumbnail of `key` (a model type, or `tex:<path>`) shows one of the replaced files itself. */
export function thumbReplaced(key: string, files: ReplacedFiles): boolean {
	if (key.startsWith('tex:')) return files.textures.has(normPath(key.slice(4)))
	const p = modelPathOf(key)
	return p !== '' && files.models.has(p)
}
