<script lang="ts">
  import Slider from './Slider.svelte'
  import { editor } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { displayName } from '../lib/models/assets'
  import type { WorldObject } from '../lib/world/ObjectLayer'

  // Live preview while dragging a slider; one undo step on release.
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
  const deg = (r: number) => (r * 180) / Math.PI
  const rad = (d: number) => (d * Math.PI) / 180
  const worldSize = $derived(engineRef.current?.terrain.worldSize ?? 512)
</script>

<div class="props">
  {#if editor.selected}
    {@const s = editor.selected}
    <h3>{displayName(s.type)} <span>#{s.id}</span></h3>
    {#if s.parent !== undefined}
      {@const p = engineRef.current?.objects.objects.get(s.parent)}
      <div class="attached">
        <span>Attached to <b>{p ? displayName(p.type) : '#' + s.parent}</b> (position is relative to it)</span>
        <button onclick={() => engineRef.current?.detachSelected()}>Detach</button>
      </div>
    {/if}
    <Slider label="X" value={s.x} min={0} max={worldSize} step={0.1} digits={1} onstart={startEdit} oninput={(v) => live({ x: v })} onchange={(v) => commit({ x: v })} />
    <Slider label="Z" value={s.z} min={0} max={worldSize} step={0.1} digits={1} onstart={startEdit} oninput={(v) => live({ z: v })} onchange={(v) => commit({ z: v })} />
    <Slider label="Height offset" value={s.yOff} min={-5} max={20} step={0.05} digits={2} onstart={startEdit} oninput={(v) => live({ yOff: v })} onchange={(v) => commit({ yOff: v })} />
    <Slider label="Rotation°" value={deg(s.rotY) % 360} min={-360} max={360} step={1} digits={0} onstart={startEdit} oninput={(v) => live({ rotY: rad(v) })} onchange={(v) => commit({ rotY: rad(v) })} />
    <Slider label="Scale" value={s.scale} min={0.2} max={5} step={0.01} digits={2} onstart={startEdit} oninput={(v) => live({ scale: v })} onchange={(v) => commit({ scale: v })} />
  {:else}
    <h3>World</h3>
    <label class="check"><input type="checkbox" bind:checked={editor.waterEnabled} /> Water</label>
    {#if editor.waterEnabled}
      <Slider label="Water level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
    {/if}
    <label class="check"><input type="checkbox" bind:checked={editor.autoCliff} /> Automatic cliff rock</label>
    <label class="check"><input type="checkbox" bind:checked={editor.grid} /> Show grid</label>
    <p class="dim">Select an object with the Select tool (1) to edit its transform here.</p>
  {/if}
</div>

<style>
  .props {
    padding: 8px 10px;
    overflow-y: auto;
  }
  h3 {
    text-transform: none;
    letter-spacing: 0;
    font-size: 12px;
    color: var(--text);
  }
  h3 span {
    color: var(--text-dim);
    font-family: var(--mono);
    font-weight: 400;
  }
  .attached {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .attached button {
    padding: 1px 8px;
    flex: none;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
    cursor: pointer;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
