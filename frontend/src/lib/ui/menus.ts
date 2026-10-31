// The menu bar's menus (#584), built from a plain context so a Bun test can check them without the live
// app: MenuBar.svelte calls `buildMenus` inside a `$derived`, handing it the reactive `ui`, `editor` and
// `prefs` (the derived then tracks what the build reads) and the actions, which stay in the component
// since they reach the Engine, the Go bindings and the dialogs. Nothing here imports those modules: the
// io functions come in through `MenuIo` and are imported here as types only.
import type { Engine } from '../engine/Engine'
import type { ProjectInfo, editor as editorState, prefs as prefsState, ui as uiState } from '../state/editor.svelte'
import type { CameraView } from './cameraView'
import type { BenchKind } from '../bench/benchMaps'
import type * as compileIo from '../io/compile'
import type * as gameIo from '../io/game'
import type * as externalIo from '../io/external'
import type * as imagesIo from '../io/images'
import type * as listsIo from '../io/lists'
import type * as mapIo from '../io/mapio'
import type * as regionIo from '../io/region'
import type * as prefabIo from '../io/prefabFiles'
import type * as sceneIo from '../io/scene'
import type * as benchIo from '../bench/benchMaps'
import type * as doodadBrushIo from '../tools/DoodadBrushTool'
import { serverControls, serverHeader } from '../io/serverMenu'
import { growableSides, type Side } from '../io/regionGrow'
import { GRAPHICS_PRESETS, applyPreset, presetOf } from '../state/graphicsPresets'
import { keysOf, type CommandId } from './commands'

export type MenuItem =
	| { kind: 'action'; label: string; shortcut?: string; disabled?: boolean; run: () => unknown }
	| { kind: 'check'; label: string; shortcut?: string; checked: boolean; toggle: () => void }
	| { kind: 'radio'; label: string; shortcut?: string; checked: boolean; select: () => void }
	| { kind: 'header'; label: string }
	| { kind: 'sep' }

export interface Menu {
	name: string
	items: MenuItem[]
}

/** The functions of lib/io (and the tools) the menus call: MenuBar passes the real ones, a test stand-ins. */
export interface MenuIo {
	compileRegion: typeof compileIo.compileRegion
	exportSpawnSql: typeof compileIo.exportSpawnSql
	launchGame: typeof gameIo.launchGame
	playHere: typeof gameIo.playHere
	exportPortCoords: typeof gameIo.exportPortCoords
	controlServer: typeof gameIo.controlServer
	chooseExternalDatabase: typeof externalIo.chooseExternalDatabase
	disconnectExternal: typeof externalIo.disconnectExternal
	exportAlphamap: typeof imagesIo.exportAlphamap
	importAlphamap: typeof imagesIo.importAlphamap
	exportHeightmap: typeof imagesIo.exportHeightmap
	exportNormalMap: typeof imagesIo.exportNormalMap
	writeMinimapTiles: typeof imagesIo.writeMinimapTiles
	exportDoodadBrush: typeof listsIo.exportDoodadBrush
	exportObjectList: typeof listsIo.exportObjectList
	importDoodadBrushes: typeof listsIo.importDoodadBrushes
	importObjectList: typeof listsIo.importObjectList
	requestRevert: typeof mapIo.requestRevert
	editWorldHere: typeof regionIo.editWorldHere
	extendRegion: typeof regionIo.extendRegion
	openWorldView: typeof regionIo.openWorldView
	restoreClientPaint: typeof regionIo.restoreClientPaint
	saveSelectionAsPrefab: typeof prefabIo.saveSelectionAsPrefab
	copyPerfReport: typeof sceneIo.copyPerfReport
	copyScene: typeof sceneIo.copyScene
	pasteScene: typeof sceneIo.pasteScene
	openBenchMap: typeof benchIo.openBenchMap
	activeDoodadBrush: typeof doodadBrushIo.activeDoodadBrush
}

/** What the menus do beyond writing `ui`, `editor` and `prefs`. */
export interface MenuActions {
	/** Runs a command of the shortcut table (lib/ui/runCommand), so an item and its key do the same (#583). */
	command(id: CommandId): unknown
	/** The engine, or null before it starts. */
	engine(): Engine | null
	switchProject(p: ProjectInfo): unknown
	exit(): void
	openManual(): void
	setCameraView(v: CameraView): void
	setStatus(text: string, ms: number): void
	io: MenuIo
}

/** A world event the open region's spawns belong to, with how many spawns are in it. */
export interface RegionEvent {
	id: number
	n: number
	name: string
}

export interface MenuContext {
	ui: typeof uiState
	editor: typeof editorState
	prefs: typeof prefsState
	/** Whether the Go side answers (the desktop app or the dev page's server), `hasBackend()`. */
	backend: boolean
	/** Whether the client is open (`wow.loaded`). */
	wowLoaded: boolean
	events: RegionEvent[]
	cameraView: CameraView
	cameraViews: ReadonlyArray<{ id: CameraView; label: string }>
	benchMaps: ReadonlyArray<{ kind: BenchKind; label: string }>
	benchScales: ReadonlyArray<readonly [string, number]>
	act: MenuActions
}

