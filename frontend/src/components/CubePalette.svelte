<script lang="ts">
	// The asset browser in a cube world's tab (#63): the palette of shapes, materials and liquids the
	// Cubes tool builds with, and the objects it attaches (#32, #102: a click takes Object mode). The same frame as the WoW
	// browser: one search box (Ctrl+F), category facets, the recent picks, tiles with their names and a
	// preview of the tile under the cursor (else the cube the tool puts down). A click sets the Cubes
	// tool's shape or kind and takes the tool; Alt+click in the world (the pipette) copies a cube, and
	// the palette marks its shape and kind. Two more tabs (3dgame #73): Sets, the author's named lists of
	// tiles (prefs.cubeSets, cubes/cubeSets.ts; a right-click on a tile adds it to one), and Prefabs, the
	// boxes of cubes kept in the prefab folder (cubes/prefabs.ts), saved from the Select tool's box and
	// placed as its paste with one click, turned with R. A fourth, Props (3dgame #133): the game's models
	// (assets/models, cubes/propModels.ts) by folder, each tile a picture of the model; a click takes the
	// Cubes tool's Prop mode with it.
	import CubeTile from './CubeTile.svelte'
	import PropTile from './PropTile.svelte'
	import { MODEL_NAMES, modelFolder, modelWords } from '../lib/cubes/propModels'
	import { editor, prefs, setStatus, stats, ui, type ContextItem } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { CUBE_CATEGORIES, cubeItem, searchCubes, themeName, withRecent, type CubeCategory, type CubeItem } from '../lib/cubes/palette'
	import { newCubeSet, uniqueName, validCubeSets, withCubeItem, withoutCubeItem, type CubeSet } from '../lib/cubes/cubeSets'
	import { prefabContents } from '../lib/cubes/prefabs'
	import { GROUND_LAYER, KINDS } from '../lib/cubes/world'
	import { cubeName } from '../lib/tools/CubeTool'
	import { dialogOpen } from '../lib/ui/dialogFocus'
	import { choosePrefabFolder, readCubePrefabs, saveCubeSelectionAsPrefab, type CubePrefabEntry } from '../lib/io/prefabFiles'
	import { hasBackend } from '../lib/io/mapio'

	const GAP = 6
	let query = $state('')
	const category = $derived((CUBE_CATEGORIES as readonly string[]).includes(prefs.cubeCategory) ? (prefs.cubeCategory as CubeCategory) : '')
	const result = $derived(searchCubes(query, category))
	const items = $derived(result.items)
	const tab = $derived(prefs.cubeTab === 'sets' || prefs.cubeTab === 'prefabs' || prefs.cubeTab === 'props' ? prefs.cubeTab : 'cubes')
	const recent = $derived(query || category ? [] : prefs.cubeRecent.map(cubeItem).filter((it): it is CubeItem => !!it))
	const sets = $derived(validCubeSets(prefs.cubeSets))
	const activeSet = $derived(sets.find((s) => s.name === prefs.cubeSet) ?? sets[0] ?? null)
	/** The shown set's tiles the search leaves, in the set's order. */
	const setItems = $derived.by(() => {
		if (!activeSet) return []
		const hits = new Set(searchCubes(query, '').items.map((it) => it.key))
		return activeSet.items.filter((k) => hits.has(k)).map(cubeItem).filter((it): it is CubeItem => !!it)
	})
	let hovered = $state<CubeItem | null>(null)
	let searchBox: HTMLInputElement | undefined = $state()

	/** The layer whose theme tints the pictures: the slice's layer, else the camera's, else the ground. */
	const layer = $derived(ui.cubeSlice.mode !== 'off' ? ui.cubeSlice.layer : stats.cameraLayer >= 0 ? stats.cameraLayer : GROUND_LAYER)
	const tile = $derived(prefs.browserTile)
	/** The picture inside a tile, less the tile's padding and border. */
	const pic = $derived(tile - 8)

	/** The cube an object tile is drawn on, with the object's colour marked on it. */
	const STONE = KINDS.indexOf('stone')

	/** A tile's picture: a shape in the tool's kind, a kind as a whole cube, an object marked on a stone cube. */
	const tileCube = (it: CubeItem) =>
		it.sets === 'shape' ? { kind: editor.cubeKind, shape: it.id, rotation: 0, object: null } : it.sets === 'object' ? { kind: STONE, shape: 0, rotation: 0, object: it.id } : { kind: it.id, shape: 0, rotation: 0, object: null }
	const isActive = (it: CubeItem) => (it.sets === 'shape' ? editor.cubeShape === it.id : it.sets === 'object' ? editor.tool === 'cube' && editor.cubeMode === 'object' && editor.cubeObject === it.id : editor.cubeKind === it.id)

	/** The preview: the hovered tile with the tool's other half of the cube, else the tool's cube. */
	const preview = $derived.by(() => {
		const h = hovered
		if (!h) return { kind: editor.cubeKind, shape: editor.cubeShape, rotation: editor.cubeRotation, object: null as number | null }
		if (h.sets === 'object') return { kind: STONE, shape: 0, rotation: 0, object: h.id }
		return h.sets === 'shape' ? { kind: editor.cubeKind, shape: h.id, rotation: editor.cubeRotation, object: null } : { kind: h.id, shape: editor.cubeShape, rotation: editor.cubeRotation, object: null }
	})

	function pick(it: CubeItem) {
		if (it.sets === 'object') {
			editor.cubeObject = it.id
			editor.cubeMode = 'object'
		} else {
			if (it.sets === 'shape') editor.cubeShape = it.id
			else editor.cubeKind = it.id
			// A cube pick puts the tool back to building when it was attaching or removing.
			if (editor.cubeMode === 'object') editor.cubeMode = 'place'
		}
		prefs.cubeRecent = withRecent(prefs.cubeRecent, it.key)
		if (editor.tool !== 'cube') editor.tool = 'cube'
		setStatus(it.sets === 'object' ? `The Cubes tool attaches a ${it.name.toLowerCase()} to the cube face you click.` : `The Cubes tool puts down ${cubeName()}.`, 2500)
	}

	function setCategory(c: CubeCategory | '') {
		prefs.cubeCategory = c
	}

	function setTab(t: 'cubes' | 'sets' | 'prefabs' | 'props') {
		prefs.cubeTab = t
		prefs.browserCollapsed = false
		hovered = null
		hoveredPrefab = null
		hoveredProp = null
	}

	// --- props (#133) -------------------------------------------------------------------------------
	const PROP_FOLDERS = [...new Set(MODEL_NAMES.map(modelFolder))]
	let propFolder = $state('')
	let hoveredProp = $state<string | null>(null)
	/** The model the side shows: the hovered tile's, else the one the tool places. */
	const shownProp = $derived(hoveredProp ?? editor.cubeProp)
	const shownProps = $derived.by(() => {
		const q = query.trim().toLowerCase()
		return MODEL_NAMES.filter((n) => (!propFolder || modelFolder(n) === propFolder) && (!q || n.toLowerCase().includes(q) || modelWords(n).includes(q)))
	})
	function pickProp(name: string) {
		editor.cubeProp = name
		editor.cubeMode = 'prop'
		if (editor.tool !== 'cube') editor.tool = 'cube'
		setStatus(`The Cubes tool puts ${name} where you click the cubes: R turns it, drag a prop to move it.`, 3000)
	}

	// --- sets (#73) ---------------------------------------------------------------------------------
	function putSet(name: string, next: CubeSet) {
		prefs.cubeSets = sets.map((s) => (s.name === name ? next : s))
	}
	function addSet(first?: CubeItem) {
		const name = uniqueName('New set', sets.map((s) => s.name))
		prefs.cubeSets = [...sets, first ? withCubeItem(newCubeSet(name), first.key) : newCubeSet(name)]
		prefs.cubeSet = name
		setStatus(first ? `Made the set "${name}" with ${first.name}; rename it in the Sets tab.` : `Made the set "${name}": right-click a tile in the Cubes tab to add it.`, 4000)
	}
	function renameSet(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const set = activeSet
		const name = input.value.trim()
		if (!set || !name || name === set.name) {
			input.value = set?.name ?? ''
			return
		}
		const unique = uniqueName(name, sets.filter((s) => s !== set).map((s) => s.name))
		putSet(set.name, { ...set, name: unique })
		prefs.cubeSet = unique
	}
	function deleteSet() {
		const set = activeSet
		if (!set || !confirm(`Delete the set "${set.name}"? Only the list goes; its ${set.items.length} tiles stay in the palette.`)) return
		prefs.cubeSets = sets.filter((s) => s !== set)
		prefs.cubeSet = ''
	}
	function addToSet(set: CubeSet, it: CubeItem) {
		putSet(set.name, withCubeItem(set, it.key))
		setStatus(`Added ${it.name} to the set "${set.name}".`, 3000)
	}
	function removeFromSet(set: CubeSet, it: CubeItem) {
		putSet(set.name, withoutCubeItem(set, it.key))
		setStatus(`Took ${it.name} out of the set "${set.name}".`, 3000)
	}

	/** A tile's right-click menu: the sets it can join or leave. */
	function tileMenu(e: MouseEvent, it: CubeItem) {
		e.preventDefault()
		const items: ContextItem[] = sets.map((set) => (set.items.includes(it.key) ? { label: `Remove from "${set.name}"`, run: () => removeFromSet(set, it) } : { label: `Add to "${set.name}"`, run: () => addToSet(set, it) }))
		items.push({ label: 'Add to a New Set', run: () => addSet(it) })
		ui.contextMenu = { x: e.clientX, y: e.clientY, title: it.name, items }
	}

	// --- prefabs (#73) ------------------------------------------------------------------------------
	let prefabs = $state<CubePrefabEntry[]>([])
	let problems = $state<string[]>([])
	let loading = $state(false)
	let hoveredPrefab = $state<CubePrefabEntry | null>(null)

	async function loadPrefabs() {
		loading = true
		try {
			const r = await readCubePrefabs()
			prefabs = r.entries
			problems = r.problems
		} catch (err) {
			prefabs = []
			problems = [String(err)]
		} finally {
			loading = false
		}
	}
	$effect(() => {
		if (tab !== 'prefabs') return
		void ui.prefabsVersion
		void prefs.prefabDir
		void loadPrefabs()
	})
	const shownPrefabs = $derived(query.trim() ? prefabs.filter((e) => e.prefab.name.toLowerCase().includes(query.trim().toLowerCase())) : prefabs)

	function placePrefab(e: CubePrefabEntry) {
		engineRef.current?.placeCubeClip(e.prefab.clip, e.prefab.name)
	}

	const count = $derived(tab === 'sets' ? setItems.length : tab === 'prefabs' ? shownPrefabs.length : tab === 'props' ? shownProps.length : items.length)
	const placeholder = $derived(tab === 'prefabs' ? 'Search prefabs… (Ctrl+F)' : tab === 'sets' ? 'Search this set… (Ctrl+F)' : tab === 'props' ? 'Search models… (Ctrl+F)' : 'Search shapes, materials, liquids and objects… (Ctrl+F)')
	const TABS = [
		['cubes', 'Cubes'],
		['sets', 'Sets'],
		['prefabs', 'Prefabs'],
		['props', 'Props'],
	] as const

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			query = ''
			searchBox?.blur()
		}
	}

	/** Ctrl+F focuses the search from anywhere, as in the WoW browser. */
	function globalKey(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			if (dialogOpen()) return
			e.preventDefault()
			prefs.browserCollapsed = false
			searchBox?.focus()
			searchBox?.select()
		}
	}
