<script lang="ts">
  import { onMount } from 'svelte'
  import PaletteTile from './PaletteTile.svelte'
  import { editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { LAYERS } from '../lib/terrain/layers'
  import { isColor } from '../lib/terrain/paletteArray'
  import type { ChunkTexture } from '../lib/terrain/chunkPaint'

  // The map's texture palette: every texture paint can use, with the share of the map each covers.
  let coverage = $state<number[]>([])
  let tick = $state(0)
  onMount(() => {
    const update = () => {
      coverage = engineRef.current?.layerCoverage() ?? []
      tick++
    }
    update()
    const id = setInterval(update, 1500)
    return () => clearInterval(id)
  })

  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
  const colorName = (p: string) => LAYERS.find((l) => l.swatch.toLowerCase() === p.toLowerCase())?.name ?? p
  const label = (p: string) => (isColor(p) ? colorName(p) : texName(p))
  const pct = (v: number | undefined) => (v === undefined ? '' : v < 0.001 ? '—' : v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`)

  // The picked chunk's textures, refreshed with the coverage so painting shows up while the chunk is selected.
  const chunk = $derived.by(() => {
    void tick
    const e = engineRef.current
    if (!e || editor.chunkSel < 0) return null
    const side = e.terrain.paintChunksPerSide
    const texes: ChunkTexture[] = e.chunkContents(editor.chunkSel)
    return { label: `${(editor.chunkSel % side) + 1}, ${Math.floor(editor.chunkSel / side) + 1}`, texes }
  })

  function select(i: number) {
    editor.paintLayer = i
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
  }
</script>

<div class="layers" title="Each 8×8-cell chunk can use four of these textures at once, as in 1.12">
  {#if chunk}
    <div class="chunk">
      <div class="chead">
        <span>Chunk {chunk.label}</span>
        <button onclick={() => (editor.chunkSel = -1)} title="Close">×</button>
      </div>
      {#each chunk.texes as ct (ct.tex)}
        <div class="row" class:active={editor.paintLayer === ct.tex} role="button" tabindex="0" onclick={() => select(ct.tex)} onkeydown={(e) => e.key === 'Enter' && select(ct.tex)}>
          <span class="num">{ct.tex + 1}</span>
          <span class="name" title={editor.palette[ct.tex]}>{label(editor.palette[ct.tex])}</span>
          <span class="sub">{pct(ct.share)}</span>
        </div>
      {:else}
        <div class="empty">No textures in this chunk yet.</div>
      {/each}
    </div>
  {/if}
  {#each editor.palette as p, i (i)}
    <div class="row" class:active={editor.paintLayer === i} role="button" tabindex="0" onclick={() => select(i)} onkeydown={(e) => e.key === 'Enter' && select(i)}>
      <div class="thumb">
        {#if isColor(p)}
          <span class="swatch" style:background={p}></span>
        {:else}
          <PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
        {/if}
      </div>
      <span class="num">{i + 1}</span>
      <span class="name" title={p}>{label(p)}</span>
      <span class="sub">{pct(coverage[i])}</span>
    </div>
  {/each}
  <div class="foot">
    {#if ui.maskActive}
      <button onclick={() => engineRef.current?.fillMask(editor.paintLayer)} title="Fill the paint mask with the active texture">Fill mask</button>
    {/if}
    <button onclick={() => (ui.palette = 'textures')}>Browse textures…</button>
    <button onclick={() => (ui.dialog = 'textures')} title="Replace a texture everywhere on the map, or fill the map with one">Replace…</button>
    <button onclick={() => engineRef.current?.regenerateAutoPaint()} title="Repaint by height and slope">Auto-paint</button>
  </div>
</div>

<style>
  .layers {
    overflow-y: auto;
    padding: 2px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 8px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.active {
    background: #3a4a62;
  }
  .thumb {
    width: 26px;
    height: 26px;
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
  .num {
    width: 12px;
    font: 10px var(--mono);
    color: var(--text-dim);
    text-align: right;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 10px;
    color: var(--text-dim);
  }
  .chunk {
    border-bottom: 2px solid var(--border);
    background: var(--panel-2);
  }
  .chead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    font-weight: 600;
  }
  .chead button {
    padding: 0 6px;
  }
  .empty {
    padding: 4px 8px;
    color: var(--text-dim);
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
