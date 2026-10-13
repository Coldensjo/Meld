<script lang="ts">
  import PaletteTile from './PaletteTile.svelte'
  import AssetPreview from './AssetPreview.svelte'
  import { editor, prefs, ui, wow } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { chooseWowFolder, listAssets } from '../lib/wow/api'
  import { buildCatalog, categoryOrder } from '../lib/wow/catalog'
  import { indexCatalog, searchAssets, type AssetKind, type SearchItem } from '../lib/wow/search'
  import { hasBackend } from '../lib/io/mapio'
  import { paletteIndex } from '../lib/terrain/chunkPaint'

  // The asset browser: the panel along the bottom of the window where models and textures are found.
  // Search-first: one box over everything, facets to narrow, big tiles, and a live preview of the
  // tile under the cursor. Nothing is read from the client until it is shown.

  const KINDS: Array<{ id: AssetKind | 'all'; label: string }> = [
    { id: 'm2', label: 'Doodads' },
    { id: 'wmo', label: 'Buildings' },
    { id: 'tex', label: 'Textures' },
    { id: 'all', label: 'All' },
  ]

  let kind = $state<AssetKind | 'all'>('m2')
  let query = $state('')
  let category = $state('')
  let zone = $state('')
  let hovered = $state<SearchItem | null>(null)
  let searchBox: HTMLInputElement | undefined = $state()

  // The whole client's catalog, indexed once per client.
  let all = $state<SearchItem[]>([])
  let loadingList = $state(false)
  let loadedRevision = -1
  $effect(() => {
    if (!wow.loaded || loadedRevision === wow.revision) return
    loadedRevision = wow.revision
    loadingList = true
    Promise.all([listAssets('m2'), listAssets('wmo'), listAssets('tileset')]).then(([m2, wmo, tex]) => {
      all = [...indexCatalog('m2', buildCatalog('m2', m2)), ...indexCatalog('wmo', buildCatalog('wmo', wmo)), ...indexCatalog('tex', buildCatalog('tex', tex))]
      loadingList = false
    })
  })

  // The tool decides what is wanted: textures while painting, models while placing.
  $effect(() => {
    if (ui.palette === 'textures' && kind !== 'tex') kind = 'tex'
    else if (ui.palette === 'models' && kind === 'tex') kind = 'm2'
  })
  // A filter from another kind means nothing here.
  $effect(() => {
    void kind
    category = ''
    zone = ''
  })

  const orderFor = (k: AssetKind | 'all') => (k === 'all' ? [...categoryOrder('m2'), ...categoryOrder('wmo'), ...categoryOrder('tex')] : categoryOrder(k))
  const result = $derived(searchAssets(all, { kind, query, category, zone }, orderFor(kind)))
  const items = $derived(result.items)

  /** Recently picked assets, newest first, shown when the search box is empty. */
  const recent = $derived.by(() => {
    if (query || category || zone) return []
    const byKey = new Map(all.map((it) => [it.key, it]))
    return prefs.recentAssets.map((k) => byKey.get(k)).filter((it): it is SearchItem => !!it && (kind === 'all' || it.kind === kind))
  })

  function remember(key: string) {
    prefs.recentAssets = [key, ...prefs.recentAssets.filter((k) => k !== key)].slice(0, 24)
  }

  function pick(it: SearchItem) {
    remember(it.key)
    if (it.kind === 'tex') pickTexture(it)
    else pickModel(it)
  }

  function pickModel(it: SearchItem) {
    editor.prefab = it.key
    if (editor.tool !== 'place') editor.tool = 'place'
  }

  function pickTexture(it: SearchItem) {
    const engine = engineRef.current
    if (!engine) return
    // A Replace on a Layers panel row is waiting for this pick: it takes the slot's place in that chunk.
    const target = ui.replaceSlot
    if (target) {
      ui.replaceSlot = null
      engine.replaceChunkTexture(target.chunk, target.slot, it.path)
      return
    }
    const slot = engine.useTexture(it.path)
    if (slot < 0) return
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
    // With a mask painted, picking a texture fills the whole mask with it.
    if (ui.maskActive && editor.tool === 'paint') engine.fillMask(slot)
  }

  const slotOf = (path: string) => paletteIndex(editor.palette, path)
  const isActive = (it: SearchItem) => (it.kind === 'tex' ? slotOf(it.path) >= 0 && slotOf(it.path) === editor.paintLayer : editor.prefab === it.key)
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
  const rowH = $derived(tile + 22 + GAP)
  const cols = $derived(Math.max(1, Math.floor((gridWidth - GAP) / (tile + GAP))))
  const rows = $derived(Math.ceil(items.length / cols))
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowH) - 1))
  const last = $derived(Math.min(rows, Math.ceil((scrollTop + viewHeight) / rowH) + 1))
  const visible = $derived(items.slice(first * cols, last * cols))

  let scroller: HTMLDivElement | undefined = $state()
  $effect(() => {
    void items
    scroller?.scrollTo(0, 0)
    scrollTop = 0
  })

  /** The tile a shown item gets in the sidebar list of the selected model, when it exists. */
  const previewItem = $derived.by(() => {
    if (hovered) return hovered
    const key = kind === 'tex' ? `tex:${editor.palette[editor.paintLayer] ?? ''}` : editor.prefab
    return all.find((it) => it.key === key) ?? null
  })

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      query = ''
      searchBox?.blur()
    }
  }

  /** Ctrl+F focuses the search from anywhere. */
  function globalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
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
      prefs.browserHeight = Math.round(Math.min(window.innerHeight * 0.7, Math.max(160, startH + (startY - ev.clientY))))
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
    <div class="kinds">
      {#each KINDS as k (k.id)}
        <button class="tab" class:active={kind === k.id && !prefs.browserCollapsed} onclick={() => { kind = k.id; prefs.browserCollapsed = false }}>{k.label}</button>
      {/each}
    </div>
    {#if !prefs.browserCollapsed && wow.loaded}
      <input
        class="search"
        type="text"
        placeholder={kind === 'tex' ? 'Search textures… (Ctrl+F)' : kind === 'all' ? 'Search everything… (Ctrl+F)' : 'Search models… (Ctrl+F)'}
        bind:value={query}
        bind:this={searchBox}
        onkeydown={onKey}
      />
      <select bind:value={zone} title="Zone" aria-label="Zone">
        <option value="">All zones</option>
        {#each result.zones as z (z.name)}<option value={z.name}>{z.name} ({z.count})</option>{/each}
      </select>
      <span class="count">{items.length.toLocaleString()}</span>
      <label class="size" title="Tile size">
        <input type="range" min="64" max="176" step="8" bind:value={prefs.browserTile} />
      </label>
    {/if}
    <button class="chev" onclick={() => (prefs.browserCollapsed = !prefs.browserCollapsed)} title={prefs.browserCollapsed ? 'Expand' : 'Collapse'} aria-label={prefs.browserCollapsed ? 'Expand the asset browser' : 'Collapse the asset browser'}>
      {prefs.browserCollapsed ? '▴' : '▾'}
    </button>
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
    {:else}
      <div class="body">
        <nav class="facets">
          <button class="facet" class:active={!category} onclick={() => (category = '')}>
            All <span>{result.categories.reduce((n, c) => n + c.count, 0).toLocaleString()}</span>
          </button>
          {#each result.categories as c (c.name)}
            <button class="facet" class:active={category === c.name} onclick={() => (category = category === c.name ? '' : c.name)}>
              {c.name} <span>{c.count.toLocaleString()}</span>
            </button>
          {/each}
        </nav>

        <div class="grid-wrap" bind:this={scroller} bind:clientWidth={gridWidth} bind:clientHeight={viewHeight} onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}>
          {#if loadingList}
            <p class="hint">Reading the client's file list…</p>
          {:else}
            {#if recent.length}
              <div class="section">Recent</div>
              <div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)" style:gap="{GAP}px">
                {#each recent as it (it.key)}
                  <PaletteTile thumbKey={it.key} label={it.name} title={it.path} size={tile} active={isActive(it)} badge={badgeOf(it)} onclick={() => pick(it)} onhover={(on) => (hovered = on ? it : hovered === it ? null : hovered)} />
                {/each}
              </div>
              <div class="section">{query ? 'Results' : category || 'Everything'}</div>
            {/if}
            {#if !items.length}
              <p class="hint">Nothing matches. Try another word, or clear the zone and category.</p>
            {:else}
              <div class="virtual" style:height="{rows * rowH}px">
                <div class="grid" style:grid-template-columns="repeat({cols}, {tile}px)" style:gap="{GAP}px" style:transform="translateY({first * rowH}px)">
                  {#each visible as it (it.key)}
                    <PaletteTile thumbKey={it.key} label={it.name} title={it.path} size={tile} active={isActive(it)} badge={badgeOf(it)} onclick={() => pick(it)} onhover={(on) => (hovered = on ? it : hovered === it ? null : hovered)} />
                  {/each}
                </div>
              </div>
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
  .search {
    flex: 1;
    min-width: 120px;
    max-width: 420px;
  }
  select {
    width: 150px;
  }
  .count {
    font: 11px var(--mono);
    color: var(--text-dim);
    min-width: 48px;
    text-align: right;
  }
  .size {
    width: 90px;
    display: flex;
    align-items: center;
  }
  .chev {
    margin-left: auto;
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
    position: relative;
    overflow-y: auto;
    padding: 6px;
    min-height: 0;
  }
  .virtual {
    position: relative;
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
    color: var(--danger);
  }
  .hint {
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
