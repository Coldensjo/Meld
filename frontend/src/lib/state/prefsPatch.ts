// The preferences patch a save sends (see prefs.ts): kept apart from the bindings so it can be tested.

/** The keys whose value differs from the baseline, as the JSON patch to send; null when nothing changed. */
export function changedPrefs(current: Record<string, unknown>, base: Map<string, string>): { json: string; keys: Map<string, string> } | null {
	const keys = new Map<string, string>()
	const parts: string[] = []
	for (const k of Object.keys(current)) {
		const v = JSON.stringify(current[k])
		if (v === undefined || base.get(k) === v) continue
		keys.set(k, v)
		parts.push(`${JSON.stringify(k)}:${v}`)
	}
	return parts.length ? { json: `{${parts.join(',')}}`, keys } : null
}

/**
 * Whether `v` may replace a preference whose current value is `current`: the same type, arrays for
 * arrays, and finite numbers (JSON has no NaN, but a hand-written scene could hold anything).
 * Shared by loadPrefs (the file) and parseScene (a pasted scene), so neither writes a mistyped value.
 */
export function prefValueOk(current: unknown, v: unknown): boolean {
	if (Array.isArray(current)) return Array.isArray(v)
	if (v === null) return current === null
	if (Array.isArray(v)) return false
	if (typeof v === 'number') return typeof current === 'number' && Number.isFinite(v)
	return typeof v === typeof current
}

// Shape checks for the preferences that hold nested data. `prefValueOk` only compares top-level
// types, so `{"entries": 3}` for a doodad brush or a session tab without `map` would pass it and
// crash the tool or the restore later (#447). A check is a function from an unknown to whether it
// has the shape; the parts are built from the small ones below.

type Check = (v: unknown) => boolean

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const str: Check = (v) => typeof v === 'string'
const bool: Check = (v) => typeof v === 'boolean'
const arr =
	(item: Check): Check =>
	(v) =>
		Array.isArray(v) && v.every(item)
const opt =
	(c: Check): Check =>
	(v) =>
		v === undefined || c(v)
const orNull =
	(c: Check): Check =>
	(v) =>
		v === null || c(v)
const oneOf =
	(...values: string[]): Check =>
	(v) =>
		typeof v === 'string' && values.includes(v)
const obj =
	(fields: Record<string, Check>): Check =>
	(v) =>
		isObj(v) && Object.keys(fields).every((k) => fields[k](v[k]))
const pair: Check = (v) => Array.isArray(v) && v.length === 2 && v.every(num)
const triple: Check = (v) => Array.isArray(v) && v.length === 3 && v.every(num)

const rules = obj({ slope: pair, height: orNull(pair), aboveSea: bool, onTextures: arr(str), offTextures: arr(str), textureMin: num, avoidWater: bool, avoidHoles: bool })
const doodadEntry = obj({ type: str, weight: num, scaleMin: opt(num), scaleMax: opt(num), sink: opt(num), tilt: opt(num), align: opt(num) })
const doodadBrush = obj({ name: str, spacing: num, entries: arr(doodadEntry), rules: opt(rules) })
// Fields added after the first release are optional here: an older saved value must still load.
const stackItem = obj({
	tool: oneOf('sculpt', 'paint'),
	on: bool,
	mode: str,
	texture: str,
	radius: num,
	strength: num,
	falloff: num,
	rotation: num,
	inheritRadius: opt(bool),
	inheritStrength: opt(bool),
	inheritRotation: opt(bool),
})
const spawnEntry = obj({
	entry: num,
	name: opt(str),
	subname: opt(str),
	levelMin: opt(num),
	levelMax: opt(num),
	faction: opt(num),
	npcFlags: opt(num),
	rank: opt(num),
	type: opt(num),
	display: opt(num),
	scale: opt(num),
	equipment: opt(num),
	weight: opt(num),
})
const spawnBrush = obj({
	entries: arr(spawnEntry),
	density: opt(num),
	spacing: opt(num),
	levelMin: opt(num),
	levelMax: opt(num),
	movement: opt(oneOf('stay', 'random')),
	wander: opt(num),
	respawnSecs: opt(num),
	facing: opt(oneOf('random', 'centre')),
	maxSlope: opt(num),
	avoidWater: opt(bool),
	rules: opt(rules),
})
const projectInfo = obj({ name: str, path: str, clientPath: str })
const sessionTab = obj({
	map: (v) => isObj(v) && (str(v.file) || obj({ region: obj({ mapName: str, x: num, y: num, size: num }) })(v) || obj({ world: obj({ mapName: str }) })(v)),
	view: obj({ target: triple, yaw: num, pitch: num, distance: num }),
})

const shapes: Record<string, Check> = {
	doodadBrushes: arr(doodadBrush),
	brushStacks: arr(obj({ name: str, items: arr(stackItem) })),
	modelSets: arr(obj({ name: str, models: arr(str) })),
	spawnBrush,
	fitGround: obj({ margin: num, falloff: num, mode: oneOf('lower', 'raise', 'both'), holes: bool, reach: num }),
	prefabVary: obj({ on: bool, turn: num, scale: num, drop: num }),
	session: obj({ tabs: arr(sessionTab), active: num }),
	project: orNull(projectInfo),
	recentProjects: arr(projectInfo),
	browserViews: (v) => isObj(v) && Object.values(v).every(obj({ query: str, category: str, zone: str, scroll: num })),
	pinnedMaps: arr(num),
	shownEvents: arr(num),
	collapsedPanels: arr(str),
	recentAssets: arr(str),
	favoriteAssets: arr(str),
	keymap: (v) => isObj(v) && Object.values(v).every(arr(str)),
	scriptBrushTags: (v) => isObj(v) && Object.values(v).every((t) => isObj(t) && Object.values(t).every((x) => num(x) || str(x) || bool(x))),
}

/** Whether `v` has the nested shape the preference `key` needs; true for a key with no nested data. */
export function prefShapeOk(key: string, v: unknown): boolean {
	const check = shapes[key]
	return check ? check(v) : true
}
