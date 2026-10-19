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
			icons = ListItemIcons().then((d) => d ?? [])
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
	import { spawnType } from '../lib/world/spawnInfo'
	import ItemIcon from './ItemIcon.svelte'
	import PaletteTile from './PaletteTile.svelte'

	// The item editor's look and icon grids (#353), under its Change look and Change icon views, as
	// the creature editor's display picker: looks are the client's item displays, a rendered tile of
	// the model (the icon for a display without one, such as body armour), the ones that fit the
	// item's slot first; icons are every icon of the client. Only the rows in view are drawn. Hovering
	// a tile previews it, a click picks it, a double click picks it and applies it. The spell editor
	// (#294) uses the icons too, with the spells' and abilities' first rather than the items' (INV_…).

	interface Props {
		mode: 'looks' | 'icons'
		/** Where the item goes (ItemDisplayEntry.kind), for the Fits filter. */
		kind: string
		/** The display or icon picked now, drawn highlighted. */
		selected: number | string
		onpick: (v: number | string) => void
		/** A double click: pick it and apply it. */
		onapply: (v: number | string) => void
		/** The tile under the pointer (null when it leaves the grid). */
		onhover: (v: number | string | null) => void
		/** Which icons come first: the items' (INV_…) or the rest, the spells' and abilities'. */
		iconsFirst?: 'items' | 'spells'
	}
	let { mode, kind, selected, onpick, onapply, onhover, iconsFirst = 'items' }: Props = $props()

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

	let query = $state('')
	/** The kind the looks show: 'fits' for the item's own, '' for every one. */
	let filter = $state('fits')
	let list = $state<vmangos.ItemDisplayEntry[]>([])
	let iconList = $state<string[]>([])
	let error = $state('')
	let loading = $state(true)

	$effect(() => {
		loading = true
		if (mode === 'looks')
			loadItemDisplays()
				.then((d) => (list = d), (e) => (error = String(e)))
				.finally(() => (loading = false))
		else
			loadIcons()
				.then((d) => (iconList = d), (e) => (error = String(e)))
				.finally(() => (loading = false))
	})

	const want = $derived(filter === 'fits' ? kind : filter)
	const looks = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const n = Number(query.trim())
		const out = list.filter((d) => {
			if (Number.isInteger(n) && n > 0) return d.id === n
			if (want && d.kind !== want) return false
			if (!words.length) return true
			const text = `${d.id} ${d.model} ${d.icon} ${d.names?.join(' ') ?? ''}`.toLowerCase()
			return words.every((w) => text.includes(w))
		})
		// The looks items use first, then by model.
		return out.sort((a, b) => (b.uses > 0 ? 1 : 0) - (a.uses > 0 ? 1 : 0) || a.model.localeCompare(b.model) || a.id - b.id)
	})
	const iconMatches = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/\s+/g, '_')
		const list = q ? iconList.filter((i) => i.toLowerCase().includes(q)) : iconList
		const inv = (n: string) => /^inv_/i.test(n) === (iconsFirst === 'items')
		return [...list.filter(inv), ...list.filter((n) => !inv(n))]
	})
	const count = $derived(mode === 'looks' ? looks.length : iconMatches.length)
	const kindName = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k

	// The grid draws only the rows in view.
	const TILE = $derived(mode === 'looks' ? 96 : 44)
	const LABEL = $derived(mode === 'looks' ? 22 : 0)
	const GAP = 6
	const rowH = $derived(TILE + LABEL + GAP)
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	let scroller: HTMLDivElement | undefined = $state()
	const cols = $derived(Math.max(1, Math.floor((width - GAP) / (TILE + GAP))))
	const rows = $derived(Math.ceil(count / cols))
	const first = $derived(Math.max(0, Math.floor(scrollTop / rowH) - 1))
	const last = $derived(Math.min(rows, Math.ceil((scrollTop + height) / rowH) + 1))
	const visibleLooks = $derived(mode === 'looks' ? looks.slice(first * cols, last * cols) : [])
	const visibleIcons = $derived(mode === 'icons' ? iconMatches.slice(first * cols, last * cols) : [])
	$effect(() => {
		void looks
		void iconMatches
		scroller?.scrollTo(0, 0)
		scrollTop = 0
	})

	const label = (d: vmangos.ItemDisplayEntry) => d.names?.[0] ?? (d.model || d.icon)
	const title = (d: vmangos.ItemDisplayEntry) =>
		`Display ${d.id}${d.model ? `: ${d.model}` : ''} · ${d.icon || 'no icon'}${d.uses ? `\nUsed by ${d.names.join(', ')}${d.uses > d.names.length ? ` and ${d.uses - d.names.length} more` : ''}` : '\nNo item uses it'}`
	const same = (a: number | string, b: number | string) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b)
