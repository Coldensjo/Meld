<script lang="ts">
	import Modal from './Modal.svelte'
	import Slider from './Slider.svelte'
	import { editor, setStatus, stats, ui } from '../lib/state/editor.svelte'
	import { NO_ROLE } from '../lib/terrain/roles'
	import { engineRef } from '../lib/state/engineRef'
	import { defaultMapInfo, type MapInfo } from '../lib/engine/MapDocument'
	import { loadAreas } from '../lib/wow/areas'
	import { LoadingScreens, OpenImageDialog, ReadImageFile, WriteLoadingScreen } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { hasBackend } from '../lib/io/mapio'
	import { base64ToBytes, bytesToBase64 } from '../lib/io/base64'
	import { fetchImage } from '../lib/wow/api'

	const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

	// The map's facts and its world settings (File > Map Properties). The sea is one level for the
	// whole map, so it is set here and nowhere else; a part of Azeroth keeps the client's ocean.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	/** The map's size: in client tiles for a region, else in cells. */
	const tiles = $derived(editor.regionBlock ? `${editor.regionBlock.size}×${editor.regionBlock.size} tiles` : `${editor.mapSize} × ${editor.mapSize} cells`)
	const azeroth = $derived(!!editor.region)

	// A map made for the client also says what it is to the client and the server (written on publish).
	const ref = engineRef.current?.activeVmangos() ?? null
	let info = $state<MapInfo>(ref?.info ? { ...ref.info } : defaultMapInfo())
	let areas = $state<vmangos.Area[]>([])
	let screens = $state<vmangos.LoadingScreen[]>([])
	const loadScreens = () =>
		LoadingScreens()
			.then((s) => (screens = s ?? []))
			.catch(() => {})
	if (ref && hasBackend()) {
		void loadAreas().then((a) => (areas = a.filter((x) => x.mapId === ref.mapId && !x.parent)))
		void loadScreens()
	}

	// The chosen loading screen's picture, drawn 4:3 as the game stretches it over the screen.
	let preview = $state<HTMLCanvasElement | null>(null)
	let previewOk = $state(false)
	let previewKey = $state(0)
	$effect(() => {
		const path = screens.find((s) => s.id === info.loadingScreen)?.path
		const c = preview
		void previewKey
		previewOk = false
		if (!c || !path) return
		let live = true
		fetchImage(path)
			.then((img) => {
				if (!live) return
				const tmp = document.createElement('canvas')
				tmp.width = img.width
				tmp.height = img.height
				tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.pixels), img.width, img.height), 0, 0)
				c.getContext('2d')!.drawImage(tmp, 0, 0, c.width, c.height)
				previewOk = true
			})
			.catch(() => {})
		return () => (live = false)
	})

	// Picture… (#218): a PNG of the author's becomes the map's own loading screen, written into Meld's
	// patch at once (the BLP, its LoadingScreens.dbc row and the map's Map.dbc row when the client has
	// the map) and chosen above, so a later publish keeps it.
	let writing = $state(false)
	let screenError = $state('')
	async function importScreen() {
		if (!ref) return
		const path = await OpenImageDialog('Loading Screen Picture')
		if (!path) return
		writing = true
		screenError = ''
		try {
			const bytes = base64ToBytes(await ReadImageFile(path))
			const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }))
			const c = document.createElement('canvas')
			c.width = c.height = LOADING_SCREEN_SIZE
			const ctx = c.getContext('2d')!
			ctx.drawImage(bmp, 0, 0, LOADING_SCREEN_SIZE, LOADING_SCREEN_SIZE)
			const px = new Uint8Array(ctx.getImageData(0, 0, LOADING_SCREEN_SIZE, LOADING_SCREEN_SIZE).data)
			for (let i = 3; i < px.length; i += 4) px[i] = 255
			const res = await WriteLoadingScreen(vmangos.LoadingScreenSpec.createFrom({ mapId: ref.mapId, dir: ref.dir, pixels: bytesToBase64(px) as unknown as number[] }))
			await loadScreens()
			if (info.loadingScreen !== res.row.id) setInfo({ loadingScreen: res.row.id })
			previewKey++
			setStatus(`Wrote ${path} as ${ref.dir}'s loading screen (LoadingScreens row ${res.row.id}) into ${res.patch}.`, 8000)
		} catch (err) {
			screenError = String(err)
		} finally {
			writing = false
		}
	}
	function setInfo(patch: Partial<MapInfo>) {
		info = { ...info, ...patch }
		engineRef.current?.setMapInfo(info)
	}
	/** The side of a loading screen's picture (`vmangos.LoadingScreenSize`): the game stretches it to the screen. */
	const LOADING_SCREEN_SIZE = 512
	const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
	const TYPES: Array<[number, string]> = [
		[0, 'World map'],
		[1, 'Dungeon'],
		[2, 'Raid'],
		[3, 'Battleground'],
	]
</script>

