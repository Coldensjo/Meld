<script lang="ts">
  import OptSlider from './OptSlider.svelte'
  import { TOOLS } from './Toolbar.svelte'
  import { editor, ui, type SculptMode } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { displayName } from '../lib/models/assets'
  import { FALLOFF_CURVES } from '../lib/tools/brush'

  const SCULPT_MODES: Array<{ id: SculptMode; name: string }> = [
    { id: 'raise', name: 'Raise' },
    { id: 'lower', name: 'Lower' },
    { id: 'smooth', name: 'Smooth' },
    { id: 'flatten', name: 'Flatten' },
    { id: 'noise', name: 'Noise' },
    { id: 'mountain', name: 'Mountain' },
  ]

  const tool = $derived(TOOLS.find((t) => t.id === editor.tool)!)
  const slotTex = $derived(editor.palette[editor.paintLayer])
  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
  const usesBrush = $derived(
    editor.tool === 'sculpt' ||
      editor.tool === 'paint' ||
      editor.tool === 'road' ||
      editor.tool === 'water' ||
      editor.tool === 'clear' ||
      (editor.tool === 'place' && editor.placeScatter),
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
    <span class="chip" title="Height above the surface for new placements (Alt+scroll)">
      <span class="dim">Height:</span> {editor.placeHeight >= 0 ? '+' : ''}{editor.placeHeight.toFixed(2)}
    </span>
    {#if editor.placeHeight !== 0}
      <button onclick={() => (editor.placeHeight = 0)}>Reset</button>
    {/if}
    <span class="dim"><kbd>Ctrl</kbd>+scroll rotate · <kbd>Alt</kbd>+scroll height · props attach to what they're placed on</span>
    {#if editor.selected}
      <span class="dim">Placed object selected: <kbd>←↑↓→</kbd> move · <kbd>Alt+↑↓</kbd> height · <kbd>R</kbd> spin · <kbd>Esc</kbd> deselect</span>
    {/if}
    <div class="divider"></div>
  {:else if editor.tool === 'marquee'}
    {#if ui.pasting}
      <span class="chip"><span class="dim">Pasting</span></span>
      <label class="check"><input type="checkbox" bind:checked={editor.paste.terrain} /> Terrain</label>
      <label class="check"><input type="checkbox" bind:checked={editor.paste.textures} /> Textures</label>
      <label class="check"><input type="checkbox" bind:checked={editor.paste.objects} /> Objects</label>
      <OptSlider label="Blend edges" bind:value={editor.paste.blend} min={0} max={8} step={1} digits={0} width={60} title="Cells over which the paste fades into the map" />
      <OptSlider label="Height" bind:value={editor.paste.heightOffset} min={-60} max={60} step={0.5} digits={1} width={70} title="Raise/lower the pasted terrain (PgUp/PgDn)" />
      <button onclick={() => engineRef.current?.commitPaste()}>Place <kbd>Enter</kbd></button>
      <button onclick={() => engineRef.current?.cancelPaste()}>Cancel <kbd>Esc</kbd></button>
    {:else}
      {#if editor.selection}
        {@const s = editor.selection}
        <span class="chip"><span class="dim">Selection:</span> {s.x1 - s.x0} × {s.z1 - s.z0} cells</span>
      {:else}
        <span class="dim">Drag on the map to select an area.</span>
      {/if}
      <button disabled={!editor.selection} onclick={() => engineRef.current?.copySelection()}>Copy <kbd>Ctrl+C</kbd></button>
      <button disabled={!ui.hasClip} onclick={() => engineRef.current?.startPaste()}>Paste <kbd>Ctrl+V</kbd></button>
      <button onclick={() => engineRef.current?.selectAll()}>Select all</button>
      <button disabled={!editor.selection} onclick={() => engineRef.current?.deselect()}>Deselect</button>
    {/if}
  {:else if editor.tool === 'select'}
    {#if editor.selected}
      <span class="chip"><span class="dim">Selected:</span> {displayName(editor.selected.type)}</span>
      <button onclick={() => engineRef.current?.focusSelected()}>Focus <kbd>F</kbd></button>
      <button onclick={() => engineRef.current?.deleteSelected()}>Delete <kbd>Del</kbd></button>
      <span class="dim"><kbd>←↑↓→</kbd> move · <kbd>Alt+↑↓</kbd> height · <kbd>Alt+←→</kbd>/<kbd>R</kbd> spin · <kbd>Shift</kbd> bigger steps</span>
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
      <select class="curve" bind:value={editor.brush.curve} title="How the brush weight falls off across the falloff band" aria-label="Falloff curve">
        {#each FALLOFF_CURVES as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    {/if}
  {/if}
  {#if editor.tool === 'clear'}
    <select class="curve" bind:value={editor.clearMode} title="What the brush erases" aria-label="What to clear">
      <option value="models">Models</option>
      <option value="textures">Textures (to base)</option>
    </select>
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
