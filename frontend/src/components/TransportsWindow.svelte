<script lang="ts">
	import { onDestroy, tick } from 'svelte'
	import { DeleteTransport, MapEntries, NewTransportIDs, ObjectModel, SaveTransport, Transports } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { askConfirm } from '../lib/state/confirm'
	import { startSaving } from '../lib/state/saving'
	import { hasBackend } from '../lib/io/backend'
	import { applyNote } from '../lib/io/applyNote'
	import { displayName } from '../lib/models/assets'
	import { defaultTransportRoute, DOCK, JUMP, TransportMotion, transportLegs, type PathPoint } from '../lib/world/transportRoute'
	import type { TransportHooks } from '../lib/engine/TransportView'
	import type { TaxiHooks } from '../lib/world/TaxiLayer'
	import type { Vec3 } from '../lib/world/taxiRoute'

	// World › Transports (#954): the boats and zeppelins whose routes touch the open map, read from the
	// world database's type 15 game objects and `transports` rows and the client's taxi paths
	// (App.Transports). The 3D view draws their routes and docks here; a click on one picks it, as a
	// pick in the list does. The picked one shows its entry, model, period, path, speed and docks, and
	// Sail plays its model along the route on this map as the server times it (the other maps'
	// stretches skipped), round and round until Stop or Esc.
	//
	// New transport and Edit (#955) make a draft of a transport: its names, model, size, speed and
	// acceleration, and its whole taxi path, which the 3D view edits as the Flight Paths window edits a
	// route (TaxiEditing: a point drags level, with Shift up and down; with Draw a click adds a point
	// after the picked one). A point is made a dock with its wait, and Go on to another map adds a
	// stretch on another continent, edited with that map open. Save writes the template, the transports
	// row (with the client's period) and the path (SaveTransport). A form saved with Save, as the Flight
	// Paths window is: not undo steps (decision #83). Delete (#1039, asked to confirm) takes the picked
	// one out: its template and transports rows, and its path unless another transport sails it
	// (DeleteTransport).

	let mapId = $state<number | null>(null)
	let mapName = $state('')
	let maps = $state<Map<number, string>>(new Map())
	let list = $state.raw<vmangos.Transport[]>([])
	let picked = $state<number | null>(null)
	let error = $state('')
	let loading = $state(true)
	let rate = $state(1)
	let follow = $state(true)
	/** Each map's instance type (Map.dbc's; 0 a continent), by ID. */
	let mapTypes = $state<Map<number, number>>(new Map())

	/** A transport being made or edited: what Save writes. */
	interface Draft {
		isNew: boolean
		entry: number
		name: string
		object: string
		displayId: number
		model: string
		size: number
		speed: number
		accel: number
		pathId: number
		points: PathPoint[]
	}
	let draft = $state<Draft | null>(null)
	let dirty = $state(false)
	let pickPoint = $state(-1)
	let drawing = $state(false)
	let saving = $state(false)
	let note = $state('')
	let continueTo = $state(-1)

	/** The ship and zeppelin displays the client's own transports use. */
	const SHIP = 3015
	const ZEPPELIN = 3031

	/** A draft as the layer draws it and the preview sails it. */
	const asTransport = (d: Draft): vmangos.Transport => ({
		entry: d.entry,
		name: d.name,
		object: d.object,
		period: 0,
		pathId: d.pathId,
		speed: d.speed,
		accel: d.accel,
		displayId: d.displayId,
		model: d.model,
		size: d.size,
		legs: transportLegs(d.points),
		points: d.points,
		clientPeriod: 0,
	})

	const transport = $derived(draft ? asTransport(draft) : (list.find((t) => t.entry === picked) ?? null))
	/** The picked transport's round trip as the server times it. */
	const motion = $derived(transport?.legs?.length ? new TransportMotion(transport.legs, transport.speed, transport.accel) : null)
	const point = $derived(draft && pickPoint >= 0 ? (draft.points[pickPoint] ?? null) : null)
	/** The draft's points in runs on one map each: the stretches the route sails, with the points either side of a change. */
	const runs = $derived.by(() => {
		const out: { mapId: number; from: number; to: number }[] = []
		draft?.points.forEach((p, i) => {
			const last = out.at(-1)
			if (last && last.mapId === p.mapId) last.to = i
			else out.push({ mapId: p.mapId, from: i, to: i })
		})
		return out
	})
	/** The continents a route may go on to from the picked point's map. */
	const continents = $derived([...mapTypes].filter(([id, type]) => type === 0 && id !== point?.mapId).map(([id]) => id))
	/** Displays to pick the model from: the ship and the zeppelin, and those of the transports listed. */
	const displays = $derived.by(() => {
		const out = new Map<number, string>([
			[SHIP, 'Ship'],
			[ZEPPELIN, 'Zeppelin'],
		])
		for (const t of list) if (!out.has(t.displayId)) out.set(t.displayId, t.model ? displayName(t.model) : `Display ${t.displayId}`)
		if (draft && !out.has(draft.displayId)) out.set(draft.displayId, draft.model ? displayName(draft.model) : `Display ${draft.displayId}`)
		return [...out]
	})
	const docks = $derived(motion ? motion.docks().map((d) => ({ ...d, mapId: motion.legs[d.leg].mapId })) : [])

	const mapLabel = (id: number) => maps.get(id) ?? `map ${id}`
	const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`)
	/** The maps a route sails on, in its order, each once in a row. */
	const course = (t: vmangos.Transport) => t.legs.map((l) => l.mapId).filter((m, i, all) => i === 0 || all[i - 1] !== m)

	async function init() {
		if (!hasBackend()) {
			error = 'Transports need the desktop app, a WoW client and the VMaNGOS server.'
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
			const entries = (await MapEntries()) ?? []
			maps = new Map(entries.map((m) => [m.ID, m.Name || m.Dir]))
			mapTypes = new Map(entries.map((m) => [m.ID, m.Type]))
			mapName = mapLabel(mapId)
			list = (await Transports(mapId)) ?? []
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void init()

	const hooks: TransportHooks = {
		pick(entry) {
			// While a draft is edited, a click picks its points, not another transport.
			if (!draft) picked = entry
		},
	}

	// The 3D view draws the list, the pick highlighted; a draft in place of the transport it edits.
	$effect(() => {
		const d = draft ? asTransport($state.snapshot(draft) as Draft) : null
		const shown = d ? [...list.filter((t) => t.entry !== d.entry), d] : list
		engineRef.current?.showTransports(shown, d ? d.entry : picked, hooks)
	})

	// The draft's path is edited on the map as the Flight Paths window edits a route; that window, while
	// open, has the map's routes to itself.
	const taxiHooks: TaxiHooks = {
		drawing: () => drawing,
		pick(p) {
			pickPoint = p.point
		},
		moved(kind, _route, index, at) {
			const q = draft?.points[index]
			if (kind !== 'point' || !q) return
			Object.assign(q, { x: at.x, y: at.y, z: at.z })
			dirty = true
		},
		added(_route, index, at) {
			if (!draft) return
			const prev = draft.points[index - 1] ?? draft.points[0]
			draft.points.splice(index, 0, { mapId: prev.mapId, x: at.x, y: at.y, z: at.z, flags: 0, delay: 0 })
			pickPoint = index
			dirty = true
		},
	}
	let taxiShown = false
	$effect(() => {
		const e = engineRef.current
		if (!draft || ui.flightPaths) {
			if (taxiShown && !ui.flightPaths) e?.endTaxiEdit()
			taxiShown = false
			return
		}
		const route = { id: draft.pathId, from: 0, to: 0, points: $state.snapshot(draft.points) as PathPoint[] }
		e?.showTaxi([], [route], { stop: null, route: draft.pathId, point: pickPoint }, taxiHooks)
		taxiShown = true
	})

	onDestroy(() => {
		const e = engineRef.current
		if (taxiShown) e?.endTaxiEdit()
		e?.endTransportsEdit()
	})

	// A transport picked on the map comes into view in the list.
	let body = $state<HTMLElement>()
	$effect(() => {
		void picked
		void tick().then(() => body?.querySelectorAll('.list .picked').forEach((b) => b.scrollIntoView({ block: 'nearest' })))
	})

	function pick(entry: number) {
		if (draft) return
		if (ui.transportSailing !== null && ui.transportSailing !== entry) engineRef.current?.stopTransportSail()
		picked = entry
	}

	/** Drops the draft, asking first when it has unsaved changes; false when the author keeps it. */
	async function leaveDraft(): Promise<boolean> {
		if (!draft) return true
		if (dirty && !(await askConfirm('Drop the unsaved changes to the transport?', { title: 'Unsaved changes', ok: 'Drop them' }))) return false
		engineRef.current?.stopTransportSail()
		draft = null
		dirty = false
		drawing = false
		pickPoint = -1
		return true
	}

	/** Refused while the Flight Paths window is open: both edit their routes on the map. */
	function flightPathsOpen(): boolean {
		if (!ui.flightPaths) return false
		error = 'Close the Flight Paths window first: it edits its routes on the map too.'
		return true
	}

	async function newTransport() {
		if (flightPathsOpen() || !(await leaveDraft())) return
		error = ''
		note = ''
		try {
			const here = (await engineRef.current?.playerSpot()) ?? null
			if (!here || mapId === null) return
			const ids = await NewTransportIDs()
			const model = (await ObjectModel(SHIP)) ?? ''
			engineRef.current?.stopTransportSail()
			draft = {
				isNew: true,
				entry: ids.entry,
				pathId: ids.pathId,
				name: 'New ferry',
				object: 'New ferry',
				displayId: SHIP,
				model,
				size: 1,
				speed: 30,
				accel: 1,
				points: defaultTransportRoute(here, mapId),
			}
			dirty = true
			pickPoint = -1
		} catch (err) {
			error = String(err)
		}
	}

	function editTransport() {
		const t = transport
		if (!t || draft || flightPathsOpen()) return
		engineRef.current?.stopTransportSail()
		error = ''
		note = ''
		draft = {
			isNew: false,
			entry: t.entry,
			name: t.name,
			object: t.object,
			displayId: t.displayId,
			model: t.model,
			size: t.size > 0 ? t.size : 1,
			speed: Math.max(1, Math.round(t.speed)),
			accel: Math.max(1, Math.round(t.accel)),
			pathId: t.pathId,
			points: (t.points ?? []).map((p) => ({ ...p })),
		}
		dirty = false
		pickPoint = -1
	}

	/** Changes the draft and marks it unsaved. */
	function edit(change: (d: Draft) => void) {
		if (!draft) return
		change(draft)
		dirty = true
	}

	async function setDisplay(id: number) {
		if (!draft || !Number.isInteger(id) || id <= 0) return
		edit((d) => (d.displayId = id))
		try {
			const model = (await ObjectModel(id)) ?? ''
			if (draft?.displayId === id) draft.model = model
		} catch {
			if (draft?.displayId === id) draft.model = ''
		}
	}

	function setDock(on: boolean) {
		edit((d) => {
			const p = d.points[pickPoint]
			if (!p) return
			p.flags = on ? (p.flags & ~JUMP) | DOCK : p.flags & ~DOCK
			p.delay = on ? p.delay || 30 : 0
		})
	}

	function deletePoint() {
		if (!draft || pickPoint < 0) return
		if (draft.points.length <= 4) {
			error = 'A route needs at least four points.'
			return
		}
		edit((d) => d.points.splice(pickPoint, 1))
		pickPoint = Math.min(pickPoint, (draft?.points.length ?? 0) - 1)
	}

	/** Goes on to map `to` after the picked point: four points there (the first and last the stretch's ends), placed from the picked one's spot, to move where they belong with that map open. */
	function continueOn(to: number) {
		const p = point
		if (!draft || !p || to < 0) return
		const at = pickPoint
		edit((d) => d.points.splice(at + 1, 0, ...[0, 1, 2, 3].map((i) => ({ mapId: to, x: p.x + i * 100, y: p.y, z: p.z, flags: 0, delay: 0 }))))
		continueTo = -1
		note = `The route goes on to ${mapLabel(to)} after point ${at + 1}, and comes back here after that stretch. Save, then open ${mapLabel(to)} to move its stretch where it belongs.`
	}

	/** Takes the stretch of points `run` out of the route. */
	function removeRun(run: { from: number; to: number }) {
		if (!draft) return
		if (draft.points.length - (run.to - run.from + 1) < 4) {
			error = 'A route needs at least four points.'
			return
		}
		edit((d) => d.points.splice(run.from, run.to - run.from + 1))
		pickPoint = -1
	}

	async function save() {
		const d = draft
		if (!d || mapId === null) return
		saving = true
		const end = startSaving('Saving the transport')
		error = ''
		try {
			const edit: vmangos.TransportEdit = {
				entry: d.entry,
				name: d.name.trim(),
				object: d.object.trim(),
				displayId: d.displayId,
				size: d.size,
				speed: d.speed,
				accel: d.accel,
				pathId: d.pathId,
				points: $state.snapshot(d.points),
			}
			const res = await SaveTransport(edit)
			dirty = false
			const route = [res.patch ? 'the client' : '', res.server ? "the server's data" : ''].filter(Boolean).join(' and ')
			const after = res.restart ? '' : ' The world server reads transports only when it starts.'
			note = `Saved ${edit.name} (${edit.entry}, path ${edit.pathId}, a round trip of ${duration(res.period / 1000)}) into the world database${route ? `, and its route into ${route}` : ''}.${after}${applyNote(res)}`
			setStatus(note, 12000)
			engineRef.current?.stopTransportSail()
			draft = null
			drawing = false
			pickPoint = -1
			list = (await Transports(mapId)) ?? []
			picked = edit.entry
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	async function remove() {
		const t = transport
		if (!t || draft || mapId === null) return
		const ask = `Delete ${t.name} (game object ${t.entry})? Its gameobject_template and transports rows go out of the world database, and its path ${t.pathId} out of the client's and the server's taxi tables unless another transport sails it.`
		if (!(await askConfirm(ask, { title: 'Delete the transport', ok: 'Delete' }))) return
		saving = true
		const end = startSaving('Deleting the transport')
		error = ''
		try {
			engineRef.current?.stopTransportSail()
			const res = await DeleteTransport(t.entry)
			const route = [res.patch ? 'the client' : '', res.server ? "the server's data" : ''].filter(Boolean).join(' and ')
			const path = res.pathShared ? ` Its path ${res.pathId} stays: another transport sails it.` : route ? ` Its path ${res.pathId} is out of ${route}.` : ''
			const after = res.restart ? '' : ' The world server reads transports only when it starts.'
			note = `Deleted ${t.name} (${t.entry}) from the world database.${path}${after}${applyNote(res)}`
			setStatus(note, 12000)
			picked = null
			list = (await Transports(mapId)) ?? []
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	const whole = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)))
	const value = (e: Event) => (e.target as HTMLInputElement).value

	function lookAt(p: Vec3) {
		const e = engineRef.current
		if (!e) return
		const at = e.transportLayer.editor(p)
		e.controller.focus(at.x, at.z, 160)
	}

	function sail() {
		const e = engineRef.current
		if (!e || !transport) return
		if (ui.transportSailing !== null) {
			e.stopTransportSail()
			return
		}
		if (!e.sailTransport(transport, { rate, follow })) error = `${transport.name} doesn't sail on ${mapName}.`
	}

	function setRate(v: number) {
		rate = v
		engineRef.current?.setSailRate(v)
	}

	async function close() {
		if (await leaveDraft()) ui.transports = false
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
		if (ui.transportSailing !== null) engineRef.current?.stopTransportSail()
		else if (drawing) drawing = false
		else return
		e.stopPropagation()
	}
