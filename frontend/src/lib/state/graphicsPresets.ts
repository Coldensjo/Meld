// Graphics › Quality (#203): presets that set every graphics preference at once, the lower ones
// turning off what only looks nice. The preset shown is the one whose values all match the prefs now,
// so it can never go stale; after any single change it is Custom (none).

/** The graphics preferences a preset sets (keys of `prefs`). */
export interface GraphicsValues {
	renderScale: number
	viewDistance: number
	shadows: 'off' | 'medium' | 'high'
	clouds: boolean
}

export interface GraphicsPreset {
	name: string
	values: GraphicsValues
}

export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = [
	{
		name: 'Low',
		values: { renderScale: 0.5, viewDistance: 0.6, shadows: 'off', clouds: false },
	},
	{
		name: 'Medium',
		values: { renderScale: 0.75, viewDistance: 0.6, shadows: 'off', clouds: false },
	},
	{
		name: 'High',
		values: { renderScale: 1, viewDistance: 1, shadows: 'medium', clouds: true },
	},
	{
		name: 'Very high',
		values: { renderScale: 1, viewDistance: 1.8, shadows: 'high', clouds: true },
	},
	{
		name: 'Extreme',
		values: { renderScale: 1.5, viewDistance: 1.8, shadows: 'high', clouds: true },
	},
]

const KEYS = Object.keys(GRAPHICS_PRESETS[0].values) as Array<keyof GraphicsValues>

/** The name of the preset whose values all match `p`, or null (Custom). */
export function presetOf(p: GraphicsValues): string | null {
	return GRAPHICS_PRESETS.find((g) => KEYS.every((k) => g.values[k] === p[k]))?.name ?? null
}

/** Writes preset `name`'s values into `p`. */
export function applyPreset(p: GraphicsValues, name: string) {
	const g = GRAPHICS_PRESETS.find((x) => x.name === name)
	if (g) Object.assign(p, g.values)
}
