<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs, setStatus, ui, wow, type PrefsPage } from '../lib/state/editor.svelte'
	import { hasBackend } from '../lib/io/backend'
	import { chooseBenillaFolder, chooseVmangosFolder, setGameClient, setGameWindow } from '../lib/io/game'
	import { chooseWowFolder } from '../lib/wow/api'
	import { ClearThumbnailCache, GameClient, VmangosPath } from '../../wailsjs/go/main/App'
	import { rememberAntialias } from '../lib/engine/display'
	import { TOOLBAR_ICON_MAX, TOOLBAR_ICON_MIN } from './Toolbar.svelte'
	import { UI_SCALES } from '../lib/ui/uiScale'
	import { flyOnQE, keysOf, setFlyOnQE } from '../lib/ui/commands'
	import { onMount } from 'svelte'

	// Edit › Preferences… (#752): the settings a user sets once and seldom touches again, out of the
	// menus. The menus keep what is flipped while editing (the graphics quality, the view, the camera's
	// views and Faster / Slower). Each setting writes the same pref or Go setting its menu item did, so
	// config.json keeps its keys. The search runs over every page's labels and descriptions.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const PAGES: Array<[PrefsPage, string, string]> = [
		['general', 'General', 'How the editor looks, and what it keeps.'],
		['folders', 'Folders', 'Where Meld finds the client, the server and Benilla. A project (File › Project…) names its own client folder.'],
		['camera', 'Camera and input', "The camera's feel, the keys and a tablet. Camera › Faster and Slower step the speed while flying."],
		['graphics', 'Graphics', 'The quality, render scale, view distance and effects you change while editing stay in the Graphics and Lighting menus.'],
		['compile', 'Compile and export', 'What File › Compile and the minimap export do besides writing the tiles.'],
		['game', 'Game', 'The game Launch and Play Here start (the Game menu), and its window.'],
	]

	// The game window sizes offered (gxResolution).
	const GAME_RESOLUTIONS = ['1280x720', '1600x900', '1920x1080', '2560x1440']

	let query = $state('')
	let server = $state('')
	let benilla = $state({ path: '', built: false })

	/** Reads the server and Benilla folders, which only Go knows. */
	async function refresh() {
		if (!hasBackend()) return
		server = await VmangosPath().catch(() => '')
		const g = await GameClient().catch(() => null)
		benilla = { path: g?.benillaPath ?? '', built: !!g?.benillaBuilt }
	}
	onMount(() => void refresh())

	async function clearThumbs() {
		try {
			await ClearThumbnailCache()
			setStatus('Thumbnail cache cleared. Thumbnails will re-render as you browse (after restart for ones already shown).')
		} catch (e) {
			setStatus(`Could not clear cache: ${e}`)
		}
	}

	type Option = readonly [string, unknown]
	type Setting = { page: PrefsPage; id: string; label: string; desc?: string } & (
		| { kind: 'check'; on: boolean; disabled?: boolean; set: (v: boolean) => void }
		| { kind: 'choice'; options: readonly Option[]; value: unknown; custom?: string; set: (v: unknown) => void }
		| { kind: 'button'; button: string; disabled?: boolean; run: () => unknown }
		| { kind: 'folder'; path: string; note?: string; disabled?: boolean; run: () => unknown }
	)

	/** A setting picked from a list; a value none of the options holds shows as `custom`. */
	function choice<T>(page: PrefsPage, id: string, label: string, desc: string, options: ReadonlyArray<readonly [string, T]>, value: T, set: (v: T) => void, custom?: string): Setting {
		return { page, id, label, desc, kind: 'choice', options, value, custom, set: (v) => set(v as T) }
	}
	function check(page: PrefsPage, id: string, label: string, desc: string, on: boolean, set: (v: boolean) => void, disabled = false): Setting {
		return { page, id, label, desc, kind: 'check', on, set, disabled }
	}

	const percent = (f: number) => `${Math.round(f * 100)} %`

	const SETTINGS = $derived<Setting[]>([
		// General.
		choice<typeof prefs.theme>(
			'general',
			'theme',
			'Theme',
			'The editor’s colours; System follows the desktop’s light or dark setting.',
			[
				['Dark', 'dark'],
				['Light', 'light'],
				['System (follow the desktop)', 'system'],
			],
			prefs.theme,
			(v) => (prefs.theme = v),
		),
		choice(
			'general',
			'uiScale',
			'Interface size',
			`The whole interface, zoomed. ${keysOf('uiLarger')}, ${keysOf('uiSmaller')} and ${keysOf('uiReset')} step it from anywhere.`,
			UI_SCALES.map((s) => [percent(s), s] as const),
			prefs.uiScale,
			(v) => (prefs.uiScale = v),
			percent(prefs.uiScale),
		),
		choice(
			'general',
			'toolbarIcon',
			'Toolbar icons',
			'The size of the tool buttons.',
			[
				['Small', TOOLBAR_ICON_MIN],
				['Normal', 22],
				['Large', 30],
				['Larger', 36],
				['Largest', TOOLBAR_ICON_MAX],
			],
			prefs.toolbarIcon,
			(v) => (prefs.toolbarIcon = v),
			`${prefs.toolbarIcon} px`,
		),
		choice<typeof prefs.toolbarSide>(
			'general',
			'toolbarSide',
			'Toolbar side',
			'The side of the window the toolbar stands on.',
			[
				['Left', 'left'],
				['Right', 'right'],
			],
			prefs.toolbarSide,
			(v) => (prefs.toolbarSide = v),
		),
		choice(
			'general',
			'autosave',
			'Autosave unsaved maps',
			'A recovery copy of each map with unsaved changes, offered again after a crash.',
			[
				['Every minute', 1],
				['Every 3 minutes', 3],
				['Every 10 minutes', 10],
				['Off', 0],
			],
			prefs.autosaveMinutes,
			(v) => (prefs.autosaveMinutes = v),
			`Every ${prefs.autosaveMinutes} minutes`,
		),
		check('general', 'logFileLoading', 'Log file loading', 'Every file read from the client, with its time, in Help › Log.', prefs.logFileLoading, (v) => (prefs.logFileLoading = v)),
		check(
			'general',
			'scriptWriteAnyFile',
			'Scripts may write any file',
			'Lua scripts’ write_file, append_file and image:save may write outside the scripts folder. Off, they write only inside it; reading is never limited.',
			prefs.scriptWriteAnyFile,
			(v) => (prefs.scriptWriteAnyFile = v),
		),
		{
			page: 'general',
			id: 'thumbnails',
			label: 'Thumbnail cache',
			desc: 'The asset browser’s rendered thumbnails. Cleared, they render again as you browse.',
			kind: 'button',
			button: 'Clear',
			disabled: !wow.loaded,
			run: clearThumbs,
		},

		// Folders.
		{
			page: 'folders',
			id: 'wowFolder',
			label: 'WoW client folder',
			desc: 'Your 1.12 client: models, textures, opening Azeroth and compiling to the client. Nothing is copied out of it.',
			kind: 'folder',
			path: wow.path,
			disabled: !hasBackend() || wow.loading,
			run: chooseWowFolder,
		},
		{
			page: 'folders',
			id: 'vmangosFolder',
			label: 'VMaNGOS server folder',
			desc: 'Spawns, the database editors, Compile to Server and Launch.',
			kind: 'folder',
			path: server,
			disabled: !hasBackend(),
			run: async () => {
				await chooseVmangosFolder()
				await refresh()
			},
		},
		{
			page: 'folders',
			id: 'benillaFolder',
			label: 'Benilla folder',
			desc: 'The open-source 1.12 client’s repository, with its release build in target/release. Pick it as the game on the Game page.',
			kind: 'folder',
			path: benilla.path,
			note: benilla.path && !benilla.built ? 'Not built: run cargo build --release -p benilla there.' : '',
			disabled: !hasBackend(),
			run: async () => {
				await chooseBenillaFolder()
				await refresh()
			},
		},

		// Camera and input.
		choice(
			'camera',
			'cameraSpeed',
			'Camera speed',
			'How fast the camera flies. Camera › Faster and Slower step it.',
			[
				['Slow', 0.5],
				['Normal', 1],
				['Fast', 2],
			],
			prefs.cameraSpeed,
			(v) => (prefs.cameraSpeed = v),
			percent(prefs.cameraSpeed),
		),
		choice(
			'camera',
			'mouseSensitivity',
			'Mouse sensitivity',
			'How far the camera turns for a move of the mouse.',
			[
				['Low', 0.6],
				['Normal', 1],
				['High', 1.6],
			],
			prefs.mouseSensitivity,
			(v) => (prefs.mouseSensitivity = v),
			percent(prefs.mouseSensitivity),
		),
		check('camera', 'invertY', 'Invert camera Y', 'Moving the mouse up looks down.', prefs.invertY, (v) => (prefs.invertY = v)),
		check('camera', 'flyOnQE', 'Q / E fly up and down', 'Instead of turning: Q joins Fly up, E joins Fly down.', flyOnQE(prefs.keymap), (v) => (prefs.keymap = setFlyOnQE(prefs.keymap, v))),
		{ page: 'camera', id: 'hotkeys', label: 'Keyboard shortcuts', desc: 'Rebind any command or camera key.', kind: 'button', button: 'Hotkey Manager…', run: () => (ui.dialog = 'hotkeys') },
		check('camera', 'tabletSupport', 'Tablet support', 'A pen’s pressure scales sculpt speed and paint strength; a mouse is unchanged.', prefs.tabletSupport, (v) => (prefs.tabletSupport = v)),
		check('camera', 'tabletRadius', 'Pen pressure sizes the brush', 'With Tablet support on, a light touch also paints a smaller brush.', prefs.tabletRadius, (v) => (prefs.tabletRadius = v), !prefs.tabletSupport),

		// Graphics.
		check('graphics', 'antialias', 'Anti-aliasing', 'Smooths the edges of the 3D view. Takes effect the next time Meld starts.', prefs.antialias, (v) => {
			prefs.antialias = v
			rememberAntialias(v)
			setStatus('Anti-aliasing changes the next time Meld starts.', 4000)
		}),
		choice(
			'graphics',
			'fpsLimit',
			'FPS limit',
			'Frames a second at most, to keep a laptop cool and quiet.',
			[
				["None (the screen's rate)", 0],
				['30', 30],
				['60', 60],
				['120', 120],
			],
			prefs.fpsLimit,
			(v) => (prefs.fpsLimit = v),
			String(prefs.fpsLimit),
		),

		// Compile and export.
		check('compile', 'checkBeforeCompile', 'Check the map before compile', 'Compile to Client and Compile All run File › Check Map… first, and an error stops them.', prefs.checkBeforeCompile, (v) => (prefs.checkBeforeCompile = v)),
		check(
			'compile',
			'buildMoveMaps',
			'Build movement maps on compile',
			'Compile to Server rebuilds the server’s movement maps (mmaps) of the tiles it rebuilt, so creatures path over the new ground.',
			prefs.buildMoveMaps,
			(v) => (prefs.buildMoveMaps = v),
		),
		check(
			'compile',
			'minimapAllModels',
			'Minimap tiles with all models',
			'Import/Export › Write Minimap Tiles draws the trees and small models too, not only the buildings the client’s own tiles show.',
			prefs.minimapAllModels,
			(v) => (prefs.minimapAllModels = v),
		),

		// Game.
		choice<typeof ui.gameClient>(
			'game',
			'gameClient',
			'Game client',
			'The game Launch and Play Here start, logged in with the Game Login. Benilla needs its folder (Folders page).',
			[
				['World of Warcraft (Wow.exe)', 'wow'],
				['Benilla', 'benilla'],
			],
			ui.gameClient,
			(v) => void setGameClient(v),
		),
		choice<typeof ui.gameWindow>(
			'game',
			'gameWindow',
			'Game window',
			'How the game’s window opens when Meld starts it, written into its own settings each time.',
			[
				["The game's own setting", ''],
				['Windowed', 'windowed'],
				['Fullscreen', 'fullscreen'],
			],
			ui.gameWindow,
			(v) => void setGameWindow(v),
		),
		...(ui.gameWindow === ''
			? []
			: [
					choice(
						'game',
						'gameResolution',
						'Game window size',
						'The size of the game’s window (or its fullscreen resolution, for Wow.exe).',
						GAME_RESOLUTIONS.map((r) => [r.replace('x', ' × '), r] as const),
						ui.gameResolution,
						(v) => void setGameWindow(ui.gameWindow, v),
						ui.gameResolution.replace('x', ' × '),
					),
				]),
		{ page: 'game', id: 'gameLogin', label: 'Game login', desc: 'The account, password and character Launch logs in with.', kind: 'button', button: 'Game Login…', disabled: !hasBackend(), run: () => (ui.dialog = 'gameLogin') },
	])

	/** Whether setting `s` holds every word of the search, in its label, description or page name. */
	function matches(s: Setting, words: string[]): boolean {
		const page = PAGES.find((p) => p[0] === s.page)?.[1] ?? ''
		const text = `${s.label} ${s.desc ?? ''} ${page}`.toLowerCase()
		return words.every((w) => text.includes(w))
	}
	const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean))
	const shown = $derived(words.length ? SETTINGS.filter((s) => matches(s, words)) : SETTINGS.filter((s) => s.page === ui.prefsPage))
	/** The pages shown: every page with a hit while searching, else the one picked. */
	const pagesShown = $derived(PAGES.filter(([id]) => shown.some((s) => s.page === id) || (!words.length && id === ui.prefsPage)))

	function pick(s: Extract<Setting, { kind: 'choice' }>, index: number) {
		const o = s.options[index]
		if (o) s.set(o[1])
	}
