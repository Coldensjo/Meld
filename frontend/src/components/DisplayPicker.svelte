<script lang="ts" module>
	import { ListDisplays, ListObjectDisplays } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	export type DisplayKind = 'creature' | 'object'

	// The client's displays, read once for the whole session (the Go side caches them too). The game
	// object displays are read again after an object template is saved or made, since that changes
	// which objects use each one (forgetObjectDisplays).
	const displaysPromise: Record<DisplayKind, Promise<vmangos.DisplayEntry[]> | null> = { creature: null, object: null }
	/** Every display of a kind, with the templates using each, read once for the session. */
	export function loadDisplays(kind: DisplayKind): Promise<vmangos.DisplayEntry[]> {
		let p = displaysPromise[kind]
		if (!p) {
			p = (kind === 'object' ? ListObjectDisplays() : ListDisplays()).then((d) => d ?? [])
			p.catch(() => (displaysPromise[kind] = null))
			displaysPromise[kind] = p
		}
		return p
	}
	/** Drops the creature displays read, so the next picker reads them again (after a creature is saved or made). */
	export function forgetCreatureDisplays() {
		displaysPromise.creature = null
	}
	/** Drops the game object displays read, so the next picker reads them again. */
	export function forgetObjectDisplays() {
		displaysPromise.object = null
	}
</script>

<script lang="ts">
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow, rowTop } from '../lib/ui/virtualGrid'
	import { creatureTypeName, objectTypeName, spawnType } from '../lib/world/spawnInfo'

	// A visual picker of creature displays, or (kind 'object', #230) of game object displays: rendered
	// tiles in a virtualised grid, narrowed by the creature or object type the world database's
	// templates using a display have, by model family, and by a search over the templates' names, the
	// model and skin names and the display ID.

	interface Props {
		/** Creature displays (CreatureDisplayInfo) or game object ones (GameObjectDisplayInfo). */
		kind?: DisplayKind
		/** The display picked now, drawn highlighted. */
		selected: number
		onpick: (d: vmangos.DisplayEntry) => void
		/** The display under the pointer, or null when it leaves the grid. */
		onhover?: (d: vmangos.DisplayEntry | null) => void
	}
	let { kind = 'creature', selected, onpick, onhover }: Props = $props()
	// The kind is fixed for a picker's life: each editor mounts its own.
	// svelte-ignore state_referenced_locally
	const objects = kind === 'object'
	const what = objects ? 'object' : 'creature'

	let all = $state<vmangos.DisplayEntry[]>([])
	let error = $state('')
	let loading = $state(true)
	loadDisplays(objects ? 'object' : 'creature')
		.then((d) => (all = d))
		.catch((err) => (error = String(err)))
		.finally(() => (loading = false))

	/** A display's category: the creature or object type of the templates using it, or Unused. */
	const categoryOf = (d: vmangos.DisplayEntry) => (objects ? (d.uses > 0 ? objectTypeName(d.type) : 'Unused') : d.type > 0 ? creatureTypeName(d.type) : d.uses > 0 ? 'Not specified' : 'Unused')
	/** The model's file name without its folder or extension, such as Wolf or HumanMale. */
	const fileOf = (d: vmangos.DisplayEntry) => d.model.slice(d.model.lastIndexOf('\\') + 1).replace(/\.(mdx|m2|wmo)$/i, '')
	/**
	 * A display's family: its model's file name, or for a game object the folder it is in (Chests,
	 * Mines), since most object models are used by one display each.
	 */
	const familyOf = (d: vmangos.DisplayEntry) => {
		if (!objects) return fileOf(d)
		const parts = d.model.split('\\')
		return parts.length > 1 ? parts[parts.length - 2] : '(top)'
	}

	let category = $state('')
	let family = $state('')
	let query = $state('')

	const categories = $derived.by(() => {
		const n = new Map<string, number>()
		for (const d of all) n.set(categoryOf(d), (n.get(categoryOf(d)) ?? 0) + 1)
		// The used types by size, Unused last.
		return [...n].sort((a, b) => (a[0] === 'Unused' ? 1 : b[0] === 'Unused' ? -1 : b[1] - a[1]))
	})

	const inCategory = $derived(category ? all.filter((d) => categoryOf(d) === category) : all)

	const families = $derived.by(() => {
		const n = new Map<string, number>()
		for (const d of inCategory) n.set(familyOf(d), (n.get(familyOf(d)) ?? 0) + 1)
		return [...n].sort((a, b) => a[0].localeCompare(b[0]))
	})

	// Search: every word must appear in the display's names, model, skin or ID. Used displays first.
	const items = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const list = inCategory.filter((d) => {
			if (family && familyOf(d) !== family) return false
			if (!words.length) return true
			const text = `${d.id} ${d.names?.join(' ') ?? ''} ${d.model} ${d.skin}`.toLowerCase()
			return words.every((w) => text.includes(w))
		})
		return list.sort((a, b) => (b.uses > 0 ? 1 : 0) - (a.uses > 0 ? 1 : 0) || familyOf(a).localeCompare(familyOf(b)) || a.id - b.id)
	})

	// Pick a family in another category: the family filter only holds within its category.
	function pickCategory(e: Event) {
		category = (e.target as HTMLSelectElement).value
		family = ''
	}

	// The grid renders only the rows in view.
	// TILE is the smallest tile; the columns that fit at that size are kept and the tiles grow to fill
	// the row (#389), up to MAX_TILE.
	const TILE = 104
	const MAX_TILE = 140
	const GAP = 6
	const PAD = 12
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	let scroller: HTMLDivElement | undefined = $state()
	const cols = $derived(gridCols(width, TILE, GAP, PAD - GAP))
	const tile = $derived(Math.min(MAX_TILE, Math.max(TILE, Math.floor((width - PAD - (cols - 1) * GAP) / cols))))
	const rowH = $derived(tile + 22 + GAP)
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, height))
	$effect(() => {
		void items
		scroller?.scrollTo(0, 0)
		scrollTop = 0
	})

	// Open on the template's own display (#206): its type and model family picked and its tile in
	// view, once the displays are read and again when another display slot is shown, but not after a
	// pick here, which must leave the filters where the author put them.
	let shown = -1
	let picked = -1
	$effect(() => {
		const id = selected
		if (!all.length || id === shown) return
		shown = id
		if (id === picked) return
		const d = all.find((x) => x.id === id)
		if (!d) return
		category = categoryOf(d)
		family = familyOf(d)
		query = ''
		// After the grid has laid out the narrowed list (and the scroll-to-top above has run).
		requestAnimationFrame(() => {
			const i = items.indexOf(d)
			if (i < 0 || !scroller) return
			const top = Math.max(0, rowTop(i, cols, rowH) - (height - rowH) / 2)
			scroller.scrollTo(0, top)
			scrollTop = top
		})
	})
	function pick(d: vmangos.DisplayEntry) {
		picked = d.id
		onpick(d)
	}

	const label = (d: vmangos.DisplayEntry) => d.names?.[0] ?? fileOf(d)
	const title = (d: vmangos.DisplayEntry) =>
		`Display ${d.id}: ${objects ? d.model : fileOf(d)}${d.skin ? ` (${d.skin})` : ''}${d.uses ? `\nUsed by ${d.names.join(', ')}${d.uses > d.names.length ? ` and ${d.uses - d.names.length} more` : ''}` : `\nNo ${what} uses it`}`
