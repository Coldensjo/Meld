<script lang="ts">
	import { onDestroy } from 'svelte'
	import * as THREE from 'three'
	import { LiftMotions, ListObjectTemplates, NewLiftEntry, SaveLift } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { askConfirm } from '../lib/state/confirm'
	import { startSaving } from '../lib/state/saving'
	import { hasBackend } from '../lib/io/backend'
	import { applyNote } from '../lib/io/applyNote'
	import { displayName } from '../lib/models/assets'
	import { selectSpawn } from '../lib/world/spawnEdits'
	import { spawnKey } from '../lib/world/spawnKey'
	import { defaultLiftFrames, liftPeriod, liftProblem, liftStops, samePlace, type LiftFrame, type LiftOrigin } from '../lib/world/liftMotion'

	// World › Lifts (#956): the open region's lifts and elevators, the game objects of type 11, whose
	// loops the client's TransportAnimation.dbc holds by template entry (App.LiftMotions). The selected
	// spawn, when it is a lift, is the one shown: its loop is drawn over the map (Engine.showLift) and
	// Play moves its model through it as the client does. Edit makes a draft of the loop, a list of
	// frames (a time and an offset from the spawn), and New lift a draft of a new type 11 template with
	// a loop of its own, standing under the camera. Save writes the loop into the client's and the
	// server's TransportAnimation.dbc (and a new lift's template into the world database, then places it
	// as a spawn, an undo step saved with the other spawns). A form saved with Save, as World ›
	// Transports is: not undo steps (decision #83).

	/** The model of a type 11 template, to make a new lift from. */
	interface LiftModel {
		display: number
		model: string
		name: string
		size: number
	}

	/** A lift's loop being edited, or a new lift: what Save writes. */
	interface Draft {
		isNew: boolean
		entry: number
		name: string
		displayId: number
		model: string
		size: number
		/** Where the draft stands: the spawn's place, or for a new lift the ground under the camera. */
		origin: LiftOrigin
		frames: LiftFrame[]
	}

	let motions = $state.raw<Map<number, LiftFrame[]>>(new Map())
	let models = $state.raw<LiftModel[]>([])
	let error = $state('')
	let note = $state('')
	let loading = $state(true)
	let rate = $state(1)
	let draft = $state<Draft | null>(null)
	let dirty = $state(false)
	let row = $state(-1)
	let saving = $state(false)

	/** The open region's lifts: its game objects of type 11. */
	const lifts = $derived(editor.spawns.filter((s) => s.kind === 'object' && s.type === 11))
	/** The selected spawn when it is a lift. */
	const picked = $derived(editor.selectedSpawn?.kind === 'object' && editor.selectedSpawn.type === 11 ? editor.selectedSpawn : null)
	const pickedFrames = $derived(picked ? (motions.get(picked.entry) ?? []) : [])
	const frames = $derived(draft ? draft.frames : pickedFrames)
	const problem = $derived(draft ? liftProblem(draft.frames) : '')
	const stops = $derived(liftStops(frames))
	/** How many of the region's lifts share the picked one's entry, and so its loop. */
	const sharing = $derived(picked ? lifts.filter((s) => s.entry === picked.entry).length : 0)

	const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`
	const yards = (v: number) => `${Math.round(v * 10) / 10}`
	const moveOf = (i: number) => {
		const f = frames
		if (i === 0) return 'start'
		const a = f[i - 1]
		const b = f[i]
		if (samePlace(a, b)) return `waits ${seconds(b.time - a.time)}`
		return `moves ${yards(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z))} yd in ${seconds(b.time - a.time)}`
	}

	async function init() {
		if (!hasBackend()) {
			error = 'Lifts need the desktop app, a WoW client and the VMaNGOS server.'
			loading = false
			return
		}
		try {
			await readMotions()
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void init()

	async function readMotions() {
		const list = (await LiftMotions()) ?? []
		motions = new Map(list.map((m) => [m.entry, (m.frames ?? []).map((f) => ({ ...f }))]))
	}

	async function readModels() {
		if (models.length) return
		const all = (await ListObjectTemplates()) ?? []
		const seen = new Map<number, LiftModel>()
		for (const t of all) if (t.type === 11 && t.model && !seen.has(t.display)) seen.set(t.display, { display: t.display, model: t.model, name: t.name, size: t.size || 1 })
		models = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.display - b.display)
	}

	// The 3D view draws the draft, else the picked lift.
	$effect(() => {
		const e = engineRef.current
		if (!e) return
		if (draft) {
			const d = $state.snapshot(draft) as Draft
			e.showLift({ ...d.origin, model: d.model, scale: d.size, frames: d.frames })
		} else if (picked) e.showLift({ x: picked.x, y: picked.y, z: picked.z, orientation: picked.orientation, tilt: picked.tilt, model: picked.model, scale: picked.scale, frames: $state.snapshot(pickedFrames) as LiftFrame[] })
		else e.showLift(null)
	})

	onDestroy(() => {
		const e = engineRef.current
		e?.stopLiftPlay()
		e?.showLift(null)
	})

	function pick(s: vmangos.WorldSpawn) {
		if (draft) return
		selectSpawn(s)
		engineRef.current?.focusSpawn(s)
	}

	/** Drops the draft, asking first when it has unsaved changes; false when the author keeps it. */
	async function leaveDraft(): Promise<boolean> {
		if (!draft) return true
		if (dirty && !(await askConfirm('Drop the unsaved changes to the lift?', { title: 'Unsaved changes', ok: 'Drop them' }))) return false
		engineRef.current?.stopLiftPlay()
		draft = null
		dirty = false
		row = -1
		return true
	}

	function editLift() {
		const s = picked
		if (!s || draft) return
		engineRef.current?.stopLiftPlay()
		error = ''
		note = ''
		draft = {
			isNew: false,
			entry: s.entry,
			name: s.name,
			displayId: s.display,
			model: s.model,
			size: s.scale > 0 ? s.scale : 1,
			origin: { x: s.x, y: s.y, z: s.z, orientation: s.orientation, tilt: s.tilt },
			frames: pickedFrames.length >= 2 ? pickedFrames.map((f) => ({ ...f })) : defaultLiftFrames(),
		}
		dirty = pickedFrames.length < 2
		row = -1
	}

	async function newLift() {
		if (!(await leaveDraft())) return
		const e = engineRef.current
		if (!e) return
		error = ''
		note = ''
		try {
			await readModels()
			const entry = await NewLiftEntry()
			const first = models[0]
			const t = e.controller.target
			e.stopLiftPlay()
			draft = {
				isNew: true,
				entry,
				name: 'New lift',
				displayId: first?.display ?? 0,
				model: first?.model ?? '',
				size: first?.size ?? 1,
				origin: { x: t.x, y: t.y, z: t.z, orientation: 0, tilt: null },
				frames: defaultLiftFrames(),
			}
			dirty = true
			row = -1
		} catch (err) {
			error = String(err)
		}
	}

	/** Changes the draft and marks it unsaved. */
	function edit(change: (d: Draft) => void) {
		if (!draft) return
		change(draft)
		dirty = true
	}

	function setModel(display: number) {
		const m = models.find((x) => x.display === display)
		if (m) edit((d) => Object.assign(d, { displayId: m.display, model: m.model, size: m.size }))
	}

	/** Sets frame i's time to `after` seconds past the frame before it, the later frames moving with it. */
	function setAfter(i: number, after: number) {
		edit((d) => {
			const f = d.frames
			if (i <= 0 || i >= f.length) return
			const ms = Math.max(1, Math.round(Math.max(0, after) * 1000))
			const shift = f[i - 1].time + ms - f[i].time
			for (let k = i; k < f.length; k++) f[k].time += shift
		})
	}

	function setOffset(i: number, axis: 'x' | 'y' | 'z', v: number) {
		edit((d) => {
			const f = d.frames[i]
			if (f && Number.isFinite(v)) f[axis] = v
		})
	}

	/** Adds a frame after the picked row (or the last): a wait of 5 s where it stands, or a move of 10 yd up in 5 s. */
	function addFrame(move: boolean) {
		edit((d) => {
			const at = row >= 0 && row < d.frames.length ? row : d.frames.length - 1
			const p = d.frames[at]
			const next = { ...p, time: p.time + 5000, z: move ? p.z + 10 : p.z }
			for (let k = at + 1; k < d.frames.length; k++) d.frames[k].time += 5000
			d.frames.splice(at + 1, 0, next)
			row = at + 1
		})
	}

	function deleteFrame() {
		if (!draft || row < 0) return
		if (draft.frames.length <= 2) {
			error = 'A loop needs at least two frames.'
			return
		}
		edit((d) => {
			const f = d.frames
			const gone = f.splice(row, 1)[0]
			if (row === 0) {
				// The next frame starts the loop.
				const t0 = f[0].time
				for (const k of f) k.time -= t0
			} else {
				// The frames after it come earlier by its span, keeping their own.
				const shift = gone.time - f[row - 1].time
				for (let k = row; k < f.length; k++) f[k].time -= shift
			}
		})
		row = Math.min(row, draft.frames.length - 1)
	}

	async function save() {
		const d = draft
		if (!d || problem) return
		saving = true
		const end = startSaving('Saving the lift')
		error = ''
		try {
			const edit: vmangos.LiftEdit = {
				entry: d.entry,
				new: d.isNew,
				name: d.name.trim(),
				displayId: d.displayId,
				size: d.size,
				frames: $state.snapshot(d.frames),
			}
			const res = await SaveLift(edit)
			dirty = false
			const into = [res.patch ? 'the client' : '', res.server ? "the server's data" : ''].filter(Boolean).join(' and ')
			const after = res.restart ? '' : ' The world server reads lifts when it starts, and the game when it starts.'
			const placed = d.isNew ? ` and placed it under the camera: File › Save Spawns to Database saves it with the other spawns.` : ''
			note = `Saved the loop of ${edit.name || `lift ${edit.entry}`} (${edit.entry}, ${seconds(liftPeriod(edit.frames))} round)${into ? ` into ${into}` : ''}${d.isNew ? `, its template into the world database${placed}` : '.'}${after}${applyNote(res)}`
			setStatus(note, 12000)
			engineRef.current?.stopLiftPlay()
			draft = null
			row = -1
			await readMotions()
			if (d.isNew) {
				const t: vmangos.ObjectTemplate = { entry: edit.entry, name: edit.name, type: 11, display: edit.displayId, size: edit.size, model: d.model }
				// Orientation 0, as the draft stood (the turn of 90° is the model's own, spawnOrientation).
				await engineRef.current?.placeObject(t, new THREE.Vector3(d.origin.x, d.origin.y, d.origin.z), Math.PI / 2)
			}
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	function play() {
		const e = engineRef.current
		if (!e) return
		if (ui.liftPlaying) e.stopLiftPlay()
		else if (!e.playLift(rate)) error = 'The loop needs at least two frames to play.'
	}

	function setRate(v: number) {
		rate = v
		engineRef.current?.setLiftRate(v)
	}

	async function close() {
		if (await leaveDraft()) ui.lifts = false
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !ui.liftPlaying || (e.target instanceof HTMLElement && e.target.closest('input, select, textarea'))) return
		engineRef.current?.stopLiftPlay()
		e.stopPropagation()
	}

	const num = (e: Event) => Number((e.target as HTMLInputElement).value)
</script>

<svelte:window onkeydown={onKey} />

<aside class="lifts" aria-label="Lifts">
	<header>
		<span>Lifts and elevators</span>
		<button class="close" onclick={close} title="Close" aria-label="Close the lifts">✕</button>
	</header>
	<div class="body">
		{#if error}<p class="error">{error}</p>{/if}
		{#if loading}
			<p class="dim">Reading the lifts' loops…</p>
		{:else}
			<div class="row">
				<span class="dim grow">{lifts.length} {lifts.length === 1 ? 'lift' : 'lifts'} in this region</span>
				<button onclick={() => void newLift()} disabled={saving} title="A new lift (a type 11 game object) under the camera, with a loop of its own">New lift</button>
			</div>
			{#if note}<p class="note">{note}</p>{/if}
			<ul class="list" aria-label="Lifts">
				{#each lifts as s (spawnKey(s))}
					<li>
						<button class:picked={!draft && picked?.guid === s.guid} disabled={draft !== null} onclick={() => pick(s)}>
							{s.name || `Object ${s.entry}`}<span class="id">{s.entry} · {motions.has(s.entry) ? seconds(liftPeriod(motions.get(s.entry) ?? [])) : 'no loop'}</span>
						</button>
					</li>
				{:else}
					<li class="dim">No lift stands in this region.</li>
				{/each}
			</ul>

			{#if draft}
				<div class="form" role="group" aria-label="Lift">
					<span class="k">Object</span>
					<span>{draft.isNew ? 'New template' : draft.name} <span class="dim">({draft.entry})</span></span>
					{#if draft.isNew}
						<label class="k" for="lift-name">Name</label>
						<input id="lift-name" maxlength="100" value={draft.name} oninput={(e) => edit((d) => (d.name = (e.target as HTMLInputElement).value))} />
						<label class="k" for="lift-model">Model</label>
						<select id="lift-model" value={draft.displayId} onchange={(e) => setModel(Number((e.target as HTMLSelectElement).value))}>
							{#each models as m (m.display)}<option value={m.display}>{m.name} ({displayName(m.model)}, {m.display})</option>{/each}
						</select>
					{/if}
					<span class="k">Round</span>
					<span>{seconds(liftPeriod(draft.frames))} <span class="dim">({stops.length} {stops.length === 1 ? 'stop' : 'stops'})</span></span>
				</div>
			{:else if picked}
				<div class="form">
					<span class="k">Object</span>
					<span class="row">
						<span class="grow">{picked.name} <span class="dim">({picked.entry})</span></span>
						<button onclick={() => (ui.objectEditor = { key: spawnKey(picked), entry: picked.entry })} title="Open its gameobject_template row in the game object editor">Open</button>
					</span>
					<span class="k">Model</span>
					<span>{picked.model ? displayName(picked.model) : 'none'} <span class="dim">(display {picked.display})</span></span>
					<span class="k">Round</span>
					<span>
						{#if pickedFrames.length >= 2}{seconds(liftPeriod(pickedFrames))}
							<span class="dim"
								>({stops.length} {stops.length === 1 ? 'stop' : 'stops'}; {sharing > 1 ? `every spawn of entry ${picked.entry} moves this way, ${sharing} here` : `every spawn of entry ${picked.entry} moves this way`})</span
							>
						{:else}<span class="dim">none: TransportAnimation.dbc has no loop for entry {picked.entry}, so it stands still</span>{/if}
					</span>
				</div>
			{/if}

			{#if draft || picked}
				<table class="frames" aria-label="Frames">
					<thead><tr><th>#</th><th title="Seconds after the frame before">After</th><th title="Yards from the spawn, before its turn">X</th><th>Y</th><th title="Yards above the spawn">Up</th><th></th></tr></thead>
					<tbody>
						{#each frames as f, i (i)}
							<tr class:sel={draft !== null && row === i} onclick={() => (row = i)}>
								<td>{i + 1}</td>
								{#if draft}
									<td><input class="n" type="number" min="0.001" step="0.1" value={i === 0 ? 0 : (f.time - frames[i - 1].time) / 1000} disabled={i === 0} onchange={(e) => setAfter(i, num(e))} aria-label="After" /></td>
									<td><input class="n" type="number" step="any" value={f.x} onchange={(e) => setOffset(i, 'x', num(e))} aria-label="X" /></td>
									<td><input class="n" type="number" step="any" value={f.y} onchange={(e) => setOffset(i, 'y', num(e))} aria-label="Y" /></td>
									<td><input class="n" type="number" step="any" value={f.z} onchange={(e) => setOffset(i, 'z', num(e))} aria-label="Up" /></td>
								{:else}
									<td>{i === 0 ? '0' : seconds(f.time - frames[i - 1].time)}</td>
									<td>{yards(f.x)}</td>
									<td>{yards(f.y)}</td>
									<td>{yards(f.z)}</td>
								{/if}
								<td class="dim">{moveOf(i)}</td>
							</tr>
						{:else}
							<tr><td colspan="6" class="dim">No frames.</td></tr>
						{/each}
					</tbody>
				</table>
				{#if frames.length >= 2 && !samePlace(frames[0], frames[frames.length - 1])}
					<p class="dim help">The last frame stands elsewhere than the first: after it the lift jumps back to the start.</p>
				{/if}
				<div class="row">
					<button class:active={ui.liftPlaying} disabled={frames.length < 2 || problem !== ''} onclick={play} title="Move the lift's model through its loop, round and round (Esc stops)">{ui.liftPlaying ? 'Stop' : 'Play'}</button>
					<select value={rate} onchange={(e) => setRate(Number((e.target as HTMLSelectElement).value))} aria-label="Speed">
						<option value={1}>Its own speed</option>
						<option value={4}>4× faster</option>
					</select>
					<span class="grow"></span>
					{#if draft}
						<button onclick={() => addFrame(false)} title="A wait of 5 s after the picked frame, where it stands">Add wait</button>
						<button onclick={() => addFrame(true)} title="A move of 10 yards up in 5 s after the picked frame">Add move</button>
						<button onclick={deleteFrame} disabled={row < 0}>Delete</button>
					{:else if picked}
						<button onclick={editLift} title="Edit the loop of every spawn of this entry">Edit loop</button>
					{/if}
				</div>
				{#if draft}
					{#if problem}<p class="error">{problem}</p>{/if}
					<div class="row end">
						<button onclick={() => void leaveDraft()} disabled={saving}>Cancel</button>
						<button class="active" disabled={saving || !dirty || problem !== ''} onclick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
					</div>
				{/if}
			{/if}
			<p class="dim help">
				A lift is a game object of type 11. It moves along a loop of frames in TransportAnimation.dbc, kept by its template's entry: a time and an offset in yards from the spawn, turned with the spawn. Between frames it moves
				evenly; two frames at one place are a wait. Save writes the loop into the client's and the server's TransportAnimation.dbc; both read it when they start. Pick a lift on the map or in the list.
			</p>
		{/if}
	</div>
</aside>

<style>
	.lifts {
		position: fixed;
		top: 96px;
		left: 52px;
		width: 380px;
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
	.note,
	.help {
		margin: 0;
		line-height: 1.35;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.grow {
		flex: 1;
	}
	.end {
		justify-content: flex-end;
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
		max-height: 160px;
		overflow-y: auto;
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
	.list button:disabled {
		opacity: 0.5;
	}
	.list button.picked {
		background: var(--panel-3);
	}
	.list li.dim {
		padding: 3px 8px;
	}
	.id {
		margin-left: auto;
		color: var(--text-dim);
		font-size: 11px;
	}
	.form {
		display: grid;
		grid-template-columns: 64px 1fr;
		gap: 5px 8px;
		align-items: center;
	}
	.k {
		color: var(--text-dim);
	}
	.frames {
		border-collapse: collapse;
		width: 100%;
	}
	.frames th {
		text-align: left;
		font-weight: normal;
		color: var(--text-dim);
		font-size: 11px;
		padding: 0 3px;
	}
	.frames td {
		padding: 1px 3px;
		white-space: nowrap;
	}
	.frames tr.sel {
		background: var(--panel-3);
	}
	.n {
		width: 52px;
	}
	button.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
