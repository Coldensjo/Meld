<script lang="ts" module>
	/** The category and school each kind of picker last browsed, kept while the app runs. */
	const memory = new Map<string, { category: string; school: number }>()
</script>

<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import type { Snippet } from 'svelte'
	import { ListSpells } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { spellLabel } from '../lib/wow/creatureSpellNames'
	import { SPELL_SCHOOLS, rememberSpells, spellCategories } from '../lib/wow/spells'
	import SpellIcon from './SpellIcon.svelte'

	// The client's spells browsed by category (the creature abilities, a class's skill line, a
	// pet's, a profession's...) and school, listed at once a page at a time and narrowed by a name
	// or ID (#340). The creature editor's Spells tab, the spell fields of the creature and quest
	// editors, the spell editor's Find and the visual composer all pick spells through it (#367).

	interface Props {
		/** Called with the spell clicked, when `row` doesn't draw the row itself. */
		onpick?: (r: vmangos.SpellRef) => void
		/** Draws a row's content (inside its li) instead of the default button. */
		row?: Snippet<[vmangos.SpellRef]>
		/** Which pickers share a remembered category and school. */
		memoryKey?: string
		/** The category shown the first time: a SpellCategory key. */
		start?: string
		/** Offers "every" too: all spells with the client's leftovers (tests, OLD), for the spell editor. */
		leftovers?: boolean
		/** The search's aria-label and placeholder. */
		label?: string
		placeholder?: string
		/** The list's aria-label. */
		listLabel?: string
		/** The list's most height in px; 0 makes the picker fill its parent's column. */
		height?: number
		/** Shows each spell's text under its name. */
		text?: boolean
		/** Turns the default buttons off, with `title` saying why. */
		disabled?: boolean
		title?: string
		/** A change asks the list again (after a spell was made). */
		version?: number
		focus?: boolean
	}
	let {
		onpick,
		row,
		memoryKey = 'default',
		start = 'all',
		leftovers = false,
		label = 'Find a spell',
		placeholder = 'Narrow by name or ID',
		listLabel = 'Spells found',
		height = 320,
		text = true,
		disabled = false,
		title = '',
		version = 0,
		focus = false,
	}: Props = $props()

	const EVERY = 'every'
	const PAGE = 200
	// svelte-ignore state_referenced_locally
	const kept = memory.get(memoryKey) ?? { category: start, school: -1 }
	let categories = $state<vmangos.SpellCategory[]>([])
	let category = $state(kept.category)
	let school = $state(kept.school)
	let query = $state('')
	let limit = $state(PAGE)
	let results = $state<vmangos.SpellRef[]>([])
	let total = $state(0)
	let searching = $state(false)
	let error = $state('')
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

	const NAMES: Record<string, string> = { npc: 'Creature abilities', all: 'All spells', [EVERY]: 'All spells, leftovers too' }

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
		void version
		memory.set(memoryKey, { category: c, school: sc })
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
						error = ''
					}
				} catch (err) {
					if (ask === asking) error = String(err)
				} finally {
					if (ask === asking) searching = false
				}
			},
			q ? 250 : 0,
		)
	})

	function autofocus(el: HTMLInputElement, on: boolean) {
		if (on) el.focus()
	}
</script>

<div class="spell-picker" class:fill={height === 0}>
	<div class="browse">
		<select class="category" title="Which spells to list" bind:value={category}>
			{#if leftovers}<option value={EVERY}>{NAMES[EVERY]}</option>{/if}
			{#if !categories.length && category !== EVERY}<option value={category}>{NAMES[category] ?? 'Loading…'}</option>{/if}
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
	<input class="search" type="search" {placeholder} aria-label={label} bind:value={query} use:autofocus={focus} />
	{#if error}<p class="error">{error}</p>{/if}
	{#if searching && !results.length}<p class="dim">Listing the spells…</p>{/if}
	{#if results.length}
		<p class="dim count">
			{total === results.length ? `${total} ${total === 1 ? 'spell' : 'spells'}.` : `Showing ${results.length} of ${total}. Narrow the search to see the rest.`}
			{#if total > results.length}<button onclick={() => (limit += PAGE)}>Show {Math.min(PAGE, total - results.length)} more</button>{/if}
		</p>
		<ul class="results" aria-label={listLabel} style:max-height={height ? `${height}px` : undefined}>
			{#each results as r (r.id)}
				<li>
					{#if row}
						{@render row(r)}
					{:else}
						<button class="pick" {disabled} onclick={() => onpick?.(r)} use:idMenu={{ ids: [idOf('spell', r.id)], name: r.name }} title={title || r.text || r.name}>
							<SpellIcon icon={r.icon} size={text ? 24 : 18} />
							<span class="found">
								<span>{spellLabel(r.name, r.rank)} <span class="dim">{r.id}</span></span>
								{#if text && r.text}<span class="text">{r.text}</span>{/if}
							</span>
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if !searching && !error}
		<p class="dim">{query.trim() ? 'No spell in this category matches. An ID is found in any category.' : 'No spells in this category.'}</p>
	{/if}
</div>

<style>
	.spell-picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		font-size: 12px;
	}
	.spell-picker.fill {
		flex: 1;
		min-height: 0;
	}
	p {
		margin: 0;
	}
	.browse {
		display: flex;
		gap: 6px;
		min-width: 0;
	}
	.browse .category {
		flex: 1;
		min-width: 0;
	}
	.browse .school {
		min-width: 0;
	}
	.search {
		width: 100%;
		min-width: 0;
	}
	.count {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.count button {
		padding: 1px 6px;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
	}
	.fill .results {
		flex: 1;
		min-height: 0;
	}
	.pick {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		text-align: left;
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 4px 6px;
		color: var(--text);
	}
	.pick:hover:not(:disabled) {
		background: var(--panel-3);
	}
	.pick:disabled {
		opacity: 0.45;
	}
	.found {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.text {
		color: var(--text-dim);
		line-height: 1.35;
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
