<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor, setStatus, wow } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { displayName } from '../lib/models/assets'
	import { groundEffectTables, loadGroundEffectTables, reloadGroundEffectTables } from '../lib/wow/groundEffectTables'
	import { areaName } from '../lib/wow/areas'
	import { effectAt, effectFor, knownEffects, tileKey, type GroundEffectTables, type ScopedEffects, type TextureEffects } from '../lib/world/groundEffects'
	import { AddGroundEffect } from '../../wailsjs/go/main/App'
	import { hasBackend } from '../lib/io/backend'
	// World › Ground Effects: what the game grows on each of the map's textures (grass tufts, flowers,
	// pebbles). Each texture shows the effect the client's own tiles give it; the map may choose another,
	// or none, for the whole map, or (B-151) for the zone or the tile the camera is over, a tile's choice
	// before its zone's and a zone's before the map's. All are saved with the map, written into its tiles
	// and undo steps. New effect makes a ground effect of the client's detail models (written to the client).

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	/** Bumped when the tables are read again (they live outside Svelte's state). */
	let tablesVersion = $state(0)
	const tables = $derived.by(() => {
		void tablesVersion
		return groundEffectTables()
	})
	const textures = $derived(editor.palette.map((p, i) => ({ i, path: p })).filter((t) => !t.path.startsWith('#')))
	const textureName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')

	// The scope the choices go to: the whole map, or the zone or the tile under the camera now.
	const at = engineRef.current?.effectScopeAtCamera() ?? { areaId: 0, tx: 0, tz: 0 }
	let scope = $state<'map' | 'zone' | 'tile'>('map')

	/** What an effect grows, for a label: its models' names and its density. */
	function describe(t: GroundEffectTables, id: number): string {
		const e = t.effects[id]
		if (!e) return `effect ${id}`
		const names = [...new Set(e.doodads.map((d) => displayName('m2:' + d)))]
		return `${names.join(', ')} · ${e.density}`
	}

	/** The choices kept for the scope, if it has any. */
	function scopeChoices(s: ScopedEffects): TextureEffects | undefined {
		if (scope === 'zone') return s.zones[String(at.areaId)]
		if (scope === 'tile') return s.tiles[tileKey(at.tx, at.tz)]
		return undefined
	}

	/** The effect a texture grows in the scope, and whether the scope chose it itself. */
	function current(path: string): { id: number; own: boolean } {
		if (scope === 'map') return { id: effectFor(path, editor.textureEffects, tables), own: editor.textureEffects[path] !== undefined }
		// A zone's view ignores the tile's choices (tile -1, -1 has none); a tile's sees both.
		const id = effectAt(path, editor.textureEffects, editor.scopedEffects, at.areaId, scope === 'tile' ? at.tx : -1, scope === 'tile' ? at.tz : -1, tables)
		return { id, own: scopeChoices(editor.scopedEffects)?.[path] !== undefined }
	}

	/** The choices for a texture: the client's own (learned) one first, then every effect the client has. */
	function choices(t: GroundEffectTables, path: string): Array<{ id: number; label: string }> {
		const learned = t.textures[path.toLowerCase()] ?? 0
		const out: Array<{ id: number; label: string }> = [{ id: 0, label: 'none' }]
		if (learned) out.push({ id: learned, label: `${describe(t, learned)} (the client's)` })
		for (const k of knownEffects(t)) if (k.id !== learned) out.push({ id: k.id, label: describe(t, k.id) })
		return out
	}

	const copyScoped = (s: ScopedEffects) => JSON.parse(JSON.stringify(s)) as ScopedEffects

	/** Sets a texture's effect in the scope (or, with `clear`, lets it fall back to the wider one), as an undo step. */
	function choose(path: string, id: number, clear = false) {
		const beforeMap = { ...editor.textureEffects }
		const beforeScoped = copyScoped(editor.scopedEffects)
		if (scope === 'map') {
			const learned = tables?.textures[path.toLowerCase()] ?? 0
			const own = { ...editor.textureEffects }
			if (clear || id === learned) delete own[path]
			else own[path] = id
			editor.textureEffects = own
		} else {
			const next = copyScoped(editor.scopedEffects)
			const bucket = scope === 'zone' ? next.zones : next.tiles
			const key = scope === 'zone' ? String(at.areaId) : tileKey(at.tx, at.tz)
			const own = { ...(bucket[key] ?? {}) }
			if (clear) delete own[path]
			else own[path] = id
			if (Object.keys(own).length) bucket[key] = own
			else delete bucket[key]
			editor.scopedEffects = next
		}
		const afterMap = { ...editor.textureEffects }
		const afterScoped = copyScoped(editor.scopedEffects)
		engineRef.current?.history.push({
			label: `Ground effect of ${textureName(path)}`,
			undo: () => {
				editor.textureEffects = { ...beforeMap }
				editor.scopedEffects = copyScoped(beforeScoped)
			},
			redo: () => {
				editor.textureEffects = { ...afterMap }
				editor.scopedEffects = copyScoped(afterScoped)
			},
		})
	}

	// New effect: up to four of the client's detail models, a density and footstep sounds.
	let making = $state(false)
	let picks = $state<string[]>(['', '', '', ''])
	let density = $state(8)
	let terrain = $state(0)
	const models = $derived(tables ? [...new Set(Object.values(tables.effects).flatMap((e) => e.doodads))].sort() : [])
	// The client's terrain types by name (TerrainType.dbc), else the numbers the effects use.
	const terrains = $derived(
		tables?.terrains?.length
			? tables.terrains.map((t) => ({ id: t.id, label: t.footprints ? `${t.name} (footprints)` : t.name }))
			: tables
				? [...new Set(Object.values(tables.effects).map((e) => e.terrain))].sort((a, b) => a - b).map((id) => ({ id, label: String(id) }))
				: [],
	)
	async function create() {
		const chosen = picks.filter(Boolean)
		if (!chosen.length) return
		try {
			const id = await AddGroundEffect(chosen, density, terrain)
			await reloadGroundEffectTables()
			tablesVersion++
			making = false
			picks = ['', '', '', '']
			setStatus(`Made ground effect ${id}: pick it for a texture above. The client's patch has it.`, 6000)
		} catch (err) {
			setStatus(`The effect wasn't made: ${err}`, 8000)
		}
	}
