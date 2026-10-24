// View › Layer slice (#30): what the menu and the , and . keys do to `ui.cubeSlice`, which the
// active cube world's CubeLayer follows each frame.

import { setStatus, ui } from '../state/editor.svelte'
import { LAYER_COUNT } from './world'
import { THEMES, themeOf } from './mesher'

/** The slice in words, for the status bar. */
export function sliceText(s = ui.cubeSlice) {
	if (s.mode === 'off') return 'Layer slice off: every layer shown (, and . slice).'
	const side = s.mode === 'below' ? 'and below' : 'and above'
	return `Layer slice: layer ${s.layer} (${THEMES[themeOf(s.layer)]}) ${side} (, up a layer, . down).`
}

/** Sets the slice's mode, keeping its layer, and says so. */
export function setSliceMode(mode: 'off' | 'above' | 'below') {
	ui.cubeSlice = { mode, layer: ui.cubeSlice.layer }
	setStatus(sliceText(), 3000)
}

/** Moves the slice a layer up (-1) or down (+1); with the slice off, it starts showing the layer and those below. */
export function stepSlice(dir: number) {
	const s = ui.cubeSlice
	const layer = s.mode === 'off' ? s.layer : Math.max(0, Math.min(LAYER_COUNT - 1, s.layer + dir))
	ui.cubeSlice = { mode: s.mode === 'off' ? 'below' : s.mode, layer }
	setStatus(sliceText(), 3000)
}
