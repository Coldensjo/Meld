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
  /** The selected objects' model names, most common first, for a selection of several. */
  const breakdown = $derived.by(() => {
    const objects = engineRef.current?.objects.objects
    const counts = new Map<string, number>()
    for (const id of editor.selectedIds) {
      const o = objects?.get(id)
      if (o) counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n }))
  })
</script>

<div class="props">
  {#if editor.selectedIds.length > 1}
    <h3>{editor.selectedIds.length} objects selected</h3>
    <ul class="list">
      {#each breakdown as b (b.type)}
        <li><span class="n">{b.n}×</span> {displayName(b.type)}</li>
      {/each}
    </ul>
    <p class="dim">Drag one of them to move them all; the arrow keys and <kbd>R</kbd> work on all of them. Click one alone to edit its transform here.</p>
    <div class="row">
      <button onclick={() => engineRef.current?.focusSelected()}>Focus</button>
      <button onclick={() => engineRef.current?.deleteSelected()}>Delete</button>
      <button onclick={() => engineRef.current?.deselect()}>Deselect</button>
    </div>
  {:else if editor.selected}
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
    <Slider label="Tilt°" value={deg(s.tiltX ?? 0)} min={-60} max={60} step={0.5} digits={1} onstart={startEdit} oninput={(v) => live({ tiltX: rad(v) })} onchange={(v) => commit({ tiltX: rad(v) })} />
    <Slider label="Roll°" value={deg(s.tiltZ ?? 0)} min={-60} max={60} step={0.5} digits={1} onstart={startEdit} oninput={(v) => live({ tiltZ: rad(v) })} onchange={(v) => commit({ tiltZ: rad(v) })} />
    <Slider label="Scale" value={s.scale} min={0.2} max={5} step={0.01} digits={2} onstart={startEdit} oninput={(v) => live({ scale: v })} onchange={(v) => commit({ scale: v })} />
  {:else}
    <h3>World</h3>
    <label class="check"><input type="checkbox" bind:checked={editor.waterEnabled} /> Water</label>
    {#if editor.waterEnabled}
      <Slider label="Water level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
    {/if}
    <label class="check"><input type="checkbox" bind:checked={editor.autoCliff} /> Automatic cliff rock</label>
    <label class="check"><input type="checkbox" bind:checked={editor.grid} /> Show grid</label>
    <p class="dim">Select an object with the Select tool (V) to edit its transform here. Drag on the ground to select an area: Cut hole in the options bar cuts it out of the ground.</p>
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
  .list {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 12px;
  }
  .list li {
    display: flex;
    gap: 6px;
    padding: 2px 0;
  }
  .n {
    color: var(--text-dim);
    font-family: var(--mono);
    min-width: 30px;
    text-align: right;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .row button {
    flex: 1;
  }
</style>
