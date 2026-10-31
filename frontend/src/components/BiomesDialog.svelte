<script lang="ts">
	import { numOr0 as num } from '../lib/ui/inputs'
	import Modal from './Modal.svelte'
	import { editor, prefs, setStatus, ui, wow } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { activeDoodadBrush } from '../lib/tools/DoodadBrushTool'
	import { BIOME_ROLES, DEFAULT_BIOME_RULES, copyBiome, freeBiomeName, newBiome, type Biome, type BiomeRules } from '../lib/terrain/biome'
	import { activeBiome } from '../lib/terrain/activeBiome'
	import { biomeFromZone } from '../lib/wow/zoneBiome'
	import { groundEffectTables } from '../lib/wow/groundEffectTables'
	import { effectFor, knownEffects, type GroundEffectTables } from '../lib/world/groundEffects'
	import { displayName } from '../lib/models/assets'
	import { texName as shortName } from '../lib/wow/texName'
	import { MapEntries, MapZones, ZoneDoodads, ZoneTextures } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'

	// Paint › Biomes… (#957): the saved biomes, each a set of textures for auto-paint's roles with the
	// thresholds of its rules, a ground effect per texture and the doodad brushes it scatters, made by
	// hand or from a zone of the client, and applied to the selected area or the paint mask.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const biome = $derived(activeBiome())
	const texName = (p: string) => (p ? shortName(p) : 'none')
	const paintTexture = $derived(editor.palette[editor.paintLayer] ?? '')
	const brush = $derived(activeDoodadBrush())

	/** Changes the biome in place and hands prefs a new list, so the change is saved. */
	function change(fn: (b: Biome) => void) {
		const b = activeBiome()
		if (!b) return
		fn(b)
		prefs.biomes = [...prefs.biomes]
	}

	function add(b: Biome) {
		prefs.biomes = [...prefs.biomes, b]
		prefs.biome = b.name
	}

	function rename(name: string) {
		const n = name.trim()
		const b = activeBiome()
		if (!b || !n || prefs.biomes.some((x) => x.name === n && x !== b)) return
		change((x) => (x.name = n))
		prefs.biome = n
	}

	async function remove() {
		const b = activeBiome()
		if (!b || !(await askConfirm(`Delete the biome "${b.name}"?`, { title: 'Delete biome', ok: 'Delete' }))) return
		prefs.biomes = prefs.biomes.filter((x) => x !== b)
		prefs.biome = prefs.biomes[0]?.name ?? ''
	}

	function setTexture(r: number, path: string) {
		change((b) => {
			const old = b.textures[r]
			b.textures[r] = path
			if (old && !b.textures.includes(old)) delete b.effects[old]
		})
	}

	function setRule<K extends keyof BiomeRules>(k: K, v: BiomeRules[K]) {
		change((b) => (b.rules = { ...b.rules, [k]: v }))
	}

	/** The ground effect a texture grows: the biome's own, else the client's; '' for a colour or none. */
	function effectOf(b: Biome, path: string): string {
		if (!path || path.startsWith('#')) return ''
		return String(b.effects[path] ?? effectFor(path, {}, groundEffectTables()))
	}

	function setEffect(path: string, v: string) {
		change((b) => {
			if (v.trim() === '') delete b.effects[path]
			else b.effects[path] = Math.max(0, Math.round(+v || 0))
		})
	}

	/** What an effect grows, for a label: its models' names and density. */
	function describe(t: GroundEffectTables, id: number): string {
		const e = t.effects[id]
		if (!e) return `effect ${id}`
		return `${[...new Set(e.doodads.map((d) => displayName('m2:' + d)))].join(', ')} · ${e.density}`
	}

	/** The effects to pick for a texture: none, the client's own for it, then every effect the client has (and the biome's own if the client lacks it). */
	function effectChoices(path: string): Array<{ id: number; label: string }> {
		const t = groundEffectTables()
		const out = [{ id: 0, label: 'none' }]
		if (!t) return out
		const learned = t.textures[path.toLowerCase()] ?? 0
		if (learned) out.push({ id: learned, label: `${describe(t, learned)} (the client's)` })
		for (const k of knownEffects(t)) if (k.id !== learned) out.push({ id: k.id, label: describe(t, k.id) })
		const own = biome?.effects[path]
		if (own && !out.some((c) => c.id === own)) out.push({ id: own, label: describe(t, own) })
		return out
	}

	// --- Make from a zone ---------------------------------------------------------------------------
	let maps = $state<vmangos.MapEntry[]>([])
	let zones = $state<vmangos.Zone[]>([])
	let zoneArea = $state(0)
	let making = $state(false)
	let zoneError = $state('')
	$effect(() => {
		if (!hasBackend() || !wow.loaded) return
		MapEntries()
			.then((list) => (maps = list))
			.catch((err) => (zoneError = String(err)))
		MapZones()
			.then((list) => (zones = list))
			.catch((err) => (zoneError = String(err)))
	})
	const zoneGroups = $derived.by(() => {
		const seen = new Set<number>()
		const groups: { name: string; zones: vmangos.Zone[] }[] = []
		for (const z of [...zones].sort((a, b) => a.MapID - b.MapID || a.Name.localeCompare(b.Name))) {
			const map = maps.find((m) => m.ID === z.MapID)
			if (seen.has(z.AreaID) || !map) continue
			seen.add(z.AreaID)
			if (groups.at(-1)?.name !== map.Name) groups.push({ name: map.Name, zones: [] })
			groups.at(-1)!.zones.push(z)
		}
		return groups
	})

	async function makeFromZone() {
		const z = zones.find((x) => x.AreaID === zoneArea)
		const dir = z && maps.find((m) => m.ID === z.MapID)?.Dir
		if (!z || !dir || making) return
		making = true
		zoneError = ''
		try {
			const [uses, list] = await Promise.all([ZoneTextures(dir, z), ZoneDoodads(dir, z)])
			const b = biomeFromZone(freeBiomeName(prefs.biomes, z.Name), uses ?? [], list.doodads ?? [], list.landArea, groundEffectTables())
			if (!b) zoneError = `${z.Name} has no ground textures of its own.`
			else {
				add(b)
				setStatus(`Made the biome "${b.name}" from ${z.Name}.`, 5000)
			}
		} catch (err) {
			zoneError = String(err)
		} finally {
			making = false
		}
	}

	async function apply(useMask: boolean) {
		const b = activeBiome()
		const e = engineRef.current
		if (!b || !e) return
		await e.applyBiome(b, useMask)
	}
