<script lang="ts">
	import { editor, prefs, setStatus, ui, wow } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { compileRegion, exportSpawnSql } from '../lib/io/compile'
	import { launchGame, playHere, exportPortCoords, controlServer, refreshServerStatus } from '../lib/io/game'
	import { chooseExternalDatabase, disconnectExternal } from '../lib/io/external'
	import { exportAlphamap, importAlphamap, exportHeightmap, exportNormalMap, writeMinimapTiles } from '../lib/io/images'
	import { exportDoodadBrush, exportObjectList, importDoodadBrushes, importObjectList } from '../lib/io/lists'
	import { requestRevert } from '../lib/io/mapio'
	import { editWorldHere, extendRegion, openWorldView, restoreClientPaint } from '../lib/io/region'
	import { saveSelectionAsPrefab } from '../lib/io/prefabFiles'
	import { activeDoodadBrush } from '../lib/tools/DoodadBrushTool'
	import { openProject } from '../lib/io/project'
	import type { ProjectInfo } from '../lib/state/editor.svelte'
	import { copyPerfReport, copyScene, pasteScene } from '../lib/io/scene'
	import { BENCH_MAPS, BENCH_SCALES, openBenchMap } from '../lib/bench/benchMaps'
	import { GameEvents } from '../lib/wails/App'
	import { quitNow } from '../lib/io/session'
	import { BrowserOpenURL } from '../lib/wails/runtime'
	import { MANUAL_URL } from './AppDialogs.svelte'
	import { focusMenuEdge, menuMoveFocus } from '../lib/ui/menuKeys'
	import { tick, untrack } from 'svelte'
	import { runCommand } from '../lib/ui/runCommand'
	import { CAMERA_VIEWS, cameraView, setCameraView } from '../lib/ui/cameraView'
	import { buildMenus, regionEvents, type MenuActions, type MenuItem } from '../lib/ui/menus'

	/** Opens a web page in the user's browser (the desktop runtime's way, else the dev page's). */
	function openUrl(url: string) {
		if (hasBackend()) BrowserOpenURL(url)
		else window.open(url, '_blank', 'noopener')
	}

	/** Opens a recent project from the File menu; one that no longer opens shows the Project dialog with why. */
	async function switchProject(p: ProjectInfo) {
		const err = await openProject(p.name, p.path, p.clientPath)
		if (err) {
			setStatus(`Project ${p.name} didn't open: ${err}`, 8000)
			ui.dialog = 'project'
		}
	}

	// The world events' names (game_event), read once there are spawns to sort into them (#143).
	let eventNames = $state<Map<number, string>>(new Map())
	let eventsAsked = false
	$effect(() => {
		if (eventsAsked || !editor.spawns.some((s) => s.events?.length)) return
		eventsAsked = true
		GameEvents()
			.then((list) => (eventNames = new Map((list ?? []).map((e) => [e.id, e.name]))))
			.catch(() => (eventsAsked = false))
	})

	function exit() {
		if (engineRef.current?.anyDirty()) ui.dialog = 'quit'
		else if (hasBackend()) quitNow()
	}

	const actions: MenuActions = {
		command: runCommand,
		engine: () => engineRef.current,
		switchProject,
		exit,
		openManual: () => openUrl(MANUAL_URL),
		setCameraView,
		setStatus,
		io: {
			compileRegion,
			exportSpawnSql,
			launchGame,
			playHere,
			exportPortCoords,
			controlServer,
			chooseExternalDatabase,
			disconnectExternal,
			exportAlphamap,
			importAlphamap,
			exportHeightmap,
			exportNormalMap,
			writeMinimapTiles,
			exportDoodadBrush,
			exportObjectList,
			importDoodadBrushes,
			importObjectList,
			requestRevert,
			editWorldHere,
			extendRegion,
			openWorldView,
			restoreClientPaint,
			saveSelectionAsPrefab,
			copyPerfReport,
			copyScene,
			pasteScene,
			openBenchMap,
			activeDoodadBrush,
		},
	}

	// Rebuilt reactively so checkmarks and enabled states stay current: the build (lib/ui/menus.ts, #584)
	// reads the reactive ui, editor and prefs, so this derived follows what it reads.
	const menus = $derived(
		buildMenus({
			ui,
			editor,
			prefs,
			backend: hasBackend(),
			wowLoaded: wow.loaded,
			events: regionEvents(editor.spawns, eventNames),
			cameraView: cameraView(),
			cameraViews: CAMERA_VIEWS,
			benchMaps: BENCH_MAPS,
			benchScales: BENCH_SCALES,
			act: actions,
		}),
	)

	// Classic menubar behaviour: click opens, hovering another title while
	// open switches menus, click outside / Esc closes. From the keyboard it follows the WAI-ARIA
	// menubar pattern (#370): Enter, Space or Down on a title opens its menu on the first item (Up on
	// the last), Up/Down/Home/End move between the items, Left/Right go to the neighbouring menu,
	// Escape closes the menu back onto its title and Tab closes it and moves on. Keys pressed in an
	// open menu stop there, so the map's hotkeys don't fire while a menu holds the focus.
	let open = $state<string | null>(null)
	// The server group's state is read each time the File menu opens (#857): it costs a database query and
	// two task list reads, too much to poll.
	$effect(() => {
		if (open === 'File') untrack(() => void refreshServerStatus())
	})
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

	function activate(item: MenuItem) {
		if (item.kind === 'action') {
			if (item.disabled) return
			open = null
			item.run()
		} else if (item.kind === 'check') {
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
									disabled={item.kind === 'action' && item.disabled}
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
		<button onclick={() => engineRef.current?.undo()} disabled={!ui.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
		<button onclick={() => engineRef.current?.redo()} disabled={!ui.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
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
		z-index: var(--z-bar);
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
