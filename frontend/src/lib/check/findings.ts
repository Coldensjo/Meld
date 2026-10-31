// File › Check Map (#176): what a check reports. Each check is a pure function over plain data and
// probes (the ground's height, a floor test), so it can be tested on small synthetic maps; the Engine
// gathers the data and the Check Map window lists the findings.

/** How bad a finding is: an error shows wrong in the game, a warning probably does, info is tidying. */
export type Severity = 'error' | 'warning' | 'info'

/**
 * What a click on a finding selects. A template's finding (the World data group, #951) selects its
 * spawn nearest the camera, and its Edit button opens the template's editor on the column (`field`).
 */
export type FindingTarget =
	{ kind: 'models'; ids: number[] } | { kind: 'spawn'; key: string } | { kind: 'chunk'; chunk: number } | { kind: 'template'; key: string; template: 'creature' | 'object'; entry: number; field?: string } | { kind: 'none' }

/** A safe fix the window offers: delete the models, put them on the ground, or crop the chunk's water. */
export type FixKind = 'deleteModels' | 'groundModels' | 'cropWater'

export interface Finding {
	/** The check's name, which the window groups by. */
	check: string
	severity: Severity
	message: string
	/** Where the camera goes (world x, z); NaN for a finding with no place. */
	x: number
	z: number
	target: FindingTarget
	fix?: FixKind
	/** The window's group: 'world' for the checks of the world database (#951), the map's own checks without one. */
	group?: 'world'
}

/** A world box: min and max corners as [x, y, z]. */
export interface Box {
	min: [number, number, number]
	max: [number, number, number]
}

/** The most findings one check lists; past it, one more finding counts the rest. */
export const MAX_PER_CHECK = 200

/** Cuts a check's findings to MAX_PER_CHECK, with a last one that says how many more there were. */
export function capped(check: string, list: Finding[]): Finding[] {
	if (list.length <= MAX_PER_CHECK) return list
	const more = list.length - MAX_PER_CHECK
	const group = list[0].group
	return [...list.slice(0, MAX_PER_CHECK), { check, severity: 'info', message: `…and ${more} more like these.`, x: NaN, z: NaN, target: { kind: 'none' }, ...(group ? { group } : {}) }]
}
