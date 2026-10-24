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
// types, so a session tab without `map` would pass it and crash the restore later (#447). A check is a function from an unknown to whether it
// has the shape; the parts are built from the small ones below.

type Check = (v: unknown) => boolean

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const str: Check = (v) => typeof v === 'string'
const arr =
	(item: Check): Check =>
	(v) =>
		Array.isArray(v) && v.every(item)
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
const triple: Check = (v) => Array.isArray(v) && v.length === 3 && v.every(num)

const projectInfo = obj({ name: str, path: str })
const sessionTab = obj({
	map: obj({ file: str }),
	view: obj({ target: triple, yaw: num, pitch: num, distance: num }),
})

const shapes: Record<string, Check> = {
	cubeSets: arr(obj({ name: str, items: arr(str) })),
	cubeTab: oneOf('cubes', 'sets', 'prefabs', 'props'),
	session: obj({ tabs: arr(sessionTab), active: num }),
	project: orNull(projectInfo),
	recentProjects: arr(projectInfo),
}

/** Whether `v` has the nested shape the preference `key` needs; true for a key with no nested data. */
export function prefShapeOk(key: string, v: unknown): boolean {
	const check = shapes[key]
	return check ? check(v) : true
}
