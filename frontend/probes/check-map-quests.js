// File › Check Map's quest checks (#952) against the real world database: with Tharnariun Treetender (creature 3701) on the map, his Plagued Lands (2118) asks to capture a Rabid Thistle Bear (11836) that has no spawn and no script or spell row that summons it, so it is a warning under Quest objectives that points at him; Innkeeper Farley's (295) quests have no error; the finding's Edit opens the quest editor on 2118; nothing saved.
// touches: frontend/src/lib/check/quests.ts, frontend/src/lib/world/questChain.ts, frontend/src/lib/check/run.ts, frontend/src/components/CheckMapWindow.svelte, internal/vmangos/questcheck.go, internal/vmangos/worlddata.go
const e = P.e
const { ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
if (!templates.length) return { ok: false, why: 'no object templates: the world database is not reachable' }
// A creature spawn needs no look here: an object spawn's fields, as a creature (as check-map-world does).
const base = se.newObjectSpawn(templates[0], 999_999_961, 100, 0, 100, 0)
const tharnariun = { ...base, kind: 'monster', entry: 3701, name: 'Tharnariun Treetender', waypoints: [] }
const farley = { ...base, kind: 'monster', guid: 999_999_962, entry: 295, name: 'Innkeeper Farley', x: 140, waypoints: [] }
const layer = e.activeDocument().spawnLayer
layer.set([tharnariun, farley])
se.syncSpawnUi(layer, true)
e.controller.target.set(110, 0, 100)

const { findings } = await e.checkMap()
const quests = findings.filter((f) => f.group === 'world' && f.check.startsWith('Quest'))
const bear = quests.find((f) => f.check === 'Quest objectives' && f.message.includes('(quest 2118)') && f.message.includes('creature 11836'))
const farleyErrors = quests.filter((f) => f.severity === 'error' && f.target.kind === 'quest' && [70, 69, 2158].includes(f.target.quest))
const failed = findings.find((f) => f.check === 'World data' && /quests weren't checked/.test(f.message))

// The window: the finding's Edit opens the quest editor on the quest.
ui.checkMap = true
await P.until(() => [...document.querySelectorAll('aside.check li')].some((li) => li.textContent.includes('creature 11836')), 60_000, 'the window to list the bear')
const li = [...document.querySelectorAll('aside.check li')].find((l) => l.textContent.includes('creature 11836'))
;[...li.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit')?.click()
await P.until(() => ui.questEditor, 10_000, 'the quest editor slot')
const editorOn = { ...ui.questEditor }
ui.questEditor = null
ui.checkMap = false
await P.frames(2)
return {
	quests: quests.map((f) => `${f.severity} ${f.check}: ${f.message}`),
	failed: failed?.message,
	editorOn,
	ok: !failed && bear?.severity === 'warning' && bear.target.kind === 'quest' && bear.target.quest === 2118 && bear.target.key !== undefined && bear.x === 100 && farleyErrors.length === 0 && editorOn.entry === 2118,
}