/** The events `spawns` belong to (a negative ID is the event's end), with their spawn counts, sorted by name. */
export function regionEvents(spawns: ReadonlyArray<{ events?: number[] | null }>, names: ReadonlyMap<number, string>): RegionEvent[] {
	const counts = new Map<number, number>()
	for (const s of spawns) for (const e of s.events ?? []) counts.set(Math.abs(e), (counts.get(Math.abs(e)) ?? 0) + 1)
	return [...counts].map(([id, n]) => ({ id, n, name: names.get(id) ?? `Event ${id}` })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The sides a region can grow toward, for the File menu. */
const SIDES: Array<[Side, string]> = [
	['n', 'north'],
	['e', 'east'],
	['s', 'south'],
	['w', 'west'],
]

/** The climb view's steepest walkable slopes, in degrees: 49 is Noggit Red's default. */
const CLIMB_ANGLES = [40, 45, 49, 55, 60]

/** The command of each camera view, for its shortcut text. */
const VIEW_COMMAND: Record<CameraView, CommandId> = { orbit: 'orbitView', flying: 'flyingView', walking: 'walkingView', topDown: 'topDown' }

const radios = <T>(options: ReadonlyArray<readonly [string, T]>, get: () => T, set: (v: T) => void): MenuItem[] => options.map(([label, v]) => ({ kind: 'radio', label, checked: get() === v, select: () => set(v) }))

/**
 * The menus. Each is kept short enough to fit the screen (#122): the actions on the selected models,
 * the terrain and the world's tables have menus of their own, as do the imports and exports, the view
 * and the game. The settings set once are in Edit › Preferences (#752), not in a menu.
 */
export function buildMenus(ctx: MenuContext): Menu[] {
	const { ui, editor, prefs, backend, act } = ctx
	const io = act.io

	/** A menu item's shortcut text and action from the shortcut table, so the item and its key do the same (#583). */
	const cmd = (id: CommandId) => ({ shortcut: keysOf(id), run: () => act.command(id) })
	const toggle = (id: CommandId) => ({ shortcut: keysOf(id), toggle: () => void act.command(id) })
	const withEngine = (fn: (e: Engine) => unknown) => () => {
		const e = act.engine()
		if (e) fn(e)
	}

	// A world view (#15) is looked at, not edited: its terrain is a hidden stand-in and its models are the
	// stream's, so the actions on the map's own ground, models and tables are off in it (the Engine
	// refuses them too, `refuseInWorld`). File › Edit Here opens the block around the camera for them.
	const looking = !!editor.worldMap
	const editing = (items: MenuItem[]): MenuItem[] => (looking ? items.map((it) => (it.kind === 'action' ? { ...it, disabled: true } : it)) : items)

	// The Graphics › Quality preset all of whose values the prefs hold now, or null (#203).
	const graphicsPreset = presetOf(prefs)
	// The biome Apply Biome lays (terrain/activeBiome.ts, which this module can't import).
	const biome = prefs.biomes.find((b) => b.name === prefs.biome) ?? prefs.biomes[0] ?? null
	const server = serverControls(ui.serverStatus, ui.serverAction)

	return [
		{
			name: 'File',
			items: [
				{ kind: 'action', label: 'New World…', ...cmd('newMap') },
				{ kind: 'action', label: 'Open…', disabled: ui.busy, ...cmd('open') },
				{
					kind: 'action',
					label: 'Open Part of Azeroth…',
					disabled: !backend || ui.busy,
					run: () => {
						ui.newMapMode = 'open'
						ui.showNewDialog = true
					},
				},
				// The world view (#15): the region's whole map streamed around the camera, and back to a block to edit.
				{ kind: 'action', label: 'World View', disabled: !backend || ui.busy || !editor.regionBlock, run: withEngine((e) => io.openWorldView(e)) },
				...(editor.worldMap || (editor.regionBlock && prefs.worldAround)
					? [{ kind: 'action' as const, label: 'Edit Here (Open the Block Around the Camera)', disabled: !backend || ui.busy, run: withEngine((e) => io.editWorldHere(e)) }]
					: []),
				{ kind: 'sep' },
				// Projects (#48): a project folder and the client it edits, with the recent ones to switch to.
				{ kind: 'action', label: ui.project ? `Project: ${ui.project.name}…` : 'Project…', disabled: !backend, run: () => (ui.dialog = 'project') },
				...ui.recentProjects
					.filter((p) => p.path !== ui.project?.path)
					.slice(0, 4)
					.map((p) => ({ kind: 'action' as const, label: `Open Project ${p.name}`, disabled: !backend || ui.busy, run: () => act.switchProject(p) })),
				{ kind: 'sep' },
				...editing([
					{ kind: 'action', label: 'Save', disabled: ui.busy, ...cmd('save') },
					{ kind: 'action', label: 'Save As…', disabled: ui.busy, ...cmd('saveAs') },
					{ kind: 'action', label: 'Revert to Saved', disabled: !editor.filePath || ui.busy, run: withEngine(io.requestRevert) },
					{ kind: 'action', label: 'Map Properties…', run: () => (ui.dialog = 'mapProps') },
					{ kind: 'sep' },
					{ kind: 'action', label: 'Check Map…', run: () => (ui.checkMap = true) },
					// The open region into the game (#214): the client's tiles, the server's map data built from them, or both.
					{ kind: 'action', label: 'Compile to Client', disabled: !backend || ui.busy, run: withEngine((e) => io.compileRegion(e, 'client')) },
					{ kind: 'action', label: 'Compile to Server', disabled: !backend || ui.busy, run: withEngine((e) => io.compileRegion(e, 'server')) },
					{ kind: 'action', label: 'Compile All', disabled: !backend || ui.busy, run: withEngine((e) => io.compileRegion(e, 'all')) },
				]),
				...(editor.regionBlock
					? [
							{ kind: 'header' as const, label: 'Grow region (save first; the map stays square)' },
							...SIDES.map(([side, name]) => ({
								kind: 'action' as const,
								label: `Add the tiles to the ${name}`,
								disabled: !backend || ui.busy || !growableSides(editor.regionBlock!).includes(side),
								run: withEngine((e) => io.extendRegion(e, side)),
							})),
							{ kind: 'sep' as const },
							{ kind: 'action' as const, label: 'Save Spawns to Database…', disabled: !backend || ui.busy || !ui.spawnChanges, run: () => (ui.dialog = 'saveSpawns') },
							{ kind: 'action' as const, label: 'Export Spawn SQL…', disabled: !backend || ui.busy || !ui.spawnChanges, run: withEngine((e) => io.exportSpawnSql(e)) },
						]
					: []),
				{ kind: 'sep' },
				// The local server (#857): its database, login and world servers together, as start-server.bat does.
				{ kind: 'header', label: serverHeader(ui.serverStatus, ui.serverAction) },
				{ kind: 'action', label: 'Start Server', disabled: !server.start, run: () => io.controlServer('start') },
				{ kind: 'action', label: 'Stop Server', disabled: !server.stop, run: () => io.controlServer('stop') },
				{ kind: 'action', label: 'Restart Server', disabled: !server.restart, run: () => io.controlServer('restart') },
				// Another machine's server (#856): its databases from a copy of its mangosd.conf, for this session, past a warning.
				ui.externalDb
					? { kind: 'action', label: `Disconnect External Database (${ui.externalDb.world.host || ui.externalDb.conf})`, disabled: ui.busy, run: () => io.disconnectExternal(act.engine()) }
					: { kind: 'action', label: 'Connect to External Database…', disabled: !backend || ui.busy || !!ui.serverAction, run: () => io.chooseExternalDatabase(act.engine()) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Close Map', ...cmd('closeMap') },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Exit', run: () => act.exit() },
			],
		},
		{
			name: 'Edit',
			items: [
				{ kind: 'action', label: 'Undo', disabled: !ui.canUndo, ...cmd('undo') },
				{ kind: 'action', label: 'Redo', disabled: !ui.canRedo, ...cmd('redo') },
				{ kind: 'check', label: 'History (go back to any step)', checked: ui.history, toggle: () => (ui.history = !ui.history) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Copy', disabled: !editor.selection && !editor.selectedIds.length, ...cmd('copy') },
				...editing([{ kind: 'action', label: 'Paste', disabled: !ui.hasClip, ...cmd('paste') }]),
				{ kind: 'sep' },
				...editing([{ kind: 'action', label: 'Select All', ...cmd('selectAll') }]),
				{ kind: 'action', label: 'Deselect', disabled: !editor.selection && !editor.selectedIds.length, ...cmd('deselect') },
				...editing([
					{ kind: 'action', label: 'Grow Selected Area by 1 Cell', disabled: !editor.selection, run: withEngine((e) => e.resizeSelection(1)) },
					{ kind: 'action', label: 'Shrink Selected Area by 1 Cell', disabled: !editor.selection, run: withEngine((e) => e.resizeSelection(-1)) },
					{ kind: 'sep' },
					{ kind: 'action', label: 'Cut Hole in Selected Area', disabled: !editor.selection, run: withEngine((e) => e.setHoleInSelection(true)) },
					{ kind: 'action', label: 'Fill Hole in Selected Area', disabled: !editor.selection, run: withEngine((e) => e.setHoleInSelection(false)) },
				]),
				{ kind: 'sep' },
				// The settings set once (#752): folders, theme, camera feel, compile options, the game's window.
				{ kind: 'action', label: 'Preferences…', ...cmd('preferences') },
			],
		},
		{
			name: 'Models',
			items: [
				{ kind: 'action', label: 'Duplicate Selected Models', disabled: !editor.selectedIds.length, ...cmd('duplicate') },
				{ kind: 'action', label: 'Reset Rotation', disabled: !editor.selectedIds.length, ...cmd('resetRotation') },
				{ kind: 'action', label: 'Put Selected Models on the Ground', disabled: !editor.selectedIds.length, ...cmd('snapGround') },
				{ kind: 'action', label: 'Fit Ground to Selected Models…', disabled: !editor.selectedIds.length, run: () => (ui.dialog = 'fitGround') },
				{ kind: 'action', label: 'Save Selection as Prefab…', disabled: !editor.selectedIds.length || !backend, run: withEngine((e) => void io.saveSelectionAsPrefab(e)) },
				{ kind: 'action', label: 'Replace with Copied Model', disabled: !editor.selectedIds.length, run: withEngine((e) => e.replaceSelectedWithCopied()) },
				{ kind: 'action', label: 'Group Selected Models', disabled: editor.selectedIds.length < 2, ...cmd('group') },
				{ kind: 'action', label: 'Ungroup Selected Models', disabled: !editor.selectedIds.length, ...cmd('ungroup') },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Delete Selected Models', shortcut: keysOf('deleteSelected'), disabled: !editor.selectedIds.length, run: withEngine((e) => e.deleteSelected()) },
				...editing([{ kind: 'action', label: 'Remove Duplicate Models', run: withEngine((e) => e.removeDuplicateModels()) }]),
				{ kind: 'sep' },
				{ kind: 'action', label: 'Hide Selected Models', shortcut: keysOf('hideSelected'), disabled: !editor.selectedIds.length, run: withEngine((e) => e.toggleHideSelected()) },
				{ kind: 'check', label: 'Show Hidden Models', checked: ui.showHiddenModels, toggle: () => (ui.showHiddenModels = !ui.showHiddenModels) },
				{ kind: 'action', label: 'Unhide All Models', disabled: !ui.hiddenModels, ...cmd('unhideAll') },
				{ kind: 'sep' },
				{ kind: 'check', label: 'Inspector (placement numbers)', checked: ui.inspector, ...toggle('inspector') },
				{ kind: 'check', label: 'Gizmo Arrows in Local Space', checked: editor.gizmoLocal, toggle: () => (editor.gizmoLocal = !editor.gizmoLocal) },
			],
		},
		{
			name: 'Terrain',
			items: editing([
				...(looking ? [{ kind: 'header' as const, label: 'A world view: File › Edit Here to edit' }] : []),
				{
					kind: 'action',
					label: editor.selection ? 'Smooth Selection…' : 'Smooth the Map…',
					run: () => {
						editor.smoothArea.mode = 'smooth'
						ui.dialog = 'smoothArea'
					},
				},
				{
					kind: 'action',
					label: editor.selection ? 'Raise, Lower, Flatten or Roughen Selection…' : 'Raise, Lower, Flatten or Roughen the Map…',
					run: () => {
						// The dialog's Mode keeps the last shape picked here; Smooth Selection… sets its own.
						if (editor.smoothArea.mode === 'smooth') editor.smoothArea.mode = editor.smoothArea.shape
						ui.dialog = 'smoothArea'
					},
				},
				{ kind: 'action', label: editor.selection ? 'Erode Selection…' : 'Erode the Map…', run: () => (ui.dialog = 'erode') },
				{ kind: 'sep' },
				{ kind: 'action', label: editor.selection ? 'Bake Shadows in Selection' : 'Bake Shadows', run: withEngine((e) => e.bakeShadows()) },
				{ kind: 'action', label: editor.selection ? 'Bake Shadows from the Ground in Selection' : 'Bake Shadows from the Ground Only', run: withEngine((e) => e.bakeShadows(true)) },
				{ kind: 'action', label: editor.selection ? 'Clear Shadows in Selection' : 'Clear Shadows', run: withEngine((e) => e.clearShadows()) },
				{ kind: 'sep' },
				{ kind: 'header', label: 'Clean up the tile under the camera' },
				{ kind: 'action', label: 'Clear Height', run: withEngine((e) => e.cleanUpTile('height')) },
				{ kind: 'action', label: 'Clear Textures', run: withEngine((e) => e.cleanUpTile('textures')) },
				{ kind: 'action', label: 'Clear Textures and Set Base (paint texture)', run: withEngine((e) => e.cleanUpTile('setBase')) },
				{ kind: 'action', label: 'Remove Texture Duplicates', run: withEngine((e) => e.cleanUpTile('textureDuplicates')) },
				{ kind: 'action', label: 'Clear Models', run: withEngine((e) => e.cleanUpTile('models')) },
				{ kind: 'action', label: 'Remove Duplicate Models on the Tile', run: withEngine((e) => e.cleanUpTile('duplicateModels')) },
				{ kind: 'action', label: 'Clear Baked Shadows', run: withEngine((e) => e.cleanUpTile('shadows')) },
			]),
		},
		{
			// The textures, the paint mask and the doodad-brush fills, out of Terrain so each fits the screen (#752).
			name: 'Paint',
			items: editing([
				...(looking ? [{ kind: 'header' as const, label: 'A world view: File › Edit Here to edit' }] : []),
				{ kind: 'action', label: 'Auto-paint Textures by Height and Slope', run: withEngine((e) => e.regenerateAutoPaint()) },
				{ kind: 'action', label: 'Fill Mask with Paint Texture', disabled: !ui.maskActive, run: withEngine((e) => e.fillMask(editor.paintLayer)) },
				{ kind: 'action', label: 'Replace Texture Everywhere…', run: () => (ui.dialog = 'textures') },
				{ kind: 'action', label: editor.selection ? 'Remove Empty Texture Layers in Selection' : 'Remove Empty Texture Layers', run: withEngine((e) => e.removeEmptyLayers()) },
				// The client's own paint back, read without Meld's patch, for chunks an early compile left blocky (#645).
				{
					kind: 'action',
					label: editor.selection ? "Restore the Client's Paint in Selection" : "Restore the Client's Paint",
					disabled: !backend || ui.busy || !editor.regionBlock,
					run: withEngine((e) => io.restoreClientPaint(e)),
				},
				{ kind: 'check', label: 'Map Textures (quick palette)', checked: ui.texturePalette, toggle: () => (ui.texturePalette = !ui.texturePalette) },
				{ kind: 'sep' },
				{ kind: 'header', label: 'Paint mask' },
				{ kind: 'action', label: 'Mask the Selection', disabled: !editor.selection, run: withEngine((e) => e.maskFromSelection()) },
				{ kind: 'action', label: `Grow Mask by ${editor.maskSelect.step} yd`, disabled: !ui.maskActive, run: withEngine((e) => e.modifyMask('grow')) },
				{ kind: 'action', label: `Shrink Mask by ${editor.maskSelect.step} yd`, disabled: !ui.maskActive, run: withEngine((e) => e.modifyMask('shrink')) },
				{ kind: 'action', label: `Feather Mask over ${editor.maskSelect.step} yd`, disabled: !ui.maskActive, run: withEngine((e) => e.modifyMask('feather')) },
				{ kind: 'action', label: `Border Mask by ${editor.maskSelect.step} yd`, disabled: !ui.maskActive, run: withEngine((e) => e.modifyMask('border')) },
				{ kind: 'action', label: `Smooth Mask over ${editor.maskSelect.step} yd`, disabled: !ui.maskActive, run: withEngine((e) => e.modifyMask('smooth')) },
				{ kind: 'action', label: 'Invert Mask', run: withEngine((e) => e.invertMask()) },
				{ kind: 'action', label: 'Clear Mask', disabled: !ui.maskActive, run: withEngine((e) => e.clearMask()) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Fill Selection with Doodad Brush', disabled: !editor.selection, run: withEngine((e) => e.fillWithDoodadBrush(false)) },
				{ kind: 'action', label: 'Fill Mask with Doodad Brush', disabled: !ui.maskActive, run: withEngine((e) => e.fillWithDoodadBrush(true)) },
				{ kind: 'sep' },
				// Biomes (#957): textures by rules, ground effects and scatter in one step.
				{ kind: 'action', label: 'Biomes…', run: () => (ui.dialog = 'biomes') },
				{ kind: 'action', label: biome ? `Apply Biome "${biome.name}" to Selection` : 'Apply Biome to Selection', disabled: !editor.selection || !biome, run: withEngine((e) => biome && e.applyBiome(biome, false)) },
				{ kind: 'action', label: biome ? `Apply Biome "${biome.name}" to Mask` : 'Apply Biome to Mask', disabled: !ui.maskActive || !biome, run: withEngine((e) => biome && e.applyBiome(biome, true)) },
			]),
		},
		{
			name: 'Tools',
			items: [
				{ kind: 'action', label: 'Creatures…', disabled: !backend, run: () => (ui.creatures = true) },
				{ kind: 'action', label: 'Game Objects…', disabled: !backend, run: () => (ui.objectEditor = { key: null, entry: 0 }) },
				{ kind: 'action', label: 'Quests…', disabled: !backend, run: () => (ui.questEditor = { entry: 0 }) },
				{ kind: 'action', label: 'Items…', disabled: !backend, run: () => (ui.itemEditor = { entry: 0 }) },
				{ kind: 'action', label: 'Spells…', disabled: !backend, run: () => (ui.spellEditor = { entry: 0 }) },
				{ kind: 'action', label: 'Icons…', disabled: !backend, run: () => (ui.iconsTool = { icon: '' }) },
				{ kind: 'action', label: 'Sounds…', disabled: !backend, run: () => (ui.soundsTool = { id: 0 }) },
				{ kind: 'action', label: 'Import from Another Client…', disabled: !backend, run: () => (ui.dialog = 'otherClient') },
				{ kind: 'action', label: 'Characters and Accounts…', disabled: !backend, run: () => (ui.characterEditor = { account: 0, guid: 0 }) },
				{ kind: 'sep' },
				{ kind: 'check', label: 'Scripts (Lua)', checked: ui.scripts, toggle: () => (ui.scripts = !ui.scripts) },
			],
		},
		{
			name: 'World',
			items: [
				{ kind: 'action', label: 'Doodad Brushes…', run: () => (ui.brushEditor = true) },
				...editing([
					{ kind: 'action', label: 'Ground Effects (Grass Tufts)…', run: () => (ui.dialog = 'effects') },
					{ kind: 'action', label: 'Texture Looks (Scrolling, Overbright)…', run: () => (ui.dialog = 'looks') },
				]),
				{ kind: 'action', label: 'Zones…', disabled: !backend, run: () => (ui.dialog = 'zones') },
				{ kind: 'action', label: 'World Map…', disabled: !backend, run: () => (ui.dialog = 'worldMap') },
				{ kind: 'action', label: 'Portals and Area Triggers…', disabled: !backend, run: () => (ui.dialog = 'portals') },
				{ kind: 'action', label: 'Flight Paths…', disabled: !backend, run: () => (ui.flightPaths = true) },
				{ kind: 'action', label: 'Lights…', disabled: !backend, run: () => (ui.dialog = 'lights') },
			],
		},
		{
			name: 'Import/Export',
			items: [
				...editing([
					{ kind: 'action', label: 'Import Heightmap…', disabled: !backend || ui.busy, run: () => (ui.dialog = 'heightmap') },
					{ kind: 'action', label: 'Import Watermap…', disabled: !backend || ui.busy, run: () => (ui.dialog = 'watermap') },
					{ kind: 'action', label: 'Export Heightmap…', disabled: !backend || ui.busy, run: withEngine((e) => io.exportHeightmap(e)) },
					{ kind: 'action', label: 'Export Normal Map…', disabled: !backend || ui.busy, run: withEngine((e) => io.exportNormalMap(e)) },
					{ kind: 'action', label: 'Export Alphamap of the Paint Texture…', disabled: !backend || ui.busy, run: withEngine((e) => io.exportAlphamap(e)) },
					{ kind: 'action', label: 'Import Alphamap into the Paint Texture…', disabled: !backend || ui.busy, run: withEngine((e) => io.importAlphamap(e)) },
					{ kind: 'sep' },
					{ kind: 'action', label: 'Import Object List…', disabled: !backend || ui.busy, run: withEngine((e) => io.importObjectList(e)) },
					{ kind: 'action', label: 'Export Object List…', disabled: !backend || ui.busy, run: withEngine((e) => io.exportObjectList(e)) },
					{ kind: 'sep' },
					{ kind: 'action', label: 'Save Minimap Image…', disabled: !backend || ui.busy, ...cmd('minimapImage') },
					{ kind: 'action', label: 'Write Minimap Tiles to the Client', disabled: !backend || ui.busy, run: withEngine((e) => io.writeMinimapTiles(e)) },
				]),
				{ kind: 'sep' },
				{ kind: 'action', label: 'Import Doodad Brushes…', disabled: !backend || ui.busy, run: () => io.importDoodadBrushes() },
				{
					kind: 'action',
					label: 'Export Doodad Brush…',
					disabled: !backend || ui.busy || !io.activeDoodadBrush(),
					run: () => {
						const b = io.activeDoodadBrush()
						if (b) io.exportDoodadBrush(b)
					},
				},
			],
		},
		{
			// The editor's own aids over the map; what of the world is drawn is in Show (#752).
			name: 'View',
			items: [
				{ kind: 'check', label: 'Show grid', checked: editor.grid, ...toggle('grid') },
				{ kind: 'check', label: 'Show chunk lines', checked: editor.chunkLines, toggle: () => (editor.chunkLines = !editor.chunkLines) },
				{ kind: 'check', label: 'Reference Image… (trace a plan of your own)', checked: ui.referenceWindow, toggle: () => (ui.referenceWindow = !ui.referenceWindow) },
				{ kind: 'check', label: 'Far Horizon (the map around a region)', checked: prefs.showHorizon, toggle: () => (prefs.showHorizon = !prefs.showHorizon) },
				{ kind: 'check', label: 'World Around the Block (the client’s tiles past a region)', checked: prefs.worldAround, toggle: () => (prefs.worldAround = !prefs.worldAround) },
				{ kind: 'check', label: 'Bounding boxes (one per model)', checked: prefs.showBoxes, toggle: () => (prefs.showBoxes = !prefs.showBoxes) },
				{ kind: 'check', label: 'Hover outline (what a click would select)', checked: prefs.hoverOutline, toggle: () => (prefs.hoverOutline = !prefs.hoverOutline) },
				{ kind: 'check', label: 'Detail info (the ground under the cursor)', checked: prefs.detailInfo, toggle: () => (prefs.detailInfo = !prefs.detailInfo) },
				{ kind: 'check', label: 'Wireframe', checked: prefs.wireframe, toggle: () => (prefs.wireframe = !prefs.wireframe) },
				{ kind: 'sep' },
				{ kind: 'check', label: 'Hide panels', checked: ui.hidePanels, ...toggle('hidePanels') },
				{
					kind: 'check',
					label: 'Layers panel (the right dock)',
					checked: !prefs.dockHidden,
					toggle: () => {
						prefs.dockHidden = !prefs.dockHidden
						if (prefs.dockHidden) ui.replaceSlot = null
					},
				},
				{ kind: 'sep' },
				// The ground's slope and height, moved from Terrain (#752): views of the ground, not edits.
				{ kind: 'check', label: 'Climb (ground too steep to walk up)', checked: prefs.climbView, ...toggle('climbView') },
				...radios(
					CLIMB_ANGLES.map((a): [string, number] => [`Steepest walkable slope ${a}°`, a]),
					() => prefs.climbAngle,
					(v) => {
						prefs.climbAngle = v
						prefs.climbView = true
					},
				),
				{ kind: 'check', label: 'Height contours', checked: prefs.showContours, toggle: () => (prefs.showContours = !prefs.showContours) },
				...radios(
					[
						['Contours every 4 yards', 4],
						['Contours every 10 yards', 10],
						['Contours every 25 yards', 25],
					],
					() => prefs.contourStep,
					(v) => {
						prefs.contourStep = v
						prefs.showContours = true
					},
				),
			],
		},
		{
			// What of the world the view draws: the layers, the spawns, the triggers, routes and navmesh (#752).
			name: 'Show',
			items: [
				{ kind: 'check', label: 'Terrain', checked: prefs.showTerrain, toggle: () => (prefs.showTerrain = !prefs.showTerrain) },
				{ kind: 'check', label: 'Water', checked: prefs.showWater, toggle: () => (prefs.showWater = !prefs.showWater) },
				{ kind: 'check', label: 'Objects (doodads and buildings)', checked: prefs.showObjects, toggle: () => (prefs.showObjects = !prefs.showObjects) },
				{ kind: 'check', label: 'Doodads (of the objects)', checked: prefs.showDoodads, toggle: () => (prefs.showDoodads = !prefs.showDoodads) },
				{ kind: 'check', label: 'Buildings (of the objects)', checked: prefs.showBuildings, toggle: () => (prefs.showBuildings = !prefs.showBuildings) },
				{ kind: 'check', label: 'Ground effects (grass tufts)', checked: prefs.showGroundEffects, toggle: () => (prefs.showGroundEffects = !prefs.showGroundEffects) },
				{ kind: 'sep' },
				{ kind: 'check', label: 'Monsters', checked: prefs.showMonsters, toggle: () => (prefs.showMonsters = !prefs.showMonsters) },
				{ kind: 'check', label: 'NPCs', checked: prefs.showNpcs, toggle: () => (prefs.showNpcs = !prefs.showNpcs) },
				{ kind: 'check', label: 'Game objects', checked: prefs.showGameObjects, toggle: () => (prefs.showGameObjects = !prefs.showGameObjects) },
				{ kind: 'check', label: 'All creature paths', checked: prefs.showAllPaths, toggle: () => (prefs.showAllPaths = !prefs.showAllPaths) },
				{ kind: 'check', label: 'Spawn pools', checked: prefs.showPools, toggle: () => (prefs.showPools = !prefs.showPools) },
				{ kind: 'check', label: 'Names over creatures and objects', checked: prefs.spawnNames, toggle: () => (prefs.spawnNames = !prefs.spawnNames) },
				...radios<typeof prefs.namesSide>(
					[
						['Name colours as the Alliance sees them', 'alliance'],
						['Name colours as the Horde sees them', 'horde'],
					],
					() => prefs.namesSide,
					(v) => (prefs.namesSide = v),
				),
				{ kind: 'check', label: 'Creatures and objects through walls', checked: prefs.spawnsThroughWalls, toggle: () => (prefs.spawnsThroughWalls = !prefs.spawnsThroughWalls) },
				{ kind: 'sep' },
				{ kind: 'check', label: 'Area triggers (portals)', checked: prefs.showAreaTriggers, toggle: () => (prefs.showAreaTriggers = !prefs.showAreaTriggers) },
				{ kind: 'check', label: 'Flight paths (stops and routes)', checked: prefs.showFlightPaths, toggle: () => (prefs.showFlightPaths = !prefs.showFlightPaths) },
				{ kind: 'check', label: "Walkable ground (the server's navmesh)", checked: prefs.navView, toggle: () => (prefs.navView = !prefs.navView) },
				{
					kind: 'check',
					label: "Server's mmaps (its own navmesh, for a compiled region)",
					checked: prefs.navView && prefs.navServer,
					toggle: () => {
						prefs.navServer = !(prefs.navView && prefs.navServer)
						if (prefs.navServer) prefs.navView = true
					},
				},
				{
					kind: 'action',
					label: 'Test a Path (click two points)',
					run: withEngine((e) => {
						prefs.navView = true
						e.startPathTest()
					}),
				},
				...(ctx.events.length
					? [
							{ kind: 'header', label: 'World events (their spawns)' } as MenuItem,
							...ctx.events.map((ev): MenuItem => ({
								kind: 'check',
								label: `${ev.name} (${ev.n})`,
								checked: prefs.shownEvents.includes(ev.id),
								toggle: () => (prefs.shownEvents = prefs.shownEvents.includes(ev.id) ? prefs.shownEvents.filter((e) => e !== ev.id) : [...prefs.shownEvents, ev.id]),
							})),
							{ kind: 'action', label: 'Hide every event', disabled: !prefs.shownEvents.length, run: () => (prefs.shownEvents = []) } as MenuItem,
						]
					: []),
			],
		},
		{
			name: 'Graphics',
			items: [
				{ kind: 'header', label: graphicsPreset ? 'Quality' : 'Quality (custom)' },
				...radios(
					GRAPHICS_PRESETS.map((g) => [g.name, g.name] as [string, string | null]),
					() => graphicsPreset,
					(v) => v && applyPreset(prefs, v),
				),
				{ kind: 'header', label: 'Render scale' },
				...radios(
					[
						['50% (fastest)', 0.5],
						['75%', 0.75],
						['100%', 1],
						['150% (sharper)', 1.5],
					],
					() => prefs.renderScale,
					(v) => (prefs.renderScale = v),
				),
				{ kind: 'header', label: 'View distance' },
				...radios(
					[
						['Near', 0.6],
						['Normal', 1],
						['Far', 1.8],
					],
					() => prefs.viewDistance,
					(v) => (prefs.viewDistance = v),
				),
				{ kind: 'header', label: 'Ground effects (grass tufts)' },
				...radios<typeof prefs.groundEffectDensity>(
					[
						["Sparse tufts (the game's Low)", 'sparse'],
						['Normal tufts (Medium)', 'normal'],
						['Full tufts (High)', 'full'],
					],
					() => prefs.groundEffectDensity,
					(v) => (prefs.groundEffectDensity = v),
				),
				{ kind: 'sep' },
				{ kind: 'check', label: 'Particles', checked: prefs.particles, toggle: () => (prefs.particles = !prefs.particles) },
				{ kind: 'check', label: 'Prop animations', checked: prefs.animations, toggle: () => (prefs.animations = !prefs.animations) },
				{ kind: 'check', label: 'Skip models too small to see', checked: prefs.cullSmallModels, toggle: () => (prefs.cullSmallModels = !prefs.cullSmallModels) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Full Screen', ...cmd('fullScreen') },
			],
		},
		{
			name: 'Lighting',
			items: [
				{ kind: 'header', label: 'Time of day' },
				...radios(
					[
						['Dawn', 6.3],
						['Day', 13],
						['Dusk', 17.7],
						['Night', 23.5],
					],
					() => prefs.timeOfDay,
					(v) => {
						prefs.timeOfDay = v
						prefs.dayCycle = false
					},
				),
				{ kind: 'check', label: 'Animate day/night cycle', checked: prefs.dayCycle, toggle: () => (prefs.dayCycle = !prefs.dayCycle) },
				{ kind: 'header', label: 'Shadows' },
				...radios<typeof prefs.shadows>(
					[
						['Off', 'off'],
						['Medium', 'medium'],
						['High', 'high'],
					],
					() => prefs.shadows,
					(v) => (prefs.shadows = v),
				),
				{ kind: 'sep' },
				{ kind: 'check', label: "Client Lighting (the zone's light, fog and water colours)", checked: prefs.clientLighting, toggle: () => (prefs.clientLighting = !prefs.clientLighting) },
				{ kind: 'check', label: "Baked Shadows (the client's, on a region)", checked: prefs.bakedShadows, toggle: () => (prefs.bakedShadows = !prefs.bakedShadows) },
				{ kind: 'check', label: 'Prop lights & flames', checked: prefs.propEffects, toggle: () => (prefs.propEffects = !prefs.propEffects) },
				{ kind: 'check', label: 'Clouds', checked: prefs.clouds, toggle: () => (prefs.clouds = !prefs.clouds) },
				{ kind: 'check', label: 'Fog', checked: prefs.fog, toggle: () => (prefs.fog = !prefs.fog) },
				// The client's weather around the camera (#185); its storm light needs Client Lighting.
				{ kind: 'header', label: 'Weather preview' },
				...radios<typeof ui.weather>(
					[
						['Clear', 'clear'],
						['Rain', 'rain'],
						['Snow', 'snow'],
						['Sandstorm', 'sand'],
					],
					() => ui.weather,
					(v) => {
						ui.weather = v
						if (v !== 'clear' && !prefs.clientLighting) act.setStatus("Weather preview: the drops show now; turn on Lighting › Client Lighting for the zone's storm light and fog too.", 6000)
					},
				),
				...radios<typeof ui.weatherGrade>(
					[
						['Light', 'light'],
						['Medium', 'medium'],
						['Heavy', 'heavy'],
					],
					() => ui.weatherGrade,
					(v) => (ui.weatherGrade = v),
				),
			],
		},
		{
			name: 'Camera',
			items: [
				{ kind: 'action', label: 'Turn Around (180°)', run: withEngine((e) => e.turnCameraAround()) },
				{ kind: 'sep' },
				// The four views (#750), each a command of its own; T still switches Orbit and Flying.
				...ctx.cameraViews.map((v): MenuItem => ({ kind: 'radio', label: v.label, shortcut: keysOf(VIEW_COMMAND[v.id]), checked: ctx.cameraView === v.id, select: () => act.setCameraView(v.id) })),
				{ kind: 'sep' },
				{ kind: 'check', label: 'Camera Collision (stay 3 yards above the ground and off walls)', checked: prefs.cameraCollision, toggle: () => (prefs.cameraCollision = !prefs.cameraCollision) },
				{ kind: 'check', label: 'Minimap', checked: ui.minimap, ...toggle('minimap') },
				{ kind: 'check', label: 'Locked Cursor (a brush stays put while the camera moves)', checked: prefs.lockedCursor, toggle: () => (prefs.lockedCursor = !prefs.lockedCursor) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Faster', ...cmd('cameraFaster') },
				{ kind: 'action', label: 'Slower', ...cmd('cameraSlower') },
			],
		},
		{
			name: 'Bookmarks',
			items: [
				{ kind: 'action', label: 'Add Bookmark', ...cmd('bookmark') },
				...(editor.bookmarks.length ? [{ kind: 'sep' as const }] : []),
				...editor.bookmarks.map((b, i) => ({ kind: 'action' as const, label: b.name, run: withEngine((e) => e.gotoBookmark(i)) })),
				...(editor.bookmarks.length ? [{ kind: 'sep' as const }, { kind: 'action' as const, label: 'Clear Bookmarks', run: withEngine((e) => e.clearBookmarks()) }] : []),
			],
		},
		{
			name: 'Game',
			items: [
				{ kind: 'action', label: ui.gameClient === 'benilla' ? 'Launch Benilla' : 'Launch World of Warcraft', disabled: !backend || !ctx.wowLoaded, run: () => io.launchGame(act.engine()) },
				{ kind: 'action', label: 'Play Here', disabled: !backend || !ctx.wowLoaded, run: () => io.playHere(act.engine()) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Copy Position as Teleport Command', ...cmd('teleport') },
				...editing([{ kind: 'action', label: 'Export Port Coordinates…', disabled: !backend || ui.busy, run: withEngine((e) => io.exportPortCoords(e)) }]),
				{ kind: 'sep' },
				{ kind: 'action', label: 'Game Login…', disabled: !backend, run: () => (ui.dialog = 'gameLogin') },
				// The game client and its window are set once, in Preferences (#752).
				{
					kind: 'action',
					label: 'Game Settings…',
					run: () => {
						ui.prefsPage = 'game'
						ui.dialog = 'preferences'
					},
				},
			],
		},
		{
			name: 'Help',
			items: [
				{ kind: 'action', label: 'Help…', ...cmd('help') },
				{ kind: 'action', label: 'Log…', run: () => (ui.dialog = 'log') },
				{ kind: 'action', label: 'Keyboard Shortcuts…', run: () => (ui.dialog = 'shortcuts') },
				{ kind: 'action', label: 'Manual (online)', run: () => act.openManual() },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Copy Scene', disabled: !backend || ui.busy, run: withEngine(io.copyScene) },
				{ kind: 'action', label: 'Load Scene from Clipboard', disabled: !backend || ui.busy, run: withEngine(io.pasteScene) },
				// Beside the report it explains, out of View so View fits the screen (#752).
				{ kind: 'check', label: 'Performance overlay (where the frame time goes)', checked: prefs.perfOverlay, ...toggle('perfOverlay') },
				{ kind: 'action', label: 'Copy Performance Report', run: withEngine(io.copyPerfReport) },
				{ kind: 'header', label: 'Benchmark maps' },
				...ctx.benchMaps.map((m) => ({ kind: 'action' as const, label: m.label, disabled: !backend || ui.busy, run: withEngine((e) => io.openBenchMap(e, m.kind, prefs.benchScale)) })),
				{ kind: 'header', label: 'Benchmark map size' },
				...radios(
					ctx.benchScales,
					() => prefs.benchScale,
					(v) => (prefs.benchScale = v),
				),
				{ kind: 'sep' },
				{ kind: 'action', label: 'About Meld…', run: () => (ui.dialog = 'about') },
			],
		},
	]
}