</script>

<svelte:window onkeydown={globalKey} />

<header>
	<div class="kinds" role="tablist">
		{#each TABS as [id, label] (id)}
			{@const on = !prefs.browserCollapsed && tab === id}
			<button class="tab" role="tab" aria-selected={on} class:active={on} onclick={() => setTab(id)}>{label}</button>
		{/each}
	</div>
	{#if !prefs.browserCollapsed}
		<input class="search" type="text" {placeholder} title={placeholder} bind:value={query} bind:this={searchBox} onkeydown={onKey} />
		<span class="count">{count}</span>
	{/if}
	<div class="view-opts">
		{#if !prefs.browserCollapsed}
			<label class="size" title="Tile size">
				<input type="range" min="64" max="176" step="8" bind:value={prefs.browserTile} />
			</label>
			<label class="names" title="Show each tile's name under its picture, and the details under the preview">
				<input type="checkbox" bind:checked={prefs.browserNames} /> Names
			</label>
		{/if}
		<button class="chev" onclick={() => (prefs.browserCollapsed = !prefs.browserCollapsed)} title={prefs.browserCollapsed ? 'Expand' : 'Collapse'} aria-label={prefs.browserCollapsed ? 'Expand the asset browser' : 'Collapse the asset browser'}>
			{prefs.browserCollapsed ? '▴' : '▾'}
		</button>
	</div>
</header>

{#snippet tileOf(it: CubeItem)}
	{@const c = tileCube(it)}
	<button class="tile" class:active={isActive(it)} aria-pressed={isActive(it)} data-key={it.key} title="{it.name}: {it.about}" style:width="{tile}px" onclick={() => pick(it)} oncontextmenu={(e) => tileMenu(e, it)} onpointerenter={() => (hovered = it)}>
		<span class="img"><CubeTile kind={c.kind} shape={c.shape} rotation={c.rotation} object={c.object} {layer} size={pic} /></span>
		{#if prefs.browserNames}<span class="label">{it.name}</span>{/if}
	</button>
{/snippet}

{#if !prefs.browserCollapsed && tab === 'props'}
	<div class="body">
		<nav class="facets" aria-label="Model folders">
			<button class="facet" aria-pressed={!propFolder} class:active={!propFolder} onclick={() => (propFolder = '')}>All <span>{MODEL_NAMES.length}</span></button>
			{#each PROP_FOLDERS as f (f)}
				<button class="facet" aria-pressed={propFolder === f} class:active={propFolder === f} onclick={() => (propFolder = propFolder === f ? '' : f)}>
					{f || 'models'} <span>{MODEL_NAMES.filter((n) => modelFolder(n) === f).length}</span>
				</button>
			{/each}
		</nav>
		<div class="grid-wrap" role="group" aria-label="Props" tabindex="-1" onpointerleave={() => (hoveredProp = null)}>
			{#if shownProps.length}
				<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
					{#each shownProps as name (name)}
						{@const on = editor.tool === 'cube' && editor.cubeMode === 'prop' && editor.cubeProp === name}
						<button class="tile" class:active={on} aria-pressed={on} data-model={name} title="{name}: click, then click the cubes to place it" style:width="{tile}px" onclick={() => pickProp(name)} onpointerenter={() => (hoveredProp = name)}>
							<span class="img"><PropTile model={name} size={pic} /></span>
							{#if prefs.browserNames}<span class="label">{modelWords(name)}</span>{/if}
						</button>
					{/each}
				</div>
			{:else}
				<p class="hint">No model matches. Try another word, or another folder.</p>
			{/if}
		</div>
		<aside class="side">
			<div class="preview"><PropTile model={shownProp} size={160} /></div>
			{#if prefs.browserNames}
				<p class="name">{modelWords(shownProp)}</p>
				<p class="about">{shownProp}</p>
			{/if}
			<p class="dim">A prop is only a look, drawn as the game draws it (crates/gameplay/models.toml); nothing collides with it.</p>
		</aside>
	</div>
{:else if !prefs.browserCollapsed && tab === 'prefabs'}
	<div class="body prefabs">
		<div class="grid-wrap" role="group" aria-label="Prefabs of cubes" tabindex="-1" onpointerleave={() => (hoveredPrefab = null)}>
			<div class="bar">
				<span class="dim folder" title={prefs.prefabDir}>{prefs.prefabDir || 'No prefab folder yet'}</span>
				<button onclick={() => void choosePrefabFolder()} disabled={!hasBackend()} title="The folder your prefabs are kept in">Folder…</button>
				<button onclick={() => void loadPrefabs()} disabled={!prefs.prefabDir} title="Read the folder again">Refresh</button>
				<button onclick={() => engineRef.current && void saveCubeSelectionAsPrefab(engineRef.current)} disabled={!hasBackend() || !ui.cubeSelection} title="Save the cubes of the Select tool's box as a prefab">Save selection…</button>
			</div>
			{#if !prefs.prefabDir}
				<p class="hint">A prefab is a box of cubes you place again as a whole: a door frame, a staircase, a tree. Pick a folder to keep them in, then select a box with the Select tool (V) and Save selection.</p>
			{:else if loading && !prefabs.length}
				<p class="hint">Reading the prefab folder…</p>
			{:else if !prefabs.length}
				<p class="hint">No prefabs of cubes in this folder yet. Select a box of cubes with the Select tool (V) and Save selection.</p>
			{:else}
				<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
					{#each shownPrefabs as e (e.file)}
						{@const c = e.prefab.clip}
						<button class="tile" data-prefab={e.file} title="{e.file}: {c.w} × {c.d} × {c.h}. Click to place it; R turns it." style:width="{tile}px" onclick={() => placePrefab(e)} onpointerenter={() => (hoveredPrefab = e)}>
							<span class="img"><CubeTile clip={c} {layer} size={pic} /></span>
							{#if prefs.browserNames}<span class="label">{e.prefab.name}</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
			{#each problems as p (p)}<p class="hint err">{p}</p>{/each}
		</div>
		<aside class="side">
			{#if hoveredPrefab}
				{@const c = hoveredPrefab.prefab.clip}
				<div class="preview"><CubeTile clip={c} {layer} size={160} /></div>
				{#if prefs.browserNames}
					<p class="name">{hoveredPrefab.prefab.name}</p>
					<p class="about">{c.w} × {c.d} columns, {c.h} {c.h === 1 ? 'layer' : 'layers'} high.</p>
					<ul class="about">
						{#each prefabContents(c) as [kind, n] (kind)}<li>{kind} ×{n}</li>{/each}
					</ul>
				{/if}
			{:else}
				<p class="dim">A click places a prefab under the cursor with the Select tool: R turns it, M mirrors it, a click puts it down.</p>
			{/if}
		</aside>
	</div>
{:else if !prefs.browserCollapsed && tab === 'sets'}
	<div class="body">
		<nav class="facets" aria-label="Sets">
			{#each sets as s (s.name)}
				<button class="facet" aria-pressed={activeSet === s} class:active={activeSet === s} onclick={() => (prefs.cubeSet = s.name)}>
					{s.name} <span>{s.items.length}</span>
				</button>
			{/each}
			<button class="facet" onclick={() => addSet()} title="Make an empty set">+ New set</button>
		</nav>
		<div class="grid-wrap" role="group" aria-label="Set" tabindex="-1" onpointerleave={() => (hovered = null)}>
			{#if activeSet}
				<div class="bar">
					{#key activeSet.name}<input class="setname" value={activeSet.name} onchange={renameSet} title="Rename the set" aria-label="Set name" />{/key}
					<button onclick={deleteSet} title="Delete this set">Delete</button>
				</div>
			{/if}
			{#if setItems.length}
				<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
					{#each setItems as it (it.key)}{@render tileOf(it)}{/each}
				</div>
			{:else}
				<p class="hint">{activeSet ? (query ? 'Nothing in this set matches.' : 'This set is empty.') : 'A set is your own list of shapes, materials and liquids to build with.'} Right-click a tile in the Cubes tab to add it to a set.</p>
			{/if}
		</div>
		{@render side()}
	</div>
{:else if !prefs.browserCollapsed}
	<div class="body">
		<nav class="facets">
			<button class="facet" aria-pressed={!category} class:active={!category} onclick={() => setCategory('')}>
				All <span>{CUBE_CATEGORIES.reduce((n, c) => n + result.counts[c], 0)}</span>
			</button>
			{#each CUBE_CATEGORIES as c (c)}
				<button class="facet" aria-pressed={category === c} class:active={category === c} onclick={() => setCategory(category === c ? '' : c)}>
					{c} <span>{result.counts[c]}</span>
				</button>
			{/each}
		</nav>

		<div class="grid-wrap" role="group" aria-label="Cubes" tabindex="-1" onpointerleave={() => (hovered = null)}>
			{#if recent.length}
				<div class="section">Recent</div>
				<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
					{#each recent as it (it.key)}{@render tileOf(it)}{/each}
				</div>
				<div class="section">Everything</div>
			{/if}
			{#if items.length}
				<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
					{#each items as it (it.key)}{@render tileOf(it)}{/each}
				</div>
			{/if}
			{#if category === 'Objects' || (!category && !query)}
				<p class="hint">A click on an object takes the Cubes tool in Object mode with that kind; click a cube face to attach it, and link levers, buttons and teleporters in the tool's Link mode.</p>
			{:else if !items.length}
				<p class="hint">Nothing matches. Try another word, or clear the category.</p>
			{/if}
		</div>

		{@render side()}
	</div>
{/if}

{#snippet side()}
	<aside class="side">
		<div class="preview"><CubeTile kind={preview.kind} shape={preview.shape} rotation={preview.rotation} object={preview.object} {layer} size={160} /></div>
		{#if prefs.browserNames}
			<p class="name">{hovered ? hovered.name : cubeName()}</p>
			{#if hovered}<p class="about">{hovered.about}</p>{/if}
			<p class="dim">Tinted as layer {layer} ({themeName(layer)}).</p>
		{/if}
	</aside>
{/snippet}

<style>
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
	.tab.active {
		background: var(--panel);
		color: var(--text);
	}
	.search {
		flex: 1 1 160px;
		min-width: 60px;
		max-width: 420px;
	}
	.count {
		flex: none;
		font: 11px var(--mono);
		color: var(--text-dim);
	}
	.view-opts {
		margin-left: auto;
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
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 3px;
		min-width: 0;
		background: var(--bg);
	}
	.tile:hover {
		background: var(--panel-2);
		border-color: var(--accent-2);
	}
	.tile.active {
		border-color: var(--accent);
		background: var(--panel-3);
		color: var(--text);
	}
	.img {
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, #5a6373, #2b3038 80%);
		overflow: hidden;
	}
	.label {
		width: 100%;
		font-size: 11px;
		line-height: 1.2;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.side {
		border-left: 1px solid var(--border);
		padding: 8px;
		min-height: 0;
		overflow: hidden;
	}
	.preview {
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, #5a6373, #2b3038 80%);
		padding: 8px;
	}
	.name {
		margin: 8px 0 2px;
		font-weight: 600;
	}
	.about,
	.dim,
	.hint {
		color: var(--text-dim);
		font-size: 12px;
		margin: 2px 0;
	}
	.hint {
		margin-top: 8px;
	}
	.err {
		color: var(--danger-text);
	}
	.body.prefabs {
		grid-template-columns: 1fr 260px;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 6px;
		background: var(--panel);
	}
	.folder {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.setname {
		flex: 0 1 220px;
		min-width: 60px;
	}
	ul.about {
		margin: 2px 0;
		padding-left: 16px;
	}
</style>
