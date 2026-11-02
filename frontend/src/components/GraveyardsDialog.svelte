<script lang="ts">
	import * as THREE from 'three'
	import { startSaving } from '../lib/state/saving'
	import Modal from './Modal.svelte'
	import { Areas, Graveyards, MapEntries, SaveGraveyards, SearchCreatures } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { editorPoint, type ServerSpot } from '../lib/io/portCoords'
	import { applyNote } from '../lib/io/applyNote'
	import { ALLIANCE, ANYONE, HORDE, facingTip } from '../lib/world/GraveyardLayer'

	// World › Graveyards (#947): the open map's graveyards (WorldSafeLocs.dbc), where a dead player's
	// ghost goes, with their facings (world_safe_locs_facing) and the zones they serve
	// (game_graveyard_zone). Add one where the camera is, link it to the zones it serves, and place a
	// Spirit Healer beside it. The 3D view draws them, and a click on one's cross picks it. A form
	// saved with Save, as Portals and Flight Paths are: not undo steps (decision #83); the Spirit
	// Healer is an ordinary spawn, an undo step of the map. Save writes the client's table into
	// Meld's patch and the server's copy, and the facings and links into the world database.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	/** How many graveyards the list shows, nearest the camera first. */
	const LIST_MAX = 200
	/** The Spirit Healer's creature template (1.12's, in VMaNGOS's creature_template). */
	const SPIRIT_HEALER = 6491
	/** How far beside the graveyard the Spirit Healer stands, yards. */
	const HEALER_OFFSET = 3

	let maps = $state<vmangos.MapEntry[]>([])
	let areas = $state<vmangos.Area[]>([])
	let mapId = $state<number | null>(null)
	let graveyards = $state<vmangos.Graveyard[]>([])
	let nextId = $state(0)
	let server = $state(false)
	/** IDs of graveyards changed or added since the load, and of removed ones. */
	let dirty = $state<number[]>([])
	let removed = $state<number[]>([])
	let picked = $state<number | null>(null)
	let here = $state<ServerSpot | null>(null)
	let error = $state('')
	let saving = $state(false)
	let loading = $state(true)
	/** The zone a new link takes. */
	let addZone = $state(0)

	const g = $derived(graveyards.find((x) => x.id === picked) ?? null)
	const listed = $derived.by(() => {
		const h = here
		const d = (x: vmangos.Graveyard) => (h ? (x.x - h.x) ** 2 + (x.y - h.y) ** 2 + (x.z - h.z) ** 2 : 0)
		return [...graveyards].sort((a, b) => d(a) - d(b)).slice(0, LIST_MAX)
	})
	const distance = (x: vmangos.Graveyard) => (here ? Math.round(Math.hypot(x.x - here.x, x.y - here.y, x.z - here.z)) : null)
	const mapName = (id: number) => {
		const m = maps.find((x) => x.ID === id)
		return m ? m.Name || m.Dir : `map ${id}`
	}
	/** The zones (AreaTable rows without a parent), this map's first, then by name. */
	const zones = $derived.by(() => {
		const list = areas.filter((a) => a.parent === 0)
		return list.sort((a, b) => Number(b.mapId === mapId) - Number(a.mapId === mapId) || a.name.localeCompare(b.name))
	})
	const areaName = (id: number) => areas.find((a) => a.id === id)?.name ?? `area ${id}`
	const zoneLabel = (a: vmangos.Area) => `${a.name} (${a.id}${a.mapId === mapId ? '' : `, ${mapName(a.mapId)}`})`
	const FACTIONS = [
		{ id: ANYONE, name: 'Anyone' },
		{ id: ALLIANCE, name: 'Alliance' },
		{ id: HORDE, name: 'Horde' },
	]

	async function init() {
		if (!hasBackend()) {
			error = 'Graveyards need the desktop app and a WoW client.'
			loading = false
			return
		}
		try {
			;[maps, areas] = await Promise.all([MapEntries().then((m) => m ?? []), Areas().then((a) => a ?? [])])
			const e = engineRef.current
			here = (await e?.playerSpot()) ?? null
			mapId = here?.map ?? null
			if (mapId === null) {
				error = 'This map has no client map ID: open a part of Azeroth or a map made for the client.'
				return
			}
			await load(mapId)
			picked = listed[0]?.id ?? null
			addZone = zoneHere() || (zones[0]?.id ?? 0)
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void init()

	async function load(id: number) {
		const r = await Graveyards(id)
		graveyards = (r.graveyards ?? []).map((x) => ({ ...x, links: x.links ?? [] }))
		nextId = r.nextId
		server = r.server
		dirty = []
		removed = []
	}

	/** The zone of the ground under the camera's spot (its area's parent zone), or 0. */
	function zoneHere(): number {
		const e = engineRef.current
		if (!e || !here) return 0
		const o = e.serverOrigin()
		const p = editorPoint(here, o.x, o.y)
		const id = e.areaAt(p.x, p.z)
		if (!id) return 0
		return areas.find((a) => a.id === id)?.parent || id
	}

	// The 3D view draws the list as it is edited, the picked one highlighted; a click on a cross picks it.
	$effect(() => {
		const list = $state.snapshot(graveyards)
		engineRef.current?.showGraveyards(list, picked, (id) => (picked = id))
	})

	function touch(id: number) {
		if (!dirty.includes(id)) dirty = [...dirty, id]
	}

	function edit<K extends keyof vmangos.Graveyard>(key: K, value: vmangos.Graveyard[K]) {
		if (!g) return
		g[key] = value
		touch(g.id)
	}

	function add() {
		if (!here || mapId === null) return
		const id = Math.max(nextId, ...graveyards.map((x) => x.id + 1))
		const zone = zoneHere()
		const n: vmangos.Graveyard = { id, mapId, x: here.x, y: here.y, z: here.z, o: here.o, name: zone ? `${areaName(zone)} Graveyard` : 'Graveyard', links: zone ? [{ zone, faction: ANYONE }] : [] }
		graveyards = [...graveyards, n]
		touch(id)
		picked = id
	}

	function moveHere() {
		if (!g || !here) return
		g.x = here.x
		g.y = here.y
		g.z = here.z
		g.o = here.o
		touch(g.id)
	}

	function remove() {
		if (!g) return
		const id = g.id
		graveyards = graveyards.filter((x) => x.id !== id)
		dirty = dirty.filter((x) => x !== id)
		// A graveyard added in this session was never written: nothing to take out.
		if (id < nextId) removed = [...removed, id]
		picked = listed.find((x) => x.id !== id)?.id ?? null
	}

	function addLink() {
		if (!g || !addZone || g.links.some((l) => l.zone === addZone)) return
		g.links = [...g.links, { zone: addZone, faction: ANYONE }]
		touch(g.id)
	}

	function setFaction(i: number, faction: number) {
		if (!g) return
		g.links[i].faction = faction
		touch(g.id)
	}

	function dropLink(i: number) {
		if (!g) return
		g.links = g.links.filter((_, k) => k !== i)
		touch(g.id)
	}

	/** Puts the camera on the picked graveyard. */
	function goTo() {
		const e = engineRef.current
		if (!g || !e) return
		const o = e.serverOrigin()
		const p = editorPoint(g, o.x, o.y)
		e.setSceneView({ ...e.sceneView(), target: [p.x, p.y, p.z], distance: 30, pitch: 0.6 })
	}

	/** Places a Spirit Healer (an ordinary spawn, one undo step) beside the picked graveyard, facing the way it faces. */
	let placing = $state(false)
	async function placeHealer() {
		const e = engineRef.current
		if (!g || !e) return
		placing = true
		error = ''
		try {
			const t = (await SearchCreatures(String(SPIRIT_HEALER))).find((x) => x.entry === SPIRIT_HEALER)
			if (!t) {
				error = `The world database has no creature ${SPIRIT_HEALER} (Spirit Healer).`
				return
			}
			const o = e.serverOrigin()
			// Beside it: a few yards to its left, on the ground there when the open block has it.
			const side = facingTip({ ...g, o: g.o + Math.PI / 2 }, HEALER_OFFSET)
			const p = editorPoint(side, o.x, o.y)
			const ground = e.terrain.contains(p.x, p.z) ? e.terrain.heightAt(p.x, p.z) : p.y
			const ahead = editorPoint(facingTip(g), o.x, o.y)
			const g0 = editorPoint(g, o.x, o.y)
			// rotY is the model's turn about the vertical in the editor, +X its front at rest.
			const rotY = Math.atan2(-(ahead.z - g0.z), ahead.x - g0.x)
			await e.placeCreature(t, new THREE.Vector3(p.x, ground, p.z), rotY)
			setStatus(`Placed a Spirit Healer beside ${g.name}: a spawn of the map, saved with Save Spawns like any other.`, 8000)
		} catch (err) {
			error = String(err)
		} finally {
			placing = false
		}
	}

	async function save() {
		const changed = graveyards.filter((x) => dirty.includes(x.id))
		if (!changed.length && !removed.length) return
		saving = true
		const end = startSaving('Saving the graveyards')
		error = ''
		try {
			const res = await SaveGraveyards(
				changed.map((x) => $state.snapshot(x) as vmangos.Graveyard),
				$state.snapshot(removed),
			)
			const n = changed.length + removed.length
			dirty = []
			removed = []
			nextId = Math.max(nextId, ...graveyards.map((x) => x.id + 1))
			const where = [res.patch ? 'the client' : '', res.server ? "the server's graveyards" : ''].filter(Boolean).join(' and ')
			setStatus(`Saved ${n} graveyard${n === 1 ? '' : 's'} to ${where || 'nowhere new (nothing differed)'}.${applyNote(res)}`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	async function close() {
		if ((dirty.length || removed.length) && !(await askConfirm('Close without saving the graveyard changes?', { title: 'Unsaved changes', ok: 'Close without saving' }))) return
		engineRef.current?.endGraveyardEdit()
		onclose()
	}

	const num = (e: Event) => {
		const v = Number((e.target as HTMLInputElement).value)
		return Number.isFinite(v) ? v : 0
	}
	const deg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10
	const rad = (d: number) => (d * Math.PI) / 180
</script>

<Modal title="Graveyards" width={780} onclose={close}>
	{#if error}<p class="error">{error}</p>{/if}
	{#if !loading && !server && !error}<p class="error">Graveyards are the server's: set the VMaNGOS server folder to read their zone links and save them.</p>{/if}
	<div class="top">
		<span class="dim">{loading ? 'Reading the graveyards…' : mapId !== null ? `${mapName(mapId)}: ${graveyards.length} graveyards, nearest the camera first.` : ''}</span>
		<button onclick={add} disabled={!here || mapId === null} title="A new graveyard where the camera is, facing its way, linked to the zone under it">New graveyard here</button>
	</div>
	<div class="cols">
		<ul class="list" aria-label="Graveyards">
			{#each listed as x (x.id)}
				<li>
					<button class:picked={picked === x.id} class:dirty={dirty.includes(x.id)} onclick={() => (picked = x.id)} title={x.name || `Graveyard ${x.id}`}>
						<span class="name">{x.name || `Graveyard ${x.id}`}</span>
						<span class="id">{x.id}{distance(x) !== null ? ` · ${distance(x)} yd` : ''}{server ? ` · ${x.links.length} ${x.links.length === 1 ? 'zone' : 'zones'}` : ''}</span>
					</button>
				</li>
			{:else}
				<li class="dim">{loading ? '' : 'No graveyards on this map yet.'}</li>
			{/each}
		</ul>
		{#if g}
			<div class="form">
				<div class="grid">
					<label class="k" for="gy-name">Name</label>
					<span class="row">
						<input id="gy-name" maxlength="256" value={g.name} oninput={(e) => edit('name', (e.target as HTMLInputElement).value)} />
						<span class="dim nowrap" title="The graveyard's ID in WorldSafeLocs.dbc">ID {g.id}</span>
					</span>
				</div>

				<fieldset>
					<legend>Where a ghost appears</legend>
					<div class="grid">
						<span class="k">Position</span>
						<span class="row">
							<label class="axis">X <input type="number" step="any" value={g.x} oninput={(e) => edit('x', num(e))} aria-label="X" /></label>
							<label class="axis">Y <input type="number" step="any" value={g.y} oninput={(e) => edit('y', num(e))} aria-label="Y" /></label>
							<label class="axis">Z <input type="number" step="any" value={g.z} oninput={(e) => edit('z', num(e))} aria-label="Z" /></label>
						</span>
						<label class="k" for="gy-o">Facing (°)</label>
						<input id="gy-o" type="number" step="any" value={deg(g.o)} disabled={!server} oninput={(e) => edit('o', rad(num(e)))} />
						<span></span>
						<span class="row wrap">
							<button onclick={moveHere} disabled={!here} title="Put the graveyard where the camera is, facing its way">Move to the camera</button>
							<button onclick={goTo} title="Put the camera on the graveyard">Look at it</button>
							<button onclick={() => void placeHealer()} disabled={placing || !server} title="Place a Spirit Healer (creature {SPIRIT_HEALER}) beside it, as an ordinary spawn you can move or delete"
								>Place a Spirit Healer</button
							>
						</span>
					</div>
				</fieldset>

				<fieldset>
					<legend>Zones it serves</legend>
					{#if !server}
						<span class="dim">Set the VMaNGOS server folder: the links are the world database's.</span>
					{:else}
						<ul class="links" aria-label="Zone links">
							{#each g.links as l, i (l.zone)}
								<li class="row">
									<span class="zone" title="The zone's ID in AreaTable.dbc">{areaName(l.zone)} <span class="dim">({l.zone})</span></span>
									<select value={l.faction} aria-label="For whom" onchange={(e) => setFaction(i, Number((e.target as HTMLSelectElement).value))}>
										{#each FACTIONS as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
									</select>
									<button onclick={() => dropLink(i)} title="This graveyard no longer serves the zone">Remove</button>
								</li>
							{:else}
								<li class="dim">No zone yet: a ghost of a zone without a graveyard goes to the nearest of any zone it has, or nowhere.</li>
							{/each}
						</ul>
						<span class="row">
							<select bind:value={addZone} aria-label="Zone to link">
								{#each zones as z (z.id)}<option value={z.id}>{zoneLabel(z)}</option>{/each}
							</select>
							<button class="nowrap" onclick={addLink} disabled={!addZone || g.links.some((l) => l.zone === addZone)}>Link zone</button>
						</span>
					{/if}
				</fieldset>

				<span class="row end"><button class="danger" onclick={remove}>Delete graveyard</button></span>
			</div>
		{/if}
	</div>
	<p class="dim">
		A dead player's ghost goes to the nearest graveyard linked to the zone it died in, for anyone or its side. Save writes the client's WorldSafeLocs.dbc (Meld's patch) and the server's copy, and the facings and links into the world
		database. A running world server reloads the links; it reads new places and facings only when it starts.
	</p>
	{#snippet actions()}
		<button onclick={close}>Close</button>
		<button class="active" onclick={() => void save()} disabled={(!dirty.length && !removed.length) || saving || !server}>{saving ? 'Saving…' : `Save${dirty.length + removed.length ? ` (${dirty.length + removed.length})` : ''}`}</button
		>
	{/snippet}
</Modal>

<style>
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
	.top span {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* minmax(0, …): a long zone name in a select must not widen its column past the dialog. */
	.cols {
		display: grid;
		grid-template-columns: minmax(160px, 230px) minmax(0, 1fr);
		gap: 12px;
		min-height: 0;
	}
	.list,
	.links {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.list {
		max-height: 440px;
	}
	.links {
		max-height: 180px;
		padding: 4px 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.list button {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: 3px 8px;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.list .name,
	.zone {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.zone {
		flex: 1;
		min-width: 0;
	}
	.list button.picked {
		background: var(--panel-3);
	}
	.list button.dirty {
		font-style: italic;
	}
	.id {
		color: var(--text-dim);
		font-size: 11px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	fieldset {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 6px 10px 8px;
		min-width: 0;
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	legend {
		padding: 0 4px;
		color: var(--text-dim);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr);
		gap: 6px 8px;
		align-items: center;
	}
	.k {
		overflow-wrap: anywhere;
	}
	.grid > input {
		width: 100%;
		min-width: 0;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.row.wrap {
		flex-wrap: wrap;
	}
	.row.end {
		justify-content: flex-end;
	}
	.row > input,
	.row > select {
		flex: 1;
		min-width: 0;
	}
	.axis {
		display: flex;
		flex: 1;
		gap: 4px;
		align-items: center;
		min-width: 0;
		color: var(--text-dim);
	}
	.axis input {
		flex: 1;
		min-width: 0;
		width: 100%;
	}
	.nowrap {
		white-space: nowrap;
	}
</style>
