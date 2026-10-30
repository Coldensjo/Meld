<script lang="ts">
	import { clamp, num } from '../lib/ui/inputs'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { leaveField, takeEscape } from '../lib/state/escape'
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow } from '../lib/ui/virtualGrid'
	import AssetPreview from './AssetPreview.svelte'
	import { displayName } from '../lib/models/assets'
	import { requestThumb, THUMBS_FORGOTTEN } from '../lib/wow/thumbs'
	import { loadCatalog } from '../lib/wow/catalogIndex'
	import { categoryOrder } from '../lib/wow/catalog'
	import { searchAssets, type AssetKind, type SearchItem } from '../lib/wow/search'
	import PlacementRulesForm from './PlacementRulesForm.svelte'
	import { activeBrushIn, addBrushTo, cloneBrush, newEntry, newRules, totalWeight, uniqueName, type BrushStore, type DoodadBrush, type PlacementRules } from '../lib/tools/doodadBrush'

	// The doodad brush editor, full screen like the creature editor: the left is a model picker over
	// the client's doodads and buildings (a click adds one to the brush, hovering shows it big), the
	// right the brush being edited, with each model's weight, scale range, sink and tilt. Edits go
	// straight into `store`: `prefs` in the page (DoodadBrushWindow.svelte), saved with the other
	// preferences, or the window's own copy in its OS window (#911, toolwin/DoodadBrushToolWindow.svelte),
	// which sends it to the main page.

	interface Props {
		store: BrushStore
		/** Whether the client is open, and its revision (the model list is read again when it changes). */
		wowLoaded: boolean
		wowRevision: number
		/** Whether brushes can be read from and written to files (the desktop app's dialogs). */
		files: boolean
		onclose: () => void
		/** Close and paint with the brush. */
		onpaint: () => void
		onimport: () => void
		onexport: (brush: DoodadBrush) => void
		onstatus: (text: string) => void
	}
	let { store, wowLoaded, wowRevision, files, onclose, onpaint, onimport, onexport, onstatus }: Props = $props()

	const brush = $derived(activeBrushIn(store))
	const total = $derived(brush ? totalWeight(brush) : 0)
	const names = () => store.doodadBrushes.map((b) => b.name)
	const inBrush = $derived(new Set(brush?.entries.map((e) => e.type) ?? []))

	const close = () => onclose()

	function create() {
		addBrushTo(store)
	}

	function duplicate() {
		if (!brush) return
		const b = cloneBrush(brush, uniqueName(brush.name, names()))
		store.doodadBrushes = [...store.doodadBrushes, b]
		store.doodadBrush = b.name
	}

	function remove() {
		if (!brush) return
		store.doodadBrushes = store.doodadBrushes.filter((b) => b !== brush)
		store.doodadBrush = store.doodadBrushes[0]?.name ?? ''
	}

	function rename(e: Event) {
		if (!brush) return
		const input = e.target as HTMLInputElement
		const name = input.value.trim()
		if (!name || name === brush.name) {
			input.value = brush.name
			return
		}
		const unique = uniqueName(
			name,
			names().filter((n) => n !== brush.name),
		)
		brush.name = unique
		store.doodadBrush = unique
	}

	function addModel(it: SearchItem) {
		const b = brush ?? addBrushTo(store)
		if (b.entries.some((e) => e.type === it.key)) {
			onstatus(`${it.name} is in the brush "${b.name}" already.`)
			return
		}
		b.entries.push(newEntry(it.key))
	}

	function removeEntry(i: number) {
		brush?.entries.splice(i, 1)
	}

	/** Closes the editor and paints with the brush. */
	const paint = () => onpaint()

	/** The brush's own rules, made on the first edit. */
	function rules(): PlacementRules {
		if (!brush!.rules) brush!.rules = newRules()
		return brush!.rules
	}

	const share = (w: number) => (total > 0 ? Math.round((Math.max(0, w) / total) * 100) : 0)

	/** Shows a model's thumbnail in `node` (an img) once it is rendered. */
	function thumb(node: HTMLImageElement, key: string) {
		let current = key
		let cancel = requestThumb(key, (u) => (node.src = u))
		const load = (k: string) => {
			current = k
			cancel()
			node.removeAttribute('src')
			cancel = requestThumb(k, (u) => (node.src = u))
		}
		// Its file was written over (#922): the picture is made again.
		const onForgotten = (e: Event) => {
			if ((e as CustomEvent<Set<string>>).detail.has(current.toLowerCase())) load(current)
		}
		window.addEventListener(THUMBS_FORGOTTEN, onForgotten)
		return {
			update: load,
			destroy: () => {
				window.removeEventListener(THUMBS_FORGOTTEN, onForgotten)
				cancel()
			},
		}
	}

	// ---- the model picker ------------------------------------------------------------------------------
	let all = $state<SearchItem[]>([])
	let loadingList = $state(false)
	let kind = $state<AssetKind>('m2')
	let query = $state('')
	let category = $state('')
	let hovered = $state<SearchItem | null>(null)
	let searchBox: HTMLInputElement | undefined = $state()

	// Read once per client, and only while the editor is open; the effect must read nothing it writes,
	// or it would run again after every load.
	let loadedRevision = -1
	$effect(() => {
		if (!wowLoaded || loadedRevision === wowRevision) return
		loadedRevision = wowRevision
		loadingList = true
		void loadCatalog().then((items) => {
			all = items
			loadingList = false
		})
	})
	$effect(() => {
		searchBox?.focus()
	})
	$effect(() => {
		void kind
		category = ''
	})

	const result = $derived(searchAssets(all, { kind, query, category, zone: '' }, categoryOrder(kind)))
	const items = $derived(result.items)

	// Only the rows in view are rendered, as in the asset browser.
	const GAP = 6
	const tile = 96
	let gridWidth = $state(0)
	let scrollTop = $state(0)
	let viewHeight = $state(0)
	const rowH = tile + 22 + GAP
	const cols = $derived(gridCols(gridWidth, tile, GAP))
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, viewHeight))
	let scroller: HTMLDivElement | undefined = $state()
	$effect(() => {
		void items
		scroller?.scrollTo(0, 0)
		scrollTop = 0
	})

	let root = $state<HTMLElement>()

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (!takeEscape(e, root)) return
			if (leaveField(e)) return
			e.preventDefault()
			close()
		} else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			searchBox?.focus()
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="editor" role="dialog" aria-modal="true" aria-label="Doodad brush editor" bind:this={root} use:dialogFocus>
	<header>
		<div class="title">
			<h2>Doodad brushes</h2>
			<span class="dim">A brush scatters its models over the ground by their weights. Click a model on the left to add it.</span>
		</div>
		<div class="actions">
			<select value={brush?.name ?? ''} onchange={(e) => (store.doodadBrush = (e.target as HTMLSelectElement).value)} disabled={!store.doodadBrushes.length} aria-label="Brush">
				{#if !store.doodadBrushes.length}<option value="">No brushes yet</option>{/if}
				{#each store.doodadBrushes as b (b.name)}
					<option value={b.name}>{b.name} ({b.entries.length})</option>
				{/each}
			</select>
			<button onclick={create} title="Make a new, empty brush">New</button>
			<button onclick={duplicate} disabled={!brush} title="Copy this brush">Copy</button>
			<button onclick={remove} disabled={!brush} title="Delete this brush">Delete</button>
			<span class="gap"></span>
			<button disabled={!files} onclick={() => onimport()} title="Read brushes from .toml files">Import…</button>
			<button disabled={!files || !brush} onclick={() => brush && onexport(brush)} title="Save this brush as a .toml file to share">Export…</button>
			<button class="active" disabled={!brush?.entries.length} onclick={paint} title="Close and paint with this brush (8)">Paint with it</button>
			<button onclick={close} title="Close (Esc)">Close</button>
		</div>
	</header>

	<div class="body">
		<section class="left">
			<div class="search">
				<input bind:this={searchBox} type="search" placeholder="Search models… (Ctrl+F)" bind:value={query} />
				<nav class="kinds">
					<button class:on={kind === 'm2'} onclick={() => (kind = 'm2')}>Doodads</button>
					<button class:on={kind === 'wmo'} onclick={() => (kind = 'wmo')}>Buildings</button>
				</nav>
			</div>
			{#if !wowLoaded}
				<div class="empty dim">Select your WoW client folder (Edit › Preferences › Folders) to browse its models.</div>
			{:else}
				<div class="picker">
					<nav class="facets">
						<button class="facet" aria-pressed={!category} class:active={!category} onclick={() => (category = '')}>
							All <span>{result.categories.reduce((n, c) => n + c.count, 0).toLocaleString()}</span>
						</button>
						{#each result.categories as c (c.name)}
							<button class="facet" aria-pressed={category === c.name} class:active={category === c.name} onclick={() => (category = category === c.name ? '' : c.name)}>
								{c.name} <span>{c.count.toLocaleString()}</span>
							</button>
						{/each}
					</nav>
					<!-- A tile only sets the hover; leaving the grid clears it (no gap between two tiles). -->
					<div
						class="grid-wrap"
						role="group"
						aria-label="Models"
						tabindex="-1"
						bind:this={scroller}
						bind:clientWidth={gridWidth}
						bind:clientHeight={viewHeight}
						onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
						onpointerleave={() => (hovered = null)}
					>
						{#if loadingList}
							<p class="hint">Reading the client's file list…</p>
						{:else if !items.length}
							<p class="hint">Nothing matches. Try another word, or clear the category.</p>
						{:else}
							<VirtualGrid {items} {win} {cols} {tile} gap={GAP} {rowH} key={(it) => it.key}>
								{#snippet cell(it: SearchItem)}
									<PaletteTile
										thumbKey={it.key}
										label={it.name}
										title={it.path}
										size={tile}
										active={inBrush.has(it.key)}
										badge={inBrush.has(it.key) ? '✓' : undefined}
										onclick={() => addModel(it)}
										onhover={(on) => on && (hovered = it)}
									/>
								{/snippet}
							</VirtualGrid>
						{/if}
					</div>
					<aside class="side">
						<AssetPreview item={hovered} />
					</aside>
				</div>
			{/if}
		</section>

		<section class="right">
			{#if brush}
				<div class="scroll">
					<div class="row">
						<label class="field grow"><span>Name</span><input value={brush.name} onchange={rename} /></label>
						<label class="field" title="Space between models as a multiple of their footprint: 1 lets them touch, 2 leaves a model's width between them, 0.5 lets them overlap">
							<span>Spacing</span>
							<input class="num" type="number" min="0" max="5" step="0.1" value={brush.spacing.toFixed(1)} onchange={(e) => (brush.spacing = clamp(num(e), 0, 5))} />
						</label>
					</div>

					<div class="section">
						Models {#if brush.entries.length}<span class="dim">· total weight {total}</span>{/if}
					</div>
					{#if !brush.entries.length}
						<p class="dim">The brush is empty. Click models on the left to add them.</p>
					{/if}
					{#each brush.entries as e, i (e.type)}
						<div class="entry">
							<img class="thumb" alt="" use:thumb={e.type} />
							<div class="ebody">
								<div class="head">
									<span class="name" title={e.type}>{displayName(e.type)}</span>
									<span class="pct" title="Share of the placements">{share(e.weight)}%</span>
									<button class="x" onclick={() => removeEntry(i)} title="Take the model out of the brush" aria-label="Remove model">✕</button>
								</div>
								<label class="field" title="How often it comes out, relative to the other models">
									<span>Weight</span>
									<input type="range" min="0" max="100" step="1" bind:value={e.weight} />
									<input class="num" type="number" min="0" step="1" value={e.weight} onchange={(ev) => (e.weight = clamp(num(ev), 0, 1000))} />
								</label>
								<div class="row tight">
									<label class="field" title="Random scale between these">
										<span>Scale</span>
										<input class="num" type="number" min="0.05" max="20" step="0.05" value={e.scaleMin.toFixed(2)} onchange={(ev) => (e.scaleMin = Math.min(e.scaleMax, clamp(num(ev), 0.05, 20)))} />
										<span>–</span>
										<input class="num" type="number" min="0.05" max="20" step="0.05" value={e.scaleMax.toFixed(2)} onchange={(ev) => (e.scaleMax = Math.max(e.scaleMin, clamp(num(ev), 0.05, 20)))} />
									</label>
									<label class="field" title="Height above the ground in yards; negative sinks it in">
										<span>Sink</span>
										<input class="num" type="number" min="-20" max="20" step="0.1" value={e.sink.toFixed(1)} onchange={(ev) => (e.sink = clamp(num(ev), -20, 20))} />
									</label>
									<label class="field" title="Random tilt each way, in degrees (Follow ground rotation replaces it)">
										<span>Tilt</span>
										<input class="num" type="number" min="0" max="45" step="1" value={e.tilt} onchange={(ev) => (e.tilt = clamp(num(ev), 0, 45))} />°
									</label>
									<label class="field" title="How far it leans with the slope it stands on: 0 upright, 100 square to the ground (Follow ground rotation leans every model fully)">
										<span>Align</span>
										<input class="num" type="number" min="0" max="100" step="10" value={Math.round((e.align ?? 0) * 100)} onchange={(ev) => (e.align = clamp(num(ev), 0, 100) / 100)} />%
									</label>
								</div>
							</div>
						</div>
					{/each}

					<div class="section">Where it places <span class="dim">· besides the options bar's Max slope and Avoid water</span></div>
					<PlacementRulesForm value={brush.rules} make={rules} />
					<p class="dim hint">
						In the world: drag to scatter, Ctrl+drag to erase the brush's models. Size, Strength and Falloff are in the options bar. Paint › Fill Selection (or Mask) with Doodad Brush covers a whole area at once.
					</p>
				</div>
			{:else}
				<div class="empty dim">No brush yet. Click New, or click a model on the left to start one.</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.editor {
		position: fixed;
		inset: 0;
		z-index: var(--z-editor);
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.actions select {
		max-width: 220px;
	}
	.gap {
		width: 8px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.left {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.search {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.search input {
		flex: 1;
		padding: 4px 8px;
	}
	.kinds {
		display: flex;
	}
	.kinds button {
		border-radius: 0;
		margin-left: -1px;
	}
	.kinds button:first-child {
		border-radius: var(--radius) 0 0 var(--radius);
		margin-left: 0;
	}
	.kinds button:last-child {
		border-radius: 0 var(--radius) var(--radius) 0;
	}
	.kinds button.on {
		background: var(--panel-3);
		color: var(--text-strong);
	}
	.picker {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 8px;
	}
	.facets {
		width: 150px;
		flex: none;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.facet {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		border: none;
		background: transparent;
		color: var(--text-dim);
		text-align: left;
		padding: 3px 8px;
		font-size: 11px;
	}
	.facet span {
		font: 10px var(--mono);
		opacity: 0.7;
	}
	.facet:hover {
		background: var(--panel-2);
		color: var(--text);
	}
	.facet.active {
		background: var(--panel-3);
		color: var(--text);
	}
	.grid-wrap {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		position: relative;
	}
	.hint {
		color: var(--text-dim);
		font-size: 12px;
		margin: 8px;
	}
	/* Wide enough to judge a model before adding it; a narrow window keeps room for the grid. */
	.side {
		width: min(520px, calc(28 * var(--vw)));
		flex: none;
		display: flex;
		flex-direction: column;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 24px;
		text-align: center;
	}
	.right {
		width: min(520px, calc(42 * var(--vw)));
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--panel);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.row.tight {
		gap: 10px;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		font-size: 11px;
		color: var(--text-dim);
	}
	.field input:not(.num):not([type='range']) {
		flex: 1;
		min-width: 0;
		padding: 2px 6px;
	}
	.field input[type='range'] {
		flex: 1;
		min-width: 40px;
		height: 14px;
	}
	.num {
		width: 52px;
		padding: 1px 4px;
		font: 11px var(--mono);
		text-align: right;
	}
	.section {
		margin: 6px 0 0;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.entry {
		display: flex;
		gap: 8px;
		padding: 6px;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.thumb {
		width: 64px;
		height: 64px;
		flex: none;
		border-radius: 4px;
		object-fit: cover;
		background: radial-gradient(circle at 50% 40%, var(--preview-glow), var(--preview-edge) 80%);
	}
	.ebody {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 600;
	}
	.pct {
		font: 11px var(--mono);
		color: var(--text-dim);
	}
	.x {
		border: none;
		background: transparent;
		padding: 0 4px;
		color: var(--text-dim);
	}
	.x:hover {
		color: var(--text);
	}
</style>
