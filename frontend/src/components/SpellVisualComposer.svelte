<script lang="ts" module>
	import { ListVisualEffects } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The client's effect models, read once a session.
	let effectList: Promise<vmangos.VisualEffect[]> | null = null

	export function loadVisualEffects(): Promise<vmangos.VisualEffect[]> {
		if (!effectList) {
			effectList = ListVisualEffects().then((l) => l ?? [])
			effectList.catch(() => (effectList = null))
		}
		return effectList
	}

	/** The composer's stages in the order a cast plays them: a kit stage's index in VisualDesign.stages, or the missile or area. */
	export const STAGES: Array<{ key: string; name: string; kit?: number; hint: string }> = [
		{ key: 'precast', name: 'Precast', kit: 0, hint: 'On the caster while the cast bar fills' },
		{ key: 'cast', name: 'Cast', kit: 1, hint: 'On the caster as the spell goes off' },
		{ key: 'channel', name: 'Channel', kit: 4, hint: 'On the caster while it channels' },
		{ key: 'missile', name: 'Missile', hint: 'What flies from the caster to the target' },
		{ key: 'impact', name: 'Impact', kit: 2, hint: 'On the target when the spell lands' },
		{ key: 'state', name: 'State', kit: 3, hint: 'On the target while the aura lasts' },
		{ key: 'area', name: 'Area', hint: 'On the ground where an area spell lands, while it lasts' },
	]

	/** A kit's attachment points, in the order of SpellVisualKit.dbc's fields 3 to 12. */
	export const SLOTS = ['Head', 'Chest', 'Base', 'Left hand', 'Right hand', 'Breath', 'Left weapon', 'Right weapon', 'Special 1', 'Special 2']

	/** The effects a stage of a design shows, by ID (0s left out). */
	export function stageEffects(d: vmangos.VisualDesign, key: string): number[] {
		const s = STAGES.find((x) => x.key === key)
		if (!s) return []
		if (s.kit !== undefined) return (d.stages[s.kit]?.effects ?? []).filter((e) => e > 0)
		const e = key === 'missile' ? d.missile : d.area
		return e > 0 ? [e] : []
	}
</script>

