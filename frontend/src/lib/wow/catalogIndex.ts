import { wow } from '../state/editor.svelte'
import { HELPERS } from '../models/helpers'
import { listAssets } from './api'
import { buildCatalog } from './catalog'
import { indexCatalog, type SearchItem } from './search'

// The whole client's searchable catalog (models, buildings and tilesets), read and indexed once per
// client and shared by every browser: the asset browser along the bottom and the brush editor's picker.

let indexed: Promise<SearchItem[]> | null = null
let indexedRevision = -1

/** The indexed catalog of the loaded client, fetched on the first call and again after the client changes. */
export function loadCatalog(): Promise<SearchItem[]> {
	if (indexed && indexedRevision === wow.revision) return indexed
	indexedRevision = wow.revision
	indexed = Promise.all([listAssets('m2'), listAssets('wmo'), listAssets('tileset')]).then(([m2, wmo, tex]) => [
		...indexCatalog('m2', buildCatalog('m2', m2)),
		...indexCatalog('wmo', buildCatalog('wmo', wmo)),
		...indexCatalog('tex', buildCatalog('tex', tex)),
		// The helper shapes (models/helpers.ts): placed like doodads, never exported.
		...indexCatalog(
			'm2',
			HELPERS.map((h) => ({ key: h.type, path: `Helpers\\${h.name}`, name: h.name, category: 'Helpers', zone: '' })),
		),
	])
	return indexed
}
