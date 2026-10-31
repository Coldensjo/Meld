// The Changes window's lists (#959): the client files in their groups, and a line for each file and spawn.
import type { vmangos } from '../wails/models'

/** The file groups in the window's order, with their headings. */
export const FILE_GROUPS: [group: string, label: string][] = [
	['tile', 'Tiles'],
	['wdt', 'Map layout (WDT)'],
	['wdl', 'Far horizon (WDL)'],
	['dbc', 'Client tables (DBC)'],
	['minimap', 'Minimap'],
	['other', 'Other files'],
]

/** A heading of the client files and the files under it. */
export type FileGroup = { group: string; label: string; files: vmangos.FileChange[] }

/** Sorts files into the window's groups, in FILE_GROUPS order, leaving out the empty ones. */
export function groupFiles(files: vmangos.FileChange[]): FileGroup[] {
	const by = new Map<string, vmangos.FileChange[]>()
	for (const f of files) {
		const g = FILE_GROUPS.some(([k]) => k === f.group) ? f.group : 'other'
		const list = by.get(g)
		if (list) list.push(f)
		else by.set(g, [f])
	}
	return FILE_GROUPS.filter(([k]) => by.has(k)).map(([group, label]) => ({ group, label, files: by.get(group)! }))
}

/** A spawn change as one line: "Change Guard (guid 42): position, path". */
export function spawnLine(s: vmangos.SpawnChange): string {
	const verb = s.action === 'add' ? 'Add' : s.action === 'delete' ? 'Delete' : 'Change'
	const what = s.name || (s.object ? `object ${s.entry}` : `creature ${s.entry}`)
	const fields = s.action === 'change' && s.fields?.length ? `: ${s.fields.join(', ')}` : ''
	return `${verb} ${what} (guid ${s.guid})${fields}`
}

/** A tile file's line: its tile and reason, or the file's name and reason. */
export function fileLine(f: vmangos.FileChange): string {
	const name = f.tile || f.name.replace(/^.*[\\/]/, '')
	return f.reason ? `${name}: ${f.reason}` : name
}

/**
 * The count after a group's heading: for the tiles, how many of the region's or map's, and how many of
 * them sit beside the region (written for the models by its edge, #647).
 */
export function groupCount(g: FileGroup, tiles: number): string {
	if (g.group !== 'tile') return String(g.files.length)
	const beside = g.files.filter((f) => f.reason.startsWith('beside')).length
	const own = g.files.length - beside
	return `${own} of ${tiles}${beside ? `, and ${beside} beside the region` : ''}`
}