<script lang="ts">
	import { ReadSpellVisual } from '../../wailsjs/go/main/App'
	import CreaturePreview from './CreaturePreview.svelte'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'

	// The spell editor's visual composer (#361): a new visual put together from the client's pieces.
	// Each stage of a cast (precast, cast, channel, missile, impact, state, area) can be taken from any
	// spell, and a stage's effect models changed one attachment point at a time from the client's effect
	// models. The model under the pointer, or the one picked, plays in the preview. Apply hands the design
	// back to the editor, whose Save adds the new kits and visual to Meld's patch.

	interface Props {
		/** The design being edited (a copy the composer may change). */
		design: vmangos.VisualDesign
		onapply: (d: vmangos.VisualDesign) => void
		oncancel: () => void
	}
	let { design = $bindable(), onapply, oncancel }: Props = $props()

	let effects = $state<vmangos.VisualEffect[]>([])
	let error = $state('')
	$effect(() => {
		loadVisualEffects().then(
			(l) => (effects = l),
			(err) => (error = String(err)),
		)
	})
	const byId = $derived(new Map(effects.map((e) => [e.id, e])))
	const effectName = (id: number) => byId.get(id)?.name ?? `effect ${id}`

	let stage = $state('area')
	const current = $derived(STAGES.find((s) => s.key === stage) ?? STAGES[0])
	/** The attachment point picked on a kit stage (its index), or 0 for the missile and area's one model. */
	let slot = $state(0)
	let hover = $state<number | null>(null)

	/** The effect on the stage's picked point. */
	const picked = $derived(current.kit !== undefined ? (design.stages[current.kit]?.effects[slot] ?? 0) : current.key === 'missile' ? design.missile : design.area)
	const shownEffect = $derived(hover ?? (picked || stageEffects(design, stage)[0] || 0))
	const shownModel = $derived(shownEffect ? (byId.get(shownEffect)?.model ?? '') : '')

	function pickStage(key: string) {
		stage = key
		const s = STAGES.find((x) => x.key === key)
		// The first point that has an effect, else the base (the ground) or the chest.
		const fx = s?.kit !== undefined ? (design.stages[s.kit]?.effects ?? []) : []
		const first = fx.findIndex((e) => e > 0)
		slot = s?.kit === undefined ? 0 : first >= 0 ? first : 2
		hover = null
	}

	function setEffect(id: number) {
		if (current.kit !== undefined) design.stages[current.kit].effects[slot] = id
		else if (current.key === 'missile') {
			design.missile = id
			if (!id) design.missileFrom = 0
		} else {
			design.area = id
			if (!id) design.areaFrom = 0
		}
	}

	function clearStage() {
		if (current.kit !== undefined) design.stages[current.kit] = { id: 0, effects: Array(SLOTS.length).fill(0) } as vmangos.VisualKit
		else setEffect(0)
	}

	// The effect list: filtered by name or file.
	let query = $state('')
	const matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const out = words.length ? effects.filter((e) => words.every((w) => `${e.name} ${e.model} ${e.id}`.toLowerCase().includes(w))) : effects
		return out.slice(0, 300)
	})

	// Take a stage, or every stage, from a spell, browsed by category and school (SpellPicker, #367).
	async function take(s: vmangos.SpellRef, all: boolean) {
		error = ''
		try {
			const src = await ReadSpellVisual(s.visual)
			// Many spells share a name (the helpers a spell triggers, NPC versions): one without this stage would only clear it.
			if (!all && !stageEffects(src, current.key).length) {
				error = `${s.name}${s.rank ? ` (${s.rank})` : ''}, spell ${s.id}, has no ${current.name.toLowerCase()}: try another of that name.`
				return
			}
			if (all) design = src
			else if (current.kit !== undefined) design.stages[current.kit] = src.stages[current.kit]
			else if (current.key === 'missile') {
				design.missile = src.missile
				design.missileFrom = src.missileFrom
			} else {
				design.area = src.area
				design.areaFrom = src.areaFrom
			}
			taken = `${all ? 'Every stage' : current.name} from ${s.name}${s.rank ? ` (${s.rank})` : ''}.`
			pickStage(stage)
		} catch (err) {
			error = String(err)
		}
	}
	let taken = $state('')
</script>

