<script lang="ts" module>
	import { ListItemDisplays, ListItemIcons } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The lists are read once a session; forgetLooks drops the displays after one was added.
	let displays: Promise<vmangos.ItemDisplayEntry[]> | null = null
	let icons: Promise<string[]> | null = null

	export function loadItemDisplays(): Promise<vmangos.ItemDisplayEntry[]> {
		if (!displays) {
			displays = ListItemDisplays().then((d) => d ?? [])
			displays.catch(() => (displays = null))
		}
		return displays
	}

	function loadIcons(): Promise<string[]> {
		if (!icons) {
			// Item icons (INV_…) first, then the spells' and abilities'.
			icons = ListItemIcons().then((d) => {
				const inv = (d ?? []).filter((n) => /^inv_/i.test(n))
				return [...inv, ...(d ?? []).filter((n) => !/^inv_/i.test(n))]
			})
			icons.catch(() => (icons = null))
		}
		return icons
	}

	/** Drops the display list, after a display was added or an item's display changed. */
	export function forgetLooks() {
		displays = null
	}
</script>

<script lang="ts">
	import ItemIcon from './ItemIcon.svelte'

	// The item editor's look pickers (#353): Looks, every item display of the client by its icon, the
	// ones that fit the item's slot first; Icons, every icon of the client. Hovering a look previews it,
	// a click picks it. An icon picked keeps the item's model; Save then makes the display that pairs
	// them (ItemIconDisplay).

	interface Props {
		/** Where the item goes (ItemDisplayEntry.kind), for the Fits filter. */
		kind: string
		/** The item's display now, and the icon picked for it but not saved ('' for none). */
		display: number
		icon: string
		onlook: (display: number) => void
		onicon: (icon: string) => void
		/** The look under the pointer, previewed until the pointer leaves (null). */
		onhover: (display: number | null) => void
	}
	let { kind, display, icon, onlook, onicon, onhover }: Props = $props()

	const KINDS: Array<[string, string]> = [
		['weapon', 'Weapons'],
		['shield', 'Shields'],
		['held', 'Held in off hand'],
		['ranged', 'Ranged weapons'],
		['head', 'Helms'],
		['shoulder', 'Shoulders'],
		['back', 'Cloaks'],
		['body', 'Body armour'],
		['jewelry', 'Necks, rings and trinkets'],
		['other', 'Everything else'],
	]

	let tab = $state<'looks' | 'icons'>('looks')
	let query = $state('')
	/** The kind the Looks list shows: 'fits' for the item's own, '' for every one. */
	let filter = $state('fits')
	let list = $state<vmangos.ItemDisplayEntry[]>([])
	let iconList = $state<string[]>([])
	let error = $state('')

	$effect(() => {
		if (tab === 'looks' && !list.length) loadItemDisplays().then((d) => (list = d), (e) => (error = String(e)))
		if (tab === 'icons' && !iconList.length) loadIcons().then((d) => (iconList = d), (e) => (error = String(e)))
	})

	/** Tiles shown at once; each loads its icon only once it scrolls into view. */
	const LIMIT = 600
	const want = $derived(filter === 'fits' ? kind : filter)
	const looks = $derived.by(() => {
		const q = query.trim().toLowerCase()
		const n = Number(q)
		return list.filter((d) => {
			if (q && Number.isInteger(n) && n > 0) return d.id === n
			if (want && d.kind !== want) return false
			if (!q) return true
			return d.model.toLowerCase().includes(q) || d.icon.toLowerCase().includes(q) || (d.names ?? []).some((x) => x.toLowerCase().includes(q))
		})
	})
	const iconMatches = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/\s+/g, '_')
		return q ? iconList.filter((i) => i.toLowerCase().includes(q)) : iconList
	})
	const current = $derived(list.find((d) => d.id === display))
	const kindName = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k
	const tip = (d: vmangos.ItemDisplayEntry) =>
		`Display ${d.id}${d.model ? ` · ${d.model}` : ''} · ${d.icon || 'no icon'}${d.uses ? `\nUsed by ${d.names.join(', ')}${d.uses > d.names.length ? ` and ${d.uses - d.names.length} more` : ''}` : '\nNo item uses it'}`
</script>

<div class="picker">
	<div class="head">
		<div class="seg" role="group" aria-label="Pick">
			<button class:on={tab === 'looks'} onclick={() => (tab = 'looks')}>Looks</button>
			<button class:on={tab === 'icons'} onclick={() => (tab = 'icons')}>Icons</button>
		</div>
		{#if tab === 'looks'}
			<select bind:value={filter} aria-label="Which looks">
				<option value="fits">Fits it: {kindName(kind)}</option>
				<option value="">Every look</option>
				{#each KINDS as [v, name] (v)}<option value={v}>{name}</option>{/each}
			</select>
		{/if}
	</div>
	<input type="search" placeholder={tab === 'looks' ? 'Model, icon, item name or display number' : 'Icon name, such as sword or INV_Axe'} bind:value={query} aria-label="Search the {tab}" />
	{#if error}<p class="error">{error}</p>{/if}

	{#if tab === 'looks'}
		<div class="grid" role="listbox" aria-label="Looks" tabindex="-1" onmouseleave={() => onhover(null)}>
			{#each looks.slice(0, LIMIT) as d (d.id)}
				<button class="tile" class:on={d.id === display && !icon} title={tip(d)} onclick={() => onlook(d.id)} onmouseenter={() => onhover(d.id)}>
					<ItemIcon displayId={d.id} size={36} lazy />
				</button>
			{:else}
				<p class="dim">{list.length ? 'No look matches.' : 'Reading the client’s looks…'}</p>
			{/each}
		</div>
		<p class="dim">
			{looks.length > LIMIT ? `Showing ${LIMIT} of ${looks.length}: narrow the search to see the rest. ` : `${looks.length} ${looks.length === 1 ? 'look' : 'looks'}. `}{current
				? `Now display ${current.id}${current.model ? `, ${current.model}` : ''}.`
				: ''}
		</p>
	{:else}
		<div class="grid" role="listbox" aria-label="Icons" tabindex="-1">
			{#each iconMatches.slice(0, LIMIT) as name (name)}
				<button class="tile" class:on={icon.toLowerCase() === name.toLowerCase() || (!icon && current?.icon.toLowerCase() === name.toLowerCase())} title={name} onclick={() => onicon(name)}>
					<ItemIcon icon={name} size={36} lazy />
				</button>
			{:else}
				<p class="dim">{iconList.length ? 'No icon matches.' : 'Reading the client’s icons…'}</p>
			{/each}
		</div>
		<p class="dim">
			{iconMatches.length > LIMIT ? `Showing ${LIMIT} of ${iconMatches.length}: narrow the search. ` : ''}An icon keeps the item's model: Save finds the client's display with both, or adds one to Meld's patch.
		</p>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	.head {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.head select {
		flex: 1;
		min-width: 0;
	}
	.seg {
		display: flex;
	}
	.seg button {
		border-radius: 0;
	}
	.seg button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.seg button:last-child {
		border-radius: 0 4px 4px 0;
	}
	.seg button.on {
		background: var(--accent);
		color: #fff;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 42px);
		gap: 4px;
		max-height: 240px;
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
		align-content: start;
	}
	.grid .dim {
		grid-column: 1 / -1;
	}
	.tile {
		width: 42px;
		height: 42px;
		padding: 2px;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
	}
	.tile:hover {
		border-color: var(--text-dim);
	}
	.tile.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
		white-space: pre-line;
	}
	.error {
		color: var(--danger);
		margin: 0;
	}
</style>
