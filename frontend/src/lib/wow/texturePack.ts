/**
 * Texture packs for a new world (#733): the ground textures a zone of the client uses (`ZoneTextures`,
 * by share of the zone's ground, the seabed left out), sorted into the palette's roles so
 * `Terrain.autoPaint` paints the world with them: 0 grass (the zone's main ground), 1 lush, 2 dirt,
 * 3 rock, 4 sand, 5 snow, 6 cobblestone and 7 dirt path (layers.ts). A role the zone has no texture
 * for takes the nearest role's, so Duskwood's shore is its dirt and Tanaris's peaks its rock.
 */

/** A texture and its share of the zone's ground (vmangos.TextureUse). */
export interface TextureUse {
	path: string
	share: number
}

export type TextureKind = 'snow' | 'road' | 'sand' | 'rock' | 'dirt' | 'grass' | 'other'

// By the file name, first match wins: sand before rock for Tanaris's SandStones, road before rock
// for cobblestones.
const KINDS: [TextureKind, RegExp][] = [
	['snow', /snow|ice|frost|glacier/],
	['road', /cobble|brick|road|paved|flagstone|floor|plank|tile/],
	['sand', /sand|beach|shore|dune/],
	['rock', /rock|cliff|stone|boulder|crag|slate|granite|mountain/],
	['dirt', /dirt|mud|ground|soil|path|crack|gravel|ash|earth|clay|trail|pebble/],
	['grass', /grass|flower|leaf|leaves|moss|fern|clover|weed|lush|bush|needle|meadow|forest/],
]

/** What kind of ground a tileset is, by its file name. */
export function kindOf(path: string): TextureKind {
	const file = path.slice(path.lastIndexOf('\\') + 1).toLowerCase()
	for (const [kind, re] of KINDS) if (re.test(file)) return kind
	return 'other'
}

/** A texture under this share of the zone is a detail (a decal, a patch), never a role's. */
const MIN_SHARE = 0.01

/** Where a role with no texture of its own looks next. */
const FALLBACK: Record<number, number> = { 1: 0, 2: 0, 3: 2, 4: 2, 5: 3, 6: 2, 7: 2 }

/**
 * The palette for a zone's textures, a path per role (eight), or null when the zone has no ground.
 * Each role takes the most used texture of its kind not taken by an earlier role; the main ground is
 * the most used of any kind but rock, snow and road.
 */
export function packPalette(uses: TextureUse[]): string[] | null {
	const list = uses.filter((u) => u.share >= MIN_SHARE).map((u) => ({ path: u.path, kind: kindOf(u.path) }))
	const taken = new Set<string>()
	const pick = (ok: (k: TextureKind) => boolean): string | null => {
		const hit = list.find((u) => !taken.has(u.path) && ok(u.kind))
		if (!hit) return null
		taken.add(hit.path)
		return hit.path
	}
	const ground = (k: TextureKind) => k !== 'rock' && k !== 'snow' && k !== 'road'
	const roles: (string | null)[] = new Array(8).fill(null)
	roles[0] = pick(ground) ?? pick(() => true)
	if (!roles[0]) return null
	// Lush patches are the zone's grass, or in a zone without (a desert) more of its main ground's kind.
	const base = kindOf(roles[0])
	roles[1] = pick((k) => k === 'grass') ?? pick((k) => k === base) ?? pick(ground)
	roles[3] = pick((k) => k === 'rock')
	roles[5] = pick((k) => k === 'snow')
	roles[4] = pick((k) => k === 'sand')
	roles[2] = pick((k) => k === 'dirt') ?? pick(ground)
	roles[6] = pick((k) => k === 'road')
	roles[7] = pick(() => true)
	for (let r = 1; r < roles.length; r++) {
		let from = r
		while (!roles[from] && from !== 0) from = FALLBACK[from]
		roles[r] = roles[from]
	}
	return roles as string[]
}
