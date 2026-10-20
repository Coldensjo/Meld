<script lang="ts">
	import { SearchCreatures, SearchItems, SearchQuests, SearchSpells } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import type { CreatureField } from '../lib/world/creatureFields'
	import { areaName, loadAreas } from '../lib/wow/areas'
	import { QUALITY_COLORS } from '../lib/wow/itemTooltip'
	import { emoteList, questTables, refName, refTarget, rememberName, type NameKind, type RefName } from '../lib/wow/refNames'
	import { rememberSpells } from '../lib/wow/spells'
	import ItemIcon from './ItemIcon.svelte'
	import { loadObjectTemplates } from './SpawnBrowser.svelte'
	import SpellIcon from './SpellIcon.svelte'

	// A column that names a thing (#259, the quest editor): its number, the name of what it names
	// (an item with its icon and quality colour, a spell with its icon, a creature, a quest…), and
	// Find, a search that puts the picked thing's number in. An emote is a list to pick from.

	interface Props {
		f: CreatureField
		value: string
		changed: boolean
		onset: (value: string) => void
	}
	let { f, value, changed, onset }: Props = $props()

	const ref = $derived(f.ref ?? 'item')
	const target = $derived(refTarget(ref, Number(value) || 0))

	// The name of what the value names: null while it loads, false for none.
	let shown = $state<RefName | null | false>(false)
	$effect(() => {
		const t = target
		if (!t) {
			shown = false
			return
		}
		shown = null
		void refName(t.kind, t.id).then((r) => {
			if (target?.kind === t.kind && target.id === t.id) shown = r ?? { name: '' }
		})
	})

	// Emotes: a list.
	let emotes = $state<vmangos.Emote[]>([])
	$effect(() => {
		if (ref === 'emote' && !emotes.length) void emoteList().then((e) => (emotes = e))
	})

	// Find: a search by name or number.
	interface Hit {
		kind: NameKind
		id: number
		name: string
		sub: string
		quality?: number
		displayId?: number
		icon?: string
	}
	let open = $state(false)
	let query = $state('')
	let hits = $state<Hit[]>([])
	let searching = $state(false)
	let error = $state('')
	/** For a column that names one of two kinds, the one the search looks for. */
	let side = $state<'a' | 'b'>('a')
	const kinds = $derived<[NameKind, NameKind | null]>(ref === 'creature or object' ? ['creature', 'object'] : ref === 'zone or sort' ? ['zone', 'sort'] : [ref as NameKind, null])
	const kind = $derived(side === 'b' && kinds[1] ? kinds[1] : kinds[0])
	const SIDE_NAMES: Record<string, string> = { creature: 'Creature', object: 'Object', zone: 'Zone', sort: 'Quest sort' }

	function toggle() {
		open = !open
		if (open) {
			side = target && kinds[1] === target.kind ? 'b' : 'a'
			query = ''
			hits = []
		}
	}

	const LIMIT = 60
	const like = (name: string, id: number, q: string) => name.toLowerCase().includes(q.toLowerCase()) || String(id) === q

	async function search(k: NameKind, q: string): Promise<Hit[]> {
		switch (k) {
			case 'item':
				return ((await SearchItems(q)) ?? []).map((r) => ({ kind: k, id: r.entry, name: r.name, sub: String(r.entry), quality: r.quality, displayId: r.displayId }))
			case 'creature':
				return ((await SearchCreatures(q)) ?? []).map((r) => ({ kind: k, id: r.entry, name: r.subname ? `${r.name} <${r.subname}>` : r.name, sub: `${r.entry} · level ${r.levelMin}${r.levelMax > r.levelMin ? `–${r.levelMax}` : ''}` }))
			case 'object':
				return (await loadObjectTemplates())
					.filter((o) => like(o.name, o.entry, q))
					.slice(0, LIMIT)
					.map((o) => ({ kind: k, id: o.entry, name: o.name, sub: String(o.entry) }))
			case 'quest':
				return ((await SearchQuests(q)) ?? []).map((r) => ({ kind: k, id: r.quest, name: r.title, sub: `${r.quest} · level ${r.level}` }))
			case 'spell': {
				const list = (await SearchSpells(q)) ?? []
				rememberSpells(list)
				return list.map((s) => ({ kind: k, id: s.id, name: s.rank ? `${s.name} (${s.rank})` : s.name, sub: String(s.id), icon: s.icon }))
			}
			case 'zone':
				return (await loadAreas())
					.filter((a) => like(a.name, a.id, q))
					.slice(0, LIMIT)
					.map((a) => ({ kind: k, id: a.id, name: areaName(a.id), sub: String(a.id) }))
			case 'emote':
				return []
		}
		const t = await questTables()
		const list = k === 'faction' ? t.factions : k === 'skill' ? t.skills : t.sorts
		return list
			.filter((r) => like(r.name, r.id, q))
			.slice(0, LIMIT)
			.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
	}

	let timer = 0
	$effect(() => {
		const q = query.trim()
		const k = kind
		clearTimeout(timer)
		if (!open) return
		// The client's short lists show whole without a search; the zones, the objects and the
		// database's templates need one.
		const whole = k === 'faction' || k === 'skill' || k === 'sort'
		const local = whole || k === 'zone' || k === 'object'
		if (!q && !whole) {
			hits = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			error = ''
			try {
				const r = await search(k, q)
				if (q === query.trim() && k === kind) hits = r
			} catch (err) {
				error = String(err)
			} finally {
				searching = false
			}
		}, local ? 0 : 250)
	})

	function pick(h: Hit) {
		rememberName(h.kind, h.id, { name: h.name, quality: h.quality, displayId: h.displayId, icon: h.icon })
		const negative = h.kind === 'object' || h.kind === 'sort'
		onset(String(negative ? -h.id : h.id))
		open = false
	}
