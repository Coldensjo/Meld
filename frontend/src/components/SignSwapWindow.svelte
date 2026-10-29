<script lang="ts">
	import Modal from './Modal.svelte'
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import AssetPreview from './AssetPreview.svelte'
	import { gridCols, gridTile, gridWindow } from '../lib/ui/virtualGrid'
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { loadCatalog } from '../lib/wow/catalogIndex'
	import { isRoadSign, isSignModel, signModels } from '../lib/wow/signs'
	import type { SearchItem } from '../lib/wow/search'

	// Swap sign (#843, the right-click menu on a sign doodad): a road sign's words are painted in its
	// model's texture in 1.12, so what a signpost says is changed by swapping it for another sign model.
	// The client's sign doodads are listed as thumbnails, those in the selected sign's folder first; the
	// one under the pointer (else the selected sign) is shown large beside them, turnable, so its words
	// can be read. A click swaps the selected signs for it (Engine.swapSelectedSigns: one undo step, the
	// placement kept), and the window stays open to try another.

	const close = () => (ui.signSwap = false)

	/** Bumped by each swap here, so `current` reads the swapped type. */
	let swaps = $state(0)
	/** The selected sign's type now: it follows each swap, so its tile is the highlighted one. */
	const current = $derived.by(() => {
		// The objects map is not reactive: a swap here bumps `swaps`, an undo or a new selection writes editor.selected.
		void swaps
		void editor.selected
		const id = editor.selectedIds.find((i) => isSignModel(engineRef.current?.objects.objects.get(i)?.type ?? ''))
		return id === undefined ? '' : (engineRef.current?.objects.objects.get(id)?.type ?? '')
	})
	/** The type the window opened on, which orders the list (it must not jump about after each swap). */
	// svelte-ignore state_referenced_locally
	const opened = current

	let all = $state<SearchItem[]>([])
	let loading = $state(true)
	void loadCatalog().then((items) => {
		all = signModels(items, opened)
		loading = false
	})

	// svelte-ignore state_referenced_locally
	let roadOnly = $state(!opened || isRoadSign(opened))
	let query = $state('')
	const items = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		return all.filter((it) => (!roadOnly || isRoadSign(it.path)) && words.every((w) => it.path.toLowerCase().includes(w)))
	})

	let hovered = $state<SearchItem | null>(null)
	const shown = $derived(hovered ?? all.find((it) => it.key.toLowerCase() === current.toLowerCase()) ?? null)

	function pick(it: SearchItem) {
		engineRef.current?.swapSelectedSigns(it.key)
		swaps++
	}

	// The grid renders only the rows in view.
	const TILE = 104
	const MAX_TILE = 132
	const GAP = 6
	const PAD = 12
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	const cols = $derived(gridCols(width, TILE, GAP, PAD - GAP))
	const tile = $derived(gridTile(width, cols, GAP, PAD, TILE, MAX_TILE))
	const rowH = $derived(tile + 22 + GAP)
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, height))

	// Closes itself when no sign is selected any more (the selection changed under it, or the tab).
	$effect(() => {
		if (!loading && !current) close()
	})
</script>

<Modal title={editor.selectedIds.length > 1 ? 'Swap signs' : 'Swap sign'} width={900} onclose={close}>
	<div class="swap" data-testid="sign-swap">
		<div class="list">
			<div class="row">
				<input type="search" placeholder="Search the signs: a word of the path (pointer, goldshire, dwarf)" bind:value={query} />
				<label title="Only the signposts, pointers and directional signs of the roads"><input type="checkbox" bind:checked={roadOnly} /> Road signs</label>
			</div>
			<div
				class="grid-wrap"
				role="listbox"
				aria-label="Sign models"
				tabindex="-1"
				bind:clientWidth={width}
				bind:clientHeight={height}
				onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
				onpointerleave={() => (hovered = null)}
			>
				{#if loading}
					<p class="dim">Reading the client's models…</p>
				{:else if !items.length}
					<p class="dim">No sign matches.</p>
				{:else}
					<VirtualGrid {items} {win} {cols} {tile} gap={GAP} {rowH} key={(it) => it.key}>
						{#snippet cell(it: SearchItem)}
							<PaletteTile
								thumbKey={it.key}
								label={it.name}
								title={`${it.path}\nClick to swap the selected ${editor.selectedIds.length > 1 ? 'signs' : 'sign'} for it`}
								size={tile}
								active={it.key.toLowerCase() === current.toLowerCase()}
								onclick={() => pick(it)}
								onhover={(on) => on && (hovered = it)}
							/>
						{/snippet}
					</VirtualGrid>
				{/if}
			</div>
		</div>
		<aside class="side">
			<AssetPreview item={shown} />
		</aside>
	</div>
	<p class="dim hint">
		Hover a sign to see it large (drag to turn it and read it); a click swaps the selected {editor.selectedIds.length > 1 ? 'signs' : 'sign'}, keeping {editor.selectedIds.length > 1 ? 'their' : 'its'} place, turn and scale. Ctrl+Z after closing
		undoes it.
	</p>
</Modal>

<style>
	.swap {
		display: flex;
		gap: 12px;
		height: min(calc(70 * var(--vh)), 600px);
	}
	.list {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.row input[type='search'] {
		flex: 1;
		min-width: 0;
	}
	.row label {
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
		font-size: 12px;
	}
	.grid-wrap {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px;
	}
	.side {
		width: 300px;
		flex: none;
		min-height: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.hint {
		margin-top: 8px;
	}
</style>
