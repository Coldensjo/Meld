<script lang="ts">
	import { numOr0 as num } from '../lib/ui/inputs'
	import { startSaving } from '../lib/state/saving'
	import Modal from './Modal.svelte'
	import { AreaRows, ExportAreas, ImportAreas, LiquidTypes, MapEntries, MapLights, NewAreaRow, OpenAreasDialog, PlanAreaImport, SaveAreas, ZoneSounds, ZoneWeather } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { reloadAreas } from '../lib/wow/areas'
	import { applyNote } from '../lib/io/applyNote'
	import { playSound, soundPlayer, stopSound } from '../lib/ui/soundPlayer.svelte'

	// World › Zones (Noggit Red's zone editor in its Area Designator): a map's zones and subzones from
	// the client's AreaTable.dbc. Pick one to edit its row, or add a zone or a subzone; Save writes the
	// changed and new rows into the client's patch and the server's area_template. A form saved with
	// Save, like the creature editor's templates: not undo steps, since the rows aren't part of a map.
	// Export map…, Export zone… and Import… (#942) write and read an SQL script of the areas'
	// area_template rows and weather, with their AreaTable rows in "-- meld area" lines
	// (internal/vmangos/areascripts.go); an import goes through Save's write after its plan.

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
	function loadWeather() {
		return ZoneWeather()
			.then((w) => {
				weatherServer = w.server
				weather = Object.fromEntries((w.zones ?? []).map((z) => [z.zone, z]))
				weatherDirty = []
			})
			.catch((err) => (error = `The server's weather could not be read: ${err}`))
	}
	void loadWeather()
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

	// The Play buttons share the sound pickers' player (#684), so a sound playing in another picker
	// stops when one plays here; closing the dialog stops it.
	const play = (file: string) => playSound(file, (m) => (error = m))
	$effect(() => () => stopSound())

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
				changed.map((r) => r as vmangos.AreaRow),
				weathers.map((w) => w as vmangos.ZoneWeather),
			)
			dirty = []
			weatherDirty = []
			if (changed.length) await reloadAreas()
			const tables = [changed.length ? 'area_template' : '', weathers.length ? 'game_weather' : ''].filter(Boolean).join(' and ')
			const where = [res.patch ? 'the client' : '', res.server ? `the server's ${tables}` : ''].filter(Boolean).join(' and ')
			const what = [changed.length ? `${changed.length} zone${changed.length === 1 ? '' : 's'}` : '', weathers.length ? `the weather of ${weathers.length} zone${weathers.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')
			const after = !res.server ? ' Set the VMaNGOS server folder for the server to know them.' : weathers.length ? ' The world server reloads the weather if it runs with its SOAP console on, or reads it when it starts.' : ''
			setStatus(`Saved ${what} to ${where || 'nowhere new (nothing differed)'}.${after}${applyNote(res)}`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	// Export and import (#942).
	const mapEntry = $derived(maps.find((m) => m.ID === mapId))
	const mapName = $derived(mapEntry?.Name || mapEntry?.Dir || `map ${mapId}`)
	/** The areas Export zone… writes: the picked area and, for a zone, its subzones. */
	const zoneAreas = $derived(row ? [row, ...(row.parent ? [] : subzones(row.id))] : [])
	let note = $state('')

	async function exportAreas(ids: number[], what: string) {
		if (mapId === null) return
		error = ''
		note = ''
		try {
			const file = what.replace(/[^\w\- ]+/g, '').trim() || 'zones'
			const path = await ExportAreas(mapId, ids, file)
			if (!path) return
			const n = ids.length || rows.length
			note = `Exported ${what} (${n} ${n === 1 ? 'area' : 'areas'}${weatherServer ? ' with the weather' : ', without the weather: no server folder is set'}) to ${path}${unsaved ? ', as saved: the unsaved changes are not in it' : ''}.`
			setStatus(note, 8000)
		} catch (err) {
			error = String(err)
		}
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.AreaImport } | null>(null)
	let importing = $state(false)

	async function askImport() {
		error = ''
		note = ''
		if (unsaved && !(await askConfirm('Drop the unsaved zone changes? The zones are read again after the import.', { title: 'Unsaved changes', ok: 'Drop them' }))) return
		try {
			const path = await OpenAreasDialog()
			if (!path) return
			plan = { path, plan: await PlanAreaImport(path) }
		} catch (err) {
			error = String(err)
		}
	}

	async function confirmImport() {
		if (!plan) return
		const { path } = plan
		importing = true
		const end = startSaving('Importing the zones')
		error = ''
		try {
			const res = await ImportAreas(path)
			plan = null
			await reloadAreas()
			// The dialog shows the script's map when it is on one map only, else the one it had.
			const onMaps = res.maps ?? []
			if (onMaps.length === 1) mapId = onMaps[0]
			await load()
			await loadWeather()
			const where = [res.patch ? 'the client' : '', res.server ? `the server's area_template${res.weather ? ' and game_weather' : ''}` : ''].filter(Boolean).join(' and ')
			const weathers = res.weather ? `, with the weather of ${res.weather} zone${res.weather === 1 ? '' : 's'},` : ''
			const after = !res.server ? ' Set the VMaNGOS server folder for the server to know them.' : res.weather ? ' The world server reloads the weather if it runs with its SOAP console on, or reads it when it starts.' : ''
			note = `Imported ${res.areas} ${res.areas === 1 ? 'area' : 'areas'}${weathers} into ${where || 'nowhere new (nothing differed)'}.${after}${applyNote(res)}`
			setStatus(note, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			importing = false
			end()
		}
	}

	/** An area of the plan, as the plan bar says it. */
	function areaText(a: vmangos.AreaImportRow): string {
		const parts = [String(a.id)]
		if (a.parent) parts.push(`in ${a.parent}`)
		if (!a.exists) parts.push('new')
		else if (a.was || a.wasMap !== a.mapId) parts.push(`replaces ${a.was || 'the area'}${a.wasMap !== a.mapId ? ` of map ${a.wasMap}` : ''}`)
		else parts.push('replaces it')
		if (a.fromBit) parts.push(`exploration bit ${a.bit}, as ${a.fromBit} is another area's`)
		return `${a.name} (${parts.join(', ')})`
	}

	/** The first `n` of `items` joined, with how many more. */
	function some(items: string[], n = 12): string {
		return items.slice(0, n).join('; ') + (items.length > n ? `; and ${items.length - n} more` : '')
	}

	async function close() {
		stopSound()
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
</script>

<Modal title="Zones" width={720} onclose={close}>
	{#if error}<p class="error">{error}</p>{/if}
	{#if note && !plan}<p class="note">{note}</p>{/if}
	{#if plan}
		{@const p = plan.plan}
		{@const areas = p.areas ?? []}
		{@const onMaps = p.maps ?? []}
		{@const refused = p.refused ?? []}
		<div class="plan" role="group" aria-label="Import plan">
			<div class="what">
				<strong>Import {areas.length} {areas.length === 1 ? 'area' : 'areas'} into the client's AreaTable.dbc{p.server ? " and the server's area_template" : ''}?</strong>
				<span>{some(areas.map(areaText))}.</span>
				{#if onMaps.some((m) => m !== mapId)}<span>On {onMaps.length === 1 ? 'map' : 'maps'} {onMaps.join(', ')}: the area and map IDs are the exporting client's, kept as they are.</span>{/if}
				{#if p.missingMaps?.length}<span>Not in this client's Map.dbc: map {p.missingMaps.join(', ')}. The areas are written, but no map of this client shows them.</span>{/if}
				{#if p.missingZones?.length}<span>Subzones of zones neither the script nor this client has: {p.missingZones.join(', ')}.</span>{/if}
				{#if p.missing?.length}<span>IDs this client's tables lack, kept as they are: {some(p.missing)}.</span>{/if}
				{#if !p.server && (p.weather || p.clearWeather)}<span>The weather is left out: set the VMaNGOS server folder to import it.</span>
				{:else if p.weather || p.clearWeather}<span>Weather: sets {p.weather} {p.weather === 1 ? "zone's" : "zones'"}{p.clearWeather ? `, clears ${p.clearWeather} ${p.clearWeather === 1 ? "zone's" : "zones'"}` : ''}.</span>
				{:else if p.server}<span>The script carries no weather: the zones keep theirs.</span>{/if}
				{#if p.others}<span>{p.others} weather {p.others === 1 ? 'row is' : 'rows are'} of zones the script has no zone row of, and left out.</span>{/if}
				{#if p.skipped}<span>{p.skipped} other {p.skipped === 1 ? 'statement is' : 'statements are'} left out: only the areas and their weather are imported.</span>{/if}
				{#if p.unknown?.length}<span>game_weather columns Meld doesn't know are left out: {p.unknown.join(', ')}.</span>{/if}
				{#if refused.length}<span class="refused">Refused, nothing is written: {refused.join('; ')}.</span>
				{:else}<span>A replaced area can't be brought back, unless you exported it first.</span>{/if}
			</div>
			<button onclick={() => (plan = null)}>Cancel</button>
			<button class="active" disabled={importing || refused.length > 0} onclick={() => void confirmImport()}>{importing ? 'Importing…' : 'Import'}</button>
		</div>
	{/if}
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
		<button onclick={() => void askImport()} disabled={importing || saving} title="Read zones from an SQL script into the client and the server, as Save writes them">Import…</button>
		<button onclick={() => void exportAreas([], mapName)} disabled={!rows.length} title="Write every zone and subzone of this map, with their weather, to an SQL script">Export map…</button>
		<button
			onclick={() =>
				row &&
				void exportAreas(
					zoneAreas.map((a) => a.id),
					row.name,
				)}
			disabled={!row}
			title="Write the picked zone with its subzones (or the picked subzone) to an SQL script">Export zone…</button
		>
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
			<button class="play" disabled={!file} onclick={() => play(file)} title={file ? `Play ${file}` : 'Nothing to play'}>{soundPlayer.playing && soundPlayer.playing === file ? '■' : '▶'}</button>
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
	.note {
		color: var(--ok);
		margin: 0 0 8px;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.plan {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 0 0 8px;
		padding: 8px;
		font-size: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.plan .what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}
	.plan .refused {
		color: var(--danger-text);
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
