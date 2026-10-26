<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { SearchCreatures, SearchItems, SearchQuests, SearchWorldRefs } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { ownListIds, type CreatureField } from '../lib/world/creatureFields'
	import { areaName, loadAreas } from '../lib/wow/areas'
	import { QUALITY_VARS } from '../lib/wow/itemTooltip'
	import {
		ITEM_TABLE_KINDS,
		NUMBER_ONLY_KINDS,
		OBJECT_TABLE_KINDS,
		emoteList,
		factionTemplateName,
		factionTemplates,
		iconFileName,
		itemTableList,
		itemTables,
		isWorldKind,
		lockName,
		objectTableList,
		objectTables,
		questTableList,
		questTables,
		reactionText,
		refName,
		refTarget,
		rememberName,
		spellTables,
		type NameKind,
		type RefName,
	} from '../lib/wow/refNames'
	import EquipIcons from './EquipIcons.svelte'
	import ItemIcon from './ItemIcon.svelte'
	import { loadObjectTemplates } from './SpawnBrowser.svelte'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'

	// A column that names a thing (#259, the quest editor): its number, the name of what it names
	// (an item with its icon and quality colour, a spell with its icon, a creature, a quest…), and
	// Find, a search that puts the picked thing's number in. An emote is a list to pick from. A faction
	// template lists its faction's name with how it treats Alliance and Horde players (#699). A game
	// object's data columns (#702) name client table rows (a lock by what opens it, a language, a
	// flight path…), listed whole, and world database rows (a gossip menu or page by its first line,
	// an event script or loot list by its size), searched by text or number. The item editor's (#701)
	// add item sets, cooldown categories (named by their spells) and maps, listed whole, and random
	// enchantments and disenchant loot, named by what they give and searched. The creature editor's
	// lists (#700: vendor, trainer, equipment, loot and spell lists) are named by what they hold and
	// how many creatures use them; a list numbered as the creature's own (`own`) says so and is
	// offered when Find opens. `options` beside `ref` name special values (a gossip menu's −1). The
	// spell editor's (#703) add global cooldown categories (named by their spells) and icons (with
	// their pictures), listed whole, and visuals, named by the spells that use them and found by
	// taking the visual of a spell. The quest editor's (#704) add mail templates (by their letter's
	// first line), listed whole, and start and end scripts and exclusive groups (by the quests in
	// them), searched; `owner` names what an own list belongs to ("this quest's own").

	interface Props {
		f: CreatureField
		value: string
		changed: boolean
		onset: (value: string) => void
		/** The record's entry, for `own`. */
		entry?: number
		/** Hide the label (a caller that labels the field itself). */
		bare?: boolean
		/** What the record is, for `own` ("this creature's own"). */
		owner?: string
	}
	let { f, value, changed, onset, entry = 0, bare = false, owner = 'creature' }: Props = $props()

	const ref = $derived(f.ref ?? 'item')
	/** A special value's name (`options`), shown instead of a lookup. */
	const special = $derived(f.options?.find(([v]) => String(v) === value.trim())?.[1])
	const target = $derived(special === undefined ? refTarget(ref, Number(value) || 0) : null)
	/** The numbers this creature's own list has (`own`). */
	const ownIds = $derived(ownListIds(f.own, entry))
	const isOwn = (id: number) => ownIds.includes(id)

	// The name of what the value names: null while it loads, false for none.
	let shown = $state<RefName | null | false>(false)
	$effect(() => {
		const t = target
		if (special !== undefined) {
			shown = { name: special }
			return
		}
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

	// Find: a search by name or number; a spell is browsed by category too (SpellPicker, #367).
	interface Hit {
		kind: NameKind
		id: number
		name: string
		sub: string
		quality?: number
		displayId?: number
		icon?: string
		/** The name the field shows once picked, when it is not `name`. */
		full?: string
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
		if (isWorldKind(k)) return ((await SearchWorldRefs(k, q)) ?? []).map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
		switch (k) {
			case 'item':
				return ((await SearchItems(q)) ?? []).map((r) => ({ kind: k, id: r.entry, name: r.name, sub: String(r.entry), quality: r.quality, displayId: r.displayId }))
			case 'creature':
				return ((await SearchCreatures(q)) ?? []).map((r) => ({
					kind: k,
					id: r.entry,
					name: r.subname ? `${r.name} <${r.subname}>` : r.name,
					sub: `${r.entry} · level ${r.levelMin}${r.levelMax > r.levelMin ? `–${r.levelMax}` : ''}`,
				}))
			case 'object':
				return (await loadObjectTemplates())
					.filter((o) => like(o.name, o.entry, q))
					.slice(0, LIMIT)
					.map((o) => ({ kind: k, id: o.entry, name: o.name, sub: String(o.entry) }))
			case 'quest':
				return ((await SearchQuests(q)) ?? []).map((r) => ({ kind: k, id: r.quest, name: r.title, sub: `${r.quest} · level ${r.level}` }))
			case 'spell':
			case 'spell visual':
				return []
			case 'global category':
				return (await spellTables()).globalCategories
					.filter((r) => like(r.name, r.id, q))
					.slice(0, 300)
					.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
			case 'item enchantment':
				return (await spellTables()).enchantments
					.filter((r) => like(r.name, r.id, q))
					.slice(0, 300)
					.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
			case 'spell icon':
				// Each hit decodes its picture: fewer than the other lists.
				return (await spellTables()).icons
					.filter((r) => like(iconFileName(r.name), r.id, q))
					.slice(0, 80)
					.map((r) => ({ kind: k, id: r.id, name: iconFileName(r.name), sub: String(r.id), icon: r.name }))
			case 'zone':
				return (await loadAreas())
					.filter((a) => like(a.name, a.id, q))
					.slice(0, LIMIT)
					.map((a) => ({ kind: k, id: a.id, name: areaName(a.id), sub: String(a.id) }))
			case 'emote':
				return []
			case 'lock': {
				const t = await objectTables()
				const named = await Promise.all(t.locks.map(async (l) => ({ id: l.id, name: await lockName(l, t.lockTypes) })))
				return named
					.filter((l) => like(l.name, l.id, q))
					.slice(0, 300)
					.map((l) => ({ kind: k, id: l.id, name: l.name, sub: String(l.id) }))
			}
			case 'lock type':
			case 'language':
			case 'page material':
			case 'spell focus':
			case 'cinematic':
			case 'taxi path':
			case 'auction house':
				return objectTableList(await objectTables(), k)
					.filter((r) => like(r.name, r.id, q))
					.slice(0, 300)
					.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
			case 'item set':
			case 'spell category':
			case 'map':
				return itemTableList(await itemTables(), k)
					.filter((r) => like(r.name, r.id, q))
					.slice(0, 300)
					.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
			case 'faction template':
				return (await factionTemplates())
					.filter((f) => like(f.name, f.id, q) || (q !== '' && reactionText(f).includes(q.toLowerCase())))
					.slice(0, 300)
					.map((f) => ({ kind: k, id: f.id, name: f.name || 'Unnamed', sub: `${f.id} · ${reactionText(f)}`, full: factionTemplateName(f) }))
		}
		return questTableList(await questTables(), k)
			.filter((r) => like(r.name, r.id, q))
			.slice(0, LIMIT)
			.map((r) => ({ kind: k, id: r.id, name: r.name, sub: String(r.id) }))
	}

	let timer = 0
	$effect(() => {
		const q = query.trim()
		const k = kind
		clearTimeout(timer)
		if (!open || k === 'spell' || k === 'spell visual') return
		// The client's short lists show whole without a search; the zones, the objects and the
		// database's templates need one.
		const whole =
			k === 'faction' ||
			k === 'faction template' ||
			k === 'skill' ||
			k === 'sort' ||
			k === 'mail template' ||
			k === 'global category' ||
			k === 'item enchantment' ||
			k === 'spell icon' ||
			(OBJECT_TABLE_KINDS as readonly NameKind[]).includes(k) ||
			(ITEM_TABLE_KINDS as readonly NameKind[]).includes(k)
		const local = whole || k === 'zone' || k === 'object'
		if (!q && !whole) {
			hits = []
			// Before a search: the special values and the creature's own list, if it has one.
			const starters: Hit[] = (f.options ?? []).map(([id, name]) => ({ kind: k, id, name, sub: String(id) }))
			if (ownIds.length) {
				void Promise.all(ownIds.map(async (id) => ({ id, r: await refName(k, id) }))).then((found) => {
					if (query.trim() || kind !== k) return
					hits = [...starters, ...found.filter((x) => x.r).map(({ id, r }) => ({ kind: k, id, name: r?.name ?? '', sub: String(id) }))]
				})
			} else hits = starters
			return
		}
		timer = window.setTimeout(
			async () => {
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
			},
			local ? 0 : 250,
		)
	})

	/** A visual: the picked spell's, its name asked again (the spells that share it). */
	function takeVisual(s: vmangos.SpellRef) {
		if (!s.visual) return
		onset(String(s.visual))
		open = false
	}

	/** A thing's name for Copy name (#681): a list or script is named by a summary of what it holds, not a name. */
	const NAMED = new Set<string>(['item', 'creature', 'object', 'quest', 'spell', 'faction', 'skill', 'item set', 'zone', 'spell icon', 'emote', 'map', 'language'])
	const copyName = (kind: string, name: string) => (NAMED.has(kind) ? name : undefined)

	function pick(h: Hit) {
		rememberName(h.kind, h.id, { name: h.full ?? h.name, quality: h.quality, displayId: h.displayId, icon: h.icon })
		// Only a column that names one of two kinds tells them apart by the sign.
		const negative = kinds[1] !== null && (h.kind === 'object' || h.kind === 'sort')
		onset(String(negative ? -h.id : h.id))
		open = false
	}
</script>

<div class="ref" class:changed class:wide={f.wide}>
	{#if !bare}<span class="label" title={f.hint ? `${f.hint} (${f.col})` : f.col}>{f.label}</span>{/if}
	{#if ref === 'emote'}
		<select {value} onchange={(e) => onset((e.currentTarget as HTMLSelectElement).value)} aria-label={f.label}>
			<option value="0">None</option>
			{#if value !== '0' && value !== '' && !emotes.some((e) => String(e.id) === value)}<option {value}>{value}</option>{/if}
			{#each emotes as e (e.id)}{#if e.id > 0}<option value={String(e.id)}>{e.name} ({e.id})</option>{/if}{/each}
		</select>
	{:else}
		<span class="row">
			<input type="number" step="1" {value} oninput={(e) => onset((e.currentTarget as HTMLInputElement).value)} aria-label={f.label} />
			<span
				class="name"
				use:idMenu={target ? { ids: [idOf(target.kind, target.id)], name: shown ? copyName(target.kind, shown.name) : undefined, title: shown ? shown.name : undefined } : null}
				title={target ? `${shown && shown.name ? `${shown.name} (${target.kind} ${target.id})` : `${target.kind} ${target.id}`}` : (special ?? '')}
			>
				{#if special !== undefined}
					<span>{special}</span>
				{:else if target && shown && shown.name}
					{#if target.kind === 'item'}<ItemIcon displayId={shown.displayId ?? 0} />{:else if target.kind === 'spell' || target.kind === 'spell icon'}<SpellIcon
							icon={shown.icon ?? ''}
						/>{:else if target.kind === 'equipment'}<EquipIcons id={target.id} />{/if}
					<span style:color={target.kind === 'item' ? (QUALITY_VARS[shown.quality ?? 1] ?? QUALITY_VARS[1]) : undefined}>{shown.name}</span>
					{#if kinds[1]}<span class="dim">({SIDE_NAMES[target.kind]})</span>{/if}
					{#if isOwn(target.id)}<span class="dim own">(this {owner}'s own)</span>{/if}
				{:else if target && shown}
					<span class="missing">No {target.kind} {target.id}</span>
				{:else if target}
					<span class="dim">…</span>
				{:else}
					<span class="dim">None</span>
				{/if}
			</span>
			<button class:on={open} onclick={toggle} title="Find by name">Find</button>
			<button disabled={!target && special === undefined} onclick={() => onset('0')} title="Clear">✕</button>
		</span>
		{#if open && kind === 'spell'}
			<div class="find">
				<SpellPicker
					memoryKey="field"
					text={false}
					height={200}
					label="Find a spell"
					placeholder="Name or number"
					focus
					onpick={(s) => pick({ kind: 'spell', id: s.id, name: s.rank ? `${s.name} (${s.rank})` : s.name, sub: String(s.id), icon: s.icon })}
				/>
			</div>
		{:else if open && kind === 'spell visual'}
			<div class="find">
				<SpellPicker memoryKey="visual" text={false} height={200} label="Take the visual of a spell" placeholder="Name or number" focus onpick={takeVisual} />
			</div>
		{:else if open}
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
							<button onclick={() => pick(h)} use:idMenu={{ ids: [idOf(h.kind, h.id)], name: copyName(h.kind, h.full ?? h.name), title: h.full ?? h.name }}>
								{#if h.kind === 'item'}<ItemIcon displayId={h.displayId ?? 0} />{:else if h.kind === 'spell' || h.kind === 'spell icon'}<SpellIcon icon={h.icon ?? ''} />{:else if h.kind === 'equipment'}<EquipIcons
										id={h.id}
									/>{/if}
								<span class="hit" style:color={h.kind === 'item' ? (QUALITY_VARS[h.quality ?? 1] ?? QUALITY_VARS[1]) : undefined}>{h.name}</span>
								<span class="dim">{h.sub}{isOwn(h.id) ? ` · this ${owner}'s own` : ''}</span>
							</button>
						</li>
					{:else}
						<li class="dim">
							{searching
								? 'Searching…'
								: query.trim()
									? 'Nothing matches.'
									: (NUMBER_ONLY_KINDS as readonly NameKind[]).includes(kind)
										? 'Type a number.'
										: ownIds.length
											? `It has no list of its own (${ownIds.length > 1 ? `${ownIds[0]}–${ownIds[ownIds.length - 1]}` : ownIds[0]}). Type a name or a number.`
											: 'Type a name or a number.'}
						</li>
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
	.name .own {
		flex: none;
	}
	button {
		padding: 1px 6px;
		flex: none;
	}
	button.on {
		background: var(--accent);
		color: var(--accent-ink);
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