<div class="composer" aria-label="Compose visual">
	<div class="bar">
		<div class="what">
			<strong>Compose visual</strong>
			<span class="dim">Take each stage from any spell, or change a stage's effect models. {taken}</span>
		</div>
		<button onclick={oncancel} title="Back to the spell (Esc)">Cancel</button>
		<button class="active" onclick={() => onapply(design)}>Use this visual</button>
	</div>
	{#if error}<p class="error">{error}</p>{/if}
	<div class="top">
		<ul class="stages" aria-label="Stages">
			{#each STAGES as s (s.key)}
				{@const fx = stageEffects(design, s.key)}
				<li>
					<button class:on={stage === s.key} onclick={() => pickStage(s.key)} title={s.hint}>
						<strong>{s.name}</strong>
						<span class="dim">{fx.length ? fx.map(effectName).join(', ') : 'none'}</span>
					</button>
				</li>
			{/each}
		</ul>
		<div class="preview">
			{#if shownModel}
				<CreaturePreview type={`m2:${shownModel}`} scale={1} />
			{:else}
				<div class="empty dim">{effects.length ? 'No effect to show: pick one below.' : 'Reading the client’s effects…'}</div>
			{/if}
			<p class="dim caption">{shownEffect ? `${effectName(shownEffect)} · ${shownModel}` : ''}</p>
		</div>
	</div>
	<div class="bottom">
		<div class="detail">
			<h3>{current.name} <span class="dim">· {current.hint}</span></h3>
			{#if current.kit !== undefined}
				<div class="slots" role="group" aria-label="Attachment points">
					{#each SLOTS as name, i (name)}
						{@const e = design.stages[current.kit]?.effects[i] ?? 0}
						<button class:on={slot === i} class:set={e > 0} onclick={() => (slot = i)} title={e ? effectName(e) : 'Nothing here'}>
							<span>{name}</span>
							<span class="dim">{e ? effectName(e) : '—'}</span>
						</button>
					{/each}
				</div>
			{/if}
			<div class="row">
				<button disabled={!picked} onclick={() => setEffect(0)}>Remove {current.kit !== undefined ? `the ${SLOTS[slot].toLowerCase()} effect` : `the ${current.name.toLowerCase()}`}</button>
				<button disabled={!stageEffects(design, stage).length} onclick={clearStage}>Clear the stage</button>
			</div>
			<h3>Take from a spell</h3>
			<SpellPicker memoryKey="visual" height={160} text={false} label="Take from a spell" listLabel="Spells to take from" placeholder="A spell: Rain of Fire, Blizzard, Frostbolt…">
				{#snippet row(s: vmangos.SpellRef)}
					<span class="hit">
						<SpellIcon icon={s.icon} />
						<span class="name"
							>{s.name}{#if s.rank}<span class="dim"> {s.rank}</span>{/if}</span
						>
						<span class="dim">{s.id}</span>
						<button disabled={!s.visual} onclick={() => take(s, false)} title={s.visual ? `Use its ${current.name.toLowerCase()} for this visual's` : 'It has no visual'}>Its {current.name.toLowerCase()}</button>
						<button disabled={!s.visual} onclick={() => take(s, true)} title={s.visual ? 'Start again from its whole visual' : 'It has no visual'}>All</button>
					</span>
				{/snippet}
			</SpellPicker>
		</div>
		<div class="effects">
			<h3>Effect models <span class="dim">· {current.kit !== undefined ? `for the ${SLOTS[slot].toLowerCase()}` : `the ${current.name.toLowerCase()}`}; hover to preview, click to use</span></h3>
			<input type="search" placeholder="Search: fire, ice, impact, shadow…" bind:value={query} aria-label="Search the effect models" />
			<ul class="list" aria-label="Effect models" onpointerleave={() => (hover = null)}>
				{#each matches as e (e.id)}
					<li>
						<button class:on={e.id === picked} onclick={() => setEffect(e.id)} onpointerover={() => (hover = e.id)} title={e.model}>
							<span class="name">{e.name}</span>
							<span class="dim">{e.id}</span>
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>

<style>
	.composer {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		font-size: 12px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.top {
		flex: 1 1 45%;
		min-height: 200px;
		display: flex;
		gap: 10px;
	}
	.stages {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 260px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow-y: auto;
	}
	.stages button {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		text-align: left;
		padding: 4px 8px;
	}
	.stages button.on {
		border-color: var(--accent);
	}
	.stages .dim {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.preview {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
		background: var(--preview-bg);
	}
	.caption {
		padding: 4px 8px;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.bottom {
		flex: 1 1 50%;
		min-height: 200px;
		display: flex;
		gap: 12px;
	}
	.detail,
	.effects {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	h3 {
		margin: 4px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h3 .dim {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.slots {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 3px;
	}
	.slots button {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		padding: 3px 6px;
		text-align: left;
		min-width: 0;
	}
	.slots button .dim {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.slots button.set > span:first-child {
		color: var(--accent-text);
	}
	.slots button.on {
		border-color: var(--accent);
	}
	.row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
	}
	.hit button {
		padding: 1px 6px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.list {
		flex: 1;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.list button {
		width: 100%;
		display: flex;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 2px 6px;
		text-align: left;
	}
	.list button:hover {
		background: var(--panel-2);
	}
	.list button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
</style>
