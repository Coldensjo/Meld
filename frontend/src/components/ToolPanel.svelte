<script lang="ts">
  import Slider from './Slider.svelte'
  import WowClientSection from './WowClientSection.svelte'
  import { TOOLS } from './Toolbar.svelte'
  import { editor, ui, type SculptMode } from '../lib/state/editor.svelte'
  import { displayName } from '../lib/models/assets'
  import { engineRef } from '../lib/state/engineRef'
  import type { WorldObject } from '../lib/world/ObjectLayer'

  const SCULPT_MODES: Array<{ id: SculptMode; name: string }> = [
    { id: 'raise', name: 'Raise' },
    { id: 'lower', name: 'Lower' },
    { id: 'smooth', name: 'Smooth' },
    { id: 'flatten', name: 'Flatten' },
    { id: 'noise', name: 'Noise' },
    { id: 'mountain', name: 'Mountain' },
  ]

  const toolName = $derived(TOOLS.find((t) => t.id === editor.tool)?.name ?? '')
  const showBrush = $derived(
    editor.tool === 'sculpt' ||
      editor.tool === 'paint' ||
      editor.tool === 'road' ||
      editor.tool === 'water' ||
      (editor.tool === 'place' && editor.placeScatter),
  )

  // Properties panel edits: live preview on input, one undo step on release.
  let before: WorldObject | undefined
  const startEdit = () => {
    const s = editor.selected
    before = s ? { ...s } : undefined
  }
  const live = (patch: Partial<WorldObject>) => engineRef.current?.editSelected(patch, false)
  const commit = (patch: Partial<WorldObject>) => {
    engineRef.current?.editSelected(patch, true, before)
    before = undefined
  }
  const texName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')

  const deg = (r: number) => (r * 180) / Math.PI
  const rad = (d: number) => (d * Math.PI) / 180
</script>

