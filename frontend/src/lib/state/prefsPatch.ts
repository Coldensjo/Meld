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