<Modal title="Map Properties" width={460} {onclose}>
	<div class="facts">
		<span class="k">Name</span><span title={editor.mapName}>{editor.mapName}</span>
		<span class="k">Size</span><span>{tiles}</span>
		{#if editor.region}<span class="k">Region</span><span title={editor.region}>{editor.region}</span>{/if}
		{#if editor.filePath}<span class="k">File</span><span title={editor.filePath}>{editor.filePath}</span>{/if}
		<span class="k">Models</span><span>{stats.objects}</span>
		<span class="k">Textures</span><span>{editor.palette.length}</span>
		{#if editor.spawns.length}<span class="k">Spawns</span><span>{editor.spawns.length}</span>{/if}
	</div>
	{#if ref}
		<div class="section">Client map ({ref.dir}, ID {ref.mapId})</div>
		<div class="facts">
			<label class="k" for="mi-name">Shown name</label>
			<input id="mi-name" value={info.name} placeholder={ref.dir} onchange={(e) => setInfo({ name: (e.target as HTMLInputElement).value })} />
			<label class="k" for="mi-type">Kind</label>
			<select id="mi-type" value={info.type} onchange={(e) => setInfo({ type: Number((e.target as HTMLSelectElement).value) })}>
				{#each TYPES as [v, label] (v)}<option value={v}>{label}</option>{/each}
			</select>
			<label class="k" for="mi-area">Zone</label>
			<select id="mi-area" value={info.areaId} onchange={(e) => setInfo({ areaId: Number((e.target as HTMLSelectElement).value) })} title="The map's zone (World › Zones makes one)">
				<option value={0}>None</option>
				{#each areas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				{#if info.areaId && !areas.some((a) => a.id === info.areaId)}<option value={info.areaId}>Area {info.areaId}</option>{/if}
			</select>
			<label class="k" for="mi-screen">Loading screen</label>
			<select id="mi-screen" value={info.loadingScreen} onchange={(e) => setInfo({ loadingScreen: Number((e.target as HTMLSelectElement).value) })}>
				<option value={0}>The continent's</option>
				{#each screens as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
			</select>
			<span class="k"></span>
			<span class="screen">
				<canvas bind:this={preview} width={160} height={120} class:hidden={!previewOk}></canvas>
				<button disabled={writing || ui.busy || !hasBackend()} onclick={() => void importScreen()} title="Make a PNG of your own the map's loading screen: written into the client's patch at once ({LOADING_SCREEN_SIZE}x{LOADING_SCREEN_SIZE}, stretched to the screen as the game's own)">{writing ? 'Writing…' : 'Picture…'}</button>
			</span>
			{#if screenError}<span class="k"></span><span class="error">{screenError}</span>{/if}
			<label class="k" for="mi-players">Player limit</label>
			<input id="mi-players" type="number" min="0" value={info.maxPlayers} onchange={(e) => setInfo({ maxPlayers: Math.max(0, num(e)) })} title="0 for no limit" />
			<span class="k">WMO-only</span>
			<label class="check" title="The map is its first building (a WMO), with no ground, as the client's Blackfathom Deeps; publish writes no tiles"
				><input type="checkbox" checked={!!info.wmoOnly} onchange={(e) => setInfo({ wmoOnly: (e.target as HTMLInputElement).checked })} /> The map is its first building</label
			>
			<span class="k">Ghost goes to</span>
			<span class="row">
				<input type="number" value={info.ghostMap} onchange={(e) => setInfo({ ghostMap: Math.round(num(e)) })} title="The map a dead player's ghost goes back to its corpse from (-1 for this map)" aria-label="Ghost entrance map" />
				<input type="number" step="any" value={info.ghostX} onchange={(e) => setInfo({ ghostX: num(e) })} aria-label="Ghost entrance x" />
				<input type="number" step="any" value={info.ghostY} onchange={(e) => setInfo({ ghostY: num(e) })} aria-label="Ghost entrance y" />
			</span>
		</div>
		<p class="dim">Written on publish: the kind, name, zone and loading screen into the client's Map.dbc (Picture… writes its own loading screen at once), and the kind, zone, player limit and ghost entrance into the server's map_template.</p>
	{/if}
	<div class="section">World</div>
	<label class="check" title="Ocean at the sea level wherever the ground lies below it. Lakes and rivers are painted with the Water tool."
		><input type="checkbox" bind:checked={editor.waterEnabled} /> Sea</label
	>
	{#if editor.waterEnabled}
		{#if azeroth}
			<div class="facts">
				<span class="k">Sea level</span><span>{editor.waterLevel.toFixed(1)}</span>
			</div>
			<p class="dim">A part of Azeroth keeps the client's sea level.</p>
		{:else}
			<Slider label="Sea level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
			<p class="dim">One level for the whole map. Dig lake, Raise shore and Auto-paint shape the coast around it.</p>
		{/if}
	{/if}
	<label class="check" title="Steep slopes are drawn as rock in the editor's view only. Nothing is painted, so the client will not show it: paint the rock with Sculpt's by-slope painting instead."
		><input type="checkbox" bind:checked={editor.autoCliff} /> Show steep slopes as rock (preview only)</label
	>
	<div class="section">Texture roles</div>
	<p class="dim">The textures Sculpt paints by slope while it shapes the ground: rock on the steep, dirt rimming its foot. Pick them from the map's palette (the asset browser adds textures to it).</p>
	<div class="facts">
		<label class="k" for="role-rock">Rock</label>
		<select id="role-rock" bind:value={editor.roles.rock}>
			<option value={NO_ROLE}>none</option>
			{#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
		</select>
		<label class="k" for="role-dirt">Dirt</label>
		<select id="role-dirt" bind:value={editor.roles.dirt}>
			<option value={NO_ROLE}>none</option>
			{#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
		</select>
	</div>
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.screen {
		display: flex;
		align-items: flex-end;
		gap: 6px;
	}
	.screen canvas {
		width: 160px;
		height: 120px;
		border: 1px solid var(--border);
	}
	.screen canvas.hidden {
		display: none;
	}
	.error {
		color: var(--danger-text);
		white-space: normal !important;
	}
	.row {
		display: flex;
		gap: 4px;
	}
	.row input {
		width: 70px;
		min-width: 0;
	}
	.facts {
		display: grid;
		grid-template-columns: 70px 1fr;
		gap: 3px 8px;
		margin: 4px 0;
		font-size: 12px;
	}
	.facts span:not(.k) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.section {
		margin: 12px 0 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 4px 0;
		cursor: pointer;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
		margin: 2px 0 6px;
	}
</style>
