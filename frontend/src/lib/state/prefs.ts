import { LoadPrefs, SavePrefs } from '../../../wailsjs/go/main/App'
import { hasBackend } from '../io/mapio'
import { prefs, type Prefs } from './editor.svelte'

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

export async function loadPrefs() {
  if (!hasBackend()) return
  try {
    const raw = await LoadPrefs()
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<Prefs>
    for (const k of Object.keys(prefs) as (keyof Prefs)[]) {
      const ok = Array.isArray(prefs[k]) ? Array.isArray(saved[k]) : typeof saved[k] === typeof prefs[k]
      if (ok) (prefs as Record<string, unknown>)[k] = saved[k]
    }
  } catch (e) {
    console.warn('failed to load preferences', e)
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Writes the preferences now, for the moment before the app quits. */
export async function flushPrefs() {
  if (!canSave()) return
  clearTimeout(timer)
  await SavePrefs(JSON.stringify(prefs)).catch((e) => console.warn('failed to save preferences', e))
}

/** Debounced save of the current preferences. */
export function savePrefs() {
  if (!canSave()) return
  clearTimeout(timer)
  const json = JSON.stringify(prefs)
  timer = setTimeout(() => SavePrefs(json).catch((e) => console.warn('failed to save preferences', e)), 400)
}
