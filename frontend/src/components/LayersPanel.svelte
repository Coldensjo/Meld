<script lang="ts">
  import { onMount } from 'svelte'
  import PaletteTile from './PaletteTile.svelte'
  import { editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { LAYERS } from '../lib/terrain/layers'

  // Photoshop-like layer list for the map's 8 texture slots.
  let coverage = $state<number[]>([])
  onMount(() => {
    const update = () => (coverage = engineRef.current?.layerCoverage() ?? [])
    update()
    const id = setInterval(update, 1500)
    return () => clearInterval(id)
  })

  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
  const pct = (v: number | undefined) => (v === undefined ? '' : v < 0.001 ? '—' : v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`)

  function select(i: number) {
    editor.paintLayer = i
    if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
  }
</script>

<div class="layers">
  {#each LAYERS as l (l.id)}
    {@const p = editor.layerTextures[l.id]}
    <div class="row" class:active={editor.paintLayer === l.id} role="button" tabindex="0" onclick={() => select(l.id)} onkeydown={(e) => e.key === 'Enter' && select(l.id)}>
      <div class="thumb">
        {#if p}
          <PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
        {:else}
          <span class="swatch" style:background={l.swatch}></span>
        {/if}
      </div>
      <span class="num">{l.id + 1}</span>
      <span class="name" title={p}>{p ? texName(p) : 'Empty layer'}</span>
      <span class="sub">{pct(coverage[l.id])}</span>
      {#if p}
        <button class="clear" title="Remove texture from this layer" onclick={(e) => { e.stopPropagation(); engineRef.current?.clearLayerTexture(l.id) }}>✕</button>
      {/if}
    </div>
  {/each}
  <div class="foot">
    {#if ui.maskActive}
      <button onclick={() => engineRef.current?.fillMask(editor.paintLayer)} title="Fill the paint mask with the active layer">Fill mask</button>
    {/if}
    <button onclick={() => (ui.palette = 'textures')}>Browse textures…</button>
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
    opacity: 0.4;
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
  .clear {
    border: none;
    background: transparent;
    color: var(--text-dim);
    padding: 0 4px;
    visibility: hidden;
  }
  .row:hover .clear {
    visibility: visible;
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
