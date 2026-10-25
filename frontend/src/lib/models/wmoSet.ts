// A placed WMO shows its global doodad set 0 and one more, the placement's doodad set (the tile's MODF
// entry). The editor names that set in the model's type as a query, "wmo:<path>?set=<n>", which the
// model endpoint draws and the export writes (internal/vmangos/modeltype.go). A type without one shows
// set 0 and, in a region, keeps the placement's own set on export (a map saved before sets were named);
// one picked in the Inspector is always written out, 0 included.

/** The type without its query: "m2:<path>" or "wmo:<path>". */
export function baseType(type: string): string {
	const q = type.indexOf('?')
	return q < 0 ? type : type.slice(0, q)
}

/** The doodad set a WMO type shows besides set 0; 0 for none, or for an M2. */
export function doodadSetOf(type: string): number {
	if (!type.startsWith('wmo:')) return 0
	const m = /[?&]set=(\d+)/.exec(type)
	return m ? Number(m[1]) : 0
}

/** A WMO type showing doodad set `set`, written out even for 0 so the export sets it. */
export function withDoodadSet(type: string, set: number): string {
	return `${baseType(type)}?set=${set}`
}
