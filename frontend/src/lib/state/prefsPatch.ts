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
