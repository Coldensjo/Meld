<script lang="ts">
  import { onMount } from 'svelte'
  import PaletteTile from './PaletteTile.svelte'
  import { editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { LAYERS } from '../lib/terrain/layers'
  import { isColor } from '../lib/terrain/paletteArray'
  import { MAX_PALETTE, SLOTS, type ChunkTexture } from '../lib/terrain/chunkPaint'

  // The map's texture palette: every texture the map can paint with, how much of the map each
  // covers, and which of them the chunk under the cursor holds (the 1.12 limit is four per chunk).
  // Clicking one paints with it. The list keeps palette order, so rows don't jump while painting.

  let tick = $state(0)
  onMount(() => {
    const id = setInterval(() => tick++, 700)
    return () => clearInterval(id)
  })

  const texName = (p: string) => p.slice(p.search(/[^\\/]*$/)).replace(/\.blp$/i, '')
  const colorName = (p: string) => LAYERS.find((l) => l.swatch.toLowerCase() === p.toLowerCase())?.name ?? p
  const label = (p: string) => (isColor(p) ? colorName(p) : texName(p))
  const pct = (v: number) => (v <= 0 ? '' : v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`)

  /** Share of the map each palette entry covers, sampled a few times a second. */
  const coverage = $derived.by(() => {
    void tick
    void editor.palette.length
    return engineRef.current?.layerCoverage() ?? []
  })

  /** The chunk under the cursor: its label and the slot each of its textures sits in. */
  const chunk = $derived.by(() => {
    void tick
    const e = engineRef.current
    const c = editor.hoverChunk
    if (!e || c < 0) return null
    const side = e.terrain.paintChunksPerSide
    const found = e.chunkContents(c)
    const byTex = new Map<number, ChunkTexture>()
    for (const t of found) byTex.set(t.tex, t)
    return { index: c, label: `${(c % side) + 1}, ${Math.floor(c / side) + 1}`, byTex, used: found.length }
  })

  const replacing = $derived.by(() => {
    const r = ui.replaceSlot
    if (!r || !chunk || r.chunk !== chunk.index) return null
    for (const t of chunk.byTex.values()) if (t.slot === r.slot) return t
    return null
  })

  function use(tex: number) {
    editor.paintLayer = tex
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
  }

  function browse() {
    ui.palette = 'textures'
    prefs.browserCollapsed = false
  }

  /** Marks a chunk slot for replacement: the next texture picked in the asset browser takes its place. */
  function replaceHere(slot: number) {
    if (!chunk) return
    ui.replaceSlot = { chunk: chunk.index, slot }
    browse()
  }
</script>

{#snippet thumb(p: string)}
  <div class="thumb">
    {#if isColor(p)}
      <span class="swatch" style:background={p}></span>
    {:else}
      <PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
    {/if}
  </div>
{/snippet}

<div class="textures">
  <div class="head">
    <span>{editor.palette.length} of {MAX_PALETTE}</span>
    {#if chunk}
      <span class="here" class:full={chunk.used >= SLOTS} title="The paint chunk under the cursor and how many of its four texture slots are in use">
        <span class="dot"></span>Chunk {chunk.label}: {chunk.used} of {SLOTS}
      </span>
    {/if}
  </div>
  <div class="list">
    {#each editor.palette as p, i (i)}
      {@const inChunk = chunk?.byTex.get(i)}
      {@const cov = coverage[i] ?? 0}
      <div
        class="row"
        class:active={editor.paintLayer === i}
        class:unused={cov <= 0 && !inChunk}
        class:target={replacing !== null && replacing === inChunk}
        role="button"
        tabindex="0"
        title={p}
        onclick={() => use(i)}
        onkeydown={(e) => e.key === 'Enter' && use(i)}>
        {@render thumb(p)}
        <div class="info">
          <span class="name">{label(p)}</span>
          <span class="bar"><span style:width="{Math.min(100, Math.max(cov > 0 ? 1 : 0, Math.round(cov * 100)))}%"></span></span>
        </div>
        <span class="cov" title="Share of the map's paint">{pct(cov)}</span>
        {#if inChunk}
          <span class="dot" title="In the chunk under the cursor ({Math.round(inChunk.share * 100)}% of it)"></span>
          <button
            class="rep"
            title="Replace this texture in the chunk under the cursor with the next one picked in the browser"
            aria-label="Replace in this chunk"
            onclick={(e) => {
              e.stopPropagation()
              replaceHere(inChunk.slot)
            }}>⇄</button
          >
        {/if}
      </div>
    {/each}
    {#if !editor.palette.length}
      <div class="hint">No textures yet. Add one from the WoW client below.</div>
    {/if}
  </div>
  {#if replacing}
    <div class="notice">
      Pick a texture in the browser to replace {label(editor.palette[replacing.tex])} in chunk {chunk?.label}.
      <button onclick={() => (ui.replaceSlot = null)}>Cancel</button>
    </div>
  {/if}
  <div class="foot">
    <button onclick={browse} title="Pick a texture from the WoW client: it joins the palette and becomes the paint texture">Add…</button>
    {#if ui.maskActive}
      <button onclick={() => engineRef.current?.fillMask(editor.paintLayer)} title="Fill the paint mask with the paint texture">Fill mask</button>
    {/if}
    <button onclick={() => engineRef.current?.regenerateAutoPaint()} title="Repaint the whole map by height and slope">Auto-paint</button>
    <button onclick={() => (ui.dialog = 'textures')} title="Replace a texture everywhere on the map, or fill the map with one">Replace…</button>
  </div>
</div>

<style>
  .textures {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 5px 8px 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    flex: none;
  }
  .here {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .here.full {
    color: #e0a040;
  }
  .list {
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.active {
    background: #3a4a62;
  }
  .row.unused .name,
  .row.unused .thumb {
    opacity: 0.6;
  }
  .row.target {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .thumb {
    display: block;
    width: 28px;
    height: 28px;
    flex: none;
    border: 1px solid var(--border-soft);
  }
  .thumb :global(.tile) {
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    pointer-events: none;
  }
  .thumb :global(.label) {
    display: none;
  }
  .thumb :global(.img) {
    border-radius: 0;
  }
  .swatch {
    display: block;
    width: 100%;
    height: 100%;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    display: block;
    height: 3px;
    background: var(--border);
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .cov {
    font: 10px var(--mono);
    color: var(--text-dim);
    min-width: 28px;
    text-align: right;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e0a040;
    flex: none;
  }
  .rep {
    width: 22px;
    padding: 0;
    font-size: 12px;
    line-height: 18px;
    flex: none;
    color: var(--text-dim);
  }
  .rep:hover {
    color: var(--text);
  }
  .hint {
    padding: 8px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 6px 8px 0;
    padding: 6px 8px;
    border: 1px solid var(--accent);
    font-size: 11px;
    flex: none;
  }
  .foot {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    flex: none;
    border-top: 1px solid var(--border);
  }
  .foot button {
    flex: 1;
    padding: 2px 6px;
  }
</style>
