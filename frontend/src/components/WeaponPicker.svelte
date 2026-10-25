<script lang="ts" module>
	import { ListWeapons } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The world database's holdable items, read once for the whole session (the Go side caches them
	// too). The spawn fields use the list for the names of a spawn's items.
	let weaponsPromise: Promise<vmangos.WeaponEntry[]> | null = null
	export function loadWeapons(): Promise<vmangos.WeaponEntry[]> {
		if (!weaponsPromise) {
			weaponsPromise = ListWeapons().then((w) => w ?? [])
			weaponsPromise.catch(() => (weaponsPromise = null))
		}
		return weaponsPromise
	}

	/** The equipment slots: creature_equip_template's item1, item2 and item3. */
	export const SLOTS = ['Main hand', 'Off hand', 'Ranged'] as const

	/** The inventory types a slot takes. */
	const SLOT_INV: Record<number, number[]> = {
		0: [13, 17, 21], // one-hand, two-hand, main hand
		1: [13, 14, 22, 23], // one-hand, shield, off hand, held in off hand
		2: [15, 25, 26], // bow / crossbow, thrown, gun / wand
	}

	/** The thumbnail key of a weapon: its model with its texture, as the asset browser renders models. */
	export const weaponThumbKey = (w: vmangos.WeaponEntry) => (w.model ? `m2:${w.model}${w.texture ? `?tex=${encodeURIComponent(`2:${w.texture}`)}` : ''}` : '')

	/** The kind of a weapon, from its item class and subclass. */
	export function weaponKind(w: vmangos.WeaponEntry): string {
		if (w.class === 4) return w.subclass === 6 ? 'Shield' : 'Held item'
		return WEAPON_SUBCLASSES[w.subclass] ?? 'Other'
	}
	const WEAPON_SUBCLASSES: Record<number, string> = {
		0: 'Axe',
		1: 'Two-handed axe',
		2: 'Bow',
		3: 'Gun',
		4: 'Mace',
		5: 'Two-handed mace',
		6: 'Polearm',
		7: 'Sword',
		8: 'Two-handed sword',
		10: 'Staff',
		13: 'Fist weapon',
		14: 'Misc',
		15: 'Dagger',
		16: 'Thrown',
		18: 'Crossbow',
		19: 'Wand',
		20: 'Fishing pole',
	}
</script>

<script lang="ts">
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow } from '../lib/ui/virtualGrid'
	import AssetPreview from './AssetPreview.svelte'
	import type { SearchItem } from '../lib/wow/search'

	// A visual picker of the items a creature can hold in one slot: rendered tiles in a virtualised
	// grid, narrowed by kind (sword, shield, bow…), by whether the item is a creature's own
	// ("Monster - …" items, which most spawns hold) or a player item, and by a search over names and
	// entries. Only items the slot takes are offered.

	interface Props {
		/** The slot being filled: 0 main hand, 1 off hand, 2 ranged. */
		which: number
		/** The item entry held now, drawn highlighted; 0 for none. */
		selected: number
		onpick: (entry: number) => void
		onhover?: (w: vmangos.WeaponEntry | null) => void
	}
	let { which, selected, onpick, onhover }: Props = $props()

	let all = $state<vmangos.WeaponEntry[]>([])
	let error = $state('')
	let loading = $state(true)
	loadWeapons()
		.then((w) => (all = w))
		.catch((err) => (error = String(err)))
		.finally(() => (loading = false))

	const isMonster = (w: vmangos.WeaponEntry) => /^monster\b/i.test(w.name)

	let kind = $state('')
	let owner = $state<'' | 'monster' | 'player'>('monster')
	let query = $state('')

	const forSlot = $derived(all.filter((w) => w.model && (SLOT_INV[which] ?? []).includes(w.invType)))
	const byOwner = $derived(owner ? forSlot.filter((w) => isMonster(w) === (owner === 'monster')) : forSlot)

	const kinds = $derived.by(() => {
		const n = new Map<string, number>()
		for (const w of byOwner) n.set(weaponKind(w), (n.get(weaponKind(w)) ?? 0) + 1)
		return [...n].sort((a, b) => b[1] - a[1])
	})

	const items = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		return byOwner.filter((w) => (!kind || weaponKind(w) === kind) && (!words.length || words.every((t) => `${w.entry} ${w.name}`.toLowerCase().includes(t)))).sort((a, b) => a.name.localeCompare(b.name) || a.entry - b.entry)
	})

	// A kind from the other owner list means nothing here.
	$effect(() => {
		void owner
		kind = ''
	})

	// The grid renders only the rows in view.
	const TILE = 88
	const GAP = 6
	const rowH = TILE + 22 + GAP
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	let scroller: HTMLDivElement | undefined = $state()
	const cols = $derived(gridCols(width, TILE, GAP))
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, height))
	$effect(() => {
		void items
		scroller?.scrollTo(0, 0)
		scrollTop = 0
	})

	const label = (w: vmangos.WeaponEntry) => w.name.replace(/^monster\s*-\s*/i, '')

	// The preview shows the item under the pointer, else the one held now, as the asset browser's
	// preview shows a model: the item's model with its texture as the path's query.
	let hovered = $state<vmangos.WeaponEntry | null>(null)
	const previewItem = $derived.by((): SearchItem | null => {
		const w = hovered ?? all.find((x) => x.entry === selected) ?? null
		if (!w || !w.model) return null
		const key = weaponThumbKey(w)
		return { kind: 'm2', key, path: key.slice(3), name: label(w), category: weaponKind(w), zone: `Item ${w.entry}`, tokens: [], nameTokens: [], text: '' }
	})
	function hover(w: vmangos.WeaponEntry | null) {
		hovered = w
		onhover?.(w)
	}
	const title = (w: vmangos.WeaponEntry) => `${w.name} (item ${w.entry})\n${weaponKind(w)}`
