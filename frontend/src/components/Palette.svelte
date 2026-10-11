<script lang="ts">
  import PaletteTile from './PaletteTile.svelte'
  import { editor, ui, wow } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { chooseWowFolder, listAssets } from '../lib/wow/api'
  import { buildCatalog, categoryOrder, type CatalogItem } from '../lib/wow/catalog'
  import { LAYERS } from '../lib/terrain/layers'
  import { hasBackend } from '../lib/io/mapio'

  type Kind = 'm2' | 'wmo' | 'tex'

  let modelKind = $state<'m2' | 'wmo'>('m2')
  const kind = $derived<Kind>(ui.palette === 'textures' ? 'tex' : modelKind)

  // Per-kind catalogs, loaded lazily once per client.
  let catalogs = $state<Record<Kind, CatalogItem[]>>({ m2: [], wmo: [], tex: [] })
  let loadedRevision = -1
  let loadingList = $state(false)
  $effect(() => {
    if (!wow.loaded) return
    if (loadedRevision !== wow.revision) {
      loadedRevision = wow.revision
      catalogs = { m2: [], wmo: [], tex: [] }
    }
    const k = kind
    if (catalogs[k].length) return
    loadingList = true
    listAssets(k === 'tex' ? 'tileset' : k).then((paths) => {
      catalogs[k] = buildCatalog(k, paths)
      loadingList = false
    })
  })

  // Filters are remembered per kind.
  let filters = $state<Record<Kind, { category: string; zone: string; query: string }>>({
    m2: { category: 'Trees', zone: '', query: '' },
    wmo: { category: 'Human', zone: '', query: '' },
    tex: { category: 'Grass', zone: '', query: '' },
  })
  const f = $derived(filters[kind])
  const items = $derived(catalogs[kind])

  const categories = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const it of items) if (!f.zone || it.zone === f.zone) counts.set(it.category, (counts.get(it.category) ?? 0) + 1)
    return categoryOrder(kind)
      .filter((c) => counts.has(c))
      .map((c) => ({ name: c, count: counts.get(c)! }))
  })
  const zones = $derived([...new Set(items.map((i) => i.zone))].sort((a, b) => a.localeCompare(b)))

  const shown = $derived.by(() => {
    const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((it) => {
      if (f.zone && it.zone !== f.zone) return false
      if (terms.length) {
        const l = it.path.toLowerCase()
        return terms.every((t) => l.includes(t))
      }
      return it.category === f.category
    })
  })

  // Keep a valid category selected when the zone filter changes.
  $effect(() => {
    if (categories.length && !f.query && !categories.some((c) => c.name === f.category)) {
      filters[kind].category = categories[0].name
    }
  })

  const LIMIT = 400
  let scroller: HTMLDivElement | undefined = $state()
  $effect(() => {
    void kind
    void f.category
    void f.zone
    scroller?.scrollTo(0, 0)
  })

  function pickModel(it: CatalogItem) {
    editor.prefab = it.key
    if (editor.tool !== 'place') editor.tool = 'place'
  }

  function pickTexture(it: CatalogItem) {
    engineRef.current?.useTexture(it.path)
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
  }

  const slotOf = (path: string) => editor.layerTextures.findIndex((p) => p.toLowerCase() === path.toLowerCase())
  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
</script>

