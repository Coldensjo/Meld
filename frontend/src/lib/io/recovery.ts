import { DropRecovery, EndRecovery, ListRecovery, LoadRecoveryWorld, SaveRecoveryWorld } from '../../../wailsjs/go/main/App'
import { main, recovery } from '../../../wailsjs/go/models'
import type { Engine } from '../engine/Engine'
import type { MapDocument } from '../engine/MapDocument'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { hasBackend } from './mapio'
import { CubeWorld } from '../cubes/world'

// Autosave (#177): every few minutes (Preferences › Autosave), each world with unsaved changes is
// copied, as a .world file (#65), into the recovery folder of the user cache (`internal/recovery`), and
// the copy goes once the world is saved, reverted or closed. A quit through File › Quit drops this
// session's copies; a crash, or closing the window on unsaved worlds, leaves them, and the next start
// offers them back.

/** How often the open tabs are looked at; a world is copied at most every `prefs.autosaveMinutes`. */
const CHECK_MS = 15_000
/** A little over Go's `recovery.Stale`: a session that crashed just before this start counts as gone by then. */
const RECHECK_MS = 35_000

/** Each tab's copy: its ID, the tab's change count it holds and when it was written. */
const copies = new Map<number, { id: string; changes: number; at: number }>()
/** When each dirty tab without a copy was first seen dirty, so its first copy also waits the interval. */
const dirtySince = new Map<number, number>()
let busy = false

/** Copies the dirty tabs every so often. Returns a stop function. */
export function startAutosave(engine: Engine) {
	if (!hasBackend()) return () => {}
	const timer = setInterval(() => void autosave(engine), CHECK_MS)
	return () => clearInterval(timer)
}

const pathOf = (engine: Engine, d: MapDocument) => (d === engine.activeDocument() ? editor.filePath : d.meta.filePath)
const nameOf = (engine: Engine, d: MapDocument) => (d === engine.activeDocument() ? editor.mapName : d.meta.mapName)

/** One check of the open tabs, as the timer runs it (exported for the `autosave` probe). */
export async function autosave(engine: Engine) {
	// A save, compile or open in progress has the map half-written; the next check comes soon.
	if (busy || ui.busy) return
	busy = true
	try {
		const now = Date.now()
		const every = prefs.autosaveMinutes * 60_000
		const open = new Set<number>()
		let wrote = 0
		for (const d of [...engine.documents]) {
			open.add(d.id)
			const copy = copies.get(d.id)
			if (!engine.isDirty(d.id)) {
				dirtySince.delete(d.id)
				if (copy) await drop(d.id)
				continue
			}
			if (every <= 0) continue
			const changes = d.history.changes
			if (copy?.changes === changes) continue
			const since = copy?.at ?? dirtySince.get(d.id) ?? now
			dirtySince.set(d.id, since)
			if (now - since < every) continue
			// Mid-drag the cubes are half-edited and the history step not pushed: copy them after the drag.
			if (engine.isStroking()) continue
			const info = recovery.Info.createFrom({ name: nameOf(engine, d), file: pathOf(engine, d) })
			// A world's cubes are a few bytes a chunk and copied at once, so no edit can tear them.
			const saved = await SaveRecoveryWorld(d.id, info, main.WorldData.createFrom(d.world.toData()))
			copies.set(d.id, { id: saved.id, changes, at: Date.now() })
			dirtySince.delete(d.id)
			wrote++
		}
		// Closed tabs: their worlds were saved or thrown away.
		for (const id of [...copies.keys()]) if (!open.has(id)) await drop(id)
		for (const id of [...dirtySince.keys()]) if (!open.has(id)) dirtySince.delete(id)
		if (wrote) setStatus(`Autosaved ${wrote === 1 ? 'a recovery copy' : `${wrote} recovery copies`}.`, 2000)
	} catch (err) {
		console.warn('autosave failed', err)
		setStatus(`Autosave failed: ${err}`, 6000)
	} finally {
		busy = false
	}
}

async function drop(docId: number) {
	const copy = copies.get(docId)
	copies.delete(docId)
	if (copy) await DropRecovery(copy.id)
}

/** Drops this session's copies before a quit the author chose (every world saved, or discarded). */
export async function endAutosave() {
	if (!hasBackend()) return
	copies.clear()
	await EndRecovery().catch((err) => console.warn('recovery copies not dropped', err))
}

/** Lists the copies earlier sessions left behind, and opens the Recover dialog when there are any. */
export async function offerRecovery(retry = true) {
	if (!hasBackend()) return
	const list = await ListRecovery().catch(() => [])
	if (list?.length) {
		if (ui.dialog === null) ui.dialog = 'recovery'
	} else if (retry) {
		// A session that crashed moments before this start still looks alive; look once more later.
		setTimeout(() => void offerRecovery(false), RECHECK_MS)
	}
}

/** The copies earlier sessions left behind, newest first. */
export async function recoveryCopies(): Promise<recovery.Info[]> {
	return (await ListRecovery()) ?? []
}

const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** Opens a copy as a world with unsaved changes, in place of the tab of the same file when that tab has no changes of its own, as the session restore reopens it. */
export async function recover(engine: Engine, info: recovery.Info) {
	const world = CubeWorld.fromData(await LoadRecoveryWorld(info.id))
	const same = engine.documents.find((d) => !engine.isDirty(d.id) && !!info.file && samePath(pathOf(engine, d), info.file))
	engine.openWorld(world, info.name, info.file, same?.id)
	editor.dirty = true
	engine.refreshTabs()
	await DropRecovery(info.id)
	setStatus(`Recovered ${info.name}. Save it to keep it.`, 6000)
}

/** Throws a copy away. */
export function discard(info: recovery.Info) {
	return DropRecovery(info.id)
}
