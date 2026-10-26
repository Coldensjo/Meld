<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import { onDestroy, tick } from 'svelte'
	import { MapEntries, ReadCreature, SaveCreature, SaveTaxi, TaxiNetwork } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { editorPoint, serverSpot } from '../lib/io/portCoords'
	import type { TaxiHooks } from '../lib/world/TaxiLayer'
	import { defaultRoute, flightSeconds, type Vec3 } from '../lib/world/taxiRoute'
	import { applyNote } from '../lib/io/applyNote'
	import Money from './Money.svelte'
	import MoneyField from './MoneyField.svelte'
	import RefField from './RefField.svelte'

	// World › Flight Paths (#180): the open map's flight stops (TaxiNodes.dbc) and the routes between
	// them (TaxiPath.dbc and TaxiPathNode.dbc's points), edited on the map. A window, not a dialog, so
	// the map stays in reach: a stop's marker drags over the ground, the picked route's points drag
	// level (Shift: up and down), and with Draw on a click adds a point after the picked one, at its
	// height. Fly it rides the camera along the route at a flight's speed. Save writes the three tables
	// into Meld's patch and the server's (taxi_nodes and its copies of the route tables). A form saved
	// with Save, as the Portals and Zones dialogs are: not undo steps (decision #83).

	interface Stop extends Vec3 {
		id: number
		mapId: number
		name: string
		hordeMount: number
		allianceMount: number
	}
	interface Point extends Vec3 {
		mapId: number
		flags: number
		delay: number
	}
	interface Route {
		id: number
		from: number
		to: number
		cost: number
		points: Point[]
	}

	/** The mounts the client's own stops use, by side. */
	const ALLIANCE_MOUNTS = [
		{ id: 541, name: 'Riding Gryphon' },
		{ id: 3837, name: 'Riding Hippogryph' },
	]
	const HORDE_MOUNTS = [
		{ id: 2224, name: 'Wind Rider' },
		{ id: 3574, name: 'Riding Bat' },
	]
	/** The client's taxi mask holds stops 1 to 256 (vmangos.MaxTaxiNode). */
	const MAX_STOP = 256
	/** The npc flag that makes a creature a flight master (1.12's UNIT_NPC_FLAG_FLIGHTMASTER). */
	const FLIGHT_MASTER = 8

	let mapId = $state<number | null>(null)
	let mapName = $state('')
	let stops = $state<Stop[]>([])
	let routes = $state<Route[]>([])
	let nextStop = 0
	let nextRoute = 0
	/** The stops and routes the client's tables hold (a removed one must be taken out of them). */
	let savedStops = new Set<number>()
	let savedRoutes = new Set<number>()
	let dirtyStops = $state<number[]>([])
	let dirtyRoutes = $state<number[]>([])
	let removedStops = $state<number[]>([])
	let removedRoutes = $state<number[]>([])
	let pickStop = $state<number | null>(null)
	let pickRoute = $state<number | null>(null)
	let pickPoint = $state(-1)
	let drawing = $state(false)
	let routeTo = $state(-1)
	let error = $state('')
	let loading = $state(true)
	let saving = $state(false)

	const stop = $derived(stops.find((s) => s.id === pickStop) ?? null)
	const route = $derived(routes.find((r) => r.id === pickRoute) ?? null)
	const point = $derived(route && pickPoint >= 0 ? (route.points[pickPoint] ?? null) : null)
	const stopRoutes = $derived(stop ? routes.filter((r) => r.from === stop.id || r.to === stop.id) : [])
	const changes = $derived(dirtyStops.length + dirtyRoutes.length + removedStops.length + removedRoutes.length)
	const spawn = $derived(editor.selectedSpawn && editor.selectedSpawn.kind !== 'object' ? editor.selectedSpawn : null)

	const stopName = (id: number) => stops.find((s) => s.id === id)?.name || `stop ${id}`

	async function init() {
		if (!hasBackend()) {
			error = 'Flight paths need the desktop app and a WoW client.'
			loading = false
			return
		}
		try {
			const here = (await engineRef.current?.playerSpot()) ?? null
			mapId = here?.map ?? null
			if (mapId === null) {
				error = 'This map has no client map ID: open a part of Azeroth or a map made for the client.'
				return
			}
			const id = mapId
			const maps = (await MapEntries()) ?? []
			const m = maps.find((x) => x.ID === id)
			mapName = m ? m.Name || m.Dir : `Map ${id}`
			const net = await TaxiNetwork(id)
			stops = (net.nodes ?? []) as Stop[]
			routes = (net.routes ?? []) as Route[]
			nextStop = net.nextNode
			nextRoute = net.nextRoute
			savedStops = new Set(stops.map((s) => s.id))
			savedRoutes = new Set(routes.map((r) => r.id))
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void init()

	const hooks: TaxiHooks = {
		drawing: () => drawing,
		pick(p) {
			if (p.stop !== pickStop) pickStop = p.stop
			pickRoute = p.route
			pickPoint = p.point
		},
		moved(kind, id, index, at) {
			if (kind === 'stop') {
				const s = stops.find((x) => x.id === id)
				if (s) Object.assign(s, { x: at.x, y: at.y, z: at.z })
				touchStop(id)
				return
			}
			const p = routes.find((r) => r.id === id)?.points[index]
			if (p) Object.assign(p, { x: at.x, y: at.y, z: at.z })
			touchRoute(id)
		},
		added(id, index, at) {
			const r = routes.find((x) => x.id === id)
			if (!r) return
			const prev = r.points[index - 1] ?? r.points[0]
			r.points.splice(index, 0, { mapId: prev.mapId, x: at.x, y: at.y, z: at.z, flags: 0, delay: 0 })
			pickPoint = index
			touchRoute(id)
		},
	}

	// The 3D view draws the window's stops and routes as they are edited, the picks highlighted.
	$effect(() => {
		const s = $state.snapshot(stops)
		const r = $state.snapshot(routes)
		engineRef.current?.showTaxi(s, r, { stop: pickStop, route: pickRoute, point: pickPoint }, hooks)
	})

	onDestroy(() => engineRef.current?.endTaxiEdit())

	// A stop or route picked on the map comes into view in its list.
	let body = $state<HTMLElement>()
	$effect(() => {
		void pickStop
		void pickRoute
		void tick().then(() => body?.querySelectorAll('.list .picked').forEach((b) => b.scrollIntoView({ block: 'nearest' })))
	})

	function touchStop(id: number) {
		if (!dirtyStops.includes(id)) dirtyStops = [...dirtyStops, id]
	}
	function touchRoute(id: number) {
		if (!dirtyRoutes.includes(id)) dirtyRoutes = [...dirtyRoutes, id]
	}

	function editStop<K extends keyof Stop>(key: K, value: Stop[K]) {
		if (!stop) return
		stop[key] = value
		touchStop(stop.id)
	}

	function pickStopFromList(id: number) {
		pickStop = id
		if (route && route.from !== id && route.to !== id) {
			pickRoute = null
			pickPoint = -1
			drawing = false
		}
	}

	function pickRouteFromList(id: number) {
		pickRoute = id
		pickPoint = -1
	}

	/** The server point under the camera, or of the selected creature (`atSpawn`). */
	async function spotHere(atSpawn: boolean): Promise<Vec3 | null> {
		const e = engineRef.current
		if (!e) return null
		if (atSpawn && spawn) {
			const o = e.serverOrigin()
			const s = serverSpot(spawn, mapId ?? 0, o.x, o.y)
			return { x: s.x, y: s.y, z: s.z }
		}
		const s = await e.playerSpot()
		return s ? { x: s.x, y: s.y, z: s.z } : null
	}

	async function addStop(atSpawn: boolean) {
		if (mapId === null) return
		const at = await spotHere(atSpawn)
		if (!at) return
		const id = Math.max(nextStop, ...stops.map((s) => s.id + 1), ...removedStops.map((x) => x + 1))
		if (id > MAX_STOP) {
			error = `No stop ID is left: the client knows stops 1 to ${MAX_STOP}.`
			return
		}
		const name = atSpawn && spawn ? spawn.name : 'New flight stop'
		stops = [...stops, { id, mapId, ...at, name, hordeMount: 2224, allianceMount: 541 }]
		touchStop(id)
		pickStopFromList(id)
	}

	function moveStopHere(atSpawn: boolean) {
		const s = stop
		if (!s) return
		void spotHere(atSpawn).then((at) => {
			if (!at) return
			Object.assign(s, at)
			touchStop(s.id)
		})
	}

	async function removeStop() {
		const s = stop
		if (!s) return
		const own = routes.filter((r) => r.from === s.id || r.to === s.id)
		if (own.length && !(await askConfirm(`Delete ${s.name} and its ${own.length} route${own.length === 1 ? '' : 's'}?`, { title: 'Delete flight stop', ok: 'Delete' }))) return
		for (const r of own) dropRoute(r.id)
		stops = stops.filter((x) => x.id !== s.id)
		dirtyStops = dirtyStops.filter((x) => x !== s.id)
		if (savedStops.has(s.id)) removedStops = [...removedStops, s.id]
		pickStop = null
	}

	function dropRoute(id: number) {
		routes = routes.filter((r) => r.id !== id)
		dirtyRoutes = dirtyRoutes.filter((x) => x !== id)
		if (savedRoutes.has(id)) removedRoutes = [...removedRoutes, id]
		if (pickRoute === id) {
			pickRoute = null
			pickPoint = -1
			drawing = false
		}
	}

	/** A new route between two stops, from defaultRoute, with a price of a copper for every ten yards. */
	function newRoute(from: Stop, to: Stop, points?: Point[]) {
		if (routes.some((r) => r.from === from.id && r.to === to.id)) {
			error = `There is a route from ${from.name} to ${to.name} already: the server keeps one each way.`
			return
		}
		const id = Math.max(nextRoute, ...routes.map((r) => r.id + 1), ...removedRoutes.map((x) => x + 1))
		const pts = points ?? defaultRoute(from, to).map((p) => ({ mapId: from.mapId, ...p, flags: 0, delay: 0 }))
		const cost = Math.max(10, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 10))
		routes = [...routes, { id, from: from.id, to: to.id, cost, points: pts }]
		touchRoute(id)
		error = ''
		pickRoute = id
		pickPoint = -1
	}

	function addRoute() {
		const to = stops.find((s) => s.id === routeTo)
		if (stop && to) newRoute(stop, to)
	}

	/** The way back: a route from this one's end to its start, through its points the other way. */
	function wayBack() {
		const r = route
		const from = stops.find((s) => s.id === r?.to)
		const to = stops.find((s) => s.id === r?.from)
		if (!r || !from || !to) return
		newRoute(from, to, [...$state.snapshot(r.points)].reverse())
	}

	function deleteRoute() {
		if (route) dropRoute(route.id)
	}

	function deletePoint() {
		const r = route
		if (!r || pickPoint < 0) return
		if (r.points.length <= 2) {
			error = 'A route needs at least two points.'
			return
		}
		r.points.splice(pickPoint, 1)
		pickPoint = Math.min(pickPoint, r.points.length - 1)
		touchRoute(r.id)
	}

	function editPointHeight(z: number) {
		if (!route || !point) return
		point.z = z
		touchRoute(route.id)
	}

	function editCost(cost: number) {
		if (!route) return
		route.cost = Math.max(0, Math.round(cost))
		touchRoute(route.id)
	}

	/** Looks at a server point from 40 yd off, the way the camera flies or follows the ground. */
	function lookAt(p: Vec3) {
		const e = engineRef.current
		if (!e) return
		const o = e.serverOrigin()
		const at = editorPoint(p, o.x, o.y)
		e.controller.focus(at.x, at.z, 40)
	}

	function fly() {
		if (!route) return
		if (ui.taxiFlying) engineRef.current?.stopTaxiFlight()
		else engineRef.current?.flyTaxi($state.snapshot(route.points))
	}

	async function makeFlightMaster() {
		const s = spawn
		if (!s) return
		error = ''
		try {
			const rec = await ReadCreature(s.entry)
			const flags = Number(rec.values['npc_flags'] ?? 0)
			if (flags & FLIGHT_MASTER) {
				setStatus(`${s.name} is a flight master already.`, 6000)
				return
			}
			await SaveCreature(s.entry, rec.patch, { npc_flags: String(flags | FLIGHT_MASTER) })
			setStatus(`${s.name} (${s.entry}) is a flight master now. The server sends a player who talks to one to the nearest stop their side has a mount at.`, 10000)
		} catch (err) {
			error = String(err)
		}
	}

	async function save() {
		if (!changes) return
		saving = true
		const end = startSaving('Saving the flight paths')
		error = ''
		try {
			const edit = vmangos.TaxiEdit.createFrom({
				nodes: $state.snapshot(stops).filter((s) => dirtyStops.includes(s.id)),
				removeNodes: removedStops,
				routes: $state.snapshot(routes).filter((r) => dirtyRoutes.includes(r.id)),
				removeRoutes: removedRoutes,
			})
			const res = await SaveTaxi(edit)
			for (const s of edit.nodes) savedStops.add(s.id)
			for (const r of edit.routes) savedRoutes.add(r.id)
			for (const id of removedStops) savedStops.delete(id)
			for (const id of removedRoutes) savedRoutes.delete(id)
			const n = changes
			dirtyStops = []
			dirtyRoutes = []
			removedStops = []
			removedRoutes = []
			const where = [res.patch ? 'the client' : '', res.server ? "the server's data" : ''].filter(Boolean).join(' and ')
			setStatus(
				`Saved ${n} flight path change${n === 1 ? '' : 's'} to ${where || 'nowhere new (nothing differed)'}.${res.server ? '' : ' Set the VMaNGOS server folder: without the server, nobody can fly them.'}${applyNote(res)}`,
				10000,
			)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	async function close() {
		if (changes && !(await askConfirm('Close without saving the flight path changes?', { title: 'Unsaved changes', ok: 'Close without saving' }))) return
		ui.flightPaths = false
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
		if (ui.taxiFlying) engineRef.current?.stopTaxiFlight()
		else if (drawing) drawing = false
		else return
		e.stopPropagation()
	}

	/** A mount creature typed or picked: an entry the taxi table holds (16 bits). */
	const mountEntry = (v: string) => Math.min(65535, Math.max(0, Math.round(Number(v) || 0)))
	const num = (e: Event) => {
		const v = Number((e.target as HTMLInputElement).value)
		return Number.isFinite(v) ? v : 0
	}
	const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`)
	const sides = (s: Stop) => (s.allianceMount && s.hordeMount ? 'both' : s.allianceMount ? 'Alliance' : s.hordeMount ? 'Horde' : 'nobody')
</script>

<svelte:window onkeydown={onKey} />

<aside class="flight" aria-label="Flight paths">
	<header>
		<span>Flight paths{mapName ? `: ${mapName}` : ''}</span>
		<button class="close" onclick={close} title="Close" aria-label="Close the flight paths">✕</button>
	</header>
	<div class="body" bind:this={body}>
		{#if error}<p class="error">{error}</p>{/if}
		{#if loading}
			<p class="dim">Reading the flight paths…</p>
		{:else if mapId !== null}
			<div class="row">
				<span class="dim grow">{stops.length} stops, {routes.length} routes</span>
				<button onclick={() => void addStop(false)} title="A new stop on the ground under the camera">New stop here</button>
				{#if spawn}<button onclick={() => void addStop(true)} title="A new stop where the selected creature stands, named after it">At {spawn.name}</button>{/if}
			</div>
			<ul class="list" aria-label="Stops">
				{#each stops as s (s.id)}
					<li>
						<button class:picked={pickStop === s.id} class:dirty={dirtyStops.includes(s.id)} onclick={() => pickStopFromList(s.id)}>
							<span class="dot {sides(s)}"></span>{s.name}<span class="id">{s.id}</span>
						</button>
					</li>
				{:else}
					<li class="dim">No stops on this map yet.</li>
				{/each}
			</ul>

			{#if stop}
				<div class="form">
					<label class="k" for="fp-name">Name</label>
					<input id="fp-name" maxlength="256" value={stop.name} oninput={(e) => editStop('name', (e.target as HTMLInputElement).value)} />
					<span class="k">Position</span>
					<span class="row">
						<input type="number" step="any" value={stop.x} oninput={(e) => editStop('x', num(e))} aria-label="X" />
						<input type="number" step="any" value={stop.y} oninput={(e) => editStop('y', num(e))} aria-label="Y" />
						<input type="number" step="any" value={stop.z} oninput={(e) => editStop('z', num(e))} aria-label="Z" />
					</span>
					<span></span>
					<span class="row">
						<button onclick={() => moveStopHere(false)}>To the camera</button>
						{#if spawn}<button onclick={() => moveStopHere(true)}>To {spawn.name}</button>{/if}
						<button onclick={() => lookAt(stop)}>Look at it</button>
					</span>
					<label class="k" for="fp-ally">Alliance</label>
					<span class="row">
						<select id="fp-ally" value={stop.allianceMount} onchange={(e) => editStop('allianceMount', Number((e.target as HTMLSelectElement).value))}>
							<option value={0}>Can't fly here</option>
							{#each ALLIANCE_MOUNTS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
							{#if stop.allianceMount && !ALLIANCE_MOUNTS.some((m) => m.id === stop.allianceMount)}<option value={stop.allianceMount}>Creature {stop.allianceMount}</option>{/if}
						</select>
					</span>
					<RefField
						f={{ col: 'allianceMount', label: 'Alliance mount creature', ref: 'creature', hint: 'The creature the flight is ridden on' }}
						value={String(stop.allianceMount)}
						changed={false}
						bare
						onset={(v) => editStop('allianceMount', mountEntry(v))}
					/>
					<label class="k" for="fp-horde">Horde</label>
					<span class="row">
						<select id="fp-horde" value={stop.hordeMount} onchange={(e) => editStop('hordeMount', Number((e.target as HTMLSelectElement).value))}>
							<option value={0}>Can't fly here</option>
							{#each HORDE_MOUNTS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
							{#if stop.hordeMount && !HORDE_MOUNTS.some((m) => m.id === stop.hordeMount)}<option value={stop.hordeMount}>Creature {stop.hordeMount}</option>{/if}
						</select>
					</span>
					<RefField
						f={{ col: 'hordeMount', label: 'Horde mount creature', ref: 'creature', hint: 'The creature the flight is ridden on' }}
						value={String(stop.hordeMount)}
						changed={false}
						bare
						onset={(v) => editStop('hordeMount', mountEntry(v))}
					/>
					<span class="k">Routes</span>
					<span class="row">
						<select bind:value={routeTo} aria-label="To stop">
							<option value={-1}>New route to…</option>
							{#each stops.filter((s) => s.id !== stop.id) as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
						</select>
						<button onclick={addRoute} disabled={routeTo < 0}>Add</button>
						<button class="danger" onclick={removeStop}>Delete stop</button>
					</span>
				</div>
				<ul class="list short" aria-label="Routes">
					{#each stopRoutes as r (r.id)}
						<li>
							<button class:picked={pickRoute === r.id} class:dirty={dirtyRoutes.includes(r.id)} onclick={() => pickRouteFromList(r.id)}>
								{r.from === stop.id ? `→ ${stopName(r.to)}` : `← ${stopName(r.from)}`}<span class="id">{r.id} · <Money copper={r.cost} size={11} /></span>
							</button>
						</li>
					{:else}
						<li class="dim">No routes from or to {stop.name}.</li>
					{/each}
				</ul>
			{/if}

			{#if route}
				<div class="form">
					<span class="k">Route {route.id}</span>
					<span class="dim">{stopName(route.from)} to {stopName(route.to)}: {route.points.length} points, {duration(flightSeconds(route.points))}</span>
					<label class="k" for="fp-cost">Price</label>
					<MoneyField id="fp-cost" value={route.cost} onset={editCost} />
					<span></span>
					<span class="row">
						<button class:active={drawing} onclick={() => (drawing = !drawing)} title="Clicks on the map add a point after the picked one, at its height">{drawing ? 'Drawing…' : 'Draw points'}</button>
						<button onclick={fly} title="Ride the camera along the route at a flight's speed (Esc stops)">{ui.taxiFlying ? 'Stop' : 'Fly it'}</button>
						<button onclick={wayBack} title="A route back from its end to its start, through its points the other way">Way back</button>
					</span>
					{#if point}
						<label class="k" for="fp-height">Point {pickPoint + 1} height</label>
						<span class="row">
							<input id="fp-height" type="number" step="any" value={Math.round(point.z * 10) / 10} oninput={(e) => editPointHeight(num(e))} />
							<button onclick={deletePoint}>Delete point</button>
						</span>
					{/if}
					<span></span>
					<span class="row"><button class="danger" onclick={deleteRoute}>Delete route</button></span>
				</div>
			{/if}

			<p class="dim help">Drag a stop's marker over the ground. Pick a route, then drag its points (Shift+drag for height) or Draw points; the curve turns red where it runs under the ground. Each way is a route of its own.</p>
			<div class="row">
				<span class="dim grow">{spawn ? `Flight master: ${spawn.name}` : 'Select a creature to make it the flight master.'}</span>
				<button onclick={() => void makeFlightMaster()} disabled={!spawn} title="Give the creature's template the flight master flag (npc_flags 8) in the world database">Make flight master</button>
			</div>
		{/if}
	</div>
	<footer>
		<span class="dim grow">Save writes the client's taxi tables (the game reads them when it starts) and the server's (the world server, when it starts).</span>
		<button class="active" onclick={() => void save()} disabled={!changes || saving}>{saving ? 'Saving…' : `Save${changes ? ` (${changes})` : ''}`}</button>
	</footer>
</aside>

<style>
	.flight {
		position: fixed;
		top: 96px;
		left: 52px;
		width: 360px;
		max-height: calc(100 * var(--vh) - 160px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
		font-size: 12px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	header span {
		flex: 1;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.body {
		padding: 8px 10px;
		overflow-y: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* The body scrolls; its lists and forms keep their height rather than shrink to fit. */
	.body > * {
		flex: none;
	}
	footer {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 6px 10px 8px;
		border-top: 1px solid var(--border);
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.help {
		margin: 0;
		line-height: 1.35;
	}
	.grow {
		flex: 1;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.row input,
	.row select {
		flex: 1;
		min-width: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		max-height: 180px;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.list.short {
		max-height: 120px;
	}
	.list button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: 3px 8px;
	}
	.list button.picked {
		background: var(--panel-3);
	}
	.list button.dirty {
		font-style: italic;
	}
	.list li.dim {
		padding: 3px 8px;
	}
	.id {
		margin-left: auto;
		color: var(--text-dim);
		font-size: 11px;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #8a8a8a;
	}
	.dot.both {
		background: #7ee081;
	}
	.dot.Alliance {
		background: #4d8dff;
	}
	.dot.Horde {
		background: #ff5a4d;
	}
	.form {
		display: grid;
		grid-template-columns: 92px 1fr;
		gap: 5px 8px;
		align-items: center;
	}
	.danger {
		margin-left: auto;
	}
	button.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
