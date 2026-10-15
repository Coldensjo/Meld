import { LoadPrefs, SavePrefs } from '../../../wailsjs/go/main/App'
import { hasBackend } from '../io/mapio'
import { prefs, type Prefs } from './editor.svelte'
import { changedPrefs } from './prefsPatch'

// Preferences live in the Go-side config file (reliable across platforms,
// unlike webview storage). Unknown/invalid keys are ignored on load.

/**
 * The dev page opened with `?nosave` never writes the config file. The desktop window and a browser
 * page on `wails dev` share one file and each writes all of its preferences, so a test in the page
 * would otherwise overwrite what the user set in the window.
 */
const readOnly = typeof location !== 'undefined' && /[?&]nosave(?:[&=]|$)/.test(location.search)

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
  if (!hasBackend()) return
  try {
    const raw = await LoadPrefs()
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<Prefs>
    for (const k of Object.keys(prefs) as (keyof Prefs)[]) {
      const ok = Array.isArray(prefs[k]) ? Array.isArray(saved[k]) : typeof saved[k] === typeof prefs[k]
      if (ok) {
        ;(prefs as Record<string, unknown>)[k] = saved[k]
        baseline.set(k, JSON.stringify(saved[k]))
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

/** Debounced save of the preferences that changed. */
export function savePrefs() {
  if (!canSave()) return
  clearTimeout(timer)
  timer = setTimeout(() => void send(), 400)
}
