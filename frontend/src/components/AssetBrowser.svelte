<script lang="ts">
	import { tick, untrack } from 'svelte'
	import PaletteTile from './PaletteTile.svelte'
	import { copyItems, copyValue } from '../lib/ui/copyId'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow, rowTop } from '../lib/ui/virtualGrid'
	import AssetPreview from './AssetPreview.svelte'
	import SpawnBrowser, { type SpawnKind } from './SpawnBrowser.svelte'
	import { editor, prefs, setStatus, ui, wow, type ContextItem } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { activeDoodadBrush, addDoodadBrush } from '../lib/tools/DoodadBrushTool'
	import { newEntry } from '../lib/tools/doodadBrush'
	import { engineRef } from '../lib/state/engineRef'
	import { chooseWowFolder } from '../lib/wow/api'
	import { loadCatalog } from '../lib/wow/catalogIndex'
	import { prefetchAround, prefetchThumbs } from '../lib/wow/thumbs'
	import { categoryOrder } from '../lib/wow/catalog'
	import { searchAssets, type AssetKind, type SearchItem } from '../lib/wow/search'
	import { readView, writeView, type BrowserSort, type BrowserView } from '../lib/wow/browserViews'
	import { isModelKey, newSet, sameModel, validSets, withModel, withoutModel, type ModelSet } from '../lib/wow/modelSets'
	import { uniqueName } from '../lib/tools/doodadBrush'
	import { hasBackend } from '../lib/io/backend'
	import { exportModelSet, importModelSets } from '../lib/io/lists'
	import PrefabBrowser from './PrefabBrowser.svelte'
	import { paletteIndex } from '../lib/terrain/chunkPaint'
	import { cssViewport, toCss } from '../lib/ui/uiScale'
	import { dialogOpen } from '../lib/ui/dialogFocus'

	/** A tab: the client's files by kind, all of them, the world database's templates, or the author's sets. */
	type Kind = AssetKind | 'all' | SpawnKind | 'sets' | 'prefabs'

	// The asset browser: the panel along the bottom of the window where models and textures are found.
	// Search-first: one box over everything, facets to narrow, big tiles, and a live preview of the
	// tile under the cursor. Nothing is read from the client until it is shown.

	const KINDS: Array<{ id: Kind; label: string }> = [
		{ id: 'm2', label: 'Doodads' },
		{ id: 'wmo', label: 'Buildings' },
		{ id: 'tex', label: 'Textures' },
		{ id: 'creature', label: 'Creatures' },
		{ id: 'npc', label: 'NPCs' },
		{ id: 'object', label: 'Objects' },
		{ id: 'all', label: 'All' },
		{ id: 'sets', label: 'Sets' },
		{ id: 'prefabs', label: 'Prefabs' },
	]

	/** The tab, kept in the preferences so a restart opens it again. */
	const kind = $derived<Kind>(KINDS.find((k) => k.id === prefs.browserKind)?.id ?? 'm2')
	/** The spawn tabs list the world database's templates (SpawnBrowser), not the client's files. */
	const spawnKind = $derived(kind === 'creature' || kind === 'npc' || kind === 'object')
	/** The catalog's kind: the spawn tabs search nothing of the catalog. */
	const catalogKind = $derived((spawnKind || kind === 'sets' || kind === 'prefabs' ? 'all' : kind) as AssetKind | 'all')
	let spawnHover = $state<SearchItem | null>(null)
	// Each tab's search, category and zone live in the preferences (#123), so changing tab or
	// restarting finds them as they were left.
	const view = $derived(readView(prefs.browserViews, kind))
	const query = $derived(view.query)
	const category = $derived(view.category)
	const zone = $derived(view.zone)
	/** The creature tabs' order (#659); objects have no level. */
	const sort = $derived(view.sort)
	function setView(patch: Partial<BrowserView>) {
		prefs.browserViews = writeView(prefs.browserViews, kind, patch)
	}
	let hovered = $state<SearchItem | null>(null)
	/** What the spawn and prefab tabs list, for the header's count; they search the header's query (#651). */
	let childCount = $state(0)
	/** Each tab's search box hint: what it searches by. */
	const PLACEHOLDERS: Partial<Record<Kind, string>> = {
		tex: 'Search textures… (Ctrl+F)',
		all: 'Search everything… (Ctrl+F)',
		creature: 'Search creatures: a name (Hogger) or an entry… (Ctrl+F)',
		npc: 'Search NPCs: a name or an entry… (Ctrl+F)',
		object: 'Search objects: a name (chest, vein, peacebloom) or an entry… (Ctrl+F)',
		prefabs: 'Search prefabs… (Ctrl+F)',
	}
	const placeholder = $derived(PLACEHOLDERS[kind] ?? 'Search models… (Ctrl+F)')
	let searchBox: HTMLInputElement | undefined = $state()

	// The whole client's catalog, indexed once per client.
	let all = $state<SearchItem[]>([])
	let loadingList = $state(false)
	let loadedRevision = -1
	$effect(() => {
		if (!wow.loaded || loadedRevision === wow.revision) return
		loadedRevision = wow.revision
		loadingList = true
		void loadCatalog().then((items) => {
			all = items
			loadingList = false
		})
	})

	// The tool decides what is wanted: textures while painting, models while placing. Only a change of
	// ui.palette moves the browser; reading kind here would undo every click on a tab.
	$effect(() => {
		const want = ui.palette
		untrack(() => {
			if (want === 'textures' && kind !== 'tex') setKind('tex')
			else if (want === 'models' && kind === 'tex') setKind('m2')
		})
	})

	/** Changes tab, first keeping where the grid of the one left was scrolled to. */
	function setKind(k: Kind) {
		if (k === kind) return
		saveScroll()
		prefs.browserKind = k
	}

	function chooseKind(k: Kind) {
		setKind(k)
		prefs.browserCollapsed = false
		// Keep ui.palette in step, so the next tool switch moves the browser again.
		if (k === 'tex') ui.palette = 'textures'
		else if (k !== 'all') ui.palette = 'models'
	}

	const orderFor = (k: AssetKind | 'all') => (k === 'all' ? [...categoryOrder('m2'), ...categoryOrder('wmo'), ...categoryOrder('tex')] : categoryOrder(k))
	// The Sets tab searches the shown set's models only; a model this client lacks is kept in the set
	// but can't be shown.
	const sets = $derived(validSets(prefs.modelSets))
	const activeSet = $derived(sets.find((s) => s.name === prefs.modelSet) ?? sets[0] ?? null)
	const setItems = $derived(kind === 'sets' && activeSet ? activeSet.models.map((k) => itemFor(k)).filter((it): it is SearchItem => !!it) : [])
	const missing = $derived(kind === 'sets' && activeSet ? activeSet.models.length - setItems.length : 0)
	const result = $derived(searchAssets(kind === 'sets' ? setItems : all, { kind: catalogKind, query, category, zone }, orderFor(catalogKind)))
	const items = $derived(result.items)

	/**
	 * A key as the client's tiles name models: lower case, and the old .mdx extension as .m2. A model
	 * picked from a loaded region (the pipette) only matches the catalog this way.
	 */
	const normKey = (k: string) => k.toLowerCase().replace(/\.mdx$/, '.m2')
	const byNormKey = $derived(new Map(all.map((it) => [normKey(it.key), it])))
	const itemFor = (key: string) => byNormKey.get(normKey(key)) ?? null

	/** Recently picked assets, newest first, shown when the search box is empty. */
	const recent = $derived.by(() => {
		if (query || category || zone || kind === 'sets') return []
		return prefs.recentAssets.map(itemFor).filter((it): it is SearchItem => !!it && (catalogKind === 'all' || it.kind === catalogKind))
	})

	/** The favourites (prefs.favoriteAssets), in the order they were starred, shown first when the search box is empty. */
	const favourites = $derived.by(() => {
		if (query || category || zone || kind === 'sets') return []
		return prefs.favoriteAssets.map(itemFor).filter((it): it is SearchItem => !!it && (catalogKind === 'all' || it.kind === catalogKind))
	})
	const favouriteSet = $derived(new Set(prefs.favoriteAssets.map(normKey)))
	const isFavourite = (it: SearchItem) => favouriteSet.has(normKey(it.key))

	/** Stars or unstars an asset (a right-click on its tile). */
	function toggleFavourite(it: SearchItem) {
		const on = !isFavourite(it)
		prefs.favoriteAssets = on ? [...prefs.favoriteAssets, it.key] : prefs.favoriteAssets.filter((k) => normKey(k) !== normKey(it.key))
		setStatus(on ? `${it.name} is a favourite: it shows first in the browser (right-click again to remove it).` : `${it.name} is no longer a favourite.`, 3000)
	}

	// --- model sets (#124) --------------------------------------------------------------------------
	function putSet(name: string, next: ModelSet) {
		prefs.modelSets = sets.map((s) => (s.name === name ? next : s))
	}
	function addSet(first?: SearchItem) {
		const name = uniqueName(
			'New set',
			sets.map((s) => s.name),
		)
		const set = first ? withModel(newSet(name), first.key) : newSet(name)
		prefs.modelSets = [...sets, set]
		prefs.modelSet = name
		setStatus(first ? `Made the set "${name}" with ${first.name}; rename it in the Sets tab.` : `Made the set "${name}": right-click a model in Doodads or Buildings to add it.`, 4000)
	}
	function renameSet(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const set = activeSet
		const name = input.value.trim()
		if (!set || !name || name === set.name) {
			input.value = set?.name ?? ''
			return
		}
		const unique = uniqueName(
			name,
			sets.filter((s) => s !== set).map((s) => s.name),
		)
		putSet(set.name, { ...set, name: unique })
		prefs.modelSet = unique
		input.value = unique
	}
	async function deleteSet() {
		const set = activeSet
		if (!set || !(await askConfirm(`Delete the set "${set.name}"? Its ${set.models.length} models stay in the client; only the list goes.`, { title: 'Delete set', ok: 'Delete' }))) return
		prefs.modelSets = sets.filter((s) => s !== set)
		prefs.modelSet = ''
	}
	function addToSet(set: ModelSet, it: SearchItem) {
		putSet(set.name, withModel(set, it.key))
		setStatus(`Added ${it.name} to the set "${set.name}".`, 3000)
	}
	function removeFromSet(set: ModelSet, it: SearchItem) {
		putSet(set.name, withoutModel(set, it.key))
		setStatus(`Took ${it.name} out of the set "${set.name}".`, 3000)
	}

	/** A tile's right-click menu: the favourite star, and for a model the sets it can join or leave. */
	function tileMenu(e: MouseEvent, it: SearchItem) {
		const items: ContextItem[] = [{ label: isFavourite(it) ? 'Remove from Favourites' : 'Add to Favourites', run: () => toggleFavourite(it) }]
		if (isModelKey(it.key)) {
			items.unshift({ label: 'Preview', run: () => (ui.modelPreview = { title: it.name, type: it.key, scale: 1 }) }, { separator: true })
			items.push({ separator: true })
			for (const set of sets) {
				const has = set.models.some((m) => sameModel(m, it.key))
				items.push(has ? { label: `Remove from "${set.name}"`, run: () => removeFromSet(set, it) } : { label: `Add to "${set.name}"`, run: () => addToSet(set, it) })
			}
			items.push({ label: 'Add to a New Set', run: () => addSet(it) })
		}
		// Copy id (#681): an asset's id is its path in the client.
		items.push({ separator: true }, { label: 'Copy path', run: () => void copyValue(it.path, 'path') }, ...copyItems({ ids: [], name: it.name }))
		ui.contextMenu = { x: e.clientX, y: e.clientY, title: it.name, items }
	}

	function remember(key: string) {
		prefs.recentAssets = [key, ...prefs.recentAssets.filter((k) => k !== key)].slice(0, 24)
	}

	function pick(it: SearchItem) {
		remember(it.key)
		if (it.kind === 'tex') pickTexture(it)
		else pickModel(it)
	}

	function pickModel(it: SearchItem) {
		// In the Doodad brush tool a pick goes into the brush being edited, not under the cursor.
		if (editor.tool === 'doodad') {
			const brush = activeDoodadBrush() ?? addDoodadBrush()
			if (brush.entries.some((e) => e.type === it.key)) setStatus(`${it.name} is in the brush "${brush.name}" already.`)
			else {
				brush.entries.push(newEntry(it.key))
				setStatus(`Added ${it.name} to the brush "${brush.name}".`)
			}
			return
		}
		// In the Path tool the pick is the picked path's fence model, and the tool stays (#167).
		if (editor.tool === 'path') {
			const engine = engineRef.current
			if (!engine || editor.pathId < 0) setStatus('Pick a path first: the model is the one a fence stands along it.', 4000)
			else {
				engine.path((t, c) => t.setField(c, 'model', it.key))
				if (editor.pathKind !== 'fence') setStatus(`${it.name} is the path's model: switch it to Fence to stand it along the path.`, 5000)
			}
			return
		}
		editor.prefab = it.key
		// A model replaces whatever creature or object template the Place tool was putting down.
		ui.placeCreature = ui.placeObject = null
		if (editor.tool !== 'place') editor.tool = 'place'
	}

	function pickTexture(it: SearchItem) {
		const engine = engineRef.current
		if (!engine) return
		// A Replace on a Layers panel row is waiting for this pick: it takes that texture's place in those chunks.
		const target = ui.replaceSlot
		if (target) {
			ui.replaceSlot = null
			engine.replaceTextureInChunks(target.chunks, target.tex, it.path)
			return
		}
		const slot = engine.useTexture(it.path)
		if (slot < 0) return
		// Sculpting with Paint texture on: the pick is the texture sculpting paints, and the tool stays.
		if (editor.tool === 'sculpt' && editor.sculptPaint === 'texture') {
			editor.sculptPaintLayer = slot
			return
		}
		// In the Path tool the pick is the picked path's texture, and the tool stays (#167).
		if (editor.tool === 'path') {
			engine.path((t, c) => t.setField(c, 'texture', editor.palette[slot]))
			return
		}
		if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
		// With a mask painted, picking a texture fills the whole mask with it.
		if (ui.maskActive && editor.tool === 'paint') engine.fillMask(slot)
	}

	const slotOf = (path: string) => paletteIndex(editor.palette, path)
	const activeModel = $derived(itemFor(editor.prefab))
	const isActive = (it: SearchItem) => (it.kind === 'tex' ? slotOf(it.path) >= 0 && slotOf(it.path) === editor.paintLayer : activeModel === it)
	const badgeOf = (it: SearchItem) => {
		if (it.kind !== 'tex') return undefined
		const s = slotOf(it.path)
		return s >= 0 ? String(s + 1) : undefined
	}

	// --- the grid only renders the rows in view, so a result of ten thousand tiles costs nothing -----
	const GAP = 6
	let gridWidth = $state(0)
	let scrollTop = $state(0)
	let viewHeight = $state(0)
	const tile = $derived(prefs.browserTile)
	// A tile's name takes 22 px under its picture (#655).
	const rowH = $derived(tile + (prefs.browserNames ? 22 : 0) + GAP)
	const cols = $derived(gridCols(gridWidth, tile, GAP))
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, viewHeight))
	// The rows just outside the view are prepared after the ones in it, so scrolling finds them ready.
	$effect(() => {
		if (prefs.browserCollapsed) prefetchThumbs([])
		else if (!spawnKind && !loadingList) prefetchAround(items.length, cols, win.first, win.last, (i) => items[i].key)
	})

	let scroller: HTMLDivElement | undefined = $state()
	/** The virtualised block; the Recent section above it offsets it from the scroller's top. */
	let virtualEl: HTMLDivElement | undefined = $state()
	const contentTop = () => virtualEl?.offsetTop ?? 0
	/** Scroll position within the virtualised block, which the rendered rows come from. */
	function onScroll(e: Event) {
		scrollTop = Math.max(0, (e.currentTarget as HTMLDivElement).scrollTop - contentTop())
		// Kept once the scrolling stops, not on every event, as a preferences write wakes their savers.
		clearTimeout(scrollTimer)
		scrollTimer = setTimeout(saveScroll, 300)
	}
	let scrollTimer: ReturnType<typeof setTimeout> | undefined
	/** Keeps the grid's scroll position in the tab's view. */
	function saveScroll() {
		clearTimeout(scrollTimer)
		if (scroller && !spawnKind && !loadingList && all.length) setView({ scroll: Math.round(scroller.scrollTop) })
	}
	/** The tab whose list the grid shows, so a new list knows whether it came with a tab change. */
	let shownKind: Kind | null = null
	// A new list from the same tab (another search or filter) starts at the top; a tab changed to, or
	// the catalog loaded, goes back to where that tab was left.
	$effect(() => {
		void items
		const k = kind
		// No grid (folded away, a spawn tab, the catalog loading): the next grid shown is restored.
		if (prefs.browserCollapsed || spawnKind || loadingList || !all.length) {
			shownKind = null
			return
		}
		const top = untrack(() => (k === shownKind ? 0 : view.scroll))
		shownKind = k
		void tick().then(() => {
			scroller?.scrollTo(0, top)
			scrollTop = Math.max(0, (scroller?.scrollTop ?? 0) - contentTop())
		})
	})

	// The pipette's pick (ui.revealAsset) is shown in the browser: the filters are cleared so it is
	// in the list, its kind's tab is chosen, the browser is opened and the grid scrolls to its row.
	$effect(() => {
		const req = ui.revealAsset
		if (!req) return
		untrack(() => void reveal(req.key))
	})

	async function reveal(key: string) {
		// A creature, NPC or object template: its tab shows it (SpawnBrowser scrolls to it).
		const prefix = key.slice(0, key.indexOf(':'))
		if (prefix === 'creature' || prefix === 'npc' || prefix === 'object') {
			if (kind !== prefix) chooseKind(prefix)
			prefs.browserCollapsed = false
			return
		}
		const it = itemFor(key)
		if (!it) return
		if (kind !== 'all' && kind !== it.kind) chooseKind(it.kind)
		// Its own zone and category (Durotar › Trees), so the list is short and few thumbnails load.
		setView({ query: '', zone: it.zone, category: it.category })
		prefs.browserCollapsed = false
		// Let the list and the reset-to-top effect settle before scrolling to the row.
		await tick()
		await tick()
		const idx = items.indexOf(it)
		if (idx < 0 || !scroller) return
		// The row sits a little below the top edge, clear of the scroller's padding.
		scroller.scrollTo({ top: Math.max(0, contentTop() + rowTop(idx, cols, rowH) - GAP * 3) })
		scrollTop = Math.max(0, scroller.scrollTop - contentTop())
	}

	/** The tile a shown item gets in the sidebar list of the selected model, when it exists. */
	const previewItem = $derived.by(() => {
		if (hovered) return hovered
		return kind === 'tex' ? itemFor(`tex:${editor.palette[editor.paintLayer] ?? ''}`) : activeModel
	})

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			setView({ query: '' })
			searchBox?.blur()
		}
	}

	/** Ctrl+F focuses the search from anywhere. */
	function globalKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			// Not under a dialog or full-screen editor: the box would take focus behind it (#574).
			if (dialogOpen()) return
			e.preventDefault()
			prefs.browserCollapsed = false
			searchBox?.focus()
			searchBox?.select()
		}
	}

	// Drag the top edge to resize, as the dock's edge does.
	function startResize(e: PointerEvent) {
		const startY = e.clientY
		const startH = prefs.browserHeight
		const el = e.currentTarget as HTMLElement
		el.setPointerCapture(e.pointerId)
		const move = (ev: PointerEvent) => {
			prefs.browserHeight = Math.round(Math.min(cssViewport().h * 0.7, Math.max(160, startH + toCss(startY - ev.clientY))))
		}
		const up = () => {
			el.removeEventListener('pointermove', move)
			el.removeEventListener('pointerup', up)
		}
		el.addEventListener('pointermove', move)
		el.addEventListener('pointerup', up)
	}
