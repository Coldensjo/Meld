import { DropRecovery, EndRecovery, ListRecovery, LoadRecovery, SaveRecovery } from '../../../wailsjs/go/main/App'
import { recovery } from '../../../wailsjs/go/models'
import type { Engine } from '../engine/Engine'
import { regionLabel, type MapDocument, type RegionRef } from '../engine/MapDocument'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { fromMapData, hasBackend, reloadSpawns, toMapData } from './mapio'

// Autosave (#177): every few minutes (Preferences › Autosave), each map with unsaved changes is
// copied into the recovery folder of the user cache (`internal/recovery`), and the copy goes once the
// map is saved, reverted or closed. A quit through File › Quit drops this session's copies; a crash,
// or closing the window on unsaved maps, leaves them, and the next start offers them back.

/** How often the open tabs are looked at; a map is copied at most every `prefs.autosaveMinutes`. */
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

async function autosave(engine: Engine) {
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
			const region = d.meta.region
			const info = recovery.Info.createFrom({ name: nameOf(engine, d), file: pathOf(engine, d), region: region ? regionLabel(region) : '' })
			const saved = await SaveRecovery(d.id, info, toMapData(engine.snapshotOf(d)))
			copies.set(d.id, { id: saved.id, changes, at: Date.now() })
			dirtySince.delete(d.id)
			wrote++
		}
		// Closed tabs: their maps were saved or thrown away.
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

/** Drops this session's copies before a quit the author chose (every map saved, or discarded). */
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
const sameRegion = (a: RegionRef | null, b: { mapName: string; x: number; y: number; size: number } | null) =>
	!!a && !!b && a.mapName === b.mapName && a.x === b.x && a.y === b.y && a.size === b.size

/**
 * Opens a copy as a map with unsaved changes. It takes the place of the tab of the same map (its file,
 * or the same region) when that tab has no changes of its own, as the session restore reopens it.
 */
export async function recover(engine: Engine, info: recovery.Info) {
	const snap = fromMapData(await LoadRecovery(info.id))
	const same = engine.documents.find(
		(d) => !engine.isDirty(d.id) && (info.file ? samePath(pathOf(engine, d), info.file) : !pathOf(engine, d) && sameRegion(d.meta.region, snap.region)),
	)
	engine.openDocument(snap, info.file, same?.id)
	editor.dirty = true
	engine.refreshTabs()
	await DropRecovery(info.id)
	if (snap.region) reloadSpawns(engine)
	setStatus(`Recovered ${info.name}. Save it to keep it.`, 6000)
}

/** Throws a copy away. */
export function discard(info: recovery.Info) {
	return DropRecovery(info.id)
}
