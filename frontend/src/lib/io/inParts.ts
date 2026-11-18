// Sending a value too large for one binding call to Go in parts: Wails refuses a call whose body
// passes 64 MB ("assembled body too large"), which a big region's edit and a big map's file pass.
import { DropRegionEditParts, SendRegionEditPart } from '../wails/App'

/**
 * The most characters of a value's JSON one binding call carries. A larger one goes to Go in parts of
 * this size; the JSON of a part is escaped again in the call, which leaves this far under the limit.
 */
export const PART_CHARS = 16_000_000

let sends = 0

/**
 * Hands a value to Go: whole, through `whole`, when its JSON fits one binding call, else in parts
 * through SendRegionEditPart and then `parts` with their id, which joins and takes them. `kind` starts
 * the id ("region", "map"). Parts given up halfway are dropped.
 */
export async function sendInParts<V, T>(kind: string, value: V, whole: (v: V) => Promise<T>, parts: (id: string) => Promise<T>): Promise<T> {
	const json = JSON.stringify(value)
	if (json.length <= PART_CHARS) return whole(value)
	const id = `${kind}-${Date.now()}-${++sends}`
	let sent = false
	try {
		for (let at = 0, i = 0; at < json.length; at += PART_CHARS, i++) await SendRegionEditPart(id, i, json.slice(at, at + PART_CHARS))
		sent = true
	} finally {
		if (!sent) await DropRegionEditParts(id).catch(() => {})
	}
	return parts(id)
}
