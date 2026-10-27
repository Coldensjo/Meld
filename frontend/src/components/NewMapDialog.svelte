<script lang="ts">
	import Modal from './Modal.svelte'
	import MapPicker from './MapPicker.svelte'
	import TileGrid from './TileGrid.svelte'
	import type { TileBlock as Block } from '../lib/io/regionGrow'
	import { editor, prefs, setStatus, ui, wow } from '../lib/state/editor.svelte'
	import { defaultLayerTextures } from '../lib/wow/defaults'
	import { packPalette } from '../lib/wow/texturePack'
	import { setScatter, zoneScatter, type ZoneScatter } from '../lib/wow/zoneTrees'
	import { loadAsset } from '../lib/models/assets'
	import PaletteTile from './PaletteTile.svelte'
	import { LAYERS } from '../lib/terrain/layers'
	import { CoastShape, DEFAULT_SHAPE, PRESETS, drawHeights, drawPresetPreview, presetById, type PresetId, type ShapeOptions, type WorldWater } from '../lib/terrain/presets'
	import { LIQUID_MAGMA, LIQUID_SLIME, LIQUID_WATER } from '../lib/water/liquids'
	import { imageRatios } from '../lib/io/heightmapImport'
	import { guarded } from '../lib/io/backend'
	import { boundingSquare, gridTile, maskBytes, maskOf } from '../lib/terrain/tileMask'
	import type { VmangosRef } from '../lib/engine/MapDocument'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { openWorldView, openWowBuilding, openWowRegion } from '../lib/io/region'
	import { MapEntries, MapZones, OpenHeightmapDialog, ReadHeightmap, ZoneDoodads, ZoneTextures } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// Every map Meld makes is a map for the 1.12 client and the VMaNGOS server. It starts
	// either as a new world of its own (an island, hills, mountains…), reachable from Azeroth by a
	// portal once published, or as a part of an existing continent opened from the client.

	const close = () => (ui.showNewDialog = false)
	const mode = $derived(ui.newMapMode)

	// --- a new world ------------------------------------------------------------------------------
	let name = $state('MyWorld')
	/**
	 * The world's tiles on the client's 64×64 grid (#46): where they are picked is where publish puts
	 * them. A 2×2 block in the grid's middle to start with, round the server's 0,0.
	 */
	let tiles = $state<Set<number>>(new Set([gridTile(31, 31), gridTile(32, 31), gridTile(31, 32), gridTile(32, 32)]))
	const square = $derived(boundingSquare(tiles)!)
	const mask = $derived(maskOf(square, tiles))
	/** The picked shape when it isn't its whole square, for the presets' coast. */
	const shape = $derived.by(() => {
		const m = maskBytes(mask, square.size)
		return m ? new CoastShape(m, square.size) : null
	})
	let preset = $state<PresetId>('island')
	let seed = $state(Math.floor(Math.random() * 100000))
	/** Height, Roughness, Erosion and Sea depth (#744). */
	let look = $state<ShapeOptions>({ ...DEFAULT_SHAPE })
	/** Only the island presets have a coast for Land to move. */
	const landApplies = $derived(presetById(preset).water && preset !== 'ocean')
	const lookChanged = $derived((Object.keys(DEFAULT_SHAPE) as (keyof ShapeOptions)[]).some((k) => look[k] !== DEFAULT_SHAPE[k]))
	// --- From a heightmap (#745) ---------------------------------------------------------------------
	/** The heightmap image the world starts from, once one is chosen, and whether it is picked over the presets. */
	let image = $state<{ name: string; side: number; heights: number[] } | null>(null)
	let fromImage = $state(false)
	/**
	 * Its black and white in yards, the sea at 0 or none, and its own Erosion, none to start with: Gaea,
	 * World Machine and World Creator erode their terrain already. The presets' sliders don't apply.
	 */
	let imageLook = $state({ min: -40, max: 240, sea: true, erosion: 0 })
	const imageOk = $derived(!fromImage || (!!image && Number.isFinite(imageLook.min) && Number.isFinite(imageLook.max) && imageLook.max > imageLook.min))
	/**
	 * The water (#759, the owner's choice in #733): the sea's level, and lakes filled in the land's basins
	 * up to their rims (water/lakes.ts) of water, slime or magma. The sea itself stays the client's ocean.
	 */
	let water = $state({ sea: 0, lakes: false, liquid: LIQUID_WATER })
	const LAKE_LIQUIDS = [
		{ id: LIQUID_WATER, name: 'Water' },
		{ id: LIQUID_SLIME, name: 'Slime' },
		{ id: LIQUID_MAGMA, name: 'Magma' },
	]
	/** Whether the world has a sea for Sea level to move: the preset's, or the image's Sea. */
	const seaOn = $derived(fromImage ? imageLook.sea : presetById(preset).water)
	const worldWater = $derived<WorldWater>({ sea: water.sea, lakes: water.lakes ? water.liquid : null })
	/** Asks for a heightmap PNG and picks it; cancelling keeps the one before. */
	function pickImage() {
		return guarded('Read heightmap', async () => {
			const path = await OpenHeightmapDialog()
			if (!path) {
				if (image) fromImage = true
				return
			}
			const img = await ReadHeightmap(path)
			image = { name: path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1), side: img.side, heights: img.heights }
			fromImage = true
		})
	}
	/** Draws the chosen image into its card as the world it makes, by Min, Max and Sea. */
	function imagePreview(canvas: HTMLCanvasElement) {
		$effect(() => {
			if (!image) return
			const px = 96
			const r = imageRatios(image, px + 1)
			const { min, max, sea } = imageLook
			const h = new Float32Array(r.length)
			for (let i = 0; i < r.length; i++) h[i] = min + r[i] * (max - min)
			drawHeights(canvas, h, px, sea ? water.sea : null, square.size, shape, worldWater.lakes)
		})
	}

	let mapId = $state(1900)
	let showId = $state(false)
	const nameOk = $derived(/^[A-Za-z0-9_-]+$/.test(name.trim()))
	const mapIdOk = $derived(Number.isInteger(mapId) && mapId > 0 && mapId <= 99999)
	const SIZES = [
		{ tiles: 1, label: 'Tiny', note: '1 tile · 533 yd' },
		{ tiles: 2, label: 'Small', note: '2×2 tiles · 1.1 km' },
		{ tiles: 3, label: 'Medium', note: '3×3 tiles · 1.6 km' },
		{ tiles: 4, label: 'Large', note: '4×4 tiles · 2.1 km' },
		{ tiles: 6, label: 'Huge', note: '6×6 tiles · 3.2 km' },
	]
	/** A size picks a whole square of that many tiles, from the picked tiles' corner (kept on the grid). */
	function pickSize(n: number) {
		const x0 = Math.min(square.x, 64 - n)
		const y0 = Math.min(square.y, 64 - n)
		const next = new Set<number>()
		for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) next.add(gridTile(x0 + x, y0 + y))
		tiles = next
	}
	const sizeShown = $derived(mask ? 0 : square.size)

	/** Draws a preset's picture into its card; redrawn when the seed, the tiles, Height, Roughness, Sea depth or the water change. */
	function preview(canvas: HTMLCanvasElement, id: PresetId) {
		$effect(() => drawPresetPreview(canvas, id, seed, 96, { tiles: square.size, shape, relief: look.relief, roughness: look.roughness, seaDepth: look.seaDepth, land: look.land }, worldWater))
	}

	// --- the client's maps and zones, read once --------------------------------------------------
	let maps = $state<vmangos.MapEntry[]>([])
	let zones = $state<vmangos.Zone[]>([])
	let clientError = $state('')
	let requested = false
	$effect(() => {
		if (requested || !hasBackend() || !ui.showNewDialog) return
		requested = true
		MapEntries()
			.then((list) => {
				maps = list
				// A new map takes the first free ID from 1900 up, where custom maps usually live.
				const used = new Set(list.map((m) => m.ID))
				let id = 1900
				while (used.has(id)) id++
				mapId = id
			})
			.catch((err) => (clientError = String(err)))
		MapZones()
			.then((list) => (zones = list))
			.catch((err) => (clientError = String(err)))
	})
	const continents = $derived(maps.filter((m) => m.Type === 0 && zones.some((z) => z.MapID === m.ID)))
	let continent = $state<vmangos.MapEntry | null>(null)
	$effect(() => {
		if (!continent && continents.length) continent = continents[0]
	})

	// The map list (#47, Noggit Red's): every Map.dbc map, found by name, folder or ID, narrowed to a
	// kind, the pinned ones (prefs.pinnedMaps) first, then the continents with zones, then the rest.
	/** Map.dbc's instance type, by its value. */
	const MAP_TYPES = ['Continent', 'Dungeon', 'Raid', 'Battleground']
	let mapQuery = $state('')
	let mapType = $state(-1)
	const pinned = $derived(new Set(prefs.pinnedMaps))
	const listedMaps = $derived.by(() => {
		const q = mapQuery.trim().toLowerCase()
		const rank = (m: vmangos.MapEntry) => (pinned.has(m.ID) ? 0 : continents.includes(m) ? 1 : 2)
		return maps.filter((m) => (mapType < 0 || m.Type === mapType) && (!q || m.Name.toLowerCase().includes(q) || m.Dir.toLowerCase().includes(q) || String(m.ID) === q)).sort((a, b) => rank(a) - rank(b) || a.Type - b.Type || a.ID - b.ID)
	})
	function togglePin(id: number) {
		prefs.pinnedMaps = pinned.has(id) ? prefs.pinnedMaps.filter((x) => x !== id) : [...prefs.pinnedMaps, id]
	}
	function pickMap(m: vmangos.MapEntry) {
		continent = m
		block = null
		focus = null
	}
	const continentZones = $derived(continent ? zones.filter((z) => z.MapID === continent!.ID) : [])

	// --- Ground textures (#733): a zone's own textures paint the new world ---------------------------
	/** The zone whose textures paint the world, by its area ID; 0 for the default palette (Elwynn's). */
	let packArea = $state(0)
	/** Each read zone's palette by area ID (null: the zone has no ground), and the zone being read. */
	let packs = $state<Record<number, string[] | null>>({})
	let packReading = $state(0)
	let packError = $state('')
	/** The zones by map, a group per map, each zone once. */
	const packGroups = $derived.by(() => {
		const seen = new Set<number>()
		const groups: { name: string; zones: vmangos.Zone[] }[] = []
		for (const z of [...zones].sort((a, b) => a.MapID - b.MapID || a.Name.localeCompare(b.Name))) {
			const map = maps.find((m) => m.ID === z.MapID)
			if (seen.has(z.AreaID) || !map) continue
			seen.add(z.AreaID)
			if (groups.at(-1)?.name !== map.Name) groups.push({ name: map.Name, zones: [] })
			groups.at(-1)!.zones.push(z)
		}
		return groups
	})
	const pack = $derived(packArea ? packs[packArea] : undefined)
	/** Picks a zone's textures, reading them from its tiles the first time. */
	function pickPack(area: number) {
		packArea = area
		packError = ''
		if (!area || area in packs) return
		const z = zones.find((x) => x.AreaID === area)
		const dir = z && maps.find((m) => m.ID === z.MapID)?.Dir
		if (!z || !dir) return
		packReading = area
		ZoneTextures(dir, z)
			.then((uses) => (packs[area] = packPalette(uses)))
			.catch((err) => (packError = String(err)))
			.finally(() => {
				if (packReading === area) packReading = 0
			})
	}

	// --- Trees (#758): the pack's zone's trees, bushes and rocks, or a model set's, over the new world ---
	/** Where the trees come from: 'zone' for the texture pack's zone (Elwynn's with the Default pack), 'none', or a model set's name. */
	let treeSource = $state('zone')
	/** How thickly, as a multiple of the zone's own cover. */
	let treeAmount = $state(1)
	/** Each read zone's scatter by area ID (null: the zone places none). */
	const scatters: Record<number, Promise<ZoneScatter | null>> = {}
	let creating = $state('')
	/** The zone whose trees a world gets: the pack's, else Elwynn Forest's. */
	const treeZone = $derived(packArea ? zones.find((z) => z.AreaID === packArea) : zones.find((z) => z.Name === 'Elwynn Forest' && maps.find((m) => m.ID === z.MapID)?.Dir === 'Azeroth'))
	/** A zone's scatter, read from its tiles once. */
	function zoneScatterOf(z: vmangos.Zone): Promise<ZoneScatter | null> {
		const dir = maps.find((m) => m.ID === z.MapID)?.Dir
		if (!dir) return Promise.resolve(null)
		scatters[z.AreaID] ??= ZoneDoodads(dir, z).then((list) => zoneScatter(list.doodads ?? [], list.landArea))
		return scatters[z.AreaID]
	}
	/** The scatter the world gets, or null for none. */
	async function pickedScatter(): Promise<ZoneScatter | null> {
		if (treeSource === 'none' || !wow.loaded || treeAmount <= 0) return null
		if (treeSource === 'zone') return treeZone ? zoneScatterOf(treeZone) : null
		const set = prefs.modelSets.find((x) => x.name === treeSource)
		return set ? setScatter(set.models) : null
	}

	// --- a part of a continent ----------------------------------------------------------------------
	const MAX_TILES = 8
	let block = $state<Block | null>({ x: 31, y: 48, size: 3 })
	/** The block's tiles with no ADT, and the map's tile count (-1 while loading), from the picker. */
	let gaps = $state(0)
	let tileCount = $state(-1)
	let focus = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
	let zoneFilter = $state('')
	const shownZones = $derived(continentZones.filter((z) => z.Name.toLowerCase().includes(zoneFilter.toLowerCase())))

	/** Picks a zone: the view jumps to it and the block becomes the biggest square that fits in its middle. */
	function pickZone(z: vmangos.Zone) {
		focus = { x0: z.X0, y0: z.Y0, x1: z.X1, y1: z.Y1 }
		const size = Math.min(MAX_TILES, Math.max(1, Math.min(z.X1 - z.X0, z.Y1 - z.Y0)))
		block = {
			x: Math.min(64 - size, Math.round((z.X0 + z.X1) / 2 - size / 2)),
			y: Math.min(64 - size, Math.round((z.Y0 + z.Y1) / 2 - size / 2)),
			size,
		}
	}

	async function create() {
		if (!nameOk || !mapIdOk || !imageOk || creating) return
		let scatter: ZoneScatter | null = null
		let treeError = ''
		try {
			creating = 'Reading the trees…'
			scatter = await pickedScatter()
			if (scatter) {
				// The spacing reads each model's size, so they load before the fill.
				creating = 'Loading the trees…'
				const types = [...(scatter.plants?.entries ?? []), ...(scatter.rocks?.entries ?? [])].map((e) => e.type)
				await Promise.all(types.map((t) => loadAsset(t)))
			}
		} catch (err) {
			treeError = `No trees: ${err}`
			scatter = null
		} finally {
			creating = ''
		}
		const palette = wow.loaded ? (pack ?? (await defaultLayerTextures())) : LAYERS.map((l) => l.swatch)
		const ref: VmangosRef = { dir: name.trim(), mapId }
		if (square.x) ref.tileX = square.x
		if (square.y) ref.tileY = square.y
		if (mask) ref.tiles = mask
		const ground = fromImage && image ? { img: image, min: imageLook.min, max: imageLook.max, sea: imageLook.sea } : undefined
		engineRef.current?.newVmangosDocument(square.size, preset, seed, ref, ground ? { erosion: imageLook.erosion } : { ...look }, ground, { ...worldWater })
		editor.palette = palette
		if (scatter) engineRef.current?.scatterWorld(scatter, treeAmount, seed)
		if (treeError) setStatus(treeError, 8000)
		editor.dirty = false
		engineRef.current?.refreshTabs()
		close()
	}

	/** A map the picker found no tiles for is a single building (WMO-only, #271), which opens whole. */
	const building = $derived(tileCount === 0)
	const canOpen = $derived(!!continent && (building || (!!block && gaps === 0)))

	function open() {
		const e = engineRef.current
		if (!e || !continent || !canOpen || !ui.project) return
		close()
		if (building) openWowBuilding(e, continent.Dir)
		else if (block) openWowRegion(e, continent.Dir, block.x, block.y, block.size)
	}
