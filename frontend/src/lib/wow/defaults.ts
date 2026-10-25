import { listAssets } from './api'
import { LAYERS } from '../terrain/layers'

// Default tileset per palette entry, matching each entry's role (auto-paint relies
// on 0 grass, 1 lush, 2 dirt, 3 rock, 4 sand, 5 snow). First match wins.
const SLOT_PATTERNS: RegExp[][] = [
	[/elwynn\\elwynngrassbase\.blp$/i, /grass/i],
	[/elwynn\\elwynnflowerbase\.blp$/i, /elwynn.*grass/i, /flower/i],
	[/elwynn\\elwynndirtbase\.blp$/i, /dirt/i],
	[/elwynn\\elwynnrockbase\.blp$/i, /rock/i],
	[/westfall.*sand/i, /barrens.*sand/i, /tanaris.*sand/i, /sand/i],
	[/dunmorogh.*snow/i, /winterspring.*snow/i, /snow/i],
	[/elwynn\\elwynncobblestonebase\.blp$/i, /cobble/i],
	[/elwynn\\elwynndirtmud\.blp$/i, /mud/i],
]

/** The default palette: a tileset per entry where the client has one, else the entry's colour. */
export async function defaultLayerTextures(): Promise<string[]> {
	const list = await listAssets('tileset')
	return SLOT_PATTERNS.map((patterns, i) => {
		for (const re of patterns) {
			const hit = list.find((p) => re.test(p))
			if (hit) return hit
		}
		return LAYERS[i].swatch
	})
}
