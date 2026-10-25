// The creature guide asks the world database only once it is opened (#586): Factions and ClassLevelStats are not called while it is hidden, and are called after Tools > Creatures opens it. Nothing is written to the database.
// touches: frontend/src/components/CreaturesWorkspace.svelte, internal/vmangos/factions.go, internal/vmangos/classstats.go
const { ui } = await P.state()
const app = window.go.main.App
const calls = { Factions: 0, ClassLevelStats: 0 }
const orig = {}
for (const k of Object.keys(calls)) {
	orig[k] = app[k]
	app[k] = (...a) => {
		calls[k]++
		return orig[k](...a)
	}
}
try {
	ui.creatures = false
	await P.frames(5)
	const hidden = { ...calls }
	ui.creatures = true
	await P.until(() => calls.Factions > 0 && calls.ClassLevelStats > 0, 30_000, 'the guide asking')
	const opened = { ...calls }
	ui.creatures = false
	await P.frames(2)
	ui.creatures = true
	await P.frames(5)
	const factionsOnce = calls.Factions === opened.Factions
	ui.creatures = false
	await P.frames(1)
	return { ok: hidden.Factions === 0 && hidden.ClassLevelStats === 0 && factionsOnce, hidden, opened, factionsOnce }
} finally {
	for (const k of Object.keys(orig)) app[k] = orig[k]
	ui.creatures = false
}
