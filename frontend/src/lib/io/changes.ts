// The Changes window (#959): what Compile, Save Spawns and Publish will write, before they write it. It
// asks the Go side for the same builds the writes make (RegionPending, SpawnEditSQL, PublishPending),
// which write nothing, and lists the file names and rows, never the files themselves.
import { PublishPending, RegionPending, SpawnEditSQL, VmangosPath, WaitingClientFiles } from '../wails/App'
import type { Engine } from '../engine/Engine'
import { editor } from '../state/editor.svelte'
import type { vmangos } from '../wails/models'
import { regionEdit, regionName } from './compile'
import { publishInput } from './publish'

/** What the window lists for the active map. */
export type ChangesView = {
	/** What the list is for: "Compile Azeroth 32_48", "Publish MyMap". */
	title: string
	/** The client files the write puts into Meld's patch. */
	files: vmangos.FileChange[]
	/** How many tiles the region or map has, beside the ones `files` lists. */
	tiles: number
	/** Files an earlier write left waiting for the game to close. */
	waiting: vmangos.FileChange[]
	/** The spawns Save Spawns (and Compile to Server and Compile All) write. */
	spawns: vmangos.SpawnChange[]
	/** Other rows of the world database (Publish's map_template). */
	rows: vmangos.RowChange[]
	/** Each spawn by guid as the editor has it (its original for a deleted one), for Go there. */
	spawnAt: Map<number, vmangos.WorldSpawn>
	/** Lines on what could not be listed, and why. */
	notes: string[]
}

const empty = (title: string): ChangesView => ({ title, files: [], tiles: 0, waiting: [], spawns: [], rows: [], spawnAt: new Map(), notes: [] })

/** Lists what the writes of the active map would change: a region's compile and spawns, or a client map's publish. */
export async function loadChanges(engine: Engine): Promise<ChangesView> {
	const region = engine.activeRegion()
	let view: ChangesView
	if (region) {
		view = empty(`Compile ${regionName(region)}`)
		const res = await RegionPending(regionEdit(engine, region))
		view.files = res.list ?? []
		view.tiles = res.tiles
		await addSpawns(engine, view)
	} else {
		const p = publishInput(engine)
		if (typeof p === 'string') {
			view = empty('Changes')
			view.notes.push(
				engine.activeVmangos() ? p : 'This map is not a part of a continent or a map made for the client, so nothing of it is written into the game. Open one with File › Open Part of Azeroth…, or make one with File › New World…',
			)
			return view
		}
		view = empty(`Publish ${p.dir}`)
		const res = await PublishPending(p.spec)
		view.files = res.files ?? []
		view.tiles = res.tiles
		view.rows = res.rows ?? []
		view.notes.push(...p.notes.map((n) => `${n[0].toUpperCase()}${n.slice(1)}.`))
	}
	view.waiting = await WaitingClientFiles().catch(() => [])
	return view
}

/** Adds the region's spawn edits, as the SQL Save Spawns runs lists them, when a server folder is set. */
async function addSpawns(engine: Engine, view: ChangesView) {
	const b = editor.regionBlock
	const edits = engine.spawnEdits()
	if (!b || !editor.regionMap || !edits.length) return
	if (!(await VmangosPath())) {
		view.notes.push(`${edits.length} spawn ${edits.length === 1 ? 'edit waits' : 'edits wait'} for a VMaNGOS server folder (Edit › Preferences › Folders) before they can be listed or saved.`)
		return
	}
	const res = await SpawnEditSQL(editor.regionMap, b.x, b.y, b.size, edits, 'vmangos')
	view.spawns = res.spawns ?? []
	for (const e of edits) view.spawnAt.set(e.spawn.guid, e.deleted && e.original ? e.original : e.spawn)
	for (const s of res.skipped ?? []) view.notes.push(`Not written: ${s}.`)
}
