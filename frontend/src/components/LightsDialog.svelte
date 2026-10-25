<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import Modal from './Modal.svelte'
	import { MapLights, NewLightIDs, SaveLights } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { prefs, setStatus } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { lightWeight } from '../lib/wow/clientLight'

	// World › Lights (Noggit Red's light editor): the open map's lights from the client's Light.dbc, each
	// placed in the world with an inner radius it is full within and an outer one it fades out by, and
	// its clear-weather params: the colour bands by time of day (the sun's light, the ambient, the sky,
	// the fog, the water), the fog distance and the water alphas. Save writes the changed lights and params
	// into the client's light tables (Meld's patch). A form saved with Save, like the zones: the lights are
	// client tables, not the map.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	type Light = vmangos.MapLight
	type Params = vmangos.LightParamSet

	let mapId = $state(0)
	let lights = $state<Light[]>([])
	let params = $state<Record<number, Params>>({})
	let picked = $state<number | null>(null)
	let band = $state(7)
	let dirtyLights = $state<number[]>([])
	let dirtyParams = $state<number[]>([])
	let error = $state('')
	let saving = $state(false)
	let cam = $state({ x: 0, y: 0, z: 0 })

	const BANDS = [
		'Sun light',
		'Ambient light',
		'Sky top',
		'Sky middle',
		'Sky lower',
		'Sky above horizon',
		'Sky haze (horizon)',
		'Fog',
		'Band 8',
		'Sun',
		'Sun halo',
		'Cloud edge',
		'Clouds',
		'Band 13',
		'Ocean shallow',
		'Ocean deep',
		'River shallow',
		'River deep',
	]

	const light = $derived(lights.find((l) => l.id === picked) ?? null)
	const lp = $derived(light ? params[light.params[0]] : undefined)
	const dist = (l: Light) => Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z)
	const sorted = $derived([...lights].sort((a, b) => (a.global ? -1 : b.global ? 1 : dist(a) - dist(b))))

	async function init() {
		if (!hasBackend()) {
			error = 'The lights need the desktop app and a WoW client.'
			return
		}
		const e = engineRef.current
		if (!e) return
		try {
			mapId = await e.lightsMapId()
			cam = e.cameraInFileFrame()
			const set = await MapLights(mapId)
			lights = set.lights ?? []
			params = set.params ?? {}
			// The light the camera is in (the nearest one reaching it), else the global light.
			const inside = lights.filter((l) => !l.global && lightWeight(l, dist(l)) > 0).sort((a, b) => dist(a) - dist(b))[0]
			picked = (inside ?? lights.find((l) => l.global) ?? lights[0])?.id ?? null
		} catch (err) {
			error = String(err)
		}
	}
	void init()

	function touchLight(id: number) {
		if (!dirtyLights.includes(id)) dirtyLights = [...dirtyLights, id]
	}
	function touchParams(id: number) {
		if (!dirtyParams.includes(id)) dirtyParams = [...dirtyParams, id]
	}

	function editLight(patch: Partial<Light>) {
		const l = lights.find((x) => x.id === picked)
		if (!l) return
		Object.assign(l, patch)
		touchLight(l.id)
	}

	function editParams(fn: (p: Params) => void) {
		const p = light ? params[light.params[0]] : undefined
		if (!p) return
		fn(p)
		touchParams(p.id)
	}

	function moveToCamera() {
		const e = engineRef.current
		if (!e || !light || light.global) return
		cam = e.cameraInFileFrame()
		editLight({ x: cam.x, y: cam.y, z: cam.z })
	}

	async function newLight() {
		const e = engineRef.current
		const global = lights.find((l) => l.global)
		if (!e || !global || !params[global.params[0]]) return
		try {
			const ids = await NewLightIDs()
			// A second new light in one session takes the next IDs past the unsaved ones.
			const lid = Math.max(ids.light, ...lights.map((l) => l.id + 1))
			const pid = Math.max(ids.params, ...Object.keys(params).map((k) => Number(k) + 1))
			cam = e.cameraInFileFrame()
			const copy = JSON.parse(JSON.stringify(params[global.params[0]])) as Params
			copy.id = pid
			params[pid] = copy
			lights = [...lights, vmangos.MapLight.createFrom({ id: lid, x: cam.x, y: cam.y, z: cam.z, inner: 30, outer: 90, global: false, params: [pid, 0, 0, 0, 0] })]
			picked = lid
			touchLight(lid)
			touchParams(pid)
			setStatus("A new light at the camera, starting from the map's global light. Save to write it.", 4000)
		} catch (err) {
			error = String(err)
		}
	}

	async function save() {
		saving = true
		const end = startSaving('Saving the lights')
		error = ''
		try {
			const patch = await SaveLights(
				vmangos.LightsEdit.createFrom({
					mapId,
					lights: lights.filter((l) => dirtyLights.includes(l.id)),
					params: dirtyParams.map((id) => params[id]).filter(Boolean),
				}),
			)
			dirtyLights = []
			dirtyParams = []
			engineRef.current?.reloadClientLights()
			setStatus(patch ? `Saved the lights to ${patch}. ${prefs.clientLighting ? '' : 'Turn on Lighting › Client Lighting to see them in the editor.'}` : 'Nothing changed.', 6000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	async function close() {
		if ((dirtyLights.length || dirtyParams.length) && !(await askConfirm('Close without saving the light changes?', { title: 'Unsaved changes', ok: 'Close without saving' }))) return
		onclose()
	}

	// A band key's time is half-minutes of the day; the form shows it as hh:mm.
	const hhmm = (t: number) => `${String(Math.floor(t / 120)).padStart(2, '0')}:${String(Math.floor((t % 120) / 2)).padStart(2, '0')}`
	const fromHhmm = (s: string) => {
		const [h, m] = s.split(':').map(Number)
		return Math.min(2879, Math.max(0, (h || 0) * 120 + (m || 0) * 2))
	}
	const hex = (v: number) => '#' + (v & 0xffffff).toString(16).padStart(6, '0')
	const fromHex = (s: string) => parseInt(s.slice(1), 16) || 0
	const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0

	function setKey(k: number, patch: Partial<vmangos.LightKey>) {
		editParams((p) => {
			const keys = p.colors[band].map((x) => ({ ...x }))
			Object.assign(keys[k], patch)
			// Only a new time reorders the band: a few of the client's bands keep their keys out of time
			// order, walked as a cycle in stored order, so recolouring a key must keep that order (#276).
			if (patch.t !== undefined) keys.sort((a, b) => a.t - b.t)
			p.colors[band] = keys as vmangos.LightKey[]
		})
	}
	function addKey() {
		editParams((p) => {
			const keys = p.colors[band] ?? []
			if (keys.length >= 16) return
			const t = keys.length ? Math.min(2879, keys[keys.length - 1].t + 120) : 1440
			if (keys.some((x) => x.t === t)) return
			p.colors[band] = [...keys, vmangos.LightKey.createFrom({ t, v: keys[keys.length - 1]?.v ?? 0x808080 })]
		})
	}
	function removeKey(k: number) {
		editParams((p) => (p.colors[band] = p.colors[band].filter((_, i) => i !== k)))
	}
	/** A float band's value as one number for the whole day (the form sets the band to one key). */
	const floatOf = (p: Params, i: number) => p.floats[i]?.[0]?.v ?? 0
	function setFloat(i: number, v: number) {
		editParams((p) => (p.floats[i] = [vmangos.LightKey.createFrom({ t: 0, v })]))
	}
</script>

<Modal title="Lights" width={820} onclose={close}>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="cols">
		<div class="side">
			<ul class="list" aria-label="Lights">
				{#each sorted as l (l.id)}
					<li>
						<button class:picked={picked === l.id} onclick={() => (picked = l.id)}>
							<span>{l.global ? 'Global light' : `Light ${l.id}`}{dirtyLights.includes(l.id) ? ' •' : ''}</span>
							<span class="dim">{l.global ? 'the whole map' : lightWeight(l, dist(l)) > 0 ? 'camera inside' : `${Math.round(dist(l))} yd`}</span>
						</button>
					</li>
				{:else}
					<li class="dim">Reading the lights…</li>
				{/each}
			</ul>
			<button onclick={() => void newLight()} disabled={!lights.length}>New light at the camera</button>
		</div>
		{#if light}
			<div class="form">
				{#if !light.global}
					<span class="k">Position (yd)</span>
					<span class="row">
						<input type="number" step="any" value={light.x.toFixed(1)} onchange={(e) => editLight({ x: num(e) })} aria-label="X" />
						<input type="number" step="any" value={light.y.toFixed(1)} onchange={(e) => editLight({ y: num(e) })} aria-label="Height" />
						<input type="number" step="any" value={light.z.toFixed(1)} onchange={(e) => editLight({ z: num(e) })} aria-label="Z" />
						<button onclick={moveToCamera}>Move to the camera</button>
					</span>
					<span class="k">Full within (yd)</span>
					<input type="number" min="0" step="1" value={light.inner.toFixed(1)} onchange={(e) => editLight({ inner: Math.max(0, num(e)) })} />
					<span class="k">Fades out by (yd)</span>
					<input type="number" min="1" step="1" value={light.outer.toFixed(1)} onchange={(e) => editLight({ outer: Math.max(1, num(e)) })} />
				{:else}
					<span class="k">Global</span><span class="dim">Lights the whole map; the local lights blend over it.</span>
				{/if}
				{#if lp}
					<span class="k">Colour band</span>
					<select bind:value={band} aria-label="Band">
						{#each BANDS as name, i (i)}<option value={i}>{name}</option>{/each}
					</select>
					<span class="k">By time of day</span>
					<div class="keys">
						{#each lp.colors[band] ?? [] as key, k (k)}
							<span class="key">
								<input type="time" value={hhmm(key.t)} onchange={(e) => setKey(k, { t: fromHhmm((e.target as HTMLInputElement).value) })} aria-label="Time" />
								<input type="color" value={hex(key.v)} onchange={(e) => setKey(k, { v: fromHex((e.target as HTMLInputElement).value) })} aria-label="Colour" />
								<button onclick={() => removeKey(k)} aria-label="Remove key" title="Remove this time">✕</button>
							</span>
						{/each}
						<button onclick={addKey} disabled={(lp.colors[band]?.length ?? 0) >= 16}>Add time</button>
					</div>
					<span class="k">Fog distance (yd)</span>
					<input type="number" min="0" step="10" value={Math.round(floatOf(lp, 0) / 36)} onchange={(e) => setFloat(0, num(e) * 36)} title="Set for the whole day" />
					<span class="k">Fog start (0–1)</span>
					<input type="number" min="0" max="1" step="0.05" value={floatOf(lp, 1)} onchange={(e) => setFloat(1, num(e))} title="Set for the whole day" />
					<span class="k">River alpha</span>
					<span class="row">
						<input type="number" min="0" max="1" step="0.05" value={lp.waterAlpha[0]} onchange={(e) => editParams((p) => (p.waterAlpha = [num(e), p.waterAlpha[1]]))} aria-label="River shallow alpha" />
						<input type="number" min="0" max="1" step="0.05" value={lp.waterAlpha[1]} onchange={(e) => editParams((p) => (p.waterAlpha = [p.waterAlpha[0], num(e)]))} aria-label="River deep alpha" />
					</span>
					<span class="k">Ocean alpha</span>
					<span class="row">
						<input type="number" min="0" max="1" step="0.05" value={lp.oceanAlpha[0]} onchange={(e) => editParams((p) => (p.oceanAlpha = [num(e), p.oceanAlpha[1]]))} aria-label="Ocean shallow alpha" />
						<input type="number" min="0" max="1" step="0.05" value={lp.oceanAlpha[1]} onchange={(e) => editParams((p) => (p.oceanAlpha = [p.oceanAlpha[0], num(e)]))} aria-label="Ocean deep alpha" />
					</span>
					{#if lights.filter((l) => l.params[0] === light.params[0]).length > 1}
						<span></span><span class="dim">These colours are shared by {lights.filter((l) => l.params[0] === light.params[0]).length} lights.</span>
					{/if}
				{:else}
					<span></span><span class="dim">This light has no clear-weather params.</span>
				{/if}
			</div>
		{/if}
	</div>
	<p class="dim">Save writes the changed lights into the client's Light tables (Meld's patch, which the game reads when it starts). Lighting › Client Lighting shows them in the editor.</p>
	{#snippet actions()}
		<button onclick={close}>Close</button>
		<button class="active" onclick={() => void save()} disabled={(!dirtyLights.length && !dirtyParams.length) || saving}>{saving ? 'Saving…' : 'Save'}</button>
	{/snippet}
</Modal>

<style>
	.error {
		color: var(--danger-text);
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.cols {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 12px;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		max-height: 400px;
		overflow-y: auto;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.list button {
		display: flex;
		justify-content: space-between;
		width: 100%;
		border: none;
		border-radius: 0;
		background: transparent;
		padding: 3px 8px;
		color: var(--text);
		text-align: left;
	}
	.list button.picked {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.form {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 6px 8px;
		align-items: center;
		align-content: start;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.row,
	.key {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.row input[type='number'] {
		width: 80px;
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
</style>
