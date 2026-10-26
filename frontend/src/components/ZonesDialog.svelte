<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import Modal from './Modal.svelte'
	import { AreaRows, LiquidTypes, MapEntries, MapLights, NewAreaRow, SaveAreas, ZoneSounds, ZoneWeather } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { reloadAreas } from '../lib/wow/areas'
	import { applyNote } from '../lib/io/applyNote'

	// World › Zones (Noggit Red's zone editor in its Area Designator): a map's zones and subzones from
	// the client's AreaTable.dbc. Pick one to edit its row, or add a zone or a subzone; Save writes the
	// changed and new rows into the client's patch and the server's area_template. A form saved with
	// Save, like the creature editor's templates: not undo steps, since the rows aren't part of a map.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	let maps = $state<vmangos.MapEntry[]>([])
	let mapId = $state<number | null>(null)
	let rows = $state<vmangos.AreaRow[]>([])
	/** The IDs of rows edited or added since the last load, which Save writes. */
	let dirty = $state<number[]>([])
	let picked = $state<number | null>(null)
	let error = $state('')
	let saving = $state(false)

	const row = $derived(rows.find((r) => r.id === picked) ?? null)
	const zones = $derived(rows.filter((r) => !r.parent || !rows.some((z) => z.id === r.parent)))
	const subzones = (id: number) => rows.filter((r) => r.parent === id)

	// The map the zones are listed for: the open map's, else Azeroth.
	async function init() {
		if (!hasBackend()) {
			error = 'Zones need the desktop app and a WoW client.'
			return
		}
		try {
			maps = (await MapEntries()) ?? []
			const e = engineRef.current
			const ref = e?.activeVmangos()
			const region = e?.activeRegion()
			mapId = ref ? ref.mapId : (maps.find((m) => region && m.Dir.toLowerCase() === region.mapName.toLowerCase())?.ID ?? 0)
			await load()
		} catch (err) {
			error = String(err)
		}
	}
	void init()

	// The sound and light fields by name (#31): the client's tables, read once, and the map's lights.
	let sounds = $state<vmangos.ZoneSoundTables | null>(null)
	let lights = $state<vmangos.MapLight[]>([])
	ZoneSounds()
		.then((z) => (sounds = z))
		.catch(() => (sounds = null))
	$effect(() => {
		const id = mapId
		if (id === null) return
		MapLights(id)
			.then((l) => (lights = l?.lights ?? []))
			.catch(() => (lights = []))
	})
	// The zones' weather (#185): the server's game_weather rows by zone, read once; a zone without one
	// has no weather. Edited weather is saved with the zone rows, into the server only.
	let weather = $state<Record<number, vmangos.ZoneWeather>>({})
	let weatherServer = $state(false)
	/** The zones whose weather changed since the last load, which Save writes. */
	let weatherDirty = $state<number[]>([])
	ZoneWeather()
		.then((w) => {
			weatherServer = w.server
			weather = Object.fromEntries((w.zones ?? []).map((z) => [z.zone, z]))
		})
		.catch((err) => (error = `The server's weather could not be read: ${err}`))
	const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter']
	type WeatherKind = 'rain' | 'snow' | 'storm'
	const KINDS: Array<[WeatherKind, string]> = [
		['rain', 'Rain'],
		['snow', 'Snow'],
		['storm', 'Storm'],
	]
	/** The zone whose weather the picked row has: a subzone has its zone's. */
	const weatherZone = $derived(row ? (row.parent && rows.some((z) => z.id === row.parent) ? row.parent : row.id) : 0)
	function chance(zone: number, kind: WeatherKind, season: number): number {
		return weather[zone]?.[kind][season] ?? 0
	}
	function setChance(kind: WeatherKind, season: number, v: number) {
		const zone = weatherZone
		if (!zone) return
		// A plain object, which the state proxies (a class instance it would not).
		weather[zone] ??= { zone, rain: [0, 0, 0, 0], snow: [0, 0, 0, 0], storm: [0, 0, 0, 0] }
		const w = weather[zone]
		w[kind][season] = Math.max(0, Math.min(100, Math.round(v)))
		if (!weatherDirty.includes(zone)) weatherDirty = [...weatherDirty, zone]
	}
	/** What the server leaves fine in a season: it draws 1 to 100 against rain, then snow, then storm. */
	const fine = (zone: number, season: number) => Math.max(0, 100 - chance(zone, 'rain', season) - chance(zone, 'snow', season) - chance(zone, 'storm', season))
	/** The rows and zones' weathers Save writes. */
	const unsaved = $derived(new Set([...dirty, ...weatherDirty]).size)

	const lightName = (l: vmangos.MapLight) => (l.global ? `${l.id} · the map's own` : `${l.id} · at ${Math.round(l.x)}, ${Math.round(l.z)} (${Math.round(l.outer)} yd)`)

	/** The sound playing from a Play button, stopped by the next one or by closing. */
	let audio: HTMLAudioElement | null = null
	let playing = $state('')
	function play(file: string) {
		audio?.pause()
		if (!file || playing === file) {
			playing = ''
			return
		}
		audio = new Audio(`/wow/sound?path=${encodeURIComponent(file)}`)
		audio.onended = () => (playing = '')
		audio.onerror = () => {
			playing = ''
			error = `The client's ${file} could not be played.`
		}
		playing = file
		void audio.play().catch(() => (playing = ''))
	}
	$effect(() => () => audio?.pause())

	async function load() {
		if (mapId === null) return
		error = ''
		rows = (await AreaRows(mapId)) ?? []
		dirty = []
		picked = rows[0]?.id ?? null
	}

	/** False when the user kept the unsaved changes, so the map list goes back to the open map. */
	async function changeMap(id: number): Promise<boolean> {
		if (dirty.length && !(await askConfirm('Drop the unsaved zone changes?', { title: 'Unsaved changes', ok: 'Drop them' }))) return false
		mapId = id
		try {
			await load()
		} catch (err) {
			error = String(err)
		}
		return true
	}

	function edit<K extends keyof vmangos.AreaRow>(key: K, value: vmangos.AreaRow[K]) {
		const r = rows.find((x) => x.id === picked)
		if (!r) return
		r[key] = value
		if (!dirty.includes(r.id)) dirty = [...dirty, r.id]
	}

	async function add(parent: number) {
		if (mapId === null) return
		try {
			const r = await NewAreaRow(mapId, parent)
			// A second new row in one session takes the next free ID and bit past the unsaved ones.
			const ids = rows.map((x) => x.id)
			const bits = rows.map((x) => x.areaBit)
			if (ids.includes(r.id)) r.id = Math.max(...ids) + 1
			if (bits.includes(r.areaBit)) r.areaBit = Math.max(...bits) + 1
			rows = [...rows, r]
			dirty = [...dirty, r.id]
			picked = r.id
		} catch (err) {
			error = String(err)
		}
	}

	async function save() {
		const changed = rows.filter((r) => dirty.includes(r.id))
		const weathers = weatherDirty.map((z) => weather[z]).filter(Boolean)
		if (!changed.length && !weathers.length) return
		saving = true
		const end = startSaving('Saving the zones')
		error = ''
		try {
			const res = await SaveAreas(
				changed.map((r) => vmangos.AreaRow.createFrom(r)),
				weathers.map((w) => vmangos.ZoneWeather.createFrom(w)),
			)
			dirty = []
			weatherDirty = []
			if (changed.length) await reloadAreas()
			const tables = [changed.length ? 'area_template' : '', weathers.length ? 'game_weather' : ''].filter(Boolean).join(' and ')
			const where = [res.patch ? 'the client' : '', res.server ? `the server's ${tables}` : ''].filter(Boolean).join(' and ')
			const what = [changed.length ? `${changed.length} zone${changed.length === 1 ? '' : 's'}` : '', weathers.length ? `the weather of ${weathers.length} zone${weathers.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')
			const after = !res.server ? ' Set the VMaNGOS server folder for the server to know them.' : weathers.length ? ' The world server reads the weather when it starts, or on .reload game_weather in the game.' : ''
			setStatus(`Saved ${what} to ${where || 'nowhere new (nothing differed)'}.${after}${applyNote(res)}`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	async function close() {
		audio?.pause()
		if (unsaved && !(await askConfirm('Close without saving the zone changes?', { title: 'Unsaved changes', ok: 'Close without saving' }))) return
		onclose()
	}

	const FACTIONS: Array<[number, string]> = [
		[0, 'Contested'],
		[2, 'Alliance'],
		[4, 'Horde'],
		[6, 'Alliance and Horde'],
	]
	// AreaTable's flags: VMaNGOS's AreaFlags (DBCEnums.h, AREA_FLAG_*), with what each does in 1.12.
	const AREA_FLAGS: Array<[number, string, string]> = [
		[0x001, 'Breath in the cold', 'Players breathe out mist (Dun Morogh, Winterspring)'],
		[0x002, 'Own breath setting', "Overrides its zone's breath (Naxxramas, Razorfen Downs)"],
		[0x004, 'Development', 'Only used on the development map'],
		[0x008, 'Trade channel', 'Players here may use the Trade channel'],
		[0x010, 'Enemies flagged for PvP', 'Enemy players are flagged for PvP here'],
		[0x020, 'Resting', 'Players rest here, as in an inn'],
		[0x040, 'Duels', 'Duels are allowed'],
		[0x080, 'Arena', 'An arena, instanced or in the world'],
		[0x100, 'Capital', 'A main capital city'],
		[0x200, 'City', 'A city: the highest such area names the chat channels (Trade - City)'],
	]
	const AREA_FLAG_MASK = AREA_FLAGS.reduce((m, [bit]) => m | bit, 0)
	// The client's liquids (LiquidType.dbc), read once, for a zone's liquid type.
	let liquids = $state<vmangos.LiquidTypeEntry[]>([])
	LiquidTypes()
		.then((l) => (liquids = l ?? []))
		.catch(() => (liquids = []))
	const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
</script>

<Modal title="Zones" width={720} onclose={close}>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="top">
		<label class="k" for="zone-map">Map</label>
		<select
			id="zone-map"
			value={mapId ?? 0}
			onchange={(e) => {
				const el = e.target as HTMLSelectElement
				void changeMap(Number(el.value)).then((changed) => {
					if (!changed) el.value = String(mapId ?? 0)
				})
			}}
		>
			{#each maps as m (m.ID)}
				<option value={m.ID}>{m.Name || m.Dir} ({m.ID})</option>
			{/each}
		</select>
		<button onclick={() => void add(0)} disabled={mapId === null}>New zone</button>
		<button onclick={() => row && void add(row.parent || row.id)} disabled={!row} title="A subzone of the picked zone (or of the picked subzone's zone)">New subzone</button>
	</div>
	<div class="cols">
		<ul class="list" aria-label="Zones">
			{#each zones as z (z.id)}
				<li><button class:picked={picked === z.id} class:dirty={dirty.includes(z.id)} onclick={() => (picked = z.id)}>{z.name} <span class="id">{z.id}</span></button></li>
				{#each subzones(z.id) as s (s.id)}
					<li><button class="sub" class:picked={picked === s.id} class:dirty={dirty.includes(s.id)} onclick={() => (picked = s.id)}>{s.name} <span class="id">{s.id}</span></button></li>
				{/each}
			{:else}
				<li class="dim">No zones on this map yet.</li>
			{/each}
		</ul>
		{#if row}
			<div class="form">
				<label class="k" for="zone-name">Name</label>
				<input id="zone-name" value={row.name} oninput={(e) => edit('name', (e.target as HTMLInputElement).value)} />
				<label class="k" for="zone-parent">Zone</label>
				<select id="zone-parent" value={row.parent} onchange={(e) => edit('parent', Number((e.target as HTMLSelectElement).value))}>
					<option value={0}>None (this is a zone)</option>
					{#each rows.filter((r) => !r.parent && r.id !== row.id) as z (z.id)}
						<option value={z.id}>{z.name} ({z.id})</option>
					{/each}
				</select>
				<label class="k" for="zone-level">Exploration level</label>
				<input id="zone-level" type="number" value={row.level} oninput={(e) => edit('level', num(e))} />
				<label class="k" for="zone-faction">Faction</label>
				<select id="zone-faction" value={row.faction} onchange={(e) => edit('faction', Number((e.target as HTMLSelectElement).value))}>
					{#each FACTIONS as [v, label] (v)}
						<option value={v}>{label}</option>
					{/each}
					{#if !FACTIONS.some(([v]) => v === row.faction)}<option value={row.faction}>Mask {row.faction}</option>{/if}
				</select>
				<span class="k">Flags</span>
				<div class="flags" id="zone-flags" role="group" aria-label="Flags">
					{#each AREA_FLAGS as [bit, name, hint] (bit)}
						<label class="check" title={hint}><input type="checkbox" checked={(row.flags & bit) !== 0} onchange={(e) => edit('flags', (e.target as HTMLInputElement).checked ? row.flags | bit : row.flags & ~bit)} /> {name}</label
						>
					{/each}
					{#if row.flags & ~AREA_FLAG_MASK}<span class="dim">Other bits: {row.flags & ~AREA_FLAG_MASK}</span>{/if}
				</div>
				<label class="k" for="zone-liquid">Liquid type</label>
				<select id="zone-liquid" value={row.liquid} onchange={(e) => edit('liquid', Number((e.target as HTMLSelectElement).value))} title="The LiquidType.dbc row its water is (0 for the default)">
					<option value={0}>Default</option>
					{#each liquids as l (l.id)}<option value={l.id}>{l.name} ({l.id})</option>{/each}
					{#if row.liquid && !liquids.some((l) => l.id === row.liquid)}<option value={row.liquid}>Liquid {row.liquid}</option>{/if}
				</select>
				<label class="k" for="zone-music">Zone music</label>
				{@render soundPick('zone-music', 'music', sounds?.music, 'A ZoneMusic.dbc row')}
				<label class="k" for="zone-intro">Intro music</label>
				{@render soundPick('zone-intro', 'introMusic', sounds?.intro, 'A ZoneIntroMusicTable.dbc row')}
				<label class="k" for="zone-ambience">Ambience</label>
				{@render soundPick('zone-ambience', 'ambience', sounds?.ambience, 'A SoundAmbience.dbc row: its day and night sounds (Play plays the day one)')}
				<label class="k" for="zone-sound">Sound preferences</label>
				<span class="pair">
					{@render soundPick('zone-sound', 'soundPref', sounds?.prefs, 'SoundProviderPreferences.dbc: how sound carries here')}
					{@render soundPick('zone-sound-swim', 'soundSwim', sounds?.prefs, 'Underwater: SoundProviderPreferences.dbc')}
				</span>
				<label class="k" for="zone-elev">Min. elevation</label>
				<input id="zone-elev" type="number" step="any" value={row.minElevation} oninput={(e) => edit('minElevation', num(e))} />
				<label class="k" for="zone-ambient">Ambient multiplier</label>
				<input id="zone-ambient" type="number" step="any" value={row.ambientMul} oninput={(e) => edit('ambientMul', num(e))} />
				<label class="k" for="zone-light">Light</label>
				<select id="zone-light" value={row.light} onchange={(e) => edit('light', Number((e.target as HTMLSelectElement).value))} title="A Light.dbc row of this map; none for the map's">
					<option value={0}>None (the map's)</option>
					{#each lights as l (l.id)}<option value={l.id}>{lightName(l)}</option>{/each}
					{#if row.light && !lights.some((l) => l.id === row.light)}<option value={row.light}>{row.light}</option>{/if}
				</select>
				<span class="k">ID / exploration bit</span>
				<span class="dim">{row.id} / {row.areaBit}</span>
				{@render weatherForm()}
			</div>
		{/if}
	</div>
	<p class="dim">Save writes the changed zones into the client's AreaTable.dbc (Meld's patch, which the game reads when it starts) and the server's area_template. Paint a zone onto the ground with the Map data tool.</p>
	{#snippet actions()}
		<button onclick={close}>Close</button>
		<button class="active" onclick={() => void save()} disabled={!unsaved || saving}>{saving ? 'Saving…' : `Save${unsaved ? ` (${unsaved})` : ''}`}</button>
	{/snippet}
</Modal>

{#snippet weatherForm()}
	{@const zone = weatherZone}
	<span class="k">Weather</span>
	<span class="dim">
		{#if !weatherServer}
			The weather is the server's (game_weather): set the VMaNGOS server folder to edit it.
		{:else if zone !== row?.id}
			A subzone has its zone's weather: that of {rows.find((z) => z.id === zone)?.name ?? zone}, below.
		{:else if !weather[zone]}
			None: this zone has no game_weather row. Give it a chance below.
		{:else}
			The chance (%) of each kind when the server changes the weather, by season. Lighting › Weather Preview shows how it looks.
		{/if}
	</span>
	{#if weatherServer}
		<div class="weather" data-zone={zone}>
			<span></span>
			{#each SEASONS as s (s)}<span class="k season">{s}</span>{/each}
			{#each KINDS as [kind, label] (kind)}
				<span class="k">{label}</span>
				{#each SEASONS as s, i (s)}
					<label class="chance" title={`${label} in ${s.toLowerCase()}: ${chance(zone, kind, i)}%`}>
						<input type="range" min="0" max="100" step="1" aria-label={`${label} chance in ${s.toLowerCase()}`} value={chance(zone, kind, i)} oninput={(e) => setChance(kind, i, num(e))} />
						<span class="pct">{chance(zone, kind, i)}</span>
					</label>
				{/each}
			{/each}
			<span class="k" title="What is left of 100 after rain, snow and storm">Fine</span>
			{#each SEASONS as s, i (s)}<span class="dim pct">{fine(zone, i)}</span>{/each}
		</div>
	{/if}
{/snippet}

{#snippet soundPick(id: string, key: 'music' | 'introMusic' | 'ambience' | 'soundPref' | 'soundSwim', options: vmangos.SoundOption[] | undefined, title: string)}
	{@const value = row ? row[key] : 0}
	{@const file = options?.find((o) => o.id === value)?.file ?? ''}
	<span class="pick">
		{#if options}
			<select {id} {value} {title} onchange={(e) => edit(key, Number((e.target as HTMLSelectElement).value))}>
				<option value={0}>None</option>
				{#each options as o (o.id)}<option value={o.id}>{o.name || `#${o.id}`} ({o.id})</option>{/each}
				{#if value && !options.some((o) => o.id === value)}<option {value}>{value}</option>{/if}
			</select>
		{:else}
			<input {id} type="number" min="0" {value} {title} oninput={(e) => edit(key, num(e))} />
		{/if}
		{#if key !== 'soundPref' && key !== 'soundSwim'}
			<button class="play" disabled={!file} onclick={() => play(file)} title={file ? `Play ${file}` : 'Nothing to play'}>{playing && playing === file ? '■' : '▶'}</button>
		{/if}
	</span>
{/snippet}

<style>
	.pick {
		display: flex;
		gap: 4px;
		min-width: 0;
	}
	.pick select,
	.pick input {
		flex: 1;
		min-width: 0;
	}
	.play {
		padding: 2px 8px;
	}
	.error {
		color: var(--danger-text);
		margin: 0 0 8px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.top {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 8px;
	}
	.top select {
		flex: 1;
	}
	.cols {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr);
		gap: 12px;
		min-height: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		max-height: 420px;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.list button {
		display: flex;
		width: 100%;
		justify-content: space-between;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 3px 8px;
		text-align: left;
		color: var(--text);
	}
	.list button.sub {
		padding-left: 22px;
	}
	.list button:hover {
		background: var(--panel-2);
	}
	.list button.picked {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.list button.dirty::after {
		content: '•';
		margin-left: 4px;
	}
	.id {
		opacity: 0.6;
		font-family: var(--mono);
		font-size: 10px;
		margin-left: auto;
	}
	.form {
		display: grid;
		grid-template-columns: 130px minmax(0, 1fr);
		gap: 6px 8px;
		align-items: center;
		align-content: start;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.pair {
		display: flex;
		gap: 6px;
	}
	.form select,
	.form input:not([type='range']) {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.flags {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 2px 10px;
	}
	.flags .check {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.form .flags input {
		width: auto;
	}
	.weather {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 130px repeat(4, minmax(0, 1fr));
		gap: 4px 8px;
		align-items: center;
	}
	.season {
		text-align: center;
	}
	.chance {
		display: flex;
		gap: 4px;
		align-items: center;
		min-width: 0;
	}
	.chance input {
		flex: 1;
		min-width: 0;
	}
	.pct {
		font-family: var(--mono);
		font-size: 10px;
		min-width: 2.5ch;
		text-align: right;
	}
	.pair input {
		flex: 1;
		min-width: 0;
	}
</style>
