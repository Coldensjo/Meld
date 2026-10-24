<script lang="ts">
	import { editor, prefs, setStatus, stepCameraSpeed, ui } from '../lib/state/editor.svelte'
	import type { Engine } from '../lib/engine/Engine'
	import { engineRef } from '../lib/state/engineRef'
	import { playWorld, hasBackend, importTibiaMap, openMap, requestRevert, saveMap } from '../lib/io/mapio'
	import { openProject } from '../lib/io/project'
	import type { ProjectInfo } from '../lib/state/editor.svelte'
	import { copyPerfReport, copyScene, pasteScene } from '../lib/io/scene'
	import { quitNow } from '../lib/io/session'
	import { requestClose } from './DocTabs.svelte'
	import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
	import { rememberAntialias, toggleFullScreen } from '../lib/engine/display'
	import { MANUAL_URL } from './AppDialogs.svelte'
	import { TOOLBAR_ICON_MAX, TOOLBAR_ICON_MIN } from './Toolbar.svelte'
	import { UI_SCALES } from '../lib/ui/uiScale'
	import { GRAPHICS_PRESETS, applyPreset, presetOf } from '../lib/state/graphicsPresets'
	import { focusMenuEdge, menuMoveFocus } from '../lib/ui/menuKeys'
	import { tick } from 'svelte'
	import { setSliceMode, stepSlice } from '../lib/cubes/slice'
	import { MOODS } from '../lib/engine/moods'

	/** Opens a web page in the user's browser (the desktop runtime's way, else the dev page's). */
	function openUrl(url: string) {
		if (hasBackend()) BrowserOpenURL(url)
		else window.open(url, '_blank', 'noopener')
	}

	/** Opens a recent project from the File menu; one that no longer opens shows the Project dialog with why. */
	async function switchProject(p: ProjectInfo) {
		const err = await openProject(p.name, p.path)
		if (err) {
			setStatus(`Project ${p.name} didn't open: ${err}`, 8000)
			ui.dialog = 'project'
		}
	}

	type Item =
		| { kind: 'action'; label: string; shortcut?: string; disabled?: boolean; run: () => unknown }
		| { kind: 'check'; label: string; shortcut?: string; disabled?: boolean; checked: boolean; toggle: () => void }
		| { kind: 'radio'; label: string; checked: boolean; select: () => void }
		| { kind: 'header'; label: string }
		| { kind: 'sep' }

	const withEngine = (fn: (e: NonNullable<typeof engineRef.current>) => unknown) => () => {
		if (engineRef.current) fn(engineRef.current)
	}

	function exit() {
		if (engineRef.current?.anyDirty()) ui.dialog = 'quit'
		else if (hasBackend()) quitNow()
	}

	// The Graphics › Quality preset all of whose values the prefs hold now, or null (#203).
	const graphicsPreset = $derived(presetOf(prefs))
	const radios = <T,>(options: Array<[string, T]>, get: () => T, set: (v: T) => void): Item[] =>
		options.map(([label, v]) => ({ kind: 'radio', label, checked: get() === v, select: () => set(v) }))

	// Rebuilt reactively so checkmarks and enabled states stay current. Each menu is kept short enough
	// to fit the screen (#122).
	const menus = $derived<Array<{ name: string; items: Item[] }>>([
		{
			name: 'File',
			items: [
				// A world of the game in its world format (#29, #62).
				{ kind: 'action', label: 'New Cube World…', shortcut: 'Ctrl+N', run: () => (ui.showNewDialog = true) },
				{ kind: 'action', label: 'Open…', shortcut: 'Ctrl+O', disabled: ui.busy, run: withEngine(openMap) },
				// An Open Tibia map made into a cube world (3dgame #218).
				{ kind: 'action', label: 'Import Tibia Map…', disabled: ui.busy || !hasBackend(), run: withEngine(importTibiaMap) },
				{ kind: 'sep' },
				// Projects (#48): a project folder and the client it edits, with the recent ones to switch to.
				{ kind: 'action', label: ui.project ? `Project: ${ui.project.name}…` : 'Project…', disabled: !hasBackend(), run: () => (ui.dialog = 'project') },
				...ui.recentProjects
					.filter((p) => p.path !== ui.project?.path)
					.slice(0, 4)
					.map((p) => ({ kind: 'action' as const, label: `Open Project ${p.name}`, disabled: !hasBackend() || ui.busy, run: () => switchProject(p) })),
				{ kind: 'sep' },
				{ kind: 'action', label: 'Save', shortcut: 'Ctrl+S', disabled: ui.busy, run: withEngine((e) => saveMap(e)) },
				{ kind: 'action', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: ui.busy, run: withEngine((e) => saveMap(e, true)) },
				{ kind: 'action', label: 'Revert to Saved', disabled: !editor.filePath || ui.busy, run: withEngine(requestRevert) },
				{ kind: 'action', label: 'World Properties…', run: () => (ui.dialog = 'mapProps') },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Close World', shortcut: 'Ctrl+W', run: withEngine((e) => requestClose(e.activeDocumentId())) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Exit', run: exit },
			],
		},
		{
			name: 'Edit',
			items: [
				{ kind: 'action', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !ui.canUndo, run: withEngine((e) => e.undo()) },
				{ kind: 'action', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !ui.canRedo, run: withEngine((e) => e.redo()) },
				{ kind: 'check', label: 'History (go back to any step)', checked: ui.history, toggle: () => (ui.history = !ui.history) },
				{ kind: 'sep' },
				// Copy, Cut, Paste, Delete and Deselect act on the Select tool's box of cubes (#70).
				{ kind: 'action', label: 'Copy Cubes', shortcut: 'Ctrl+C', disabled: !ui.cubeSelection, run: withEngine((e) => e.copySelection()) },
				{ kind: 'action', label: 'Cut Cubes', shortcut: 'Ctrl+X', disabled: !ui.cubeSelection, run: withEngine((e) => e.cutSelection()) },
				{ kind: 'action', label: 'Paste Cubes', shortcut: 'Ctrl+V', disabled: !ui.hasCubeClip, run: withEngine((e) => e.startPaste()) },
				{ kind: 'action', label: 'Delete Selected Cubes', shortcut: 'Del', disabled: !ui.cubeSelection, run: withEngine((e) => e.deleteCubes()) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Deselect', shortcut: 'Ctrl+D', disabled: !ui.cubeSelection && !ui.cubePasting, run: withEngine((e) => e.deselect()) },
				{ kind: 'sep' },
				// The texture ids the world's faces are painted with, each replaceable with another (3dgame #216).
				{ kind: 'action', label: 'Textures in This World…', run: () => (ui.dialog = 'textures') },
			],
		},
		{
			name: 'View',
			items: [
				{ kind: 'check', label: 'Performance overlay (where the frame time goes)', shortcut: 'Ctrl+Shift+M', checked: prefs.perfOverlay, toggle: () => (prefs.perfOverlay = !prefs.perfOverlay) },
				{ kind: 'check', label: 'Hide panels', shortcut: 'Tab', checked: ui.hidePanels, toggle: () => (ui.hidePanels = !ui.hidePanels) },
				// The world's layers (#30): only one and those above or below it, to work underground.
				{ kind: 'header', label: 'Layer slice' },
				...radios<typeof ui.cubeSlice.mode>(
					[
						['Every layer', 'off'],
						[`Layer ${ui.cubeSlice.layer} and above`, 'above'],
						[`Layer ${ui.cubeSlice.layer} and below`, 'below'],
					],
					() => ui.cubeSlice.mode,
					setSliceMode,
				),
				{ kind: 'action', label: 'Slice a layer up', shortcut: ',', run: () => stepSlice(-1) },
				{ kind: 'action', label: 'Slice a layer down', shortcut: '.', run: () => stepSlice(1) },
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
				{ kind: 'sep' },
				{
					kind: 'check',
					label: 'Anti-aliasing (after a restart)',
					checked: prefs.antialias,
					toggle: () => {
						prefs.antialias = !prefs.antialias
						rememberAntialias(prefs.antialias)
						setStatus('Anti-aliasing changes the next time Meld starts.', 4000)
					},
				},
				{ kind: 'header', label: 'FPS limit' },
				...radios(
					[
						["None (the screen's rate)", 0],
						['30', 30],
						['60', 60],
						['120', 120],
					],
					() => prefs.fpsLimit,
					(v) => (prefs.fpsLimit = v),
				),
				{ kind: 'sep' },
				{ kind: 'action', label: 'Full Screen', shortcut: 'F11', run: () => void toggleFullScreen() },
			],
		},
		{
			name: 'Lighting',
			items: [
				{ kind: 'header', label: 'Look' },
				...radios(
					[
						["The game's mood (sky, fog, light, grade)", 'mood'],
						['Work light', 'work'],
					],
					() => prefs.look,
					(v) => (prefs.look = v as typeof prefs.look),
				),
				{ kind: 'header', label: 'Mood' },
				...radios(
					[['Follow the time of day', ''] as [string, string], ...MOODS.surfaceNames.map((n) => [n[0].toUpperCase() + n.slice(1), n] as [string, string])],
					() => prefs.mood,
					(v) => {
						prefs.mood = v as string
						prefs.look = 'mood'
					},
				),
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
				...radios(
					[
						['Off', 'off'],
						['Medium', 'medium'],
						['High', 'high'],
					],
					() => prefs.shadows,
					(v) => (prefs.shadows = v as typeof prefs.shadows),
				),
				{ kind: 'sep' },
				{ kind: 'check', label: 'Clouds', checked: prefs.clouds, toggle: () => (prefs.clouds = !prefs.clouds) },
				{ kind: 'check', label: 'Fog', checked: prefs.fog, toggle: () => (prefs.fog = !prefs.fog) },
				{ kind: 'check', label: 'Smooth Textures', checked: prefs.smoothTextures, toggle: () => (prefs.smoothTextures = !prefs.smoothTextures) },
			],
		},
		{
			name: 'Camera',
			items: [
				{ kind: 'action', label: 'Turn Around (180°)', run: withEngine((e) => e.turnCameraAround()) },
				{ kind: 'check', label: 'Top-down View (2D)', shortcut: 'U', checked: ui.topDown, toggle: () => (ui.topDown = !ui.topDown) },
				{
					kind: 'check',
					label: 'Walk (FPS camera, on the ground layer)',
					checked: ui.walkCamera,
					toggle: () => {
						ui.walkCamera = !ui.walkCamera
						setStatus(ui.walkCamera ? 'Walking: W A S D move at a run (Shift faster), the mouse looks around. Camera › Walk again returns to your camera.' : 'Back to your camera.', 4000)
					},
				},
				{ kind: 'check', label: 'Minimap Window', shortcut: 'M', checked: ui.minimap, toggle: () => (ui.minimap = !ui.minimap) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Faster', shortcut: 'P', run: () => stepCameraSpeed(true) },
				{ kind: 'action', label: 'Slower', shortcut: 'O', run: () => stepCameraSpeed(false) },
			],
		},
		{
			name: 'Bookmarks',
			items: [
				{ kind: 'action', label: 'Add Bookmark', shortcut: 'Ctrl+B', run: withEngine((e) => e.addBookmark()) },
				...(editor.bookmarks.length ? [{ kind: 'sep' as const }] : []),
				...editor.bookmarks.map((b, i) => ({ kind: 'action' as const, label: b.name, run: withEngine((e: Engine) => e.gotoBookmark(i)) })),
				...(editor.bookmarks.length ? [{ kind: 'sep' as const }, { kind: 'action' as const, label: 'Clear Bookmarks', run: withEngine((e: Engine) => e.clearBookmarks()) }] : []),
			],
		},
		{
			name: 'Game',
			items: [
				{ kind: 'action', label: 'Play World', disabled: !hasBackend(), run: () => playWorld(engineRef.current) },
			],
		},
		{
			name: 'Tools',
			items: [
				// A sprite drawn slanted (a Tibia item, an isometric tile) made into a 3D model (internal/spritemodel).
				{ kind: 'action', label: 'Sprite to 3D Model…', disabled: !hasBackend(), run: () => (ui.dialog = 'spriteModel') },
			],
		},
		{
			name: 'Preferences',
			items: [
				{ kind: 'header', label: 'Autosave unsaved worlds' },
				...radios(
					[
						['Every minute', 1],
						['Every 3 minutes', 3],
						['Every 10 minutes', 10],
						['Off', 0],
					],
					() => prefs.autosaveMinutes,
					(v) => (prefs.autosaveMinutes = v),
				),
				{ kind: 'header', label: 'Theme' },
				...radios<typeof prefs.theme>(
					[
						['Dark', 'dark'],
						['Light', 'light'],
						['System (follow the desktop)', 'system'],
					],
					() => prefs.theme,
					(v) => (prefs.theme = v),
				),
				{ kind: 'header', label: 'Camera speed' },
				...radios(
					[
						['Slow', 0.5],
						['Normal', 1],
						['Fast', 2],
					],
					() => prefs.cameraSpeed,
					(v) => (prefs.cameraSpeed = v),
				),
				{ kind: 'header', label: 'Mouse sensitivity' },
				...radios(
					[
						['Low', 0.6],
						['Normal', 1],
						['High', 1.6],
					],
					() => prefs.mouseSensitivity,
					(v) => (prefs.mouseSensitivity = v),
				),
				{ kind: 'header', label: 'Interface size (Ctrl+= / Ctrl+- / Ctrl+0)' },
				...radios(
					UI_SCALES.map((s) => [`${Math.round(s * 100)} %`, s] as [string, number]),
					() => prefs.uiScale,
					(v) => (prefs.uiScale = v),
				),
				{ kind: 'header', label: 'Toolbar' },
				...radios(
					[
						['Small', TOOLBAR_ICON_MIN],
						['Normal', 22],
						['Large', 30],
						['Larger', 36],
						['Largest', TOOLBAR_ICON_MAX],
					],
					() => prefs.toolbarIcon,
					(v) => (prefs.toolbarIcon = v),
				),
				...radios<typeof prefs.toolbarSide>(
					[
						['Toolbar on the left', 'left'],
						['Toolbar on the right', 'right'],
					],
					() => prefs.toolbarSide,
					(v) => (prefs.toolbarSide = v),
				),
				{ kind: 'sep' },
				{ kind: 'check', label: 'Invert camera Y', checked: prefs.invertY, toggle: () => (prefs.invertY = !prefs.invertY) },
			],
		},
		{
			name: 'Help',
			items: [
				{ kind: 'action', label: 'Help…', shortcut: 'F1', run: () => (ui.dialog = 'help') },
				{ kind: 'action', label: 'Log…', run: () => (ui.dialog = 'log') },
				{ kind: 'action', label: 'Keyboard Shortcuts…', run: () => (ui.dialog = 'shortcuts') },
				{ kind: 'action', label: 'Manual (on GitHub)', run: () => openUrl(MANUAL_URL) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'Copy Scene', disabled: !hasBackend() || ui.busy, run: withEngine(copyScene) },
				{ kind: 'action', label: 'Load Scene from Clipboard', disabled: !hasBackend() || ui.busy, run: withEngine(pasteScene) },
				{ kind: 'action', label: 'Copy Performance Report', run: withEngine(copyPerfReport) },
				{ kind: 'sep' },
				{ kind: 'action', label: 'About Meld…', run: () => (ui.dialog = 'about') },
			],
		},
	])

	// Classic menubar behaviour: click opens, hovering another title while
	// open switches menus, click outside / Esc closes. From the keyboard it follows the WAI-ARIA
	// menubar pattern (#370): Enter, Space or Down on a title opens its menu on the first item (Up on
	// the last), Up/Down/Home/End move between the items, Left/Right go to the neighbouring menu,
	// Escape closes the menu back onto its title and Tab closes it and moves on. Keys pressed in an
	// open menu stop there, so the map's hotkeys don't fire while a menu holds the focus.
	let open = $state<string | null>(null)
	let bar: HTMLElement
	let dropdown = $state<HTMLElement | undefined>()
	const titles: Record<string, HTMLButtonElement> = {}

	/** Opens menu `name` and focuses its first item (or its last, or none). */
	function openMenu(name: string, focus: 'first' | 'last' | null = 'first') {
		open = name
		if (focus) tick().then(() => open === name && focusMenuEdge(dropdown, focus === 'last'))
	}

	/** The menu `step` places to the left (-1) or right (+1) of `name`, wrapping. */
	function neighbour(name: string, step: number): string {
		const i = menus.findIndex((m) => m.name === name)
		return menus[(i + step + menus.length) % menus.length].name
	}

	function onTitleKey(e: KeyboardEvent, name: string) {
		let handled = true
		if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') openMenu(name, 'first')
		else if (e.key === 'ArrowUp') openMenu(name, 'last')
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			const next = neighbour(name, e.key === 'ArrowLeft' ? -1 : 1)
			if (open) openMenu(next, 'first')
			titles[next]?.focus()
		} else if (e.key === 'Escape' && open) open = null
		else handled = false
		if (handled) {
			e.preventDefault()
			e.stopPropagation()
		}
	}

	function onMenuKey(e: KeyboardEvent, name: string) {
		// Every key stays in the menu: the map's hotkeys must not fire while it holds the focus.
		e.stopPropagation()
		if (e.ctrlKey || e.altKey || e.metaKey) return
		if (e.key === 'Escape') {
			e.preventDefault()
			open = null
			titles[name]?.focus()
		} else if (e.key === 'Tab') {
			// Back on the title before the menu goes, so the browser's own Tab moves on from there.
			titles[name]?.focus()
			open = null
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault()
			const next = neighbour(name, e.key === 'ArrowLeft' ? -1 : 1)
			titles[next]?.focus()
			openMenu(next, 'first')
		} else if (dropdown && menuMoveFocus(dropdown, e.key)) e.preventDefault()
	}

	function activate(item: Item) {
		if (item.kind === 'action') {
			if (item.disabled) return
			open = null
			item.run()
		} else if (item.kind === 'check') {
			if (item.disabled) return
			item.toggle()
		} else if (item.kind === 'radio') {
			item.select()
		}
	}

	function onWindowPointer(e: PointerEvent) {
		if (open && !bar.contains(e.target as Node)) open = null
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(e) => open && e.key === 'Escape' && (open = null)} onblur={() => (open = null)} />