</script>

<Modal title="Preferences" width={720} {onclose}>
	<div class="prefs">
		<nav aria-label="Preference pages">
			<input type="search" placeholder="Search" aria-label="Search the preferences" bind:value={query} />
			{#each PAGES as [id, name] (id)}
				<button
					class="page"
					class:active={!words.length && ui.prefsPage === id}
					aria-current={!words.length && ui.prefsPage === id ? 'page' : undefined}
					disabled={!!words.length && !shown.some((s) => s.page === id)}
					onclick={() => {
						query = ''
						ui.prefsPage = id
					}}>{name}</button
				>
			{/each}
		</nav>
		<div class="settings">
			{#each pagesShown as [page, name, intro] (page)}
				<h3>{name}</h3>
				{#if !words.length}<p class="dim intro">{intro}</p>{/if}
				{#each shown.filter((s) => s.page === page) as s (s.id)}
					<div class="row" data-pref={s.id}>
						<div class="text">
							<label for="pref-{s.id}">{s.label}</label>
							{#if s.desc}<div class="dim">{s.desc}</div>{/if}
							{#if s.kind === 'folder'}
								<div class="path" title={s.path}>{s.path || 'Not set'}</div>
								{#if s.note}<div class="warn">{s.note}</div>{/if}
							{/if}
						</div>
						<div class="control">
							{#if s.kind === 'check'}
								<input id="pref-{s.id}" type="checkbox" checked={s.on} disabled={s.disabled} onchange={(e) => s.set(e.currentTarget.checked)} />
							{:else if s.kind === 'choice'}
								{@const at = s.options.findIndex((o) => o[1] === s.value)}
								<select id="pref-{s.id}" value={String(at)} onchange={(e) => pick(s, Number(e.currentTarget.value))}>
									{#if at < 0}<option value="-1">{s.custom ?? 'Custom'}</option>{/if}
									{#each s.options as [label], i (i)}<option value={String(i)}>{label}</option>{/each}
								</select>
							{:else if s.kind === 'button'}
								<button id="pref-{s.id}" disabled={s.disabled} onclick={s.run}>{s.button}</button>
							{:else}
								<button id="pref-{s.id}" disabled={s.disabled} onclick={s.run}>{s.path ? 'Change…' : 'Browse…'}</button>
							{/if}
						</div>
					</div>
				{/each}
			{:else}
				<p class="dim">No setting matches “{query}”.</p>
			{/each}
		</div>
	</div>
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.prefs {
		display: grid;
		grid-template-columns: 170px 1fr;
		gap: 16px;
		/* One height for every page, so the dialog doesn't jump as the pages change. */
		min-height: min(440px, calc(100 * var(--vh) - 200px));
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-right: 1px solid var(--border);
		padding-right: 12px;
	}
	nav input {
		margin-bottom: 8px;
	}
	.page {
		border: none;
		background: transparent;
		text-align: left;
		padding: 6px 8px;
		border-radius: 4px;
	}
	.page:hover:not(:disabled) {
		background: var(--panel-3);
	}
	.page.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.settings {
		min-width: 0;
	}
	h3 {
		margin: 0 0 2px;
	}
	h3:not(:first-child) {
		margin-top: 16px;
	}
	.intro {
		margin: 0 0 8px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.text {
		min-width: 0;
	}
	.text label {
		font-weight: 600;
	}
	.control {
		flex: none;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.path {
		font: 12px var(--mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.warn {
		color: var(--warn);
		font-size: 12px;
	}
</style>
