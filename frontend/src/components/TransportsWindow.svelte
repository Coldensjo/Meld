<script lang="ts">
	import { onDestroy, tick } from 'svelte'
	import { MapEntries, Transports } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { displayName } from '../lib/models/assets'
	import { DOCK, TransportMotion } from '../lib/world/transportRoute'
	import type { TransportHooks } from '../lib/engine/TransportView'
	import type { Vec3 } from '../lib/world/taxiRoute'

	// World › Transports (#954): the boats and zeppelins whose routes touch the open map, read from the
	// world database's type 15 game objects and `transports` rows and the client's taxi paths
	// (App.Transports). The 3D view draws their routes and docks here; a click on one picks it, as a
	// pick in the list does. The picked one shows its entry, model, period, path, speed and docks, and
	// Sail plays its model along the route on this map as the server times it (the other maps'
	// stretches skipped), round and round until Stop or Esc. Read only: making and editing routes is #955.

	let mapId = $state<number | null>(null)
	let mapName = $state('')
	let maps = $state<Map<number, string>>(new Map())
	let list = $state.raw<vmangos.Transport[]>([])
	let picked = $state<number | null>(null)
	let error = $state('')
	let loading = $state(true)
	let rate = $state(1)
	let follow = $state(true)

	const transport = $derived(list.find((t) => t.entry === picked) ?? null)
	/** The picked transport's round trip as the server times it. */
	const motion = $derived(transport ? new TransportMotion(transport.legs, transport.speed, transport.accel) : null)
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
			picked = entry
		},
	}

	// The 3D view draws the list, the pick highlighted.
	$effect(() => {
		engineRef.current?.showTransports(list, picked, hooks)
	})

	onDestroy(() => engineRef.current?.endTransportsEdit())

	// A transport picked on the map comes into view in the list.
	let body = $state<HTMLElement>()
	$effect(() => {
		void picked
		void tick().then(() => body?.querySelectorAll('.list .picked').forEach((b) => b.scrollIntoView({ block: 'nearest' })))
	})

	function pick(entry: number) {
		if (ui.transportSailing !== null && ui.transportSailing !== entry) engineRef.current?.stopTransportSail()
		picked = entry
	}

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

	function close() {
		ui.transports = false
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || ui.transportSailing === null || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
		engineRef.current?.stopTransportSail()
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
			<ul class="list" aria-label="Transports">
				{#each list as t (t.entry)}
					<li>
						<button class:picked={picked === t.entry} onclick={() => pick(t.entry)}>
							{t.name}<span class="id">{t.entry}</span>
						</button>
					</li>
				{:else}
					<li class="dim">No boat or zeppelin sails on this map.</li>
				{/each}
			</ul>

			{#if transport && motion}
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
				<ul class="list short" aria-label="Docks">
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
				</div>
			{/if}
			<p class="dim help">
				Every type 15 game object sails the taxi path in its data0 (TaxiPathNode.dbc); the docks are the path's points with flags {DOCK}. The routes and docks drawn are those on this map; a click on one picks its transport. Read
				only: the world server reads them when it starts.
			</p>
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
