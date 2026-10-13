<script lang="ts">
  import { onMount } from 'svelte'
  import PaletteTile from './PaletteTile.svelte'
  import { editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { LAYERS } from '../lib/terrain/layers'
  import { isColor } from '../lib/terrain/paletteArray'
  import { SLOTS, type ChunkTexture } from '../lib/terrain/chunkPaint'

  // The chunk under the cursor is what the panel is about: its four texture slots, as the game has them.
  let tick = $state(0)
  onMount(() => {
    const id = setInterval(() => tick++, 300)
    return () => clearInterval(id)
  })

  const texName = (p: string) => p.slice(p.search(/[^\\/]*$/)).replace(/\.blp$/i, '')
  const colorName = (p: string) => LAYERS.find((l) => l.swatch.toLowerCase() === p.toLowerCase())?.name ?? p
  const label = (p: string) => (isColor(p) ? colorName(p) : texName(p))
  const pct = (v: number) => (v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`)

  const active = $derived(editor.palette[editor.paintLayer])

  const chunk = $derived.by(() => {
    void tick
    const e = engineRef.current
    const c = editor.hoverChunk
    if (!e || c < 0) return null
    const side = e.terrain.paintChunksPerSide
    const found = e.chunkContents(c)
    const slots: Array<ChunkTexture | null> = Array.from({ length: SLOTS }, (_, k) => found.find((t) => t.slot === k) ?? null)
    return { index: c, label: `${(c % side) + 1}, ${Math.floor(c / side) + 1}`, slots, used: found.length }
  })

  const replacing = $derived(ui.replaceSlot && chunk && ui.replaceSlot.chunk === chunk.index ? chunk.slots[ui.replaceSlot.slot] : null)

  function use(tex: number) {
    editor.paintLayer = tex
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
  }

  function replace(slot: number) {
    if (!chunk) return
    ui.replaceSlot = { chunk: chunk.index, slot }
    ui.palette = 'textures'
    prefs.browserCollapsed = false
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

<div class="layers">
  <div class="section">Painting with</div>
  <div class="with">
    {#if active}
      {@render thumb(active)}
      <span class="name" title={active}>{label(active)}</span>
    {:else}
      <span class="hint">No texture picked yet.</span>
    {/if}
    <button onclick={() => { ui.palette = 'textures'; prefs.browserCollapsed = false }} title="Pick a texture from the WoW client">Browse…</button>
  </div>

  {#if chunk}
    <div class="section">
      <span>This chunk ({chunk.label})</span>
      <span class="count" class:full={chunk.used >= SLOTS} title="A chunk holds at most four textures">{chunk.used} of {SLOTS}</span>
    </div>
    {#each chunk.slots as s, k (k)}
      {#if s}
        {@const p = editor.palette[s.tex]}
        <div class="row" class:active={editor.paintLayer === s.tex} class:target={replacing === s} role="button" tabindex="0" onclick={() => use(s.tex)} onkeydown={(e) => e.key === 'Enter' && use(s.tex)}>
          {@render thumb(p)}
          <div class="info">
            <span class="name" title={p}>{label(p)}</span>
            <span class="bar"><span style:width="{Math.max(2, Math.round(s.share * 100))}%"></span></span>
          </div>
          <span class="sub">{pct(s.share)}</span>
          <button
            class="rep"
            title="Replace this texture in this chunk"
            onclick={(e) => {
              e.stopPropagation()
              replace(k)
            }}>Replace</button
          >
        </div>
      {:else}
        <div class="row empty"><span class="thumb"></span><span class="hint">Empty: paint a new texture here to fill it</span></div>
      {/if}
    {/each}
    {#if replacing}
      <div class="notice">
        Pick a texture in the palette to replace {label(editor.palette[replacing.tex])} in this chunk.
        <button onclick={() => (ui.replaceSlot = null)}>Cancel</button>
      </div>
    {:else if chunk.used >= SLOTS}
      <div class="hint pad">This chunk is full. Painting a new texture here replaces its weakest one.</div>
    {/if}
  {:else}
    <div class="hint pad">Move the cursor over the terrain to see which textures are under it.</div>
  {/if}

  <div class="foot">
    {#if ui.maskActive}
      <button onclick={() => engineRef.current?.fillMask(editor.paintLayer)} title="Fill the paint mask with the active texture">Fill mask</button>
    {/if}
    <button onclick={() => engineRef.current?.regenerateAutoPaint()} title="Repaint by height and slope">Auto-paint</button>
    <button onclick={() => (ui.dialog = 'textures')} title="Replace a texture everywhere on the map, or fill the map with one">Replace everywhere…</button>
  </div>
</div>

<style>
  .layers {
    overflow-y: auto;
    padding-bottom: 2px;
  }
  .section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .count.full {
    color: #e0a040;
  }
  .with {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 8px;
    border-bottom: 1px solid var(--border);
  }
  .with .thumb {
    width: 36px;
    height: 36px;
  }
  .with button {
    padding: 2px 6px;
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
  .row.target {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .row.empty {
    cursor: default;
    opacity: 0.7;
  }
  .row.empty:hover {
    background: transparent;
  }
  .row.empty .thumb {
    border-style: dashed;
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
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info .name {
    flex: none;
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
  .sub {
    font-size: 10px;
    color: var(--text-dim);
    min-width: 26px;
    text-align: right;
  }
  .rep {
    padding: 1px 6px;
    font-size: 11px;
  }
  .hint {
    font-size: 11px;
    color: var(--text-dim);
  }
  .pad {
    padding: 6px 8px;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 6px 8px;
    padding: 6px 8px;
    border: 1px solid var(--accent);
    font-size: 11px;
  }
  .foot {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
  }
  .foot button {
    flex: 1;
    padding: 2px 6px;
  }
</style>