<aside class="palette">
  <div class="tabs">
    <button class:active={ui.palette === 'models'} onclick={() => (ui.palette = 'models')}>Models</button>
    <button class:active={ui.palette === 'textures'} onclick={() => (ui.palette = 'textures')}>Textures</button>
  </div>

  {#if !wow.loaded}
    <div class="empty">
      {#if !hasBackend()}
        <p>The asset palette needs the desktop app.</p>
      {:else if wow.loading}
        <p>Loading WoW client…</p>
      {:else}
        <p>Select your World of Warcraft 1.12 folder to browse its models and textures. Files are read directly from the client and nothing is copied.</p>
        {#if wow.error}<p class="err">{wow.error}</p>{/if}
        <button class="active" onclick={chooseWowFolder}>Select WoW folder…</button>
      {/if}
    </div>
  {:else}
    {#if ui.palette === 'models'}
      <div class="tabs sub">
        <button class:active={modelKind === 'm2'} onclick={() => (modelKind = 'm2')}>Doodads</button>
        <button class:active={modelKind === 'wmo'} onclick={() => (modelKind = 'wmo')}>Buildings</button>
      </div>
    {:else}
      <div class="slots" title="Texture slots used by this map. Click to paint with a slot.">
        {#each LAYERS as l (l.id)}
          {@const p = editor.layerTextures[l.id]}
          <button
            class="slot"
            class:active={editor.paintLayer === l.id}
            title={p ? `Slot ${l.id + 1}: ${texName(p)}` : `Slot ${l.id + 1}: empty`}
            onclick={() => {
              editor.paintLayer = l.id
              if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
            }}
          >
            {#if p}
              <PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
            {:else}
              <span class="swatch" style:background={l.swatch}></span>
            {/if}
            <span class="num">{l.id + 1}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="filters">
      <input type="text" placeholder="Search {kind === 'tex' ? 'textures' : kind === 'm2' ? 'doodads' : 'buildings'}…" bind:value={filters[kind].query} />
      <select bind:value={filters[kind].zone} title="Zone">
        <option value="">All zones</option>
        {#each zones as z (z)}<option value={z}>{z}</option>{/each}
      </select>
    </div>

    {#if !f.query}
      <div class="cats">
        {#each categories as c (c.name)}
          <button class="cat" class:active={f.category === c.name} onclick={() => (filters[kind].category = c.name)}>
            {c.name} <span>{c.count}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="grid-wrap" bind:this={scroller}>
      {#if loadingList}
        <p class="hint">Loading…</p>
      {:else if !shown.length}
        <p class="hint">Nothing here.</p>
      {:else}
        <div class="grid">
          {#each shown.slice(0, LIMIT) as it (it.key)}
            {#if kind === 'tex'}
              {@const s = slotOf(it.path)}
              <PaletteTile
                thumbKey={it.key}
                label={it.name}
                title={it.path}
                active={s >= 0 && s === editor.paintLayer}
                badge={s >= 0 ? String(s + 1) : undefined}
                onclick={() => pickTexture(it)}
              />
            {:else}
              <PaletteTile thumbKey={it.key} label={it.name} title={it.path} active={editor.prefab === it.key} onclick={() => pickModel(it)} />
            {/if}
          {/each}
        </div>
        {#if shown.length > LIMIT}<p class="hint">{shown.length - LIMIT} more, narrow with search or zone.</p>{/if}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .palette {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--panel);
    border-right: 1px solid var(--border);
    padding: 8px;
    gap: 6px;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    flex: 1;
    padding: 4px;
  }
  .tabs.sub button {
    font-size: 12px;
    padding: 3px;
  }
  .filters {
    display: flex;
    gap: 4px;
  }
  .filters input {
    flex: 1;
    min-width: 0;
  }
  .filters select {
    width: 110px;
  }
  .cats {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    max-height: 92px;
    overflow-y: auto;
    flex: none;
  }
  .cat {
    font-size: 11px;
    line-height: 16px;
    padding: 1px 6px;
    border-radius: 999px;
  }
  .cat span {
    opacity: 0.6;
    font-family: var(--mono);
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin-right: -4px;
    padding-right: 4px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 5px;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 3px;
  }
  .slot {
    position: relative;
    padding: 1px;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--bg);
  }
  .slot.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .slot :global(.tile) {
    padding: 0;
    border: none;
    pointer-events: none;
    background: transparent;
  }
  .slot :global(.label) {
    display: none;
  }
  .swatch {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 3px;
    opacity: 0.5;
  }
  .num {
    position: absolute;
    right: 2px;
    bottom: 0;
    font: 9px var(--mono);
    color: #fff;
    text-shadow: 0 0 3px #000;
  }
  .empty {
    color: var(--text-dim);
    font-size: 12px;
  }
  .empty button {
    width: 100%;
  }
  .err {
    color: var(--danger);
  }
  .hint {
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
