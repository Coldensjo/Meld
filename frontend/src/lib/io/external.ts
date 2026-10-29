// File › Connect to External Database (#856): the databases of a VMaNGOS server on another machine,
// read from a copy of its mangosd.conf (Meld stores no password), after a warning that names them.
// The connection lasts the session (app_external.go). While it is on, the database editors read and
// write it, and what writes into the local server folder or drives the local server is off.
import { BrowseExternalConf, ConnectExternalDatabase, DisconnectExternalDatabase, ExternalDatabaseInfo, ReadExternalDatabase } from '../wails/App'
import { hasBackend } from './backend'
import type { Engine } from '../engine/Engine'
import { setStatus, ui } from '../state/editor.svelte'
import type { vmangos } from '../wails/models'
import { refreshServerStatus } from './game'
import { reloadAllSpawns, unsavedSpawnRegions } from './region'

/** "world on db.example.org:3306": a database as the warning and the status bar name it. */
export function databaseLabel(d: vmangos.DatabaseRef): string {
	return d.name ? `${d.name} on ${d.host}:${d.port}` : ''
}

/** Reads which external database is connected into ui.externalDb (the Go side keeps it across a page reload). */
export async function refreshExternal() {
	if (!hasBackend()) return
	try {
		const info = await ExternalDatabaseInfo()
		ui.externalDb = info.conf ? info : null
	} catch {
		ui.externalDb = null
	}
}

/**
 * Why the database can't be switched now, or '': an open database editor or unsaved spawn edits
 * hold rows read from the database in use, which a save would then write into the other one.
 */
function switchBlocked(engine: Engine | null): string {
	if (ui.creatureEditor || ui.objectEditor || ui.questEditor || ui.itemEditor || ui.spellEditor || ui.characterEditor) return 'close the database editors first'
	const unsaved = engine ? unsavedSpawnRegions(engine) : []
	if (unsaved.length) return `save or revert the spawn changes in ${unsaved.join(', ')} first (File › Save Spawns to Database…)`
	return ''
}

/** File › Connect to External Database…: picks the mangosd.conf, then shows the warning (the externalDb dialog). */
export async function chooseExternalDatabase(engine: Engine | null) {
	if (!hasBackend()) return
	const blocked = switchBlocked(engine)
	if (blocked) {
		setStatus(`Not connected to an external database: ${blocked}.`, 8000)
		return
	}
	try {
		const path = await BrowseExternalConf()
		if (!path) return
		ui.externalDbPending = await ReadExternalDatabase(path)
		ui.dialog = 'externalDb'
	} catch (e) {
		setStatus(`That mangosd.conf can't be used: ${e}`, 10000)
	}
}

/** The warning's Connect: connects to the pending database, then reads the open regions' spawns from it. */
export async function connectExternal(engine: Engine | null) {
	const pending = ui.externalDbPending
	ui.externalDbPending = null
	if (!hasBackend() || !pending) return
	const blocked = switchBlocked(engine)
	if (blocked) {
		setStatus(`Not connected to an external database: ${blocked}.`, 8000)
		return
	}
	setStatus(`Connecting to ${databaseLabel(pending.world)}…`, 20000)
	try {
		ui.externalDb = await ConnectExternalDatabase(pending.conf)
		setStatus(`Connected to the external database ${databaseLabel(ui.externalDb.world)}. Edits to the server's tables now change that server.`, 10000)
	} catch (e) {
		setStatus(`Not connected to the external database: ${e}`, 12000)
		return
	}
	await refreshServerStatus()
	if (engine) reloadAllSpawns(engine)
}

/** File › Disconnect External Database: back to the server folder's own databases. */
export async function disconnectExternal(engine: Engine | null) {
	if (!hasBackend() || !ui.externalDb) return
	const blocked = switchBlocked(engine)
	if (blocked) {
		setStatus(`Still connected to the external database: ${blocked}.`, 8000)
		return
	}
	try {
		await DisconnectExternalDatabase()
	} catch (e) {
		setStatus(`${e}`, 8000)
		return
	}
	ui.externalDb = null
	setStatus('Disconnected from the external database: Meld uses the VMaNGOS server folder’s databases again.', 8000)
	await refreshServerStatus()
	if (engine) reloadAllSpawns(engine)
}
