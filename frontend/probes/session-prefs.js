// A session change (the camera moving) doesn't re-apply every preference to the engine (#461): prefs.session set to a new value runs Engine.applyPrefs zero times, while a real preference still runs it.
// touches: frontend/src/lib/state/prefs.ts, frontend/src/lib/state/prefsPatch.ts, frontend/src/App.svelte
const e = P.e
const { prefs } = await P.state()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const orig = e.applyPrefs.bind(e)
let calls = 0
e.applyPrefs = (p) => {
	calls++
	return orig(p)
}
const oldSession = prefs.session
prefs.session = { tabs: [], active: 0 }
await wait(300)
const afterSession = calls
const key = Object.keys(prefs).find((k) => typeof prefs[k] === 'boolean')
const old = prefs[key]
prefs[key] = !old
await wait(300)
const afterPref = calls
prefs[key] = old
await wait(100)
prefs.session = oldSession
e.applyPrefs = orig
return { ok: afterSession === 0 && afterPref >= 1, afterSession, afterPref, key }
