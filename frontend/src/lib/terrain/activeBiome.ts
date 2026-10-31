import { prefs } from '../state/editor.svelte'
import type { Biome } from './biome'

/** The biome Paint › Apply Biome lays (#957): `prefs.biome`, else the first one; null with none made. */
export function activeBiome(): Biome | null {
	return prefs.biomes.find((b) => b.name === prefs.biome) ?? prefs.biomes[0] ?? null
}
