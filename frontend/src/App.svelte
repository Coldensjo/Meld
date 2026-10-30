<script lang="ts">
	import MenuBar from './components/MenuBar.svelte'
	import Toolbar from './components/Toolbar.svelte'
	import OptionsBar from './components/OptionsBar.svelte'
	import Dock from './components/Dock.svelte'
	import AssetBrowser from './components/AssetBrowser.svelte'
	import StatusBar from './components/StatusBar.svelte'
	import Viewport from './components/Viewport.svelte'
	import NewMapDialog from './components/NewMapDialog.svelte'
	import AppDialogs from './components/AppDialogs.svelte'
	import SavingBar from './components/SavingBar.svelte'
	// The editors and the Icons tool are opened from Tools, so each loads on first use and then stays mounted.
	import type { Component } from 'svelte'
	let CreatureEditor = $state<Component | null>(null)
	let ObjectEditor = $state<Component | null>(null)
	let QuestEditor = $state<Component | null>(null)
	let ItemEditor = $state<Component | null>(null)
	let SpellEditor = $state<Component | null>(null)
	let IconsWindow = $state<Component | null>(null)
	let SoundsWindow = $state<Component | null>(null)
	let CharacterEditor = $state<Component | null>(null)
	$effect(() => {
		if (ui.creatureEditor && !CreatureEditor) void import('./components/CreatureEditor.svelte').then((m) => (CreatureEditor = m.default))
		if (ui.objectEditor && !ObjectEditor) void import('./components/ObjectEditor.svelte').then((m) => (ObjectEditor = m.default))
		if (ui.questEditor && !QuestEditor) void import('./components/QuestEditor.svelte').then((m) => (QuestEditor = m.default))
		if (ui.itemEditor && !ItemEditor) void import('./components/ItemEditor.svelte').then((m) => (ItemEditor = m.default))
		if (ui.spellEditor && !SpellEditor) void import('./components/SpellEditor.svelte').then((m) => (SpellEditor = m.default))
		if (ui.iconsTool && !IconsWindow) void import('./components/IconsWindow.svelte').then((m) => (IconsWindow = m.default))
		if (ui.soundsTool && !SoundsWindow) void import('./components/SoundsWindow.svelte').then((m) => (SoundsWindow = m.default))
		if (ui.characterEditor && !CharacterEditor) void import('./components/CharacterEditor.svelte').then((m) => (CharacterEditor = m.default))
	})
	import ModelPreviewWindow from './components/ModelPreviewWindow.svelte'
	import SignSwapWindow from './components/SignSwapWindow.svelte'
	import CreaturesWorkspace from './components/CreaturesWorkspace.svelte'
	import DoodadBrushEditor from './components/DoodadBrushEditor.svelte'
	import Inspector from './components/Inspector.svelte'
	import HistoryWindow from './components/HistoryWindow.svelte'
	import ScriptWindow from './components/ScriptWindow.svelte'
	import FlightPathsWindow from './components/FlightPathsWindow.svelte'
	import CheckMapWindow from './components/CheckMapWindow.svelte'
	import TexturePaletteWindow from './components/TexturePaletteWindow.svelte'
	import MinimapWindow from './components/MinimapWindow.svelte'
	import ReferenceWindow from './components/ReferenceWindow.svelte'
	import DebugOverlay from './components/DebugOverlay.svelte'
	import ContextMenu from './components/ContextMenu.svelte'
	import { loadPrefs, savePrefs } from './lib/state/prefs'
	import { restoreSession, saveSession, skipRestore, startSessionSaving } from './lib/io/session'
	import { offerRecovery, startAutosave } from './lib/io/recovery'
	import { offerFolderSetup } from './lib/io/folderSetup'
	import { startSessionLog } from './lib/io/sessionLog'
	import { startDebugLog } from './lib/io/debugLog'
	import { onMount, untrack } from 'svelte'
	import { refreshGameClient } from './lib/io/game'
	import { initWow } from './lib/wow/api'
	import { defaultLayerTextures } from './lib/wow/defaults'
	import { LAYERS } from './lib/terrain/layers'
	import { docs, editor, prefs, ui, wow } from './lib/state/editor.svelte'
	import { applyUiScale } from './lib/ui/uiScale'
	import { bindKeymap, commandFor, syncKeymap } from './lib/ui/commands'
	import { runCommand } from './lib/ui/runCommand'
	import { controlKeepsKey, formField, keyRoute } from './lib/ui/keys'
	import { engineRef } from './lib/state/engineRef'
	import { EventsOn, WindowSetTitle } from './lib/wails/runtime'
	import { AckClose, SetUnsaved } from './lib/wails/App'
	import { hasBackend } from './lib/io/backend'
	import { refreshProjects } from './lib/io/project'
	import { startWheelValue } from './lib/ui/wheelValue'

	let prefsLoaded = $state(false)
	onMount(() => {
		const stopLogFile = startSessionLog()
		const stopWheelValue = startWheelValue()
		const debugLog = startDebugLog()
		void refreshGameClient()
		void refreshProjects()
		const wowReady = initWow().catch((e) => console.warn('WoW client init failed', e))
		const prefsReady = loadPrefs().finally(() => (prefsLoaded = true))
		// With the preferences and the client's status known, open what was open at the last close.
		let stopSaving = () => {}
		let stopAutosave = () => {}
		Promise.all([wowReady, prefsReady]).then(async () => {
			const engine = engineRef.current
			if (!engine) return
			await restoreSession(engine).catch((e) => console.warn('could not restore the session', e))
			stopSaving = startSessionSaving(engine)
			stopAutosave = startAutosave(engine)
			// The probes' page (?nosession) must not meet the owner's recovery dialog over its screenshots (#262).
			if (!skipRestore) void offerRecovery().then(() => offerFolderSetup())
		})
		return () => {
			stopSaving()
			stopAutosave()
			stopLogFile()
			stopWheelValue()
			void debugLog.then((stop) => stop())
		}
	})

	// Closing the window with unsaved maps asks first, as File › Quit does (#188): Go stops the close
	// while any tab is dirty and sends app:close, which opens the same dialog.
	const unsaved = $derived(editor.dirty || docs.tabs.some((t) => t.id !== docs.active && t.dirty))
	$effect(() => {
		if (hasBackend()) void SetUnsaved(unsaved)
	})
	onMount(() => {
		if (!hasBackend()) return
		return EventsOn('app:close', () => {
			ui.dialog = 'quit'
			void AckClose()
		})
	})

	// The keys follow the Hotkey Manager's bindings (#396): the menus and the Shortcuts dialog read them
	// through the getter, and this effect rebuilds the camera's keys as soon as the pref is replaced.
	bindKeymap(() => prefs.keymap)
	$effect(() => syncKeymap())

	// Preferences › General › Interface size (#372): the whole page zoomed, before the engine reads the pref for its pixel ratio.
	$effect(() => applyUiScale(prefs.uiScale))

	// Object.keys on the reactive prefs reads every key (the session too), so the keys are listed once, untracked.
	const prefKeys = untrack(() => Object.keys(prefs)).filter((k) => k !== 'session')
	// Apply preferences to the engine whenever they change, and persist them.
	$effect(() => {
		// The session changes with every camera move: it is saved on its own (savePref), so it stays out of
		// this effect, which would re-apply every preference and walk them all for a save (#461).
		const snapshot = {} as Record<string, unknown>
		for (const k of prefKeys) snapshot[k] = prefs[k as keyof typeof prefs]
		// eslint-disable-next-line no-restricted-syntax -- the snapshot holds every key but the session, which applyPrefs does not read
		engineRef.current?.applyPrefs(snapshot as unknown as typeof prefs)
		if (prefsLoaded) savePrefs()
	})

	// A map still on the built-in colour palette gets the default WoW tileset set as
	// soon as a client is available. Setting the palette leaves the map's dirty flag alone: putting back
	// the flag read before the await wiped an edit made meanwhile (#779, the autosave probe's first copy).
	// The effect is keyed on `wantsDefaultPalette` alone (#598), so an edit or a palette change that
	// keeps it true doesn't fetch again; a result equal to the palette (a client with none of the
	// tilesets) is not written, since the new array would set it off once more.
	const isDefaultPalette = (palette: string[]) => palette.every((p) => LAYERS.some((l) => l.swatch === p))
	const wantsDefaultPalette = $derived(wow.loaded && isDefaultPalette(editor.palette))
	$effect(() => {
		if (!wantsDefaultPalette) return
		defaultLayerTextures().then((t) => {
			const cur = editor.palette
			if (!isDefaultPalette(cur) || (t.length === cur.length && t.every((p, i) => p === cur[i]))) return
			editor.palette = t
		})
	})

	// Preferences › General › Theme (#49): app.css's light tokens apply under data-theme="light"; System follows
	// the desktop and changes with it.
	$effect(() => {
		const theme = prefs.theme
		const media = window.matchMedia('(prefers-color-scheme: light)')
		const apply = () => (document.documentElement.dataset.theme = theme === 'light' || (theme === 'system' && media.matches) ? 'light' : 'dark')
		apply()
		if (theme !== 'system') return
		media.addEventListener('change', apply)
		return () => media.removeEventListener('change', apply)
	})

	// Window title and tab label follow the active map.
	$effect(() => {
		const title = `${editor.mapName}${editor.dirty ? ' *' : ''} — Meld`
		if (hasBackend()) WindowSetTitle(title)
	})

	// The palette follows the tool: textures for painting, models otherwise.
	$effect(() => {
		const t = editor.tool
		if (t === 'paint' || t === 'road' || (t === 'path' && editor.pathKind !== 'fence') || (t === 'sculpt' && editor.sculptPaint === 'texture')) ui.palette = 'textures'
		else if (t === 'place' || (t === 'path' && editor.pathKind === 'fence')) ui.palette = 'models'
	})

	/**
	 * A bare Alt press is swallowed on its way down and up. Otherwise Windows takes the released Alt as
	 * "enter the menu loop" and moves keyboard focus out of the page, so after an Alt+click (pipette)
	 * the page no longer sees Ctrl and Ctrl+scroll (spin) stops working.
	 */
	function onKeyUp(e: KeyboardEvent) {
		if (e.key === 'Alt') e.preventDefault()
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Alt') {
			e.preventDefault()
			return
		}
		// A text field keeps every key. A slider, select or checkbox keeps its own keys too, but
		// Ctrl+Z and Ctrl+Y reach the map: such a control has no undo of its own, and after dragging an
		// options-bar slider (Vertex mode's Slope) the focus stays on it (#127).
		const field = formField(e.target)
		if (field === 'text') return
		if (field === 'control' && controlKeepsKey(e)) return
		const engine = engineRef.current
		const route = keyRoute(e, {
			blocked: !engine || ui.showNewDialog || !!ui.dialog || ui.signSwap,
			brushEditor: ui.brushEditor,
			modelPreview: !!ui.modelPreview,
			inspector: ui.inspector,
			databaseEditor: !!(ui.questEditor || ui.itemEditor || ui.spellEditor || ui.iconsTool || ui.soundsTool || ui.characterEditor),
			spawnEditor: !!(ui.creatureEditor || ui.objectEditor),
		})
		if (!engine || route === 'none') return
		if (route === 'closeInspector') {
			ui.inspector = false
			e.preventDefault()
			return
		}
		if (route === 'undoRedo') {
			const id = commandFor(e, true)
			if (id === 'undo' || id === 'redo') {
				runCommand(id)
				e.preventDefault()
			}
			return
		}

		// The Ctrl chords, the function keys and Tab come first (lib/ui/commands.ts); a Ctrl chord that
		// is no command goes no further.
		const early = commandFor(e, true)
		if (early) {
			runCommand(early)
			e.preventDefault()
			return
		}
		if (e.ctrlKey || e.metaKey) return

		if (engine.handleSelectionKey(e) || engine.handleToolKey(e)) {
			e.preventDefault()
			return
		}

		const late = commandFor(e, false)
		if (!late) return
		runCommand(late)
		e.preventDefault()
	}

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (engineRef.current) saveSession(engineRef.current)
		if (editor.dirty) e.preventDefault()
	}
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onbeforeunload={onBeforeUnload} />

