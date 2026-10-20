<script lang="ts" module>
	/** The category and school last browsed, kept while the app runs. */
	const browse = { category: 'npc', school: -1 }
</script>

<script lang="ts">
	import { ListSpells, ReadCreatureSpells, SaveCreatureSpells } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { CAST_FLAGS, CAST_TARGETS, castTarget, spellLabel } from '../lib/wow/creatureSpellNames'
	import { SPELL_SCHOOLS, rememberSpells, spellCategories, spellRef } from '../lib/wow/spells'
	import SpellIcon from './SpellIcon.svelte'

	// The creature editor's Spells tab (#243): the spells the creature casts in combat, its
	// creature_spells list (creature_template.spell_list_id), edited as a list and saved with Save
	// spells, like the Shop (the world database keeps no undo). Spells are found by name or ID in the
	// client's Spell.dbc, with their icons and text. A list other creatures share is copied on save, so
	// theirs stays as it is; a creature with no list gets one.

	/** The most spells a creature_spells row holds. */
	const SLOTS = 8

	let {
		entry,
		onsaved,
		dirty = $bindable(false),
	}: { entry: number; onsaved: (listId: number) => void; dirty?: boolean } = $props()

	let list = $state<vmangos.CreatureSpells | null>(null)
	let spells = $state<vmangos.CreatureSpell[]>([])
	let saved = $state('[]')
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	/** The client's spells by ID, for the list's names, icons and text. */
	let refs = $state<Record<number, vmangos.SpellRef | null>>({})

	const key = (l: vmangos.CreatureSpell[]) => JSON.stringify(l)
	$effect(() => {
		dirty = key(spells) !== saved
	})

	let loadedFor = -1
	$effect(() => {
		if (entry === loadedFor) return
		loadedFor = entry
		void load()
	})

	// Every spell in the list gets its name, icon and text from the client.
	const asked = new Set<number>()
	$effect(() => {
		for (const s of spells) {
			const id = s.spell
			if (asked.has(id)) continue
			asked.add(id)
			void spellRef(id).then((r) => (refs[id] = r))
		}
	})

	async function load() {
		loading = true
		error = ''
		try {
			const c = await ReadCreatureSpells(entry)
			list = c
			spells = (c.spells ?? []).map((s) => vmangos.CreatureSpell.createFrom({ ...s }))
			saved = key(spells)
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	async function save() {
		saving = true
		error = ''
		try {
			const r = await SaveCreatureSpells(entry, spells)
			const before = list?.listId ?? 0
			saved = key(spells)
			if (r.listId !== before) onsaved(r.listId)
			await load()
			const what = spells.length ? `${spells.length} ${spells.length === 1 ? 'spell' : 'spells'} in list ${r.listId}` : 'no spells'
			setStatus(`Saved the spells of creature ${entry} (${what}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
		}
	}

	function move(i: number, d: number) {
		const j = i + d
		if (j < 0 || j >= spells.length) return
		const l = [...spells]
		;[l[i], l[j]] = [l[j], l[i]]
		spells = l
	}

	function remove(i: number) {
		spells = spells.filter((_, k) => k !== i)
	}

	function num(v: string, max: number): number {
		const n = Math.floor(Number(v))
		return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0
	}

	/** A new target: parameters it doesn't use go back to 0, which the server wants. */
	function setTarget(s: vmangos.CreatureSpell, id: number) {
		s.castTarget = id
		const p = castTarget(id).params
		if (!p[0]) s.targetParam1 = 0
		if (!p[1]) s.targetParam2 = 0
	}

	function setFlag(s: vmangos.CreatureSpell, bit: number, on: boolean) {
		s.castFlags = on ? s.castFlags | bit : s.castFlags & ~bit
	}

	/** The least of a delay pair, keeping the most at least as large (the server skips a spell otherwise). */
	function setMin(s: vmangos.CreatureSpell, which: 'initial' | 'repeat', v: number) {
		if (which === 'initial') {
			s.initialMin = v
			if (s.initialMax < v) s.initialMax = v
		} else {
			s.repeatMin = v
			if (s.repeatMax < v) s.repeatMax = v
		}
	}
	function setMax(s: vmangos.CreatureSpell, which: 'initial' | 'repeat', v: number) {
		if (which === 'initial') {
			s.initialMax = v
			if (s.initialMin > v) s.initialMin = v
		} else {
			s.repeatMax = v
			if (s.repeatMin > v) s.repeatMin = v
		}
	}

	const flagCount = (f: number) => CAST_FLAGS.filter((c) => f & c.bit).length

	// Adding (#340): the client's spells in a category (the creature abilities, a class's skill line,
	// a pet's, a profession's...) and a school, listed at once, a page at a time, and narrowed by a
	// name or ID.
	const PAGE = 200
	let categories = $state<vmangos.SpellCategory[]>([])
	let category = $state(browse.category)
	let school = $state(browse.school)
	let query = $state('')
	let limit = $state(PAGE)
	let results = $state<vmangos.SpellRef[]>([])
	let total = $state(0)
	let searching = $state(false)
	let timer = 0
	let asking = 0

	void spellCategories()
		.then((c) => (categories = c))
		.catch((err) => (error = String(err)))

	/** The category groups in their order, the ungrouped ones (creature abilities, all) first. */
	const groups = $derived.by(() => {
		const out: { group: string; list: vmangos.SpellCategory[] }[] = []
		for (const c of categories) {
			const last = out[out.length - 1]
			if (last && last.group === c.group) last.list.push(c)
			else out.push({ group: c.group, list: [c] })
		}
		return out
	})

	// A new category, school or search starts at the first page again.
	$effect(() => {
		void category
		void school
		void query
		limit = PAGE
	})

	$effect(() => {
		const c = category,
			sc = school,
			q = query.trim(),
			n = limit
		browse.category = c
		browse.school = sc
		clearTimeout(timer)
		const ask = ++asking
		timer = window.setTimeout(
			async () => {
				searching = true
				try {
					const r = await ListSpells(c, sc, q, n)
					const list = r.spells ?? []
					rememberSpells(list)
					if (ask === asking) {
						results = list
						total = r.total
					}
				} catch (err) {
					error = String(err)
				} finally {
					if (ask === asking) searching = false
				}
			},
			q ? 250 : 0,
		)
	})

	function add(r: vmangos.SpellRef) {
		if (spells.length >= SLOTS) {
			setStatus(`A creature casts at most ${SLOTS} spells from its list.`, 4000)
			return
		}
		refs[r.id] = r
		asked.add(r.id)
		spells = [
			...spells,
			vmangos.CreatureSpell.createFrom({ spell: r.id, probability: 100, castTarget: 1, targetParam1: 0, targetParam2: 0, castFlags: 0, initialMin: 5, initialMax: 10, repeatMin: 10, repeatMax: 20, scriptId: 0 }),
		]
	}
</script>

<div class="spells">
	{#if error}<p class="error">{error}</p>{/if}

	<div class="head">
		<h3>Casts in combat{spells.length ? ` (${spells.length} of ${SLOTS})` : ''}</h3>
		<button disabled={!dirty || saving} onclick={() => void load()}>Revert</button>
		<button class="active" disabled={!dirty || saving} onclick={save}>{saving ? 'Saving…' : dirty ? 'Save spells' : 'Saved'}</button>
	</div>
	{#if list && list.listId > 0 && list.shared > 1}
		<p class="warn">Spell list {list.listId} is shared with {list.shared - 1} other {list.shared === 2 ? 'creature' : 'creatures'}. Saving gives this creature its own copy and leaves theirs as they are.</p>
	{:else if list && list.listId > 0}
		<p class="dim">Spell list {list.listId}{list.name ? `, ${list.name}` : ''}.</p>
	{/if}
	{#if loading}
		<p class="dim">Loading the spells…</p>
	{:else if spells.length === 0}
		<p class="dim">No spells yet. Find spells below and click one to add it; saving gives the creature a spell list.</p>
	{:else}
		<ol class="list">
			{#each spells as s, i (i)}
				{@const ref = refs[s.spell]}
				{@const target = castTarget(s.castTarget)}
				<li>
					<div class="title">
						<SpellIcon icon={ref?.icon ?? ''} size={28} />
						<div class="name">
							<span>{ref ? spellLabel(ref.name, ref.rank) : ref === null ? spellLabel('', '') : '…'}</span>
							<span class="dim">{s.spell}</span>
						</div>
						<div class="row-actions">
							<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
							<button title="Move down" disabled={i === spells.length - 1} onclick={() => move(i, 1)}>↓</button>
							<button title="Remove" onclick={() => remove(i)}>✕</button>
						</div>
					</div>
					{#if ref?.text}<p class="text">{ref.text}</p>{/if}
					<div class="grid">
						<label title="The chance it casts the spell when its timer is up"
							>Chance (%) <input type="number" min="1" max="100" value={s.probability} oninput={(e) => (s.probability = Math.max(1, num(e.currentTarget.value, 100)))} /></label
						>
						<label class="wide"
							>Cast at
							<select value={s.castTarget} onchange={(e) => setTarget(s, Number(e.currentTarget.value))}>
								{#each CAST_TARGETS as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								{#if !CAST_TARGETS.some((t) => t.id === s.castTarget)}<option value={s.castTarget}>{target.name}</option>{/if}
							</select>
						</label>
						{#if target.params[0]}
							<label>{target.params[0]} <input type="number" min="0" max="65535" value={s.targetParam1} oninput={(e) => (s.targetParam1 = num(e.currentTarget.value, 65535))} /></label>
						{/if}
						{#if target.params[1]}
							<label>{target.params[1]} <input type="number" min="0" max="65535" value={s.targetParam2} oninput={(e) => (s.targetParam2 = num(e.currentTarget.value, 65535))} /></label>
						{/if}
						<label title="Seconds after the fight starts, a random time from the first to the second"
							>First cast (s)
							<span class="pair"
								><input type="number" min="0" max="65535" value={s.initialMin} onchange={(e) => setMin(s, 'initial', num(e.currentTarget.value, 65535))} /> to
								<input type="number" min="0" max="65535" value={s.initialMax} onchange={(e) => setMax(s, 'initial', num(e.currentTarget.value, 65535))} /></span
							>
						</label>
						<label title="Seconds between casts, a random time from the first to the second"
							>Then every (s)
							<span class="pair"
								><input type="number" min="0" max="65535" value={s.repeatMin} onchange={(e) => setMin(s, 'repeat', num(e.currentTarget.value, 65535))} /> to
								<input type="number" min="0" max="65535" value={s.repeatMax} onchange={(e) => setMax(s, 'repeat', num(e.currentTarget.value, 65535))} /></span
							>
						</label>
					</div>
					<details>
						<summary>Conditions and flags{flagCount(s.castFlags) ? ` (${flagCount(s.castFlags)} set)` : ''}{s.scriptId ? ` · runs script ${s.scriptId}` : ''}</summary>
						<div class="flags">
							{#each CAST_FLAGS as f (f.bit)}
								<label title={f.hint}><input type="checkbox" checked={(s.castFlags & f.bit) !== 0} onchange={(e) => setFlag(s, f.bit, e.currentTarget.checked)} /> {f.name}</label>
							{/each}
						</div>
					</details>
				</li>
			{/each}
		</ol>
	{/if}

	<h3>Add spells</h3>
	<div class="browse">
		<select class="category" title="Which spells to list" bind:value={category}>
			{#if !categories.length}<option value={category}>{category === 'npc' ? 'Creature abilities' : 'Loading…'}</option>{/if}
			{#each groups as g (g.group)}
				{#if g.group}
					<optgroup label={g.group}>
						{#each g.list as c (c.key)}<option value={c.key}>{c.name} ({c.count})</option>{/each}
					</optgroup>
				{:else}
					{#each g.list as c (c.key)}<option value={c.key}>{c.name} ({c.count})</option>{/each}
				{/if}
			{/each}
		</select>
		<select class="school" title="The spell's school" bind:value={school}>
			<option value={-1}>Any school</option>
			{#each SPELL_SCHOOLS as s, i (i)}<option value={i}>{s}</option>{/each}
		</select>
	</div>
	<input class="search" type="search" placeholder="Narrow by name or ID" bind:value={query} />
	{#if searching && !results.length}<p class="dim">Listing the spells…</p>{/if}
	{#if results.length}
		<p class="dim count">
			{total === results.length ? `${total} ${total === 1 ? 'spell' : 'spells'}.` : `Showing ${results.length} of ${total}. Narrow the search to see the rest.`}
			{#if total > results.length}<button onclick={() => (limit += PAGE)}>Show {Math.min(PAGE, total - results.length)} more</button>{/if}
		</p>
		<ul class="results">
			{#each results as r (r.id)}
				<li>
					<button disabled={spells.length >= SLOTS} onclick={() => add(r)} title={spells.length >= SLOTS ? `The list is full (${SLOTS} spells)` : 'Add it to the creature'}>
						<SpellIcon icon={r.icon} size={24} />
						<span class="found">
							<span>{spellLabel(r.name, r.rank)} <span class="dim">{r.id}</span></span>
							{#if r.text}<span class="text">{r.text}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if !searching}
		<p class="dim">{query.trim() ? 'No spell in this category matches. An ID is found in any category.' : 'No spells in this category.'}</p>
	{/if}
</div>

<style>
	.spells {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.head h3 {
		flex: 1;
		margin: 0;
	}
	p {
		margin: 0;
	}
	.warn {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.error {
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list > li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 13px;
	}
	.text {
		color: var(--text-dim);
		line-height: 1.35;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 6px 10px;
	}
	.grid label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		color: var(--text-dim);
	}
	.grid label.wide {
		grid-column: span 2;
	}
	.grid input,
	.grid select {
		min-width: 0;
		width: 100%;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.pair input {
		width: 0;
		flex: 1;
	}
	details summary {
		cursor: pointer;
		color: var(--text-dim);
	}
	.flags {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 2px 10px;
		padding-top: 4px;
	}
	.flags label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.row-actions {
		white-space: nowrap;
	}
	.row-actions button {
		padding: 1px 6px;
	}
	.search {
		width: 100%;
	}
	.browse {
		display: flex;
		gap: 6px;
	}
	.browse .category {
		flex: 1;
		min-width: 0;
	}
	.count {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.count button {
		padding: 1px 6px;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 320px;
		overflow-y: auto;
	}
	.results button {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		text-align: left;
		background: transparent;
		border: none;
		padding: 4px 6px;
	}
	.results button:hover:not(:disabled) {
		background: var(--panel-2);
	}
	.results button:disabled {
		opacity: 0.45;
	}
	.found {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
