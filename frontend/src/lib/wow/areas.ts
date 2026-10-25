import { Areas } from '../../../wailsjs/go/main/App'
import type { vmangos } from '../../../wailsjs/go/models'
import { hasBackend } from '../io/backend'
// The client's zones and subzones (AreaTable.dbc), read once through the Areas binding, which the
// Map data tool paints into chunks and the readouts name chunks by.

let list: vmangos.Area[] = []
let byId = new Map<number, vmangos.Area>()
let loading: Promise<vmangos.Area[]> | null = null

/** The client's areas, by map and then name; read on the first call. Empty without the desktop app or a client. */
export function loadAreas(): Promise<vmangos.Area[]> {
	if (!loading) {
		loading = (hasBackend() ? Areas() : Promise.resolve([]))
			.then((a) => {
				list = a ?? []
				byId = new Map(list.map((x) => [x.id, x]))
				return list
			})
			.catch((err) => {
				console.warn('areas not read', err)
				loading = null
				return []
			})
	}
	return loading
}

/** Reads the client's areas again (after the zone editor saved), so names and the picker see the changes. */
export function reloadAreas(): Promise<vmangos.Area[]> {
	loading = null
	return loadAreas()
}

/** An area's name, with its zone's for a subzone ("Goldshire, Elwynn Forest"); '' for 0, and "Area <id>" for one not (yet) known. */
export function areaName(id: number): string {
	const a = byId.get(id)
	if (!a) return id ? `Area ${id}` : ''
	const parent = a.parent ? byId.get(a.parent) : undefined
	return parent ? `${a.name}, ${parent.name}` : a.name
}
