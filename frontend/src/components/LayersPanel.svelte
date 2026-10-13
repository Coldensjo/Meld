<script lang="ts">
  import { onMount } from 'svelte'
  import PaletteTile from './PaletteTile.svelte'
  import { editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { LAYERS } from '../lib/terrain/layers'
  import { isColor } from '../lib/terrain/paletteArray'
  import { SLOTS, type ChunkTexture } from '../lib/terrain/chunkPaint'

  // The four texture layers of the paint chunk under the cursor, as the game has them. Replace on a
  // layer waits for the next texture picked in the asset browser and puts it in that slot, in this
  // chunk only. A slot the chunk doesn't use is an empty layer.
  let tick = $state(0)
  onMount(() => {
    const id = setInterval(() => tick++, 300)
    return () => clearInterval(id)
  })

  const texName = (p: string) => p.slice(p.search(/[^\\/]*$/)).replace(/\.blp$/i, '')
  const colorName = (p: string) => LAYERS.find((l) => l.swatch.toLowerCase() === p.toLowerCase())?.name ?? p
  const label = (p: string) => (isColor(p) ? colorName(p) : texName(p))

  const chunk = $derived.by(() => {
    void tick
    const e = engineRef.current
    const c = editor.hoverChunk
    if (!e || c < 0) return null
    const found = e.chunkContents(c)
    const slots: Array<ChunkTexture | null> = Array.from({ length: SLOTS }, (_, k) => found.find((t) => t.slot === k) ?? null)
    return { index: c, slots }
  })

  const replacing = $derived(ui.replaceSlot && chunk && ui.replaceSlot.chunk === chunk.index ? ui.replaceSlot.slot : -1)

  function replace(slot: number) {
    if (!chunk) return
    ui.replaceSlot = { chunk: chunk.index, slot }
    ui.palette = 'textures'
    prefs.browserCollapsed = false
  }
</script>

<div class="layers">
  {#if chunk}
    {#each chunk.slots as s, k (k)}
      {#if s}
        {@const p = editor.palette[s.tex]}
        <div class="row" class:target={replacing === k}>
          <div class="thumb">
            {#if isColor(p)}
              <span class="swatch" style:background={p}></span>
            {:else}
              <PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
            {/if}
          </div>
          <span class="name" title={p}>{label(p)}</span>
          {#if replacing === k}
            <button onclick={() => (ui.replaceSlot = null)} title="Stop waiting for a texture">Cancel</button>
          {:else}
            <button onclick={() => replace(k)} title="Pick a texture in the browser below to put in this layer, in this chunk only">Replace</button>
          {/if}
        </div>
      {:else}
        <div class="row empty"><span class="thumb"></span><span class="name">Empty</span></div>
      {/if}
    {/each}
    {#if replacing >= 0}
      <div class="hint">Pick a texture in the browser below.</div>
    {/if}
  {:else}
    <div class="hint">Move the cursor over the ground to see the textures of the chunk under it.</div>
  {/if}
</div>

<style>
  .layers {
    padding: 2px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
  }
  .row.target {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .row.empty {
    opacity: 0.6;
  }
  .row.empty .thumb {
    border-style: dashed;
  }
  .row button {
    padding: 1px 8px;
    font-size: 11px;
    flex: none;
  }
  .thumb {
    display: block;
    width: 32px;
    height: 32px;
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
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    padding: 8px;
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
