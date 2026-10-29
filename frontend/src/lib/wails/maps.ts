// Wails v3 types a Go map as an object whose values may be undefined, and one with integer keys as keyed
// by `${number}`, which a number can't index (#854). A map that crossed the bridge holds no undefined
// values, and its integer keys index as numbers, so these give it the type v2 gave it.

/** A Go map[string]V read from a binding. */
export function goMap<V>(m: { [k: string]: V | undefined }): Record<string, V> {
	return m as Record<string, V>
}

/** A Go map with integer keys (map[uint32]V and the like) read from a binding. */
export function goIntMap<V>(m: { [k: `${number}`]: V | undefined }): Record<number, V> {
	return m as Record<number, V>
}