</script>

<svelte:window onkeydown={globalKey} />

<section class="browser" class:collapsed={prefs.browserCollapsed} style:height={prefs.browserCollapsed ? undefined : `${prefs.browserHeight}px`}>
	{#if !prefs.browserCollapsed}
		<div class="resizer" role="separator" aria-orientation="horizontal" onpointerdown={startResize}></div>
	{/if}
	<header>
		<div class="kinds" role="tablist">
			{#each KINDS as k (k.id)}
				<button class="tab" role="tab" aria-selected={kind === k.id && !prefs.browserCollapsed} class:active={kind === k.id && !prefs.browserCollapsed} onclick={() => chooseKind(k.id)}>{k.label}</button>
			{/each}
		</div>
		{#if !prefs.browserCollapsed && wow.loaded}
			<!-- The same search, count and tile size on every tab (#651); the zone is the model tabs' and the order the creature tabs'. -->
			<input class="search" type="text" {placeholder} title={placeholder} bind:value={() => query, (v) => setView({ query: v })} bind:this={searchBox} onkeydown={onKey} />
			{#if kind === 'creature' || kind === 'npc'}
				<select aria-label="Sort" title="The order of the creatures" value={sort} onchange={(e) => setView({ sort: e.currentTarget.value as BrowserSort })}>
					<option value="">Database order</option>
					<option value="level">Level, lowest first</option>
					<option value="level-desc">Level, highest first</option>
				</select>
			{:else if !spawnKind && kind !== 'prefabs'}
				<select bind:value={() => zone, (v) => setView({ zone: v })} title="Zone" aria-label="Zone">
					<option value="">All zones</option>
					{#each result.zones as z (z.name)}<option value={z.name}>{z.name} ({z.count})</option>{/each}
				</select>
			{/if}
			<span class="count">{(spawnKind || kind === 'prefabs' ? childCount : items.length).toLocaleString()}</span>
		{/if}
		<!-- The tile size and Names sit over the preview column, as wide as it, at the header's right end. -->
		<div class="view-opts">
			{#if !prefs.browserCollapsed && wow.loaded}
				<label class="size" title="Tile size">
					<input type="range" min="64" max="176" step="8" bind:value={prefs.browserTile} />
				</label>
			{/if}
			{#if !prefs.browserCollapsed}
				<label class="names" title="Show each tile's name under its picture, and the details under the preview">
					<input type="checkbox" bind:checked={prefs.browserNames} /> Names
				</label>
			{/if}
			<button
				class="chev"
				onclick={() => (prefs.browserCollapsed = !prefs.browserCollapsed)}
				title={prefs.browserCollapsed ? 'Expand' : 'Collapse'}
				aria-label={prefs.browserCollapsed ? 'Expand the asset browser' : 'Collapse the asset browser'}
			>
				{prefs.browserCollapsed ? '▴' : '▾'}
			</button>
		</div>
	</header>

	{#if !prefs.browserCollapsed}
		{#if !wow.loaded}
			<div class="empty">
				{#if !hasBackend()}
					<p>The asset browser needs the desktop app.</p>
				{:else if wow.loading}
					<p>Loading WoW client…</p>
				{:else}
					<p>Select your World of Warcraft 1.12 folder to browse its models and textures. Files are read directly from the client and nothing is copied.</p>
					{#if wow.error}<p class="err">{wow.error}</p>{/if}
					<button class="active" onclick={chooseWowFolder}>Select WoW folder…</button>
				{/if}
			</div>
		{:else if kind === 'prefabs'}
			<PrefabBrowser {tile} {query} bind:count={childCount} />
		{:else if spawnKind}
			<div class="body spawn">
				<SpawnBrowser kind={kind as SpawnKind} onhover={(it) => (spawnHover = it)} bind:count={childCount} />
				<aside class="side">
					<AssetPreview item={spawnHover} />
				</aside>
			</div>
		{:else}
			<div class="body">
				<nav class="facets">
					<button class="facet" aria-pressed={!category} class:active={!category} onclick={() => setView({ category: '' })}>
						All <span>{result.categories.reduce((n, c) => n + c.count, 0).toLocaleString()}</span>
					</button>
					{#each result.categories as c (c.name)}
						<button class="facet" aria-pressed={category === c.name} class:active={category === c.name} onclick={() => setView({ category: category === c.name ? '' : c.name })}>
							{c.name} <span>{c.count.toLocaleString()}</span>
						</button>
					{/each}
				</nav>

				<!-- A tile only sets the hover; leaving the grid clears it, so the gap between two tiles shows no third item. -->
				<div class="grid-wrap" role="group" aria-label="Assets" tabindex="-1" bind:this={scroller} bind:clientWidth={gridWidth} bind:clientHeight={viewHeight} onscroll={onScroll} onpointerleave={() => (hovered = null)}>
					{#if kind === 'sets'}
						<div class="setbar">
							{#if activeSet}
								<select value={activeSet.name} onchange={(e) => (prefs.modelSet = (e.currentTarget as HTMLSelectElement).value)} title="The set shown" aria-label="Model set">
									{#each sets as s (s.name)}<option value={s.name}>{s.name} ({s.models.length})</option>{/each}
								</select>
								{#key activeSet.name}<input class="setname" value={activeSet.name} onchange={renameSet} title="Rename the set" aria-label="Set name" />{/key}
							{:else}
								<span class="dim">No sets yet.</span>
							{/if}
							<button onclick={() => addSet()} title="Make an empty set">New</button>
							<button onclick={deleteSet} disabled={!activeSet} title="Delete this set">Delete</button>
							<button onclick={() => void importModelSets()} disabled={!hasBackend()} title="Read sets from .toml files">Import…</button>
							<button onclick={() => activeSet && void exportModelSet(activeSet)} disabled={!hasBackend() || !activeSet} title="Save this set as a .toml file to share">Export…</button>
							{#if missing}<span class="dim" title="Models the set names that this client doesn't have; they stay in the set">{missing} not in this client</span>{/if}
						</div>
					{/if}
					{#if loadingList}
						<p class="hint">Reading the client's file list…</p>
					{:else if kind === 'sets' && !setItems.length}
						<p class="hint">{activeSet ? 'This set is empty.' : 'A set is your own list of doodads and buildings to place from.'} Right-click a model in Doodads, Buildings or All, then Add to a set.</p>
					{:else}
						{#if favourites.length}
							<div class="section">Favourites</div>
							<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
								{#each favourites as it (it.key)}
									<PaletteTile
										thumbKey={it.key}
										label={it.name}
										title={it.path}
										size={tile}
										showLabel={prefs.browserNames}
										active={isActive(it)}
										badge={badgeOf(it)}
										starred={isFavourite(it)}
										onmenu={(e) => tileMenu(e, it)}
										onclick={() => pick(it)}
										onhover={(on) => on && (hovered = it)}
									/>
								{/each}
							</div>
							{#if !recent.length}<div class="section">{query ? 'Results' : category || 'Everything'}</div>{/if}
						{/if}
						{#if recent.length}
							<div class="section">Recent</div>
							<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
								{#each recent as it (it.key)}
									<PaletteTile
										thumbKey={it.key}
										label={it.name}
										title={it.path}
										size={tile}
										showLabel={prefs.browserNames}
										active={isActive(it)}
										badge={badgeOf(it)}
										starred={isFavourite(it)}
										onmenu={(e) => tileMenu(e, it)}
										onclick={() => pick(it)}
										onhover={(on) => on && (hovered = it)}
									/>
								{/each}
							</div>
							<div class="section">{query ? 'Results' : category || 'Everything'}</div>
						{/if}
						{#if !items.length}
							<p class="hint">Nothing matches. Try another word, or clear the zone and category.</p>
						{:else}
							<VirtualGrid {items} {win} {cols} {tile} gap={GAP} {rowH} key={(it) => it.key} bind:el={virtualEl}>
								{#snippet cell(it: SearchItem)}
									<PaletteTile
										thumbKey={it.key}
										label={it.name}
										title={it.path}
										size={tile}
										showLabel={prefs.browserNames}
										active={isActive(it)}
										badge={badgeOf(it)}
										starred={isFavourite(it)}
										onmenu={(e) => tileMenu(e, it)}
										onclick={() => pick(it)}
										onhover={(on) => on && (hovered = it)}
									/>
								{/snippet}
							</VirtualGrid>
						{/if}
					{/if}
				</div>

				<aside class="side">
					<AssetPreview item={previewItem} />
				</aside>
			</div>
		{/if}
	{/if}
</section>

<style>
	.browser {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: none;
		min-height: 0;
		background: var(--panel);
		border-top: 1px solid var(--border);
	}
	.resizer {
		position: absolute;
		top: -3px;
		left: 0;
		right: 0;
		height: 6px;
		cursor: row-resize;
		z-index: 5;
	}
	.resizer:hover {
		background: var(--accent);
		opacity: 0.5;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 6px 0 0;
		background: var(--header);
		flex: none;
	}
	.kinds {
		display: flex;
		flex: none;
		align-self: stretch;
	}
	.tab {
		border: none;
		border-radius: 0;
		background: transparent;
		color: var(--text-dim);
		padding: 0 12px;
		font-size: 11px;
		font-weight: 600;
	}
	.tab:hover:not(.active) {
		color: var(--text);
	}
	.tab.active {
		background: var(--panel);
		color: var(--text);
	}
	/* In a narrow browser the search, the select and the slider shrink, so Names and the fold button stay in view. */
	.search {
		flex: 1 1 160px;
		min-width: 60px;
		max-width: 420px;
	}
	header select {
		flex: 0 1 150px;
		min-width: 70px;
	}
	.count {
		flex: none;
		font: 11px var(--mono);
		color: var(--text-dim);
		text-align: right;
	}
	.view-opts {
		margin-left: auto;
		/* The preview column's 260 px, less the header's right padding. */
		flex: 0 1 254px;
		min-width: 150px;
		display: flex;
		align-items: center;
		gap: 6px;
		padding-left: 8px;
		box-sizing: border-box;
	}
	.size {
		flex: 1;
		min-width: 30px;
		display: flex;
		align-items: center;
	}
	.size input {
		width: 100%;
	}
	.names {
		flex: none;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.chev {
		margin-left: auto;
		flex: none;
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 0 6px;
	}
	.body {
		display: grid;
		grid-template-columns: 150px 1fr 260px;
		flex: 1;
		min-height: 0;
	}
	/* The spawn tabs bring their own facets column. */
	.body.spawn {
		grid-template-columns: 1fr 260px;
	}
	.facets {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		border-right: 1px solid var(--border);
		padding: 4px;
		gap: 1px;
	}
	.facet {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 3px 8px;
		text-align: left;
		font-size: 11px;
		border-radius: var(--radius);
	}
	.facet:hover {
		background: var(--panel-2);
		color: var(--text);
	}
	.facet.active {
		background: var(--panel-3);
		color: var(--text);
	}
	.facet span {
		font-family: var(--mono);
		opacity: 0.6;
	}
	.grid-wrap {
		position: relative;
		overflow-y: auto;
		padding: 6px;
		min-height: 0;
	}
	.grid {
		display: grid;
		align-content: start;
	}
	.section {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
		margin: 4px 0 6px;
	}
	.side {
		border-left: 1px solid var(--border);
		padding: 8px;
		min-height: 0;
		overflow: hidden;
	}
	.empty {
		color: var(--text-dim);
		font-size: 12px;
		padding: 12px;
		max-width: 480px;
	}
	.err {
		color: var(--danger-text);
	}
	.setbar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 6px;
		background: var(--panel);
	}
	.setbar .setname {
		width: 160px;
	}
	.setbar .dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.hint {
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
