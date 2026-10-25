import { LoadPrefs, SavePrefs } from '../../../wailsjs/go/main/App'
import { hasBackend } from '../io/backend'
import { prefs, type Prefs } from './editor.svelte'
import { changedPrefs, prefShapeOk, prefValueOk } from './prefsPatch'

// Preferences live in the Go-side config file (reliable across platforms,
// unlike webview storage). Unknown/invalid keys are ignored on load.

/**
 * The dev page opened with `?nosave` never writes the config file. The desktop window and a browser
 * page on `wails dev` share one file and each writes all of its preferences, so a test in the page
 * would otherwise overwrite what the user set in the window.
 */
const readOnly = typeof location !== 'undefined' && /[?&]nosave(?:[&=]|$)/.test(location.search)

/**
 * The probes' page (`?defaults`) skips loading the file, so every preference keeps its default and a
 * probe doesn't depend on the owner's time of day, shadows, fog or panel sizes (#253). Used with
 * `?nosave`, so the defaults are never written either.
 */
const useDefaults = typeof location !== 'undefined' && /[?&]defaults(?:[&=]|$)/.test(location.search)

function canSave() {
	return hasBackend() && !readOnly
}

/**
 * Each preference as it was last read from or written to the file (its JSON), so a save sends only
 * the keys that changed since. Two windows share the file, and Go merges the keys sent over what the
 * file holds, so a window that only turned the fog off doesn't write its stale brushes over the
 * other's new ones. A key never saved is absent here and goes out on the first save.
 */
const baseline = new Map<string, string>()

export async function loadPrefs() {
	if (!hasBackend() || useDefaults) return
	try {
		const raw = await LoadPrefs()
		if (!raw) return
		const saved = JSON.parse(raw) as Partial<Prefs>
		for (const k of Object.keys(prefs) as (keyof Prefs)[]) {
			if (!(k in saved)) continue
			if (prefValueOk(prefs[k], saved[k]) && prefShapeOk(k, saved[k])) {
				;(prefs as Record<string, unknown>)[k] = saved[k]
				baseline.set(k, JSON.stringify(saved[k]))
			} else {
				// Rejected: keep the default, but count it as already saved, so the next save doesn't
				// overwrite what the file holds until the user changes the preference themselves.
				console.warn('ignored preference with the wrong shape:', k)
				baseline.set(k, JSON.stringify(prefs[k]))
			}
		}
	} catch (e) {
		console.warn('failed to load preferences', e)
	}
}

/** Sends the changed preferences and, once they are written, takes them as the new baseline. */
async function send() {
	const patch = changedPrefs(prefs as unknown as Record<string, unknown>, baseline)
	if (!patch) return
	try {
		await SavePrefs(patch.json)
		for (const [k, v] of patch.keys) baseline.set(k, v)
	} catch (e) {
		console.warn('failed to save preferences', e)
	}
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Writes the preferences now, for the moment before the app quits. */
export async function flushPrefs() {
	if (!canSave()) return
	clearTimeout(timer)
	await send()
}

/** Saves one preference alone, without the walk over every key that `send` does (the session, every 3 s). */
export async function savePref(key: keyof Prefs) {
	if (!canSave()) return
	const v = JSON.stringify(prefs[key])
	if (v === undefined || baseline.get(key) === v) return
	try {
		await SavePrefs(`{${JSON.stringify(key)}:${v}}`)
		baseline.set(key, v)
	} catch (e) {
		console.warn('failed to save preference', key, e)
	}
}

/** Debounced save of the preferences that changed. */
export function savePrefs() {
	if (!canSave()) return
	clearTimeout(timer)
	timer = setTimeout(() => void send(), 400)
}