</script>

<Modal title="Biomes" width={760} {onclose}>
	<div class="top">
		{#if biome}
			<select value={biome.name} onchange={(e) => (prefs.biome = e.currentTarget.value)} aria-label="Biome">
				{#each prefs.biomes as b (b.name)}<option value={b.name}>{b.name}</option>{/each}
			</select>
			<input value={biome.name} onchange={(e) => rename(e.currentTarget.value)} aria-label="Biome name" title="Rename the biome" />
		{/if}
		<button onclick={() => add(newBiome(freeBiomeName(prefs.biomes), paintTexture ? [paintTexture] : []))}>New biome</button>
		<button onclick={() => biome && add({ ...copyBiome(biome), name: freeBiomeName(prefs.biomes, biome.name) })} disabled={!biome}>Duplicate</button>
		<button onclick={remove} disabled={!biome}>Delete</button>
	</div>
	<div class="zone">
		<span>Make from a zone</span>
		<select bind:value={zoneArea} disabled={!wow.loaded || !zones.length} aria-label="Zone">
			<option value={0}>{wow.loaded ? 'Pick a zone…' : 'No client loaded'}</option>
			{#each zoneGroups as g (g.name)}
				<optgroup label={g.name}>
					{#each g.zones as z (z.AreaID)}<option value={z.AreaID}>{z.Name}</option>{/each}
				</optgroup>
			{/each}
		</select>
		<button onclick={makeFromZone} disabled={!zoneArea || making}>{making ? 'Reading the zone…' : 'Make biome'}</button>
		{#if zoneError}<span class="err">{zoneError}</span>{/if}
	</div>
	{#if biome}
		<h4>Textures</h4>
		<div class="tex">
			<span class="h">Role</span><span class="h">Texture</span><span class="h"></span><span class="h" title="The ground effect it grows: the client's own for the texture unless you pick another">Ground effect</span>
			{#each BIOME_ROLES as role, r (role)}
				<span>{role}</span>
				<span class="path" title={biome.textures[r]}
					>{texName(biome.textures[r])}{#if !biome.textures[r] && r > 0}<span class="dim"> (as {BIOME_ROLES[r === 3 || r === 4 ? 2 : r === 5 ? 3 : 0].toLowerCase()})</span>{/if}</span
				>
				<span class="ops">
					<button onclick={() => setTexture(r, paintTexture)} disabled={!paintTexture} title="Use the texture picked to paint with ({texName(paintTexture)})">Use paint texture</button>
					<button onclick={() => setTexture(r, '')} disabled={!biome.textures[r]} title="No texture of its own" aria-label="Clear">✕</button>
				</span>
				<select
					value={biome.textures[r] ? effectOf(biome, biome.textures[r]) : ''}
					disabled={!biome.textures[r] || biome.textures[r].startsWith('#')}
					onchange={(e) => setEffect(biome.textures[r], e.currentTarget.value)}
					aria-label="Ground effect"
				>
					{#if biome.textures[r]}{#each effectChoices(biome.textures[r]) as c (c.id)}<option value={String(c.id)}>{c.label}</option>{/each}{/if}
				</select>
			{/each}
		</div>
		<label class="scope" title="Write the ground effects for the tiles the area touches only, leaving the texture's effect elsewhere on the map as it is">
			<input type="checkbox" checked={!!biome.tileEffects} onchange={(e) => change((b) => (b.tileEffects = e.currentTarget.checked))} /> Ground effects for the area's tiles only
		</label>
		<h4>Rules</h4>
		<div class="rules">
			<label>Rock from <input type="number" min="0" max="89" step="1" value={biome.rules.rock[0]} onchange={(e) => setRule('rock', [num(e), biome.rules.rock[1]])} />°</label>
			<label>to <input type="number" min="0" max="89" step="1" value={biome.rules.rock[1]} onchange={(e) => setRule('rock', [biome.rules.rock[0], num(e)])} />°</label>
			<label>Dirt rim from <input type="number" min="0" max="89" step="1" value={biome.rules.dirt[0]} onchange={(e) => setRule('dirt', [num(e), biome.rules.dirt[1]])} />°</label>
			<label>to <input type="number" min="0" max="89" step="1" value={biome.rules.dirt[1]} onchange={(e) => setRule('dirt', [biome.rules.dirt[0], num(e)])} />°</label>
			<label>Lush patches <input type="number" min="0" max="1" step="0.05" value={biome.rules.lush} onchange={(e) => setRule('lush', Math.min(1, Math.max(0, num(e))))} /></label>
			<label>across <input type="number" min="10" step="10" value={biome.rules.variation} onchange={(e) => setRule('variation', Math.max(10, num(e)))} /> yd</label>
			<label>Sand up to <input type="number" min="0" step="0.5" value={biome.rules.sand} onchange={(e) => setRule('sand', Math.max(0, num(e)))} /> yd over the water</label>
			<label>
				<input type="checkbox" checked={biome.rules.snow !== null} onchange={(e) => setRule('snow', e.currentTarget.checked ? 110 : null)} /> Snow above
				<input type="number" step="5" value={biome.rules.snow ?? ''} disabled={biome.rules.snow === null} onchange={(e) => setRule('snow', num(e))} /> yd over the sea
			</label>
			<button onclick={() => setRule('rock', [...DEFAULT_BIOME_RULES.rock])} title="Auto-paint's own rock slopes">Default rock</button>
		</div>
		<h4>Scatter</h4>
		<div class="scatter">
			<span class="h">Doodad brush</span><span class="h" title="Placements tried per 100 by 100 yards">Density</span><span class="h">Clumps</span><span class="h"></span>
			{#each biome.scatter as s, i (i)}
				<span title={s.brush.entries.map((e) => e.type).join('\n')}>{s.brush.name} <span class="dim">({s.brush.entries.length} models)</span></span>
				<input type="number" min="0" step="1" value={s.density} onchange={(e) => change((b) => (b.scatter[i].density = Math.max(0, num(e))))} aria-label="Density" />
				<input type="checkbox" checked={s.clumps} onchange={(e) => change((b) => (b.scatter[i].clumps = e.currentTarget.checked))} aria-label="Clumps" />
				<button onclick={() => change((b) => b.scatter.splice(i, 1))} title="Scatter it no more" aria-label="Remove">✕</button>
			{/each}
		</div>
		<button
			onclick={() => change((b) => b.scatter.push({ brush: JSON.parse(JSON.stringify(brush)), density: 10, clumps: false }))}
			disabled={!brush || !brush.entries.length}
			title="A copy of the Doodad tool's brush: a later edit of that brush leaves the biome's alone">Add doodad brush{brush ? ` "${brush.name}"` : ''}</button
		>
	{/if}
	{#snippet actions()}
		<button onclick={() => apply(false)} disabled={!biome || !editor.selection} title="Paint and scatter it over the selected area, fading out inside its edge">Apply to Selection</button>
		<button onclick={() => apply(true)} disabled={!biome || !ui.maskActive} title="Paint and scatter it over the paint mask, by its value">Apply to Mask</button>
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.dim {
		color: var(--text-dim);
	}
	.err {
		color: var(--danger, #e66);
		font-size: 11px;
	}
	h4 {
		margin: 12px 0 4px;
		font-size: 12px;
	}
	.top,
	.zone,
	.rules {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.zone {
		margin-top: 8px;
	}
	.tex,
	.scatter {
		display: grid;
		gap: 4px 8px;
		align-items: center;
	}
	.tex {
		grid-template-columns: auto minmax(160px, 1fr) auto minmax(180px, 1fr);
	}
	.scatter {
		grid-template-columns: minmax(240px, 1fr) 80px auto auto;
		margin-bottom: 6px;
	}
	.h {
		color: var(--text-dim);
		font-size: 11px;
	}
	.path {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ops {
		display: flex;
		gap: 4px;
	}
	.rules input[type='number'] {
		width: 60px;
	}
</style>
