// The editors each listen for Esc on the window, and which listener runs first depends on the order
// the editors mounted in (#640), so the key is claimed once instead: the first editor that takes
// it closes itself and the rest leave it alone. A WeakSet, since a synthetic event isn't cancelable
// and `defaultPrevented` would not hold.
const taken = new WeakSet<Event>()

/** True for the first caller per event, false for every later one. */
export function takeEscape(e: Event): boolean {
	if (taken.has(e)) return false
	taken.add(e)
	return true
}