</script>

<div class="ref" class:changed class:wide={f.wide}>
	<span class="label" title={f.hint ? `${f.hint} (${f.col})` : f.col}>{f.label}</span>
	{#if ref === 'emote'}
		<select value={value} onchange={(e) => onset((e.currentTarget as HTMLSelectElement).value)} aria-label={f.label}>
			<option value="0">None</option>
			{#if value !== '0' && value !== '' && !emotes.some((e) => String(e.id) === value)}<option value={value}>{value}</option>{/if}
			{#each emotes as e (e.id)}{#if e.id > 0}<option value={String(e.id)}>{e.name} ({e.id})</option>{/if}{/each}
		</select>
	{:else}
		<span class="row">
			<input type="number" step="1" {value} oninput={(e) => onset((e.currentTarget as HTMLInputElement).value)} aria-label={f.label} />
			<span class="name" title={target ? `${target.kind} ${target.id}` : ''}>
				{#if target && shown && shown.name}
					{#if target.kind === 'item'}<ItemIcon displayId={shown.displayId ?? 0} />{:else if target.kind === 'spell'}<SpellIcon icon={shown.icon ?? ''} />{/if}
					<span style:color={target.kind === 'item' ? (QUALITY_COLORS[shown.quality ?? 1] ?? QUALITY_COLORS[1]) : undefined}>{shown.name}</span>
					{#if kinds[1]}<span class="dim">({SIDE_NAMES[target.kind]})</span>{/if}
				{:else if target && shown}
					<span class="missing">No {target.kind} {target.id}</span>
				{:else if target}
					<span class="dim">…</span>
				{:else}
					<span class="dim">None</span>
				{/if}
			</span>
			<button class:on={open} onclick={toggle} title="Find by name">Find</button>
			<button disabled={!target} onclick={() => onset('0')} title="Clear">✕</button>
		</span>
		{#if open}
			<div class="find">
				<span class="row">
					{#if kinds[1]}
						<button class:on={side === 'a'} onclick={() => (side = 'a')}>{SIDE_NAMES[kinds[0]]}</button>
						<button class:on={side === 'b'} onclick={() => (side = 'b')}>{SIDE_NAMES[kinds[1]]}</button>
					{/if}
					<!-- svelte-ignore a11y_autofocus -->
					<input type="search" placeholder="Name or number" bind:value={query} autofocus />
				</span>
				{#if error}<p class="missing">{error}</p>{/if}
				<ul>
					{#each hits as h (h.kind + h.id)}
						<li>
							<button onclick={() => pick(h)}>
								{#if h.kind === 'item'}<ItemIcon displayId={h.displayId ?? 0} />{:else if h.kind === 'spell'}<SpellIcon icon={h.icon ?? ''} />{/if}
								<span class="hit" style:color={h.kind === 'item' ? (QUALITY_COLORS[h.quality ?? 1] ?? QUALITY_COLORS[1]) : undefined}>{h.name}</span>
								<span class="dim">{h.sub}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{searching ? 'Searching…' : query.trim() ? 'Nothing matches.' : 'Type a name or a number.'}</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
</div>

<style>
	.ref {
		grid-column: span 2;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		color: var(--text-dim);
	}
	.ref.wide {
		grid-column: 1 / -1;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.row input[type='number'] {
		width: 80px;
		flex: none;
	}
	.row input[type='search'] {
		flex: 1;
		min-width: 0;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		overflow: hidden;
		white-space: nowrap;
		color: var(--text);
	}
	.name span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	button {
		padding: 1px 6px;
		flex: none;
	}
	button.on {
		background: var(--accent);
		color: #fff;
	}
	.find {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 200px;
		overflow-y: auto;
	}
	li button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 3px 4px;
	}
	li button:hover {
		background: var(--panel-3);
	}
	.hit {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.dim {
		color: var(--text-dim);
	}
	.missing {
		color: var(--danger-text);
		margin: 0;
	}
	select {
		width: 100%;
		min-width: 0;
	}
	.changed .label,
	.changed input,
	.changed select {
		color: var(--accent-text);
	}
	.changed input,
	.changed select {
		border-color: var(--accent);
	}
</style>
