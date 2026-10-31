/**
 * A biome made from a zone of the client (#957), as the New world page makes its texture pack and
 * trees from one: the zone's ground textures sorted into the roles (texturePack.ts `packPalette`), the
 * ground effect each carries in the client's tiles, and its trees and bushes and its rocks as two
 * scattered brushes at the zone's own density (zoneTrees.ts `zoneScatter`).
 */
import { newBiome, BIOME_ROLES, type Biome } from '../terrain/biome'
import type { GroundEffectTables } from '../world/groundEffects'
import { packPalette, type TextureUse } from './texturePack'
import { zoneScatter, type DoodadUse } from './zoneTrees'

/** The plants grow from this many yards over the sea, clear of the shore's sand, as on a new world. */
const BEACH = 2

/** The biome of a zone's textures and models, or null when the zone has no ground. */
export function biomeFromZone(name: string, textures: TextureUse[], doodads: DoodadUse[], landArea: number, tables: GroundEffectTables | null): Biome | null {
	const palette = packPalette(textures)
	if (!palette) return null
	const b = newBiome(name, palette.slice(0, BIOME_ROLES.length))
	// A role that only fell back to another's texture is left empty, so the window shows what the zone has.
	for (let r = 1; r < b.textures.length; r++) if (b.textures.indexOf(b.textures[r]) < r) b.textures[r] = ''
	for (const p of b.textures) {
		const id = p ? tables?.textures[p.toLowerCase()] : undefined
		if (id !== undefined) b.effects[p] = id
	}
	const s = zoneScatter(doodads, landArea)
	for (const [brush, density, clumps] of [
		[s.plants, s.plantDensity, true],
		[s.rocks, s.rockDensity, false],
	] as const) {
		if (!brush || density <= 0) continue
		if (brush.rules) brush.rules.height = [BEACH, 1e5]
		brush.name = `${name}: ${brush.name.toLowerCase()}`
		b.scatter.push({ brush, density, clumps })
	}
	return b
}