</script>

<div class="picker">
	<div class="list">
		<input type="search" placeholder="Search: a name (scimitar, buckler) or an item entry" bind:value={query} />
		<div class="row">
			<div class="chips">
				<button class:on={owner === 'monster'} onclick={() => (owner = 'monster')}>Creature items</button>
				<button class:on={owner === 'player'} onclick={() => (owner = 'player')}>Player items</button>
				<button class:on={owner === ''} onclick={() => (owner = '')}>All</button>
			</div>
			<select bind:value={kind} title="Kind" aria-label="Kind">
				<option value="">All kinds ({byOwner.length})</option>
				{#each kinds as [name, n] (name)}<option value={name}>{name} ({n})</option>{/each}
			</select>
		</div>
		{#if error}<p class="error">{error}</p>{/if}
		<div
			class="grid-wrap"
			role="listbox"
			aria-label="{SLOTS[which]} items"
			tabindex="-1"
			bind:this={scroller}
			bind:clientWidth={width}
			bind:clientHeight={height}
			onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
			onpointerleave={() => hover(null)}
		>
			{#if loading}
				<p class="dim">Reading the world database's items…</p>
			{:else if !items.length}
				<p class="dim">Nothing matches.</p>
			{:else}
				<VirtualGrid {items} {win} {cols} tile={TILE} gap={GAP} {rowH} key={(w) => w.entry}>
					{#snippet cell(w: vmangos.WeaponEntry)}
						<PaletteTile thumbKey={weaponThumbKey(w)} label={label(w)} title={title(w)} size={TILE} active={w.entry === selected} onclick={() => onpick(w.entry)} onhover={(on) => on && hover(w)} />
					{/snippet}
				</VirtualGrid>
			{/if}
		</div>
		<span class="dim">{items.length.toLocaleString()} items</span>
	</div>
	<div class="side">
		<div class="preview">
			<AssetPreview item={previewItem} />
		</div>
		<button onclick={() => onpick(0)} disabled={!selected}>Empty the slot</button>
	</div>
</div>

<style>
	.picker {
		display: grid;
		grid-template-columns: 1fr 280px;
		gap: 12px;
		min-height: 0;
		flex: 1;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	/* The preview sits at the top right, as big as the grid is tall. */
	.side {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.side .preview {
		height: 360px;
	}
	.side button {
		align-self: flex-end;
	}
	input[type='search'] {
		width: 100%;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chips button {
		padding: 2px 8px;
		font-size: 11px;
		border-radius: 10px;
	}
	.chips button.on {
		background: var(--accent);
		color: var(--accent-ink);
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
		height: min(calc(52 * var(--vh)), 560px);
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
