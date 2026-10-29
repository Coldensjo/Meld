// The per-map settings a tab switch swaps in and out of `editor` (Engine.stashActive, activate), apart
// from the runes state so the tests can drive them with a plain object (#437): the Engine passes
// `editor` in. A new per-map editor field goes in DocMeta, DOC_META_KEYS, stashMeta and loadMeta;
// tests/docMeta.test.ts fails when one of them misses it.
import type { editor } from '../state/editor.svelte'
import { copyPaths } from '../terrain/paths'
import { copyReference } from '../terrain/referenceImage'
import { noScopedEffects, type ScopedEffects } from '../world/groundEffects'
import type { DocMeta } from './MapDocument'

type Editor = typeof editor

/** The part of `editor` a document's meta is copied from and into. */
export type MetaEditor = Pick<
	Editor,
	| 'mapName'
	| 'filePath'
	| 'dirty'
	| 'palette'
	| 'bookmarks'
	| 'waterLevel'
	| 'waterEnabled'
	| 'paintLayer'
	| 'sculptPaintLayer'
	| 'roles'
	| 'textureEffects'
	| 'textureLooks'
	| 'scopedEffects'
	| 'reference'
	| 'paths'
	| 'pathId'
	| 'pathPoint'
	| 'flattenLock'
> & { water: Pick<Editor['water'], 'lock' | 'lockPos'> }

/**
 * Every key of DocMeta, optional ones too: the compiler fails here when one is added to DocMeta and
 * not to this list, and the test then checks that stashMeta writes it and loadMeta reads it.
 */
export const DOC_META_KEYS: Record<keyof DocMeta, true> = {
	mapName: true,
	filePath: true,
	dirty: true,
	palette: true,
	region: true,
	vmangos: true,
	bookmarks: true,
	waterLevel: true,
	waterEnabled: true,
	paintLayer: true,
	sculptPaintLayer: true,
	roles: true,
	textureEffects: true,
	textureLooks: true,
	scopedEffects: true,
	reference: true,
	paths: true,
	flattenLock: true,
	waterLock: true,
}

// The scoped effects as plain JSON first: `editor`'s are a Svelte proxy, which structuredClone refuses.
const plainScoped = (s: ScopedEffects): ScopedEffects => JSON.parse(JSON.stringify(s)) as ScopedEffects

/**
 * A copy of the live editor state as a document's meta. `prev` is the document's meta until now, for
 * what the editor does not hold: the region and the client map it was opened as.
 */
export function stashMeta(e: MetaEditor, prev: DocMeta): DocMeta {
	return {
		mapName: e.mapName,
		filePath: e.filePath,
		dirty: e.dirty,
		palette: [...e.palette],
		waterLevel: e.waterLevel,
		waterEnabled: e.waterEnabled,
		paintLayer: e.paintLayer,
		sculptPaintLayer: e.sculptPaintLayer,
		roles: { ...e.roles },
		textureEffects: { ...e.textureEffects },
		textureLooks: { ...e.textureLooks },
		scopedEffects: structuredClone(plainScoped(e.scopedEffects)),
		reference: copyReference(e.reference),
		paths: copyPaths(e.paths),
		region: prev.region,
		vmangos: prev.vmangos,
		bookmarks: [...e.bookmarks],
		flattenLock: { ...e.flattenLock },
		waterLock: { on: e.water.lock, pos: { ...e.water.lockPos } },
	}
}

/**
 * Copies a document's meta into the editor, as copies, so an edit in the editor never reaches the
 * stashed meta. The region and client map are the Engine's to show (labels, tile borders).
 */
export function loadMeta(e: MetaEditor, m: DocMeta) {
	e.mapName = m.mapName
	e.filePath = m.filePath
	e.dirty = m.dirty
	e.palette = [...m.palette]
	e.bookmarks = [...m.bookmarks]
	e.waterLevel = m.waterLevel
	e.waterEnabled = m.waterEnabled
	e.paintLayer = m.paintLayer
	e.sculptPaintLayer = m.sculptPaintLayer
	e.roles = { ...m.roles }
	e.textureEffects = { ...m.textureEffects }
	e.textureLooks = { ...m.textureLooks }
	e.scopedEffects = structuredClone(m.scopedEffects ?? noScopedEffects())
	e.reference = copyReference(m.reference)
	e.paths = copyPaths(m.paths ?? [])
	e.pathId = -1
	e.pathPoint = -1
	// The locked points are positions on one map; another map starts unlocked (#449).
	e.flattenLock = { ...(m.flattenLock ?? { on: false, x: 0, y: 0, z: 0 }) }
	e.water.lock = m.waterLock?.on ?? true
	e.water.lockPos = { ...(m.waterLock?.pos ?? { x: 0, y: 0, z: 0 }) }
}
