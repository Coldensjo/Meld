<script lang="ts">
	import Modal from './Modal.svelte'
	import { AreaTriggers, MapEntries, SaveAreaTriggers } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { untrack } from 'svelte'
	import { docs, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/mapio'
	import { editorPoint, type ServerSpot } from '../lib/io/portCoords'

	// World › Portals (#141): the open map's area triggers (AreaTrigger.dbc) and the teleports the
	// server runs for them (areatrigger_teleport), as a dungeon entrance does. Add one where the
	// camera is, size it, and pick where it sends a player: a spot typed in, or the camera of any open
	// map tab. Save writes the client's table into Meld's patch and the server's tables. A form saved
	// with Save, like Zones: not undo steps.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	/** How many triggers the list shows, nearest the camera first. */
	const LIST_MAX = 200
	/** A new portal's radius, yards: about a dungeon entrance's. */
	const NEW_RADIUS = 5

	let maps = $state<vmangos.MapEntry[]>([])
	let mapId = $state<number | null>(null)
	let triggers = $state<vmangos.AreaTrigger[]>([])
	let nextId = $state(0)
	/** IDs of triggers changed or added since the load, and of removed ones. */
	let dirty = $state<number[]>([])
	let removed = $state<number[]>([])
	let picked = $state<number | null>(null)
	let here = $state<ServerSpot | null>(null)
	let error = $state('')
	let saving = $state(false)
	let loading = $state(true)

	const t = $derived(triggers.find((x) => x.id === picked) ?? null)
	const listed = $derived.by(() => {
		const h = here
		const d = (x: vmangos.AreaTrigger) => (h ? (x.x - h.x) ** 2 + (x.y - h.y) ** 2 + (x.z - h.z) ** 2 : 0)
		return [...triggers].sort((a, b) => d(a) - d(b)).slice(0, LIST_MAX)
	})
	const distance = (x: vmangos.AreaTrigger) => (here ? Math.round(Math.hypot(x.x - here.x, x.y - here.y, x.z - here.z)) : null)
	const mapName = (id: number) => {
		const m = maps.find((x) => x.ID === id)
		return m ? m.Name || m.Dir : `map ${id}`
	}

	async function init() {
		if (!hasBackend()) {
			error = 'Portals need the desktop app and a WoW client.'
			loading = false
			return
		}
		try {
			maps = (await MapEntries()) ?? []
			const e = engineRef.current
			here = (await e?.playerSpot()) ?? null
			mapId = here?.map ?? null
			if (mapId === null) {
				error = 'This map has no client map ID: open a part of Azeroth or a map made for the client.'
				return
			}
			const r = await AreaTriggers(mapId)
			triggers = r.triggers ?? []
			nextId = r.nextId
			picked = listed[0]?.id ?? null
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void init()

	// The 3D view draws the list as it is edited, the picked one highlighted.
	$effect(() => {
		const list = $state.snapshot(triggers)
		engineRef.current?.showTriggers(list, picked)
	})

	// A trigger picked in the viewport is picked here, and the other way round (#307).
	$effect(() => {
		const p = ui.pickedTrigger
		if (p !== null && p !== untrack(() => picked) && untrack(() => triggers).some((x) => x.id === p)) picked = p
	})
	$effect(() => {
		ui.pickedTrigger = picked
	})

	function touch(id: number) {
		if (!dirty.includes(id)) dirty = [...dirty, id]
	}

	function edit<K extends keyof vmangos.AreaTrigger>(key: K, value: vmangos.AreaTrigger[K]) {
		if (!t) return
		t[key] = value
		touch(t.id)
	}

	function editTeleport<K extends keyof vmangos.TriggerTeleport>(key: K, value: vmangos.TriggerTeleport[K]) {
		if (!t?.teleport) return
		t.teleport[key] = value
		touch(t.id)
	}

	function add() {
		if (!here || mapId === null) return
		const id = Math.max(nextId, ...triggers.map((x) => x.id + 1))
		const n = vmangos.AreaTrigger.createFrom({
			id,
			mapId,
			x: here.x,
			y: here.y,
			z: here.z,
			radius: NEW_RADIUS,
			boxX: 0,
			boxY: 0,
			boxZ: 0,
			boxYaw: 0,
			name: 'Portal',
			teleport: { map: mapId, x: here.x, y: here.y, z: here.z, o: here.o, level: 0, message: '' },
		})
		triggers = [...triggers, n]
		touch(id)
		picked = id
	}

	function moveHere() {
		if (!t || !here) return
		t.x = here.x
		t.y = here.y
		t.z = here.z
		touch(t.id)
	}

	function remove() {
		if (!t) return
		const id = t.id
		triggers = triggers.filter((x) => x.id !== id)
		dirty = dirty.filter((x) => x !== id)
		// A trigger added in this session was never written: nothing to take out.
		if (id < nextId) removed = [...removed, id]
		picked = listed.find((x) => x.id !== id)?.id ?? null
	}

	function setShape(box: boolean) {
		if (!t) return
		if (box) {
			const d = Math.max(t.radius * 2, 1)
			t.boxX = t.boxY = t.boxZ = d
			t.radius = 0
		} else {
			t.radius = Math.max(t.boxX, t.boxY, t.boxZ, 2) / 2
			t.boxX = t.boxY = t.boxZ = t.boxYaw = 0
		}
		touch(t.id)
	}

	function setTeleport(on: boolean) {
		if (!t) return
		t.teleport = on ? vmangos.TriggerTeleport.createFrom({ map: here?.map ?? t.mapId, x: here?.x ?? t.x, y: here?.y ?? t.y, z: here?.z ?? t.z, o: here?.o ?? 0, level: 0, message: '' }) : undefined
		touch(t.id)
	}

	/** The destination from an open map tab's camera. */
	let fromTab = $state(-1)
	async function destinationFromTab() {
		if (!t?.teleport || fromTab < 0) return
		const s = await engineRef.current?.spotOfDoc(fromTab)
		if (!s) {
			error = 'That map has no client map ID or no camera yet.'
			return
		}
		Object.assign(t.teleport, { map: s.map, x: s.x, y: s.y, z: s.z, o: s.o })
		touch(t.id)
	}

	/** Puts the camera on the picked trigger, when it is in the open block. */
	function goTo() {
		const e = engineRef.current
		const r = e?.activeRegion()
		if (!t || !e) return
		const p = editorPoint(t, r?.x ?? 0, r?.y ?? 0)
		e.setSceneView({ ...e.sceneView(), target: [p.x, p.y, p.z], distance: Math.max(20, t.radius * 4, t.boxX * 2), pitch: 0.6 })
	}

	async function save() {
		const changed = triggers.filter((x) => dirty.includes(x.id))
		if (!changed.length && !removed.length) return
		saving = true
		error = ''
		try {
			const res = await SaveAreaTriggers(
				changed.map((x) => vmangos.AreaTrigger.createFrom($state.snapshot(x))),
				removed,
			)
			const n = changed.length + removed.length
			dirty = []
			removed = []
			nextId = Math.max(nextId, ...triggers.map((x) => x.id + 1))
			const where = [res.patch ? 'the client' : '', res.server ? "the server's area triggers" : ''].filter(Boolean).join(' and ')
			setStatus(`Saved ${n} trigger${n === 1 ? '' : 's'} to ${where || 'nowhere new (nothing differed)'}.${res.server ? ' Restart the world server for it to know them.' : ' Set the VMaNGOS server folder: without the server, a trigger does nothing.'}`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
		}
	}

	function close() {
		if ((dirty.length || removed.length) && !confirm('Close without saving the portal changes?')) return
		engineRef.current?.endTriggerEdit()
		onclose()
	}

	const num = (e: Event) => {
		const v = Number((e.target as HTMLInputElement).value)
		return Number.isFinite(v) ? v : 0
	}
	const deg = (rad: number) => Math.round((rad * 180) / Math.PI * 10) / 10
	const rad = (d: number) => (d * Math.PI) / 180
</script>

<Modal title="Portals and area triggers" width={780} onclose={close}>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="top">
		<span class="dim">{loading ? 'Reading the triggers…' : mapId !== null ? `${mapName(mapId)}: ${triggers.length} triggers, nearest the camera first.` : ''}</span>
		<button onclick={add} disabled={!here || mapId === null} title="A new portal (a 5 yd sphere) where the camera is">New portal here</button>
	</div>
	<div class="cols">
		<ul class="list" aria-label="Triggers">
			{#each listed as x (x.id)}
				<li>
					<button class:picked={picked === x.id} class:dirty={dirty.includes(x.id)} onclick={() => (picked = x.id)}>
						{x.name || `Trigger ${x.id}`}{x.teleport ? ' →' : ''}
						<span class="id">{x.id}{distance(x) !== null ? ` · ${distance(x)} yd` : ''}</span>
					</button>
				</li>
			{:else}
				<li class="dim">{loading ? '' : 'No triggers on this map yet.'}</li>
			{/each}
		</ul>
		{#if t}
			<div class="form">
				<label class="k" for="at-name">Name</label>
				<input id="at-name" maxlength="64" value={t.name} oninput={(e) => edit('name', (e.target as HTMLInputElement).value)} />
				<span class="k">Position</span>
				<span class="row">
					<input type="number" step="any" value={t.x} oninput={(e) => edit('x', num(e))} aria-label="X" />
					<input type="number" step="any" value={t.y} oninput={(e) => edit('y', num(e))} aria-label="Y" />
					<input type="number" step="any" value={t.z} oninput={(e) => edit('z', num(e))} aria-label="Z" />
				</span>
				<span></span>
				<span class="row">
					<button onclick={moveHere} disabled={!here}>Move to the camera</button>
					<button onclick={goTo}>Look at it</button>
				</span>
				<span class="k">Shape</span>
				<span class="row">
					<label class="check"><input type="radio" checked={t.radius > 0} onchange={() => setShape(false)} /> Sphere</label>
					<label class="check"><input type="radio" checked={t.radius === 0} onchange={() => setShape(true)} /> Box</label>
				</span>
				{#if t.radius > 0}
					<label class="k" for="at-radius">Radius (yd)</label>
					<input id="at-radius" type="number" min="0.1" step="any" value={t.radius} oninput={(e) => edit('radius', Math.max(0.1, num(e)))} />
				{:else}
					<span class="k">Box (yd)</span>
					<span class="row">
						<input type="number" min="0.1" step="any" value={t.boxX} oninput={(e) => edit('boxX', Math.max(0.1, num(e)))} aria-label="Length" title="Length, along its facing" />
						<input type="number" min="0.1" step="any" value={t.boxY} oninput={(e) => edit('boxY', Math.max(0.1, num(e)))} aria-label="Width" title="Width" />
						<input type="number" min="0.1" step="any" value={t.boxZ} oninput={(e) => edit('boxZ', Math.max(0.1, num(e)))} aria-label="Height" title="Height" />
					</span>
					<label class="k" for="at-yaw">Turn (°)</label>
					<input id="at-yaw" type="number" step="any" value={deg(t.boxYaw)} oninput={(e) => edit('boxYaw', rad(num(e)))} />
				{/if}

				<span class="k">Teleport</span>
				<label class="check"><input type="checkbox" checked={!!t.teleport} onchange={(e) => setTeleport((e.target as HTMLInputElement).checked)} /> Sends a player who walks in to another place</label>
				{#if t.teleport}
					<label class="k" for="at-map">To map</label>
					<select id="at-map" value={t.teleport.map} onchange={(e) => editTeleport('map', Number((e.target as HTMLSelectElement).value))}>
						{#each maps as m (m.ID)}<option value={m.ID}>{m.Name || m.Dir} ({m.ID})</option>{/each}
						{#if !maps.some((m) => m.ID === t.teleport!.map)}<option value={t.teleport.map}>map {t.teleport.map}</option>{/if}
					</select>
					<span class="k">To position</span>
					<span class="row">
						<input type="number" step="any" value={t.teleport.x} oninput={(e) => editTeleport('x', num(e))} aria-label="Target X" />
						<input type="number" step="any" value={t.teleport.y} oninput={(e) => editTeleport('y', num(e))} aria-label="Target Y" />
						<input type="number" step="any" value={t.teleport.z} oninput={(e) => editTeleport('z', num(e))} aria-label="Target Z" />
					</span>
					<label class="k" for="at-o">Facing (°)</label>
					<input id="at-o" type="number" step="any" value={deg(t.teleport.o)} oninput={(e) => editTeleport('o', rad(num(e)))} />
					<span class="k">From a map tab</span>
					<span class="row">
						<select bind:value={fromTab} aria-label="Map tab">
							<option value={-1}>Pick an open map…</option>
							{#each docs.tabs as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
						</select>
						<button onclick={() => void destinationFromTab()} disabled={fromTab < 0} title="The destination becomes where that map's camera is">Use its camera</button>
					</span>
					<label class="k" for="at-level">Required level</label>
					<input id="at-level" type="number" min="0" max="255" value={t.teleport.level} oninput={(e) => editTeleport('level', Math.min(255, Math.max(0, Math.round(num(e)))))} />
					<label class="k" for="at-msg">Message</label>
					<input id="at-msg" maxlength="128" value={t.teleport.message} placeholder="Shown to a player below the level" oninput={(e) => editTeleport('message', (e.target as HTMLInputElement).value)} />
				{/if}
				<span class="k">ID</span>
				<span class="row"><span class="dim">{t.id}</span><button class="danger" onclick={remove}>Delete trigger</button></span>
			</div>
		{/if}
	</div>
	<p class="dim">
		A trigger is a volume the client reports when a player walks in; the server teleports them. The swirl of a dungeon portal is a model: place one there with the Place tool.
		Save writes the client's AreaTrigger.dbc (Meld's patch; the game restarts to read it) and the server's areatrigger_template and areatrigger_teleport.
	</p>
	{#snippet actions()}
		<button onclick={close}>Close</button>
		<button class="active" onclick={() => void save()} disabled={(!dirty.length && !removed.length) || saving}
			>{saving ? 'Saving…' : `Save${dirty.length + removed.length ? ` (${dirty.length + removed.length})` : ''}`}</button
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
	}
	.cols {
		display: grid;
		grid-template-columns: 250px 1fr;
		gap: 12px;
		min-height: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		max-height: 440px;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.list button {
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
	.id {
		color: var(--text-dim);
		font-size: 11px;
	}
	.form {
		display: grid;
		grid-template-columns: 120px 1fr;
		gap: 6px 8px;
		align-items: center;
		align-content: start;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	.check {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.danger {
		margin-left: auto;
	}
</style>