</script>

<div class="picker">
	<div class="row">
		<input
			type="search"
			placeholder={mode === 'looks' ? 'Search: an item (Battleworn Hammer), a model (sword, helm_plate), an icon or a display number' : 'Search: an icon name, such as sword, INV_Axe or potion'}
			bind:value={query}
			aria-label="Search the {mode}"
		/>
		{#if mode === 'looks'}
			<select bind:value={filter} aria-label="Which looks">
				<option value="fits">Fits it: {kindName(kind)}</option>
				<option value="">Every look</option>
				{#each KINDS as [v, name] (v)}<option value={v}>{name}</option>{/each}
			</select>
		{/if}
		<span class="dim">{count.toLocaleString()} {mode}</span>
	</div>
	{#if error}<p class="error">{error}</p>{/if}
	<div
		class="grid-wrap"
		role="listbox"
		aria-label={mode === 'looks' ? 'Looks' : 'Icons'}
		tabindex="-1"
		bind:this={scroller}
		bind:clientWidth={width}
		bind:clientHeight={height}
		onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
		onpointerleave={() => onhover(null)}
	>
		{#if loading}
			<p class="dim">Reading the client's {mode}…</p>
		{:else if !count}
			<p class="dim">Nothing matches.</p>
		{:else}
			<div class="virtual" style:height="{rows * rowH}px">
				<div class="grid" style:grid-template-columns="repeat({cols}, {TILE}px)" style:gap="{GAP}px" style:transform="translateY({first * rowH}px)">
					{#if mode === 'looks'}
						{#each visibleLooks as d (d.id)}
							<!-- A double click applies the look; the tile's own click picks it. -->
							<div class="cell" role="presentation" ondblclick={() => onapply(d.id)}>
								{#if d.path}
									<PaletteTile
										thumbKey={spawnType({ model: d.path, look: d.skin })}
										label={label(d)}
										title={title(d)}
										size={TILE}
										active={same(d.id, selected)}
										badge={String(d.id)}
										onclick={() => onpick(d.id)}
										onhover={(on) => onhover(on ? d.id : null)}
									/>
								{:else}
									<button
										class="icon-tile"
										class:on={same(d.id, selected)}
										style:width="{TILE}px"
										title={title(d)}
										onclick={() => onpick(d.id)}
										onpointerover={() => onhover(d.id)}
									>
										<span class="img" style:height="{TILE}px"><ItemIcon displayId={d.id} size={56} /></span>
										<span class="name">{label(d)}</span>
									</button>
								{/if}
							</div>
						{/each}
					{:else}
						{#each visibleIcons as name (name)}
							<button
								class="icon-btn"
								class:on={same(name, selected)}
								style:width="{TILE}px"
								style:height="{TILE}px"
								title={name}
								onclick={() => onpick(name)}
								ondblclick={() => onapply(name)}
								onpointerover={() => onhover(name)}
							>
								<ItemIcon icon={name} size={36} />
							</button>
						{/each}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.picker {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row input {
		flex: 2;
		min-width: 0;
	}
	.row select {
		flex: 1;
		min-width: 0;
	}
	.grid-wrap {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px;
	}
	.virtual {
		position: relative;
	}
	.grid {
		display: grid;
	}
	.icon-tile {
		display: flex;
		flex-direction: column;
		padding: 0;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.icon-tile .img {
		display: grid;
		place-items: center;
	}
	.icon-tile .name {
		height: 20px;
		padding: 0 4px;
		font-size: 11px;
		line-height: 20px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		text-align: left;
	}
	.icon-btn {
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
	}
	.icon-btn:hover,
	.icon-tile:hover {
		border-color: var(--text-dim);
	}
	.icon-btn.on,
	.icon-tile.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
		white-space: nowrap;
	}
	.error {
		color: var(--danger);
		margin: 0;
	}
</style>