</script>

<Modal title="Ground effects (grass tufts)" width={620} {onclose}>
	<p class="dim">
		The game grows small models on the ground by the texture on top of each cell: grass tufts, flowers, pebbles. Each texture here grows what the client's own tiles give it. Choose another effect, or none, for this map, or only for the
		zone or the tile the camera is over.
	</p>
	{#if !wow.loaded}
		<p class="dim">Select your WoW client folder first (Settings menu).</p>
	{:else if !tables}
		<p class="dim">Reading the client's ground effects… the first time for a client reads every tile and takes a minute or two.</p>
		<button onclick={() => void loadGroundEffectTables().then(() => tablesVersion++)}>Read now</button>
	{:else}
		<div class="scope">
			<label class="check"><input type="radio" bind:group={scope} value="map" /> Whole map</label>
			<label class="check" title={at.areaId ? '' : 'The chunk under the camera has no zone'}><input type="radio" bind:group={scope} value="zone" disabled={!at.areaId} /> Zone: {at.areaId ? areaName(at.areaId) : 'none here'}</label>
			<label class="check"><input type="radio" bind:group={scope} value="tile" /> Tile {at.tx}, {at.tz}</label>
		</div>
		{#if !textures.length}
			<p class="dim">The map has no client textures yet. Textures picked in the asset browser appear here.</p>
		{:else}
			<div class="rows">
				{#each textures as t (t.i)}
					{@const c = current(t.path)}
					{@const list = choices(tables, t.path)}
					<span class="name" title={t.path}>{textureName(t.path)}</span>
					<span class="pick">
						<select value={c.id} class:own={c.own} onchange={(e) => choose(t.path, Number((e.target as HTMLSelectElement).value))} aria-label="Effect of {textureName(t.path)}">
							{#each list as ch (ch.id)}
								<option value={ch.id}>{ch.label}</option>
							{/each}
							{#if !list.some((ch) => ch.id === c.id)}<option value={c.id}>{describe(tables, c.id)}</option>{/if}
						</select>
						{#if c.own}<button onclick={() => choose(t.path, 0, true)} title={scope === 'map' ? "Back to the client's" : 'Back to the wider choice'} aria-label="Undo the choice">↺</button>{/if}
					</span>
				{/each}
			</div>
		{/if}
		<p class="dim">A choice marked in blue is this scope's own and is saved with the map. Tufts show in the editor (View › Ground effects) and in the client after an export.</p>
		{#if hasBackend()}
			{#if making}
				<div class="section">New effect</div>
				<div class="new">
					{#each [0, 1, 2, 3] as k (k)}
						<select bind:value={picks[k]} aria-label="Model {k + 1}">
							<option value="">{k === 0 ? 'Pick a model' : '(none)'}</option>
							{#each models as m (m)}<option value={m}>{displayName('m2:' + m)}</option>{/each}
						</select>
					{/each}
					<label class="check">Density <input type="number" min="1" max="64" bind:value={density} /></label>
					<label class="check"
						>Footsteps <select bind:value={terrain}>
							{#each terrains as tt (tt.id)}<option value={tt.id}>{tt.label}</option>{/each}
						</select></label
					>
					<button class="active" onclick={() => void create()} disabled={!picks.some(Boolean)}>Make it</button>
					<button onclick={() => (making = false)}>Cancel</button>
				</div>
			{:else}
				<button onclick={() => (making = true)}>New effect…</button>
			{/if}
		{/if}
	{/if}
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 4px 0 8px;
	}
	.rows {
		display: grid;
		grid-template-columns: minmax(120px, 1fr) 2fr;
		gap: 4px 10px;
		align-items: center;
		max-height: calc(50 * var(--vh));
		overflow-y: auto;
	}
	.name {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	select {
		min-width: 0;
		width: 100%;
	}
	select.own {
		border-color: var(--accent);
	}
	.scope,
	.new,
	.pick {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 6px;
	}
	.new select {
		width: auto;
		max-width: 160px;
	}
	.new input[type='number'] {
		width: 56px;
	}
	.section {
		font-size: 11px;
		color: var(--text-dim);
		margin-top: 8px;
	}
</style>
