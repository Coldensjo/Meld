// Groups raw client paths into palette categories and zones using path
// keywords. Order matters: the first matching rule wins.

export interface CatalogItem {
	key: string // "m2:<path>", "wmo:<path>" or "tex:<path>"
	path: string
	name: string
	category: string
	zone: string
}

type Rule = [string, RegExp]

const DOODAD_RULES: Rule[] = [
	['Effects', /particle|emitter|\\fx\\|energytrail|waterfall|\\spells?\\|beam|aura|glow|lightshaft|sparkle/],
	['Ground Clutter', /\\detail\\/],
	['Holiday', /christmas|valentine|lunarnewyear|summerfestival|thanksgiving|halloween|carnival|holiday|winterveil/],
	['Trees', /(?<!s)tree|pine|canopy|palm|willow|bamboo|stump|\blogs?\b|log\d|sapling|trunk/],
	['Graves & Bones', /grave|tomb|coffin|skull|bone|skeleton|corpse|crypt|headstone/],
	['Bushes & Plants', /bush|shrub|plant|flower|fern|grass|cactus|vine|reed|lily|kelp|weed|thorn|mushroom|shroom|\bhay|crop|pumpkin|seaweed|coral|shell/],
	['Rocks', /rock|boulder|cliff|crystal|pebble|\bore\b|lava|stalag|(?<!tomb|head)stone/],
	['Weapons & Armor', /weapon|armor|sword|\baxe|shield|gun|\bbows?\b|spear|mace|target|cannon/],
	['Food & Kitchen', /food|fruit|bowl|plate|\bcups?\b|mug|bread|meat|fish|cheese|bottle|kitchen|cauldron|stove/],
	['Fences & Walls', /fence|wall|gate|railing|barricade|palisade|\bposts?\b|spike|battlement|barrier/],
	['Lights & Fire', /lamp|lantern|light|torch|brazier|candle|fire|sconce/],
	['Containers', /barrel|crate|\bbox(es)?\b|chest|sack|basket|\bbags?\b|keg|bucket|\bjugs?\b|\bpots?\b|vase|\burns?\b/],
	['Furniture & Decor', /chair|table|bench|\bbeds?\b|shelf|stool|cabinet|book|desk|throne|rug|carpet|counter|anvil|forge|wardrobe|rack|cloth|artwork|painting|tapestr|curtain|statuette|bars?\\|implement/],
	['Signs & Banners', /sign|banner|flag|totem|standard|marker|plaque/],
	['Vehicles & Boats', /boat|ship|cart|wagon|canoe|raft|zeppelin|catapult|tram|machine|parts/],
	['Debris & Rubble', /debris|rubble|plank|scrap|junk|wreck|ruin|broken|metalbars/],
	['Structures', /bridge|dock|pier|tent|hut|tower|pillar|column|statue|obelisk|arch|well|windmill|scaffold|stair|shrine|altar|door|rune/],
	['Interactive', /goober|activedoodad/],
]

const BUILDING_RULES: Rule[] = [
	['Dungeons & Caves', /dungeon|cave|mine\b|mines|tunnel|instance|crypt|catacomb/],
	['Human', /human|stormwind|goldshire|westfall|duskwood|elwynn|redridge|lordaeron|stratholme|arathi|hillsbrad|stromgarde|lakeshire|theramore/],
	['Orc & Horde', /orc|orgrimmar|horde|grunt|durotar|barrens|crossroads/],
	['Night Elf', /nightelf|night_elf|darnassus|elven|teldrassil|ashenvale|auberdine|moonglade/],
	['Dwarf & Gnome', /dwarf|ironforge|gnome|gnomer|thelsamar|menethil|kharanos/],
	['Undead', /undead|undercity|scourge|plague|necro|brill|tirisfal/],
	['Tauren', /tauren|thunderbluff|thunder_bluff|mulgore/],
	['Troll', /troll|zul|jungle/],
	['Goblin', /goblin|booty|ratchet|gadget|everlook/],
	['Bridges, Towers & Walls', /bridge|tower|wall|gate|keep|castle|fort|bastion/],
]

const TEXTURE_RULES: Rule[] = [
	['Grass', /grass|lawn|meadow|moss|flower|leaf|fern/],
	['Dirt & Mud', /dirt|mud|soil|earth|ground|crop|farm/],
	['Rock', /rock|stone(?!.*cobble)|cliff|granite|gravel|boulder|crag/],
	['Roads & Cobble', /cobble|road|path|brick|tile|pave/],
	['Sand', /sand|beach|desert|dune/],
	['Snow & Ice', /snow|ice|frost/],
]

function classify(path: string, rules: Rule[]): string {
	const l = path.toLowerCase()
	for (const [name, re] of rules) if (re.test(l)) return name
	return 'Other'
}

const pretty = (s: string) =>
	s
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/\b\w/g, (c) => c.toUpperCase())

const CONTINENTS = new Set(['azeroth', 'kalimdor', 'outland', 'expansion01', 'wmo', 'dungeon', 'dungeons', 'tileset'])

/**
 * Zone filter value. Buildings group by continent (World\wmo\<Continent>);
 * doodads/textures by the first zone folder, e.g. "Elwynn" or "Generic Human".
 */
function zoneOf(kind: 'm2' | 'wmo' | 'tex', path: string): string {
	const segs = path.split('\\').slice(1, -1)
	if (kind === 'wmo') return pretty(segs[1] ?? 'Misc')
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i]
		if (CONTINENTS.has(s.toLowerCase())) continue
		if (s.toLowerCase() === 'generic' && segs[i + 1] && !/doodad/i.test(segs[i + 1])) return 'Generic ' + pretty(segs[i + 1])
		return pretty(s)
	}
	return 'Misc'
}

const nameOf = (p: string) => pretty(p.slice(p.lastIndexOf('\\') + 1).replace(/\.(m2|wmo|blp)$/i, ''))

export function buildCatalog(kind: 'm2' | 'wmo' | 'tex', paths: string[]): CatalogItem[] {
	const rules = kind === 'm2' ? DOODAD_RULES : kind === 'wmo' ? BUILDING_RULES : TEXTURE_RULES
	return paths.map((path) => ({
		key: `${kind}:${path}`,
		path,
		name: nameOf(path),
		category: classify(path, rules),
		zone: zoneOf(kind, path),
	}))
}

export function categoryOrder(kind: 'm2' | 'wmo' | 'tex'): string[] {
	const rules = kind === 'm2' ? DOODAD_RULES : kind === 'wmo' ? BUILDING_RULES : TEXTURE_RULES
	return [...rules.map((r) => r[0]), 'Other']
}
