// Which of the options bar's controls show for the tool and its modes (#584): OptionsBar.svelte reads
// these through one `$derived`, and tests/optionsVisibility.test.ts checks them without the live app.
import type { editor as editorState } from '../state/editor.svelte'

/** The editor fields that decide the options bar's controls. */
export type OptionsState = Pick<typeof editorState, 'tool' | 'paintMode' | 'placeScatter' | 'waterMode' | 'sculptMode' | 'doodadMode' | 'sculptPaint' | 'paintSpray'> & {
	maskSelect: Pick<(typeof editorState)['maskSelect'], 'by'>
}

export interface OptionsVisibility {
	/** The tool paints with the brush circle (its size, strength and falloff). */
	usesBrush: boolean
	/** The water brush paints whole cells in a circle, so only its size applies. */
	paintingWater: boolean
	/** Sculpt's Vertex mode moves the selection at the brush strength and uses nothing else of the brush. */
	vertexMode: boolean
	holeMode: boolean
	/** The Map data tool marks whole chunks or cells under the brush, so only its size applies. */
	mapData: boolean
	/** The spawn brush (#171) takes only the brush's size. */
	spawnBrushing: boolean
	/** Tools with modes show the brush's size, strength and falloff right after them, on narrower sliders, so the row fits (#715, #734). */
	sizeAfterModes: boolean
	sliderWidth: number
	falloffOnBar: boolean
	/** The settings panel under the bar holds what the tool sets once and leaves alone (#715, #734). */
	hasPanel: boolean
	sculptPainting: boolean
	spraying: boolean
	/** The panel button's text, naming what the panel holds. */
	panelLabel: string
	/** The panel button's tooltip. */
	panelTitle: string
}

export function optionsVisibility(s: OptionsState): OptionsVisibility {
	const usesBrush =
		s.tool === 'sculpt' ||
		(s.tool === 'paint' && !(s.paintMode === 'mask' && s.maskSelect.by !== 'brush')) ||
		s.tool === 'road' ||
		s.tool === 'water' ||
		s.tool === 'clear' ||
		s.tool === 'doodad' ||
		s.tool === 'mapdata' ||
		s.tool === 'stamp' ||
		(s.tool === 'place' && s.placeScatter)
	const paintingWater = s.tool === 'water' && s.waterMode === 'paint'
	const vertexMode = s.tool === 'sculpt' && s.sculptMode === 'vertex'
	const holeMode = s.tool === 'sculpt' && s.sculptMode === 'hole'
	const mapData = s.tool === 'mapdata'
	const spawnBrushing = s.tool === 'doodad' && s.doodadMode === 'creatures'
	const sizeAfterModes = s.tool === 'sculpt' || s.tool === 'paint' || s.tool === 'water' || s.tool === 'doodad'
	const falloffOnBar = sizeAfterModes && !vertexMode && !paintingWater && !spawnBrushing && !(s.tool === 'paint' && !usesBrush)
	const hasPanel = sizeAfterModes && !vertexMode
	const sculptPainting = s.tool === 'sculpt' && !holeMode && s.sculptPaint !== 'off'
	const spraying = s.tool === 'paint' && s.paintMode === 'texture' && s.paintSpray
	const panelLabel = s.tool === 'doodad' ? (spawnBrushing ? 'Spawns' : 'Placement') : paintingWater ? 'Water' : s.tool === 'paint' && s.paintMode === 'mask' ? 'Mask' : `Brush${sculptPainting ? ' · Paint' : spraying ? ' · Spray' : ''}`
	return {
		usesBrush,
		paintingWater,
		vertexMode,
		holeMode,
		mapData,
		spawnBrushing,
		sizeAfterModes,
		sliderWidth: sizeAfterModes ? 70 : 90,
		falloffOnBar,
		hasPanel,
		sculptPainting,
		spraying,
		panelLabel,
		panelTitle: panelTitle(s, holeMode, paintingWater, spawnBrushing),
	}
}

function panelTitle(s: OptionsState, holeMode: boolean, paintingWater: boolean, spawnBrushing: boolean): string {
	if (s.tool === 'sculpt')
		return `The brush's other settings: edit limit, image, shape and falloff curve${holeMode ? '' : ', and painting while sculpting'}${
			s.sculptMode === 'flatten' ? ", and Flatten's target, direction and angled plane" : s.sculptMode === 'terrace' ? ", and Terrace's offset" : ''
		}`
	if (s.tool === 'water')
		return paintingWater ? "The water brush's other settings: angled surface, overrides, opacity, which layers are drawn, and Crop water and Regen opacity" : "The brush's other settings: edit limit, shape and falloff curve"
	if (s.tool === 'doodad')
		return spawnBrushing ? "The spawn brush's other settings: movement, facing, respawn time, levels, slope, water and rules" : 'Where the brush places models: falloff curve, ground rotation, slope, the sea and props'
	if (s.paintMode === 'mask') return "The mask's other settings: Modify mask and its step, and the brush's shape and falloff curve while painting the mask"
	return `The brush's other settings: shape and falloff curve${s.paintMode === 'texture' ? ', image, spray, and the unpaintable chunks' : ''}`
}
