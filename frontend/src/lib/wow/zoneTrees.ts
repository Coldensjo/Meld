/**
 * A new world's trees, bushes and rocks (#758): the models a zone of the client places on its dry
 * ground (`ZoneDoodads`, by count), sorted by path into plants (trees and bushes) and rocks, and
 * made into two doodad brushes that `Engine.scatterWorld` fills the world with, as thickly as the
 * zone itself is covered. Buildings, fences, camp props, critters and the like are left out.
 */
import { newEntry, type DoodadBrush, type PlacementRules } from '../tools/doodadBrush'

/** A model a zone places, and how often (vmangos.DoodadUse). */
export interface DoodadUse {
	path: string
	count: number
	scaleMin: number
	scaleMax: number
}

export type DoodadKind = 'tree' | 'bush' | 'rock'

/** Never scattered, though a word below matches: a tombstone, a stone wall, a rock in a camp. */
const LEFT_OUT = /fence|gate|tomb|grave|ruin|wall|lamp|post|barrel|crate|jar|sack|fire|torch|bone|skull|critter|butterfl|house|build|sign|cart|bridge|statue|stair|tent|banner|pumpkin|corpse|web|crystal|totem|pier|boat|log ?pile|wagon/

// By the path, first match wins: a "trees" folder's stump is a tree's, a "bush" folder's grass a bush's.
const KINDS: [DoodadKind, RegExp][] = [
	['tree', /\\trees?\\|\\spooklesstrees\\|tree|palm|pine|oak|willow|birch|cactus/],
	['bush', /\\bush(es)?\\|\\plants?\\|bush|shrub|fern|plant|reed|cattail|thorn|mushroom|flower|weed/],
	['rock', /\\rocks?\\|\\cliffrocks?\\|rock|boulder|stone|pebble/],
]

/** What a model is by its path, or null for one a new world doesn't scatter. */
export function doodadKind(path: string): DoodadKind | null {
	const p = path.toLowerCase()
	if (LEFT_OUT.test(p)) return null
	for (const [kind, re] of KINDS) if (re.test(p)) return kind
	return null
}

/** Models of a kind kept in a brush, the most placed first: a few make the look, the rest are rare. */
const MAX_MODELS = 8
/** A model placed fewer times than this share of its kind's is a one-off (a landmark tree). */
const MIN_SHARE = 0.02

/** A zone's scatter: the plants and the rocks, and how many of each stand on 100 by 100 yards of its dry ground. */
export interface ZoneScatter {
	plants: DoodadBrush | null
	rocks: DoodadBrush | null
	/** Placements per 10,000 square yards. */
	plantDensity: number
	rockDensity: number
}

/** The brushes' spacing, a multiple of the models' footprints. */
const SPACING = 0.6

/** Where plants grow on a new world: above the beach, off steep slopes, below the snow. Set per world by `worldRules`. */
const PLANT_SLOPE = 30
/** Rocks lie on steeper ground than plants grow on, but not on cliffs. */
const ROCK_SLOPE = 45

function rules(maxSlope: number): PlacementRules {
	return { slope: [0, maxSlope], height: null, aboveSea: true, onTextures: [], offTextures: [], textureMin: 0.5, avoidWater: true, avoidHoles: true }
}

/** The brush of a zone's models (one kind's), by count, or null with none. */
function brushOf(name: string, uses: DoodadUse[], maxSlope: number, max = MAX_MODELS): DoodadBrush | null {
	const total = uses.reduce((s, u) => s + u.count, 0)
	const kept = uses.filter((u) => u.count >= total * MIN_SHARE).slice(0, max)
	if (!kept.length) return null
	return {
		name,
		// A zone's woods let canopies overlap a little.
		spacing: SPACING,
		entries: kept.map((u) => {
			const e = newEntry('m2:' + u.path, u.count)
			// The zone's own range, kept sane: Tanaris's rocks go up to 4.8 times.
			e.scaleMin = Math.min(2, Math.max(0.4, u.scaleMin))
			e.scaleMax = Math.min(2.5, Math.max(e.scaleMin, u.scaleMax))
			return e
		}),
		rules: rules(maxSlope),
	}
}

/**
 * A zone's scatter from its placed models and dry ground (`landArea`, square yards), the most placed
 * plants and rocks each, weighted by how often the zone places them.
 */
export function zoneScatter(uses: DoodadUse[], landArea: number): ZoneScatter {
	const plants: DoodadUse[] = []
	const rocks: DoodadUse[] = []
	for (const u of uses) {
		const k = doodadKind(u.path)
		if (k === 'rock') rocks.push(u)
		else if (k) plants.push(u)
	}
	const per = (list: DoodadUse[]) => (landArea > 0 ? (list.reduce((s, u) => s + u.count, 0) / landArea) * 1e4 : 0)
	return { plants: brushOf('Trees and bushes', plants, PLANT_SLOPE), rocks: brushOf('Rocks', rocks, ROCK_SLOPE), plantDensity: per(plants), rockDensity: per(rocks) }
}

/**
 * Sets a scatter's height rules for a world: from `beach` yards above its sea (clear of the shore's
 * sand) up to `top` yards above it (below the snow line), for both brushes.
 */
export function worldRules(s: ZoneScatter, beach: number, top: number) {
	for (const b of [s.plants, s.rocks]) if (b?.rules) b.rules.height = [beach, Math.max(beach, top)]
}

/** A model set's cover, per 10,000 square yards: a light wood with a few rocks. */
const SET_PLANTS = 12
const SET_ROCKS = 3

/**
 * The scatter of a model set from the asset browser (wow/modelSets.ts): its doodads (not its
 * buildings), the rocks among them by path and the rest as plants, each as likely, scaled 0.8 to 1.2.
 */
export function setScatter(models: string[]): ZoneScatter {
	const plants: DoodadUse[] = []
	const rocks: DoodadUse[] = []
	for (const m of models) {
		if (!m.startsWith('m2:')) continue
		const u = { path: m.slice(3), count: 1, scaleMin: 0.8, scaleMax: 1.2 }
		if (doodadKind(u.path) === 'rock') rocks.push(u)
		else plants.push(u)
	}
	return {
		plants: brushOf('Trees and bushes', plants, PLANT_SLOPE, Infinity),
		rocks: brushOf('Rocks', rocks, ROCK_SLOPE, Infinity),
		plantDensity: plants.length ? SET_PLANTS : 0,
		rockDensity: rocks.length ? SET_ROCKS : 0,
	}
}