<header class="menubar" bind:this={bar}>
	<span class="brand">Meld</span>
	<div class="menus" role="menubar" aria-label="Main menu">
		{#each menus as m (m.name)}
			<div class="menu">
				<button
					class="title"
					class:open={open === m.name}
					role="menuitem"
					bind:this={titles[m.name]}
					aria-haspopup="menu"
					aria-expanded={open === m.name}
					onclick={() => (open === m.name ? (open = null) : openMenu(m.name))}
					onpointerenter={() => open && open !== m.name && openMenu(m.name)}
					onkeydown={(e) => onTitleKey(e, m.name)}
				>
					{m.name}
				</button>
				{#if open === m.name}
					<div class="dropdown" role="menu" tabindex="-1" aria-label={m.name} bind:this={dropdown} onkeydown={(e) => onMenuKey(e, m.name)}>
						{#each m.items as item, i (i)}
							{#if item.kind === 'sep'}
								<div class="sep"></div>
							{:else if item.kind === 'header'}
								<div class="header">{item.label}</div>
							{:else}
								<button
									class="item"
									tabindex="-1"
									role={item.kind === 'action' ? 'menuitem' : item.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
									aria-checked={item.kind === 'action' ? undefined : item.checked}
									disabled={(item.kind === 'action' || item.kind === 'check') && item.disabled}
									onclick={() => activate(item)}
								>
									<span class="mark">
										{#if item.kind === 'check' && item.checked}✓{:else if item.kind === 'radio' && item.checked}●{/if}
									</span>
									<span class="label">{item.label}</span>
									{#if 'shortcut' in item && item.shortcut}<span class="sc">{item.shortcut}</span>{/if}
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
	<div class="quick">
		<button
			class="daynight"
			title={prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? 'Switch to night' : 'Switch to day'}
			aria-label="Toggle day and night"
			onclick={() => {
				prefs.dayCycle = false
				prefs.timeOfDay = prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? 23.5 : 13
			}}>{prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? '☀' : '☾'}</button
		>
		<button onclick={withEngine((e) => e.undo())} disabled={!ui.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
		<button onclick={withEngine((e) => e.redo())} disabled={!ui.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
	</div>
	<div class="spacer"></div>

</header>

<style>
	.menubar {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 34px;
		padding: 0 10px;
		background: var(--panel);
		border-bottom: 1px solid var(--border);
		position: relative;
		z-index: 50;
	}
	.brand {
		font-weight: 700;
		color: var(--accent-text);
		letter-spacing: 0.02em;
		margin-right: 6px;
	}
	.menus {
		display: flex;
	}
	.menu {
		position: relative;
	}
	.title {
		border: none;
		background: transparent;
		padding: 4px 10px;
		border-radius: 4px;
	}
	.title:hover,
	.title.open {
		background: var(--panel-3);
	}
	.dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		min-width: 240px;
		padding: 4px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		/* A menu that still outgrows a small window scrolls rather than running off it. */
		max-height: calc(100 * var(--vh) - 48px);
		overflow-y: auto;
	}
	.item {
		display: flex;
		align-items: center;
		width: 100%;
		gap: 6px;
		border: none;
		background: transparent;
		padding: 5px 8px;
		border-radius: 4px;
		text-align: left;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--accent);
		color: var(--accent-ink);
		outline: none;
	}
	.item:hover:not(:disabled) .sc,
	.item:focus-visible .sc {
		color: var(--accent-ink);
	}
	.mark {
		width: 14px;
		flex: none;
		text-align: center;
		font-size: 11px;
	}
	.label {
		flex: 1;
	}
	.sc {
		font: 11px var(--mono);
		color: var(--text-dim);
		margin-left: 16px;
	}
	.header {
		padding: 6px 8px 2px 28px;
		font-size: 11px;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--border);
	}
	.quick {
		display: flex;
		gap: 2px;
		margin-left: 4px;
	}
	.quick button {
		border: none;
		background: transparent;
		padding: 2px 8px;
		font-size: 15px;
	}
	.quick button:hover:not(:disabled) {
		background: var(--panel-3);
	}
	.spacer {
		flex: 1;
	}

</style>