</script>

<Modal title="Start" width={860} onclose={close}>
	<div class="modes">
		<button class:active={mode === 'new'} onclick={() => (ui.newMapMode = 'new')}>New world</button>
		<button class:active={mode === 'open'} onclick={() => (ui.newMapMode = 'open')} disabled={!hasBackend()}>Part of Azeroth</button>
	</div>

	{#if mode === 'new'}
		<div class="body new">
			<p class="dim">A world of its own for the client and server. Once published it can be reached from Azeroth through a portal.</p>
			<div class="row">
				<label class="field">
					<span>Name</span>
					<input type="text" bind:value={name} spellcheck="false" />
				</label>
				<div class="field">
					<span>Size</span>
					<div class="sizes">
						{#each SIZES as s (s.tiles)}
							<button class="size" class:active={sizeShown === s.tiles} onclick={() => pickSize(s.tiles)} title={s.note}>
								<b>{s.label}</b><small>{s.note}</small>
							</button>
						{/each}
					</div>
				</div>
			</div>
			{#if !nameOk}<p class="warn">Use letters, digits, - and _ for the name: it is the map's folder in the client.</p>{/if}
			<div class="row">
				<div class="field">
					<span>Tiles on the client's map</span>
					<TileGrid {tiles} onchange={(t) => (tiles = t)} />
				</div>
				<div class="presets">
					{#each PRESETS as p (p.id)}
						<button
							class="preset"
							class:active={!fromImage && preset === p.id}
							onclick={() => {
								preset = p.id
								fromImage = false
							}}
							title={p.blurb}
						>
							<canvas use:preview={p.id} width="96" height="96"></canvas>
							<b>{p.name}</b>
							<small>{p.blurb}</small>
						</button>
					{/each}
					<button
						class="preset fromimage"
						class:active={fromImage}
						onclick={() => void pickImage()}
						disabled={!hasBackend()}
						title="A 16-bit greyscale PNG from Gaea, World Machine, World Creator or the like, stretched over the whole world"
					>
						{#if image}
							<canvas use:imagePreview width="96" height="96"></canvas>
						{:else}
							<span class="pick">PNG</span>
						{/if}
						<b>From a heightmap…</b>
						<small>{image ? image.name : 'A greyscale PNG made in Gaea, World Machine or the like.'}</small>
					</button>
				</div>
			</div>
			{#if fromImage}
				<div class="row look image">
					<label class="field num" title="The height in yards the image's black becomes">
						<span>Black at (yd)</span>
						<input type="number" step="any" bind:value={imageLook.min} />
					</label>
					<label class="field num" title="The height in yards the image's white becomes">
						<span>White at (yd)</span>
						<input type="number" step="any" bind:value={imageLook.max} />
					</label>
					<label class="check" title="The sea over the ground below Sea level: set Black below it for a coast">
						<input type="checkbox" bind:checked={imageLook.sea} /> Sea
					</label>
					<label class="field slider" title="How much water and gravity carve the ground once it is made. None to start with, since Gaea and World Machine erode their terrain already.">
						<span>Erosion <b>{imageLook.erosion ? `${Math.round(imageLook.erosion * 100)}%` : 'none'}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={imageLook.erosion} />
					</label>
				</div>
				{#if !imageOk}<p class="warn">White must be higher than Black.</p>{/if}
			{:else}
				<div class="row look">
					<label class="field slider" title="How tall the land stands above the sea">
						<span>Height <b>{look.relief.toFixed(1)}×</b></span>
						<input type="range" min="0.4" max="2" step="0.1" bind:value={look.relief} />
					</label>
					<label class="field slider" title="How much small detail lies over the hills: bumps, knolls and broken ground">
						<span>Roughness <b>{look.roughness.toFixed(1)}×</b></span>
						<input type="range" min="0" max="2" step="0.1" bind:value={look.roughness} />
					</label>
					<label class="field slider" title="How much water and gravity carve the ground once it is made: valleys, gullies and scree. Not shown in the pictures; a large world takes a moment longer.">
						<span>Erosion <b>{look.erosion ? `${Math.round(look.erosion * 100)}%` : 'none'}</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={look.erosion} />
					</label>
					<label class="field slider" title={landApplies ? 'How much of the map is land: a small island in open sea at the left, land up to the edges at the right' : 'This preset has no coast'}>
						<span>Land <b>{Math.round(look.land * 100)}%</b></span>
						<input type="range" min="0" max="1" step="0.05" bind:value={look.land} disabled={!landApplies} />
					</label>
					<label class="field slider" title={presetById(preset).water ? 'How deep the open sea goes, over a seabed of ridges, trenches and shoals' : 'This preset has no sea'}>
						<span>Sea depth <b>{Math.round(14 + 46 * look.seaDepth)} yd</b></span>
						<input type="range" min="0.2" max="3" step="0.1" bind:value={look.seaDepth} disabled={!presetById(preset).water} />
					</label>
					<button class="link reset" onclick={() => (look = { ...DEFAULT_SHAPE })} disabled={!lookChanged}>Reset</button>
				</div>
			{/if}
			<div class="row look water">
				<label class="field slider" title={seaOn ? 'The height of the sea: higher floods the low ground and moves the coast and the beaches inland' : 'This world has no sea'}>
					<span>Sea level <b>{water.sea} yd</b></span>
					<input type="range" min="-30" max="60" step="1" bind:value={water.sea} disabled={!seaOn} />
				</label>
				<label class="check" title="Fill the land's basins above the sea with lakes, each up to its rim, with sand along their shores">
					<input type="checkbox" bind:checked={water.lakes} /> Lakes
				</label>
				<label class="field liquid" title="What the lakes hold. The sea stays the ocean.">
					<span>Lakes of</span>
					<select bind:value={water.liquid} disabled={!water.lakes}>
						{#each LAKE_LIQUIDS as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
					</select>
				</label>
			</div>
			{#if hasBackend()}
				<div class="row pack">
					<label class="field" title="Paint the world with the ground textures a zone of the client uses most: its main ground, rock on the slopes, sand at the shore, snow on the peaks">
						<span>Ground textures</span>
						<select value={packArea} onchange={(e) => pickPack(+e.currentTarget.value)} disabled={!wow.loaded || !zones.length}>
							<option value={0}>Default (Elwynn Forest)</option>
							{#each packGroups as g (g.name)}
								<optgroup label={g.name}>
									{#each g.zones as z (z.AreaID)}<option value={z.AreaID}>{z.Name}</option>{/each}
								</optgroup>
							{/each}
						</select>
					</label>
					<div class="packtiles">
						{#if packReading && packReading === packArea}
							<span class="dim">Reading the zone's tiles…</span>
						{:else if packError}
							<span class="warn">{packError}</span>
						{:else if pack}
							{#each pack as p, i (i)}
								<div class="packtile">
									<PaletteTile thumbKey={'tex:' + p} label="" title="{LAYERS[i].name}: {p}" size={40} showLabel={false} onclick={() => {}} />
								</div>
							{/each}
						{:else if pack === null}
							<span class="warn">That zone has no ground of its own: the default textures are used.</span>
						{/if}
					</div>
				</div>
			{/if}
			{#if hasBackend()}
				<div class="row trees">
					<label class="field" title="Trees, bushes and rocks over the land: the ones the texture pack's zone places most (Elwynn Forest's with the Default textures), or the models of one of your sets from the asset browser">
						<span>Trees and rocks</span>
						<select bind:value={treeSource} disabled={!wow.loaded}>
							<option value="zone">{treeZone ? `${treeZone.Name}'s` : "The zone's"}</option>
							{#if prefs.modelSets.length}
								<optgroup label="Model sets">
									{#each prefs.modelSets as set (set.name)}<option value={set.name}>{set.name}</option>{/each}
								</optgroup>
							{/if}
							<option value="none">None</option>
						</select>
					</label>
					<label class="field slider" title="How thickly they stand: 1× is as thick as the zone itself (a model set: a light wood)">
						<span>Density <b>{treeAmount.toFixed(2).replace(/0$/, '')}×</b></span>
						<input type="range" min="0.25" max="3" step="0.25" bind:value={treeAmount} disabled={!wow.loaded || treeSource === 'none'} />
					</label>
					{#if creating}<span class="dim">{creating}</span>{/if}
				</div>
			{/if}
			<div class="row bottom">
				<label class="field seed">
					<span>Seed</span>
					<span class="seedrow">
						<input type="number" bind:value={seed} />
						<button onclick={() => (seed = Math.floor(Math.random() * 100000))} title="Another layout">🎲</button>
					</span>
				</label>
				{#if showId}
					<label class="field id">
						<span>Map ID</span>
						<input type="number" min="1" max="99999" bind:value={mapId} />
					</label>
				{:else}
					<button class="link" onclick={() => (showId = true)}>Map ID {mapId}…</button>
				{/if}
				{#if !mapIdOk}<p class="warn">A map ID is a whole number from 1 to 99999.</p>{/if}
				{#if clientError}<p class="warn">{clientError}</p>{/if}
			</div>
		</div>
	{:else}
		<div class="body open">
			{#if !ui.project}
				<!-- The owner's limit on #48: a new world goes straight in, editing the client's own maps needs a project. -->
				<div class="needproject">
					<p>Opening a part of Azeroth edits the client's own maps, so it needs a project: a project folder for your maps of it and the WoW 1.12 client folder.</p>
					<button class="active" onclick={() => (ui.dialog = 'project')}>Choose a Project…</button>
				</div>
			{:else if !wow.loaded}
				<p class="dim">The project's client isn't loaded{wow.error ? `: ${wow.error}` : ''}. Choose its client folder in File › Project….</p>
			{:else}
				<div class="side">
					<div class="mapfind">
						<input type="search" placeholder="Find a map…" bind:value={mapQuery} />
						<select bind:value={mapType} aria-label="Kind of map">
							<option value={-1}>All</option>
							{#each MAP_TYPES as t, i (t)}<option value={i}>{t}s</option>{/each}
						</select>
					</div>
					<div class="maplist">
						{#each listedMaps as m (m.ID)}
							<div class="maprow" class:active={continent?.ID === m.ID}>
								<button class="pin" class:on={pinned.has(m.ID)} onclick={() => togglePin(m.ID)} title={pinned.has(m.ID) ? 'Unpin' : 'Pin to the top'}>{pinned.has(m.ID) ? '★' : '☆'}</button>
								<button class="mapname" onclick={() => pickMap(m)} title="{m.Dir} ({m.ID})">{m.Name || m.Dir} <span class="dim">{MAP_TYPES[m.Type] ?? `type ${m.Type}`} · {m.ID}</span></button>
							</div>
						{:else}
							<p class="dim">No map matches.</p>
						{/each}
					</div>
					<input type="text" placeholder="Find a zone…" bind:value={zoneFilter} />
					<div class="zones">
						{#each shownZones as z (z.Name + z.X0 + z.Y0)}
							<button class="zone" onclick={() => pickZone(z)}>{z.Name}</button>
						{/each}
						{#if !shownZones.length}<p class="dim">{clientError || 'No zones.'}</p>{/if}
					</div>
				</div>
				<div class="map">
					{#if continent}
						<MapPicker map={continent.Dir} bind:block bind:gaps bind:tileCount maxSize={MAX_TILES} {focus} autoPick={continent.Type !== 0} />
					{/if}
				</div>
			{/if}
		</div>
	{/if}
	{#snippet actions()}
		{#if mode === 'new'}
			<button onclick={close}>Cancel</button>
			<button class="active" disabled={!nameOk || !mapIdOk || !imageOk || !!packReading || !!creating} onclick={create}>Create world</button>
		{:else}
			<span class="dim grow"
				>{building
					? 'The building and its creatures and objects open in a new tab. Saving writes its doodad set back to the client.'
					: 'The ground, textures and models of those tiles open in a new tab. Saving writes them back to the client.'}</span
			>
			<button onclick={close}>Cancel</button>
			<button
				disabled={!continent || building || !block}
				onclick={() => continent && block && engineRef.current && openWorldView(engineRef.current, continent.Dir, block)}
				title="The whole map, its tiles loaded around the camera as it moves; File › Edit Here opens the block around the camera">World View</button
			>
			<button class="active" disabled={!canOpen || !ui.project} onclick={open}>Open</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.modes {
		display: flex;
		gap: 2px;
		background: var(--bg);
		border-radius: var(--radius);
		padding: 2px;
		width: fit-content;
		margin-bottom: 10px;
	}
	.modes button {
		border: none;
		background: transparent;
		padding: 4px 14px;
	}
	.modes button.active {
		background: var(--panel-3);
		color: var(--text-strong);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.body.open {
		flex-direction: row;
		gap: 14px;
	}
	.needproject {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		max-width: 520px;
	}
	.needproject p {
		margin: 0;
	}
	.dim {
		margin: 0;
		color: var(--text-dim);
		font-size: 12px;
	}
	.warn {
		margin: 0;
		color: var(--danger-text);
		font-size: 12px;
	}
	.row {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	.row.bottom {
		align-items: center;
	}
	.row.look {
		align-items: flex-end;
	}
	.row.water .slider {
		flex: 0 1 240px;
	}
	.slider {
		flex: 1;
	}
	.slider b {
		color: var(--text);
		font-weight: 500;
	}
	.link.reset {
		align-self: center;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--text-dim);
	}
	.field input[type='text'] {
		width: 200px;
	}
	.sizes {
		display: flex;
		gap: 4px;
	}
	.size {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4px 10px;
		line-height: 1.2;
	}
	.size small {
		font-size: 10px;
		color: var(--text-dim);
	}
	.size.active small {
		color: var(--accent-ink);
		opacity: 0.8;
	}
	.presets {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}
	.preset {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px;
		background: var(--bg);
		text-align: center;
	}
	.preset canvas {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 4px;
		image-rendering: auto;
	}
	.preset small {
		font-size: 10px;
		color: var(--text-dim);
		line-height: 1.25;
	}
	.preset.active {
		background: var(--panel-3);
		border-color: var(--accent);
	}
	.preset.active small {
		color: var(--text);
	}
	.preset small {
		overflow-wrap: anywhere;
	}
	.fromimage .pick {
		width: 100%;
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px dashed var(--border);
		border-radius: 4px;
		color: var(--text-dim);
	}
	.num input {
		width: 90px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-dim);
		align-self: flex-end;
		padding-bottom: 4px;
	}
	.row.pack,
	.row.trees {
		align-items: flex-end;
	}
	.packtiles {
		display: flex;
		gap: 4px;
		align-items: center;
		min-height: 42px;
	}
	.packtile {
		width: 40px;
		height: 40px;
		border: 1px solid var(--border-soft);
	}
	.packtile :global(.tile) {
		padding: 0;
		border: none;
		background: transparent;
		pointer-events: none;
	}
	.seedrow {
		display: flex;
		gap: 6px;
	}
	.seedrow input {
		width: 110px;
	}
	.id input {
		width: 90px;
	}
	.link {
		border: none;
		background: transparent;
		color: var(--text-dim);
		text-decoration: underline;
		padding: 0;
		align-self: flex-end;
	}
	.grow {
		flex: 1;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 220px;
		flex: none;
	}
	.mapfind {
		display: flex;
		gap: 4px;
	}
	.mapfind input {
		flex: 1;
		min-width: 0;
	}
	.maplist {
		display: flex;
		flex-direction: column;
		max-height: 190px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.maprow {
		display: flex;
		align-items: center;
	}
	.maprow.active {
		background: var(--panel-3);
	}
	.maprow button {
		border: none;
		background: transparent;
		padding: 3px 4px;
	}
	.mapname {
		flex: 1;
		min-width: 0;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mapname .dim {
		font-size: 11px;
	}
	.pin {
		color: var(--text-dim);
	}
	.pin.on {
		color: var(--warn);
	}
	.zones {
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow-y: auto;
		max-height: 480px;
	}
	.zone {
		border: none;
		background: transparent;
		text-align: left;
		padding: 3px 8px;
		color: var(--text-dim);
		border-radius: var(--radius);
	}
	.zone:hover {
		background: var(--panel-2);
		color: var(--text);
	}
	.map {
		flex: 1;
		min-width: 0;
	}
</style>
