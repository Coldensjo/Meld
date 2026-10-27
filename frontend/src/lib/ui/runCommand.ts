// What each bound shortcut of lib/ui/commands.ts does: App.svelte's key handler and the menu bar
// both run a command through here, so a menu item and its key do the same thing (#583).
import type { Engine } from '../engine/Engine'
import { editor, prefs, setStatus, stepCameraSpeed, ui, type ToolId } from '../state/editor.svelte'
import { engineRef } from '../state/engineRef'
import { stepFalloff } from '../tools/brushSize'
import { stepUiScale } from './uiScale'
import { toggleFullScreen } from '../engine/display'
import { copyTeleport } from '../io/scene'
import { saveMinimapImage } from '../io/images'
import { openMap } from '../io/mapio'
import { saveOrPublish } from '../io/publish'
import { requestClose } from '../../components/DocTabs.svelte'
import { keyHint, keysOf, type CommandId } from './commands'
import { toggleMinimap } from './minimap'
import { setCameraView, switchOrbitFlying, toggleCameraView } from './cameraView'

/** The day cycle's speeds, a day in so many minutes, slowest first; 0 is paused. */
const CYCLE_MINUTES = [40, 20, 10, 5, 2, 1]
/** The next speed faster or slower than a day in `minutes` (0 paused); slower than the slowest pauses. */
function stepCycle(minutes: number, faster: boolean): number {
	if (minutes <= 0) return faster ? CYCLE_MINUTES[0] : 0
	if (faster) return CYCLE_MINUTES.find((m) => m < minutes) ?? CYCLE_MINUTES[CYCLE_MINUTES.length - 1]
	return [...CYCLE_MINUTES].reverse().find((m) => m > minutes) ?? 0
}

/** The day cycle's N and Shift+N (#20), Noggit Red's N; its B (slower) is Paint here. */
function stepDayCycle(engine: Engine, faster: boolean) {
	const step = stepCycle(prefs.dayCycle ? prefs.cycleMinutes : 0, faster)
	if (step === 0) {
		prefs.timeOfDay = Math.round(engine.currentHour() * 100) / 100
		prefs.dayCycle = false
		setStatus(`Day cycle paused${keyHint('cycleFaster', 'runs it again')}.`, 3000)
		return
	}
	if (!prefs.dayCycle) prefs.timeOfDay = Math.round(engine.currentHour() * 100) / 100
	prefs.cycleMinutes = step
	prefs.dayCycle = true
	setStatus(`Day cycle: a day in ${step} min (${keysOf('cycleFaster')} faster, ${keysOf('cycleSlower')} slower, ${keysOf('cyclePause')} pauses).`, 3000)
}

type Run = (engine: Engine) => unknown

const RUN: Record<Exclude<CommandId, `tool:${string}`>, Run> = {
	newMap: () => {
		ui.newMapMode = 'new'
		ui.showNewDialog = true
	},
	open: (e) => openMap(e),
	save: (e) => saveOrPublish(e),
	saveAs: (e) => saveOrPublish(e, true),
	closeMap: (e) => requestClose(e.activeDocumentId()),
	nextTab: (e) => e.cycleDocument(1),
	prevTab: (e) => e.cycleDocument(-1),
	hidePanels: () => (ui.hidePanels = !ui.hidePanels),
	fullScreen: () => void toggleFullScreen(),
	// Interface size (#372).
	uiLarger: () => (prefs.uiScale = stepUiScale(prefs.uiScale, 1)),
	uiSmaller: () => (prefs.uiScale = stepUiScale(prefs.uiScale, -1)),
	uiReset: () => (prefs.uiScale = 1),
	minimapImage: (e) => saveMinimapImage(e),
	perfOverlay: () => (prefs.perfOverlay = !prefs.perfOverlay),
	help: () => (ui.dialog = 'help'),
	undo: (e) => {
		const c = e.undo()
		if (c) setStatus(`Undo: ${c.label}`)
	},
	redo: (e) => {
		const c = e.redo()
		if (c) setStatus(`Redo: ${c.label}`)
	},
	copy: (e) => e.copySelection(),
	paste: (e) => e.startPaste(),
	// The selection is the Select tool's, so it shows and its actions are at hand.
	selectAll: (e) => {
		e.selectAll()
		editor.tool = 'select'
	},
	deselect: (e) => e.deselect(),
	bookmark: (e) => e.addBookmark(),
	cameraFaster: () => stepCameraSpeed(true),
	cameraSlower: () => stepCameraSpeed(false),
	// The camera's views (#750); T switches between Orbit and Flying, as Follow the Ground did.
	followGround: () => switchOrbitFlying(),
	orbitView: () => setCameraView('orbit'),
	flyingView: () => setCameraView('flying'),
	walkingView: () => toggleCameraView('walking'),
	topDown: () => toggleCameraView('topDown'),
	minimap: () => toggleMinimap(),
	focus: (e) => e.focusSelected(),
	climbView: () => {
		prefs.climbView = !prefs.climbView
		setStatus(prefs.climbView ? `Climb view: ground steeper than ${prefs.climbAngle}° is tinted red${keyHint('climbView', 'to hide')}.` : 'Climb view off.', 3000)
	},
	cycleFaster: (e) => stepDayCycle(e, true),
	cycleSlower: (e) => stepDayCycle(e, false),
	cyclePause: (e) => {
		const on = !prefs.dayCycle
		if (!on) prefs.timeOfDay = Math.round(e.currentHour() * 100) / 100
		prefs.dayCycle = on
		setStatus(on ? `Day cycle running: a day in ${prefs.cycleMinutes} min (${keysOf('cycleFaster')} faster, ${keysOf('cycleSlower')} slower).` : `Day cycle paused${keyHint('cyclePause', 'runs it again')}.`, 3000)
	},
	brushSmaller: (e) => e.stepBrush(-1),
	brushLarger: (e) => e.stepBrush(1),
	falloffSofter: () => (editor.brush.falloff = stepFalloff(editor.brush.falloff, -1)),
	falloffHarder: () => (editor.brush.falloff = stepFalloff(editor.brush.falloff, 1)),
	snapGround: (e) => e.snapSelectedToGround(),
	resetRotation: (e) => e.resetRotation(),
	group: (e) => e.groupSelected(),
	ungroup: (e) => e.ungroupSelected(),
	duplicate: (e) => e.duplicateSelected(),
	unhideAll: (e) => e.unhideAll(),
	grid: () => (editor.grid = !editor.grid),
	inspector: () => (ui.inspector = !ui.inspector),
	teleport: (e) => void copyTeleport(e),
}

/** Runs command `id` on the active map; false when there is no engine yet. */
export function runCommand(id: CommandId): boolean {
	const engine = engineRef.current
	if (!engine) return false
	if (id.startsWith('tool:')) editor.tool = id.slice(5) as ToolId
	else RUN[id as keyof typeof RUN](engine)
	return true
}
