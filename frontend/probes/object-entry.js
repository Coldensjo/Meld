// A game object spawn turned into another object in the game object editor (#136): its entry, name and model change as one undo step, the SQL writes the new id, the pool's other vein shows, and undo turns it back.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/SpawnBrowser.svelte, frontend/src/lib/world/spawnEdits.ts, frontend/src/lib/world/SpawnLayer.ts, internal/vmangos/spawnedit.go
const e = P.e
const { editor, ui } = await P.state()
const se = await P.app('/src/lib/world/spawnEdits.ts')
const { spawnKey } = await P.app('/src/lib/world/SpawnLayer.ts')
const { loadObjectTemplates } = await P.app('/src/components/SpawnBrowser.svelte')
e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const templates = await loadObjectTemplates()
const byEntry = (n) => templates.find((t) => t.entry === n)
const thorium = byEntry(324) // Small Thorium Vein
const truesilver = byEntry(2047) // Truesilver Deposit
if (!thorium || !truesilver) return { ok: false, why: 'the world database lacks entries 324 and 2047' }
// Two veins of one pool on one spot, as the database has them in Silithus (guids 23510 and 23539).
const vein = Object.assign(se.newObjectSpawn(thorium, 23510, 100, 50, 100, 0), { pool: 22973, poolLimit: 1, poolName: 'Truesilver Deposit / Small Thorium Vein' })
const mate = Object.assign(se.newObjectSpawn(truesilver, 23539, 100, 50, 100, 0), { pool: 22973, poolLimit: 1, poolName: 'Truesilver Deposit / Small Thorium Vein' })
const layer = e.activeDocument().spawnLayer
layer.set([vein, mate])
se.syncSpawnUi(layer, true)
const key = spawnKey(vein)
se.selectSpawn(vein)
ui.objectEditor = { key, entry: 324 }
const root = () => document.querySelector('[aria-label="Game object editor"]')
const title = () => root()?.querySelector('h2')?.textContent ?? ''
const rows = () => [...(root()?.querySelectorAll('[aria-label="Game objects"] button.row') ?? [])]
await P.until(() => rows().length > 0 && title() === 'Small Thorium Vein', 60_000, 'the editor and its object list')
const category = root().querySelector('.pick select').value
const poolRow = [...root().querySelectorAll('.spawn-fields button.row')].map((b) => b.textContent.replace(/\s+/g, ' ').trim())
const row = rows().find((b) => b.title === 'Entry 2047')
if (!row) return { ok: false, why: 'Truesilver Deposit is not listed under ' + category }
row.click()
await P.until(() => layer.get(key)?.entry === 2047 && title() === 'Truesilver Deposit', 30_000, 'the entry change')
const changed = { ...layer.get(key) } // a copy: the undo below changes the spawn itself
const edits = layer.edits()
const sql = await window.go.main.App.SpawnEditSQL('Azeroth', 32, 48, 1, edits)
const label = e.history.peek()?.label
e.undo()
await P.until(() => title() === 'Small Thorium Vein', 30_000, 'the editor to follow the undo')
const back = { ...layer.get(key) }
ui.objectEditor = null
return {
	ok:
		category === 'Ore' &&
		poolRow.some((t) => t.startsWith('Truesilver Deposit') && t.includes('same spot')) &&
		changed.name === 'Truesilver Deposit' &&
		changed.model === truesilver.model &&
		edits.length === 1 &&
		sql.sql.includes('UPDATE `gameobject` SET `id` = 2047,') &&
		(sql.skipped ?? []).length === 0 &&
		back.entry === 324 &&
		back.model === thorium.model &&
		layer.edits().length === 0,
	category,
	poolRow,
	label,
	model: changed.model,
	skipped: sql.skipped,
	afterUndo: { entry: back.entry, name: back.name, edits: layer.edits().length },
}