<div class="app" class:bare={ui.hidePanels}>
	<MenuBar />
	{#if !ui.hidePanels}
		<OptionsBar />
	{/if}
	<div class="main" class:toolbar-right={prefs.toolbarSide === 'right'}>
		{#if !ui.hidePanels}
			<Toolbar />
		{/if}
		<div class="centre">
			<Viewport />
			{#if !ui.hidePanels}
				<AssetBrowser />
			{/if}
		</div>
		{#if !ui.hidePanels && !prefs.dockHidden}
			<Dock />
		{/if}
	</div>
	{#if !ui.hidePanels}
		<StatusBar />
	{/if}
</div>

<Inspector />
<HistoryWindow />
<ScriptWindow />
{#if ui.flightPaths}<FlightPathsWindow />{/if}
<CheckMapWindow />
<TexturePaletteWindow />
<MinimapWindow />
{#if ui.referenceWindow}<ReferenceWindow />{/if}
<CreaturesWorkspace />
{#if CreatureEditor}{@const Editor = CreatureEditor}<Editor />{/if}
{#if ObjectEditor}{@const Editor = ObjectEditor}<Editor />{/if}
{#if QuestEditor}{@const Editor = QuestEditor}<Editor />{/if}
{#if ItemEditor}{@const Editor = ItemEditor}<Editor />{/if}
{#if SpellEditor}{@const Editor = SpellEditor}<Editor />{/if}
{#if IconsWindow}{@const Editor = IconsWindow}<Editor />{/if}
{#if SoundsWindow}{@const Editor = SoundsWindow}<Editor />{/if}
{#if CharacterEditor}{@const Editor = CharacterEditor}<Editor />{/if}
<ModelPreviewWindow />
{#if ui.signSwap}<SignSwapWindow />{/if}
<DoodadBrushEditor />
<AppDialogs />
<SavingBar />
<ContextMenu />
<DebugOverlay />
{#if ui.showNewDialog}
	<NewMapDialog />
{/if}

<style>
	.app {
		display: grid;
		/* A bare grid's column is auto: a long status line (nowrap) widened it past the window and pushed the dock and canvas aside (#770). */
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto 1fr auto;
		height: 100%;
	}
	/* With the panels hidden (Tab) the viewport takes the window below the menu bar. */
	.app.bare {
		grid-template-rows: auto 1fr;
	}
	.main {
		display: grid;
		grid-template-columns: auto 1fr auto;
		min-height: 0;
	}
	.centre {
		/* Always the middle column: with the toolbar and dock hidden it would else fall into the first (auto) one. */
		grid-column: 2;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	/* The toolbar at the window's right edge, after the dock (#654): the columns change, not the DOM, so the tab order stays. */
	.main.toolbar-right {
		grid-template-columns: 1fr auto auto;
	}
	.main.toolbar-right > .centre {
		grid-column: 1;
	}
	.main.toolbar-right > :global(.toolbar) {
		grid-column: 3;
		grid-row: 1;
	}
	.main.toolbar-right > :global(.dock) {
		grid-column: 2;
		grid-row: 1;
	}
</style>