</script>

<svelte:window onkeydown={onKey} />

<aside class="transports" aria-label="Transports">
	<header>
		<span>Transports{mapName ? `: ${mapName}` : ''}</span>
		<button class="close" onclick={close} title="Close" aria-label="Close the transports">✕</button>
	</header>
	<div class="body" bind:this={body}>
		{#if error}<p class="error">{error}</p>{/if}
		{#if loading}
			<p class="dim">Reading the boats and zeppelins…</p>
		{:else if mapId !== null}
			<div class="row">
				<span class="dim grow">{list.length} {list.length === 1 ? 'transport sails' : 'transports sail'} here</span>
				<button onclick={() => void newTransport()} disabled={saving} title="A new boat or zeppelin, its route starting under the camera">New transport</button>
			</div>
			{#if note}<p class="note">{note}</p>{/if}
			<ul class="list" aria-label="Transports">
				{#each list as t (t.entry)}
					<li>
						<button class:picked={(draft ? draft.entry : picked) === t.entry} disabled={draft !== null && draft.entry !== t.entry} onclick={() => pick(t.entry)}>
							{t.name}<span class="id">{t.entry}</span>
						</button>
					</li>
				{:else}
					<li class="dim">No boat or zeppelin sails on this map.</li>
				{/each}
			</ul>

			{#if draft}
				<div class="form" role="group" aria-label="Transport">
					<label class="k" for="tr-name">Name</label>
					<input id="tr-name" value={draft.name} oninput={(e) => edit((d) => (d.name = value(e)))} title="The transports row's name: where it sails between" />
					<label class="k" for="tr-object">Object</label>
					<input id="tr-object" maxlength="100" value={draft.object} oninput={(e) => edit((d) => (d.object = value(e)))} title="The game object's name: the ship's or the zeppelin's own" />
					<span class="k">Entry</span>
					<span>{draft.entry} <span class="dim">(path {draft.pathId}{draft.isNew ? ', both new' : ''})</span></span>
					<label class="k" for="tr-model">Model</label>
					<span class="row">
						<select id="tr-model" class="grow" value={draft.displayId} onchange={(e) => void setDisplay(Number((e.target as HTMLSelectElement).value))}>
							{#each displays as [id, label] (id)}<option value={id}>{label}</option>{/each}
						</select>
						<input
							class="num"
							type="number"
							min="1"
							step="1"
							value={draft.displayId}
							onchange={(e) => void setDisplay(whole(value(e), 1, 16777215))}
							aria-label="Display"
							title="The game object display (GameObjectDisplayInfo.dbc)"
						/>
					</span>
					<label class="k" for="tr-size">Size</label>
					<input id="tr-size" class="num" type="number" min="0.1" step="0.1" value={draft.size} oninput={(e) => edit((d) => (d.size = Math.max(0.1, Number(value(e)) || 1)))} />
					<label class="k" for="tr-speed">Speed</label>
					<span class="row">
						<input id="tr-speed" class="num" type="number" min="1" max="1000" step="1" value={draft.speed} oninput={(e) => edit((d) => (d.speed = whole(value(e), 1, 1000)))} />
						<span>yd/s, speeding up at</span>
						<input class="num" type="number" min="1" max="1000" step="1" value={draft.accel} oninput={(e) => edit((d) => (d.accel = whole(value(e), 1, 1000)))} aria-label="Acceleration" />
						<span>yd/s²</span>
					</span>
					<span class="k">Round trip</span>
					<span>{motion ? `about ${duration(motion.cycle)}` : 'none: the route needs more points'} <span class="dim">(Save writes the client's own)</span></span>
				</div>
				<div class="row">
					<button class:active={drawing} onclick={() => (drawing = !drawing)} title="Clicks on the map add a point after the picked one, at its height (Esc stops)">Draw</button>
					<button class:active={ui.transportSailing === draft.entry} disabled={!motion} onclick={sail} title="Sail the model along the route on this map, as it stands (Esc stops)"
						>{ui.transportSailing === draft.entry ? 'Stop' : 'Sail'}</button
					>
					<select value={rate} onchange={(e) => setRate(Number((e.target as HTMLSelectElement).value))} aria-label="Speed">
						<option value={1}>Its own speed</option>
						<option value={4}>4× faster</option>
						<option value={16}>16× faster</option>
					</select>
				</div>
				<ul class="list" aria-label="Stretches">
					{#each runs as r (r.from)}
						<li>
							<span class="dock">
								<span class="grow">{mapLabel(r.mapId)}: points {r.from + 1} to {r.to + 1}</span>
								{#if r.mapId !== mapId}<button onclick={() => removeRun(r)} title="Take this stretch out of the route">Remove</button>{/if}
							</span>
						</li>
					{/each}
				</ul>
				{#if point}
					<div class="form" role="group" aria-label="Point">
						<span class="k">Point</span>
						<span>{pickPoint + 1} of {draft.points.length} on {mapLabel(point.mapId)}{pickPoint === 0 || pickPoint === draft.points.length - 1 ? ': it only shapes the curve' : ''}</span>
						<span class="k">Dock</span>
						<span class="row">
							<label class="row"><input type="checkbox" checked={(point.flags & DOCK) !== 0} onchange={(e) => setDock((e.target as HTMLInputElement).checked)} /> waits</label>
							<input
								class="num"
								type="number"
								min="0"
								max="3600"
								step="1"
								value={point.delay}
								disabled={!(point.flags & DOCK)}
								oninput={(e) => edit((d) => (d.points[pickPoint].delay = whole(value(e), 0, 3600)))}
								aria-label="Wait"
							/>
							<span>s</span>
						</span>
						<label class="k" for="tr-z">Height</label>
						<input id="tr-z" class="num" type="number" step="any" value={point.z} oninput={(e) => edit((d) => (d.points[pickPoint].z = Number(value(e)) || 0))} />
						<span></span>
						<span class="row">
							<button onclick={() => point && lookAt(point)} disabled={point.mapId !== mapId}>Look at it</button>
							<button onclick={deletePoint}>Delete point</button>
						</span>
						<span class="k">Go on to</span>
						<span class="row">
							<select class="grow" bind:value={continueTo} aria-label="Map">
								<option value={-1}>Another continent…</option>
								{#each continents as id (id)}<option value={id}>{mapLabel(id)}</option>{/each}
							</select>
							<button disabled={continueTo < 0} onclick={() => continueOn(continueTo)} title="After this point the route sails on the other map, then comes back here">Add</button>
						</span>
					</div>
				{:else}
					<p class="dim help">Pick a point of the route on the map to make it a dock, change its height or go on to another map from it. A point drags level, with Shift up and down.</p>
				{/if}
				<div class="row end">
					<button onclick={() => void leaveDraft()} disabled={saving}>Cancel</button>
					<button class="active" disabled={saving || !dirty} onclick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
				</div>
				<p class="dim help">
					Save writes the game object (type 15: data0 its path, data1 its speed, data2 its acceleration) and its transports row, with the round trip the client works out, into the world database, and the path into the client's and
					the server's TaxiPath.dbc and TaxiPathNode.dbc. The first and last points only shape the curve; after the last it jumps back to the start. The world server reads transports only when it starts.
				</p>
			{:else if transport && motion}
				<div class="form">
					<span class="k">Object</span>
					<span class="row">
						<span class="grow">{transport.object} <span class="dim">({transport.entry})</span></span>
						<button onclick={() => (ui.objectEditor = { key: null, entry: transport.entry })} title="Open its gameobject_template row in the game object editor">Open</button>
					</span>
					<span class="k">Model</span>
					<span>{transport.model ? displayName(transport.model) : 'none'} <span class="dim">(display {transport.displayId})</span></span>
					<span class="k">Period</span>
					<span>
						{#if transport.period}{duration(transport.period / 1000)} <span class="dim">(the transports row; the route works out to {duration(motion.cycle)})</span>
						{:else}{duration(motion.cycle)} <span class="dim">(worked out from the route: no transports row sets it)</span>{/if}
					</span>
					<span class="k">Path</span>
					<span>{transport.pathId} <span class="dim">({Math.round(motion.length)} yd)</span></span>
					<span class="k">Speed</span>
					<span>{transport.speed} yd/s <span class="dim">(speeding up at {transport.accel} yd/s²)</span></span>
					<span class="k">Sails on</span>
					<span>{course(transport).map(mapLabel).join(' → ')}{course(transport).length > 1 ? ', and back to the start' : ''}</span>
				</div>
				<ul class="list" aria-label="Docks">
					{#each docks as d, i (i)}
						<li>
							<span class="dock">
								<span class="grow">Dock {i + 1} on {mapLabel(d.mapId)}: waits {duration(d.point.delay)}</span>
								{#if d.mapId === mapId}<button onclick={() => lookAt(d.point)} title="Look at the dock from above">Look at it</button>{/if}
							</span>
						</li>
					{:else}
						<li class="dim">No dock: it never stops.</li>
					{/each}
				</ul>
				<div class="row">
					<button class:active={ui.transportSailing === transport.entry} onclick={sail} title="Sail its model along the route on this map as the server times it, round and round (Esc stops)"
						>{ui.transportSailing === transport.entry ? 'Stop' : 'Sail'}</button
					>
					<label class="row"><input type="checkbox" bind:checked={follow} disabled={ui.transportSailing !== null} /> Follow it</label>
					<select value={rate} onchange={(e) => setRate(Number((e.target as HTMLSelectElement).value))} aria-label="Speed">
						<option value={1}>Its own speed</option>
						<option value={4}>4× faster</option>
						<option value={16}>16× faster</option>
					</select>
					<button onclick={editTransport} title="Edit its route, docks, waits, speed and model">Edit</button>
					<button onclick={() => void remove()} disabled={saving} title="Take it out of the world database, and its path out of the taxi tables unless another transport sails it">Delete</button>
				</div>
			{/if}
			{#if !draft}
				<p class="dim help">
					Every type 15 game object sails the taxi path in its data0 (TaxiPathNode.dbc); the docks are the path's points with flags {DOCK}. The routes and docks drawn are those on this map; a click on one picks its transport. The
					world server reads them when it starts.
				</p>
			{/if}
		{/if}
	</div>
</aside>

<style>
	.transports {
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
		z-index: var(--z-window);
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
	.body > * {
		flex: none;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
	.note {
		margin: 0;
		line-height: 1.35;
	}
	.end {
		justify-content: flex-end;
	}
	.num {
		width: 64px;
	}
	.list button:disabled {
		opacity: 0.5;
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
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
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
	.list li.dim {
		padding: 3px 8px;
	}
	.dock {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
	}
	.id {
		margin-left: auto;
		color: var(--text-dim);
		font-size: 11px;
	}
	.form {
		display: grid;
		grid-template-columns: 76px 1fr;
		gap: 5px 8px;
		align-items: center;
	}
	.k {
		color: var(--text-dim);
	}
	button.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