<aside class="panel">
  <section>
    <h3>{toolName}</h3>

    {#if editor.tool === 'sculpt'}
      <div class="modes">
        {#each SCULPT_MODES as m (m.id)}
          <button class:active={editor.sculptMode === m.id} onclick={() => (editor.sculptMode = m.id)}>{m.name}</button>
        {/each}
      </div>
      <p class="hint">Hold <kbd>LMB</kbd> to apply. <b>Flatten</b> levels to the height where the stroke started.</p>
    {:else if editor.tool === 'paint' || editor.tool === 'road'}
      {@const p = editor.layerTextures[editor.paintLayer]}
      <div class="current">
        <span>Slot {editor.paintLayer + 1}</span>
        <b>{p ? texName(p) : 'empty'}</b>
      </div>
      {#if editor.tool === 'road'}
        <label class="check"><input type="checkbox" bind:checked={editor.roadFlatten} /> Level terrain under road</label>
        <p class="hint">Draws the selected texture with a hard edge. Width is half the brush radius.</p>
      {:else}
        <p class="hint">Pick a texture in the palette (left). It's added to one of the map's 8 texture slots automatically.</p>
      {/if}
      <button class="link" onclick={() => (ui.palette = 'textures')}>Show texture palette</button>
      <Slider label="Texture scale" bind:value={editor.texScale} min={2} max={24} step={0.5} digits={1} />
    {:else if editor.tool === 'water'}
      <div class="modes two">
        <button class:active={editor.waterMode === 'dig'} onclick={() => (editor.waterMode = 'dig')}>Dig Lake</button>
        <button class:active={editor.waterMode === 'shore'} onclick={() => (editor.waterMode = 'shore')}>Raise Shore</button>
      </div>
      <p class="hint">Shapes the ground relative to the water level set below in <b>World</b>.</p>
    {:else if editor.tool === 'place'}
      <div class="current">
        <span>Model</span>
        <b title={editor.prefab}>{editor.prefab ? displayName(editor.prefab) : 'none, pick one in the palette'}</b>
      </div>
      <div class="opts">
        <label class="check"><input type="checkbox" bind:checked={editor.placeRandomRot} /> Random rotation</label>
        <label class="check"><input type="checkbox" bind:checked={editor.placeRandomScale} /> Random scale</label>
        <label class="check"><input type="checkbox" bind:checked={editor.placeScatter} /> Scatter brush</label>
      </div>
      <p class="hint"><kbd>LMB</kbd> place · <kbd>R</kbd> rotate · <kbd>Shift</kbd>+drag scatter</p>
    {:else if editor.tool === 'select'}
      {#if editor.selected}
        {@const s = editor.selected}
        <div class="sel-title">{displayName(s.type)} <span>#{s.id}</span></div>
        <Slider label="X" value={s.x} min={0} max={engineRef.current?.terrain.worldSize ?? 512} step={0.1} digits={1}
          onstart={startEdit} oninput={(v) => live({ x: v })} onchange={(v) => commit({ x: v })} />
        <Slider label="Z" value={s.z} min={0} max={engineRef.current?.terrain.worldSize ?? 512} step={0.1} digits={1}
          onstart={startEdit} oninput={(v) => live({ z: v })} onchange={(v) => commit({ z: v })} />
        <Slider label="Height offset" value={s.yOff} min={-5} max={20} step={0.05} digits={2}
          onstart={startEdit} oninput={(v) => live({ yOff: v })} onchange={(v) => commit({ yOff: v })} />
        <Slider label="Rotation°" value={deg(s.rotY) % 360} min={-360} max={360} step={1} digits={0}
          onstart={startEdit} oninput={(v) => live({ rotY: rad(v) })} onchange={(v) => commit({ rotY: rad(v) })} />
        <Slider label="Scale" value={s.scale} min={0.2} max={5} step={0.01} digits={2}
          onstart={startEdit} oninput={(v) => live({ scale: v })} onchange={(v) => commit({ scale: v })} />
        <div class="row">
          <button onclick={() => engineRef.current?.focusSelected()}>Focus <kbd>F</kbd></button>
          <button class="danger" onclick={() => engineRef.current?.deleteSelected()}>Delete <kbd>Del</kbd></button>
        </div>
      {:else}
        <p class="hint">Click an object to select it. Drag to move, <kbd>R</kbd> rotates, <kbd>Del</kbd> deletes.</p>
      {/if}
    {/if}
  </section>

  {#if showBrush}
    <section>
      <h3>Brush <span class="kbds"><kbd>[</kbd> <kbd>]</kbd></span></h3>
      <Slider label="Radius" bind:value={editor.brush.radius} min={1} max={80} step={0.5} digits={1} />
      <Slider label="Strength" bind:value={editor.brush.strength} min={0.02} max={1} step={0.01} />
      {#if editor.tool !== 'road' && editor.tool !== 'place'}
        <Slider label="Falloff" bind:value={editor.brush.falloff} min={0} max={1} step={0.01} />
      {/if}
    </section>
  {/if}

  <section>
    <h3>World</h3>
    <label class="check"><input type="checkbox" bind:checked={editor.waterEnabled} /> Water</label>
    {#if editor.waterEnabled}
      <Slider label="Water level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
    {/if}
    <label class="check"><input type="checkbox" bind:checked={editor.autoCliff} /> Automatic cliff rock</label>
    <label class="check"><input type="checkbox" bind:checked={editor.grid} /> Show grid <kbd>G</kbd></label>
    <button class="full" onclick={() => engineRef.current?.regenerateAutoPaint()}>Auto-paint terrain</button>
  </section>

  <WowClientSection />
</aside>

<style>
  .panel {
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--border);
  }
  section {
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin-bottom: 8px;
  }
  .modes.two {
    grid-template-columns: 1fr 1fr;
  }
  .modes button {
    padding: 5px 4px;
  }
  .current {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    margin-bottom: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .current span {
    font-size: 11px;
    color: var(--text-dim);
  }
  .current b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link {
    width: 100%;
    margin: 8px 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
    cursor: pointer;
  }
  .opts {
    margin-top: 10px;
  }
  .hint {
    color: var(--text-dim);
    font-size: 12px;
    margin: 8px 0 0;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .row button {
    flex: 1;
  }
  .danger:hover {
    border-color: var(--danger);
    color: var(--danger);
  }
  .full {
    width: 100%;
    margin-top: 8px;
  }
  .sel-title {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .sel-title span {
    color: var(--text-dim);
    font-family: var(--mono);
    font-weight: 400;
  }
  .kbds {
    float: right;
    text-transform: none;
  }
</style>
