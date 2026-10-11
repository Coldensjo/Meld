<script lang="ts">
  import OptSlider from './OptSlider.svelte'
  import { TOOLS } from './Toolbar.svelte'
  import { editor, ui, type SculptMode } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { displayName } from '../lib/models/assets'

  const SCULPT_MODES: Array<{ id: SculptMode; name: string }> = [
    { id: 'raise', name: 'Raise' },
    { id: 'lower', name: 'Lower' },
    { id: 'smooth', name: 'Smooth' },
    { id: 'flatten', name: 'Flatten' },
    { id: 'noise', name: 'Noise' },
    { id: 'mountain', name: 'Mountain' },
  ]

  const tool = $derived(TOOLS.find((t) => t.id === editor.tool)!)
  const slotTex = $derived(editor.layerTextures[editor.paintLayer])
  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
  const usesBrush = $derived(
    editor.tool === 'sculpt' || editor.tool === 'paint' || editor.tool === 'road' || editor.tool === 'water' || (editor.tool === 'place' && editor.placeScatter),
  )
</script>

<div class="options">
  <div class="tool" title={tool.name}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
      <path d={tool.icon} />
    </svg>
  </div>
  <div class="divider"></div>

  {#if editor.tool === 'sculpt'}
    <div class="seg">
      {#each SCULPT_MODES as m (m.id)}
        <button class:active={editor.sculptMode === m.id} onclick={() => (editor.sculptMode = m.id)}>{m.name}</button>
      {/each}
    </div>
    <div class="divider"></div>
  {:else if editor.tool === 'paint' || editor.tool === 'road'}
    <button class="chip" onclick={() => (ui.palette = 'textures')} title="Active texture layer (pick textures in the Assets panel)">
      <span class="dim">Layer {editor.paintLayer + 1}:</span>
      {slotTex ? texName(slotTex) : 'empty'}
    </button>
    {#if editor.tool === 'road'}
      <label class="check"><input type="checkbox" bind:checked={editor.roadFlatten} /> Level terrain</label>
    {/if}
    <div class="divider"></div>
  {:else if editor.tool === 'water'}
    <div class="seg">
      <button class:active={editor.waterMode === 'dig'} onclick={() => (editor.waterMode = 'dig')}>Dig lake</button>
      <button class:active={editor.waterMode === 'shore'} onclick={() => (editor.waterMode = 'shore')}>Raise shore</button>
    </div>
    <OptSlider label="Water level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} width={80} />
    <div class="divider"></div>
  {:else if editor.tool === 'place'}
    <span class="chip" title={editor.prefab}>
      <span class="dim">Model:</span>
      {editor.prefab ? displayName(editor.prefab) : 'pick one in Assets'}
    </span>
    <label class="check"><input type="checkbox" bind:checked={editor.placeRandomRot} /> Random rotation</label>
    <label class="check"><input type="checkbox" bind:checked={editor.placeRandomScale} /> Random scale</label>
    <label class="check"><input type="checkbox" bind:checked={editor.placeScatter} /> Scatter</label>
    <div class="divider"></div>
  {:else if editor.tool === 'select'}
    {#if editor.selected}
      <span class="chip"><span class="dim">Selected:</span> {displayName(editor.selected.type)}</span>
      <button onclick={() => engineRef.current?.focusSelected()}>Focus <kbd>F</kbd></button>
      <button onclick={() => engineRef.current?.deleteSelected()}>Delete <kbd>Del</kbd></button>
    {:else}
      <span class="dim">Click an object to select it. Drag to move, <kbd>R</kbd> rotates.</span>
    {/if}
  {/if}

  {#if usesBrush && editor.tool !== 'place'}
    <div class="seg" title="Brush shape">
      <button class:active={editor.brush.shape === 'circle'} onclick={() => (editor.brush.shape = 'circle')} aria-label="Round brush">●</button>
      <button class:active={editor.brush.shape === 'square'} onclick={() => (editor.brush.shape = 'square')} aria-label="Square brush">■</button>
    </div>
    {#if editor.brush.shape === 'square'}
      <label class="check" title="Align square brushes to the terrain grid"><input type="checkbox" bind:checked={editor.brush.snap} /> Snap to grid</label>
    {/if}
  {/if}
  {#if usesBrush}
    <OptSlider label="Size" bind:value={editor.brush.radius} min={1} max={80} step={0.5} digits={1} title="Brush radius ( [ / ] )" />
    <OptSlider label="Strength" bind:value={editor.brush.strength} min={0.02} max={1} step={0.01} digits={2} />
    {#if editor.tool !== 'road' && editor.tool !== 'place'}
      <OptSlider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} digits={2} />
    {/if}
  {/if}
  {#if editor.tool === 'paint'}
    <OptSlider label="Tex scale" bind:value={editor.texScale} min={2} max={24} step={0.5} digits={1} width={70} />
  {/if}
</div>

<style>
  .options {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 34px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius);
    background: var(--panel-2);
    flex: none;
  }
  .divider {
    width: 1px;
    height: 20px;
    background: var(--border-soft);
    flex: none;
  }
  .seg {
    display: flex;
    flex: none;
  }
  .seg button {
    border-radius: 0;
    margin-left: -1px;
    padding: 2px 9px;
  }
  .seg button:first-child {
    border-radius: var(--radius) 0 0 var(--radius);
    margin-left: 0;
  }
  .seg button:last-child {
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .chip {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 2px 8px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
  }
  .dim {
    color: var(--text-dim);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  button {
    padding: 2px 8px;
    flex: none;
  }
</style>