</script>

<div class="picker">
	<input type="search" placeholder={objects ? 'Search: an object (Copper Vein), a model (chest, mine) or a display ID' : 'Search: a creature (Hogger), a model (wolf, kobold) or a display ID'} bind:value={query} />
	<div class="row">
		<select value={category} onchange={pickCategory} aria-label={objects ? 'Object type' : 'Creature type'}>
			<option value="">All types ({all.length})</option>
			{#each categories as [name, n] (name)}<option value={name}>{name} ({n})</option>{/each}
		</select>
		<select bind:value={family} aria-label={objects ? 'Folder' : 'Model'}>
			<option value="">{objects ? 'All folders' : 'All models'} ({families.length})</option>
			{#each families as [name, n] (name)}<option value={name}>{name} ({n})</option>{/each}
		</select>
		<span class="dim">{items.length.toLocaleString()} displays</span>
	</div>
	{#if error}<p class="error">{error}</p>{/if}
	<div
		class="grid-wrap"
		role="listbox"
		aria-label={objects ? 'Object displays' : 'Creature displays'}
		tabindex="-1"
		bind:this={scroller}
		bind:clientWidth={width}
		bind:clientHeight={height}
		onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
		onpointerleave={() => onhover?.(null)}
	>
		{#if loading}
			<p class="dim">Reading the client's {what} displays…</p>
		{:else if !items.length}
			<p class="dim">No display matches.</p>
		{:else}
			<VirtualGrid {items} {win} {cols} {tile} gap={GAP} {rowH} key={(d) => d.id}>
				{#snippet cell(d: vmangos.DisplayEntry)}
					<PaletteTile
						thumbKey={spawnType({ model: d.model, look: d.look })}
						label={label(d)}
						title={title(d)}
						size={tile}
						active={d.id === selected}
						badge={String(d.id)}
						onclick={() => pick(d)}
						onhover={(on) => on && onhover?.(d)}
					/>
				{/snippet}
			</VirtualGrid>
		{/if}
	</div>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: none;
	}
	input[type='search'] {
		width: 100%;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row select {
		flex: 1;
		min-width: 0;
	}
	.grid-wrap {
		max-height: min(calc(58 * var(--vh)), 640px);
		flex: none;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		font-size: 12px;
		margin: 0;
	}
</style>
