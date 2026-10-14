<script lang="ts">
  import { editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
  import { displayName } from '../lib/models/assets'
  import { requestThumb } from '../lib/wow/thumbs'
  import { exportDoodadBrush, hasBackend, importDoodadBrushes } from '../lib/io/mapio'
  import { cloneBrush, newEntry, totalWeight, uniqueName, type DoodadBrush } from '../lib/tools/doodadBrush'
  import { activeDoodadBrush, addDoodadBrush } from '../lib/tools/DoodadBrushTool'

  // The doodad brush editor: the list of brushes, and the picked brush's models with their weights,
  // scale range, sink and tilt. Edits go straight into `prefs.doodadBrushes`, which is saved with the
  // other preferences. Models are added by picking them in the asset browser while this tool is active.

  const brush = $derived(activeDoodadBrush())
  const total = $derived(brush ? totalWeight(brush) : 0)
  const names = () => prefs.doodadBrushes.map((b) => b.name)

  function add(b: DoodadBrush) {
    prefs.doodadBrushes = [...prefs.doodadBrushes, b]
    prefs.doodadBrush = b.name
  }

  function create() {
    addDoodadBrush()
    if (editor.tool !== 'doodad') editor.tool = 'doodad'
  }

  function duplicate() {
    if (brush) add(cloneBrush(brush, uniqueName(brush.name, names())))
  }

  function remove() {
    if (!brush) return
    prefs.doodadBrushes = prefs.doodadBrushes.filter((b) => b !== brush)
    prefs.doodadBrush = prefs.doodadBrushes[0]?.name ?? ''
  }

  function rename(e: Event) {
    if (!brush) return
    const name = (e.target as HTMLInputElement).value.trim()
    if (!name || name === brush.name) {
      ;(e.target as HTMLInputElement).value = brush.name
      return
    }
    const unique = uniqueName(name, names().filter((n) => n !== brush.name))
    brush.name = unique
    prefs.doodadBrush = unique
  }

  /** Adds the model the Place tool holds, when the asset browser's pick is not to hand. */
  function addCurrent() {
    if (!brush || !editor.prefab) return
    if (brush.entries.some((e) => e.type === editor.prefab)) return setStatus('That model is in the brush already.')
    brush.entries.push(newEntry(editor.prefab))
  }

  function removeEntry(i: number) {
    brush?.entries.splice(i, 1)
  }

  const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
  const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
  const share = (w: number) => (total > 0 ? Math.round((Math.max(0, w) / total) * 100) : 0)

  /** Shows a model's thumbnail in `node` (an img) once it is rendered. */
  function thumb(node: HTMLImageElement, key: string) {
    let cancel = requestThumb(key, (u) => (node.src = u))
    return {
      update(k: string) {
        cancel()
        node.removeAttribute('src')
        cancel = requestThumb(k, (u) => (node.src = u))
      },
      destroy: () => cancel(),
    }
  }
</script>

<div class="brushes">
  <div class="row">
    <select class="grow" value={brush?.name ?? ''} onchange={(e) => (prefs.doodadBrush = (e.target as HTMLSelectElement).value)} disabled={!prefs.doodadBrushes.length} aria-label="Brush">
      {#if !prefs.doodadBrushes.length}<option value="">No brushes yet</option>{/if}
      {#each prefs.doodadBrushes as b (b.name)}
        <option value={b.name}>{b.name}</option>
      {/each}
    </select>
    <button onclick={create} title="Make a new, empty brush">New</button>
    <button onclick={duplicate} disabled={!brush} title="Copy this brush">Copy</button>
    <button onclick={remove} disabled={!brush} title="Delete this brush">Delete</button>
  </div>

  {#if brush}
    <div class="row">
      <label class="field grow"><span>Name</span><input value={brush.name} onchange={rename} /></label>
      <label class="field" title="Space between models as a multiple of their footprint: 1 lets them touch, 2 leaves a model's width between them, 0.5 lets them overlap">
        <span>Spacing</span>
        <input class="num" type="number" min="0" max="5" step="0.1" value={brush.spacing.toFixed(1)} onchange={(e) => (brush.spacing = clamp(num(e), 0, 5))} />
      </label>
    </div>

    <div class="section">Models {#if brush.entries.length}<span class="dim">· total weight {total}</span>{/if}</div>
    {#if !brush.entries.length}
      <p class="dim">The brush is empty. Pick models in the asset browser below to add them.</p>
    {/if}
    {#each brush.entries as e, i (e.type)}
      <div class="entry">
        <img class="thumb" alt="" use:thumb={e.type} />
        <div class="body">
          <div class="head">
            <span class="name" title={e.type}>{displayName(e.type)}</span>
            <span class="pct" title="Share of the placements">{share(e.weight)}%</span>
            <button class="x" onclick={() => removeEntry(i)} title="Take the model out of the brush" aria-label="Remove model">✕</button>
          </div>
          <label class="field" title="How often it comes out, relative to the other models">
            <span>Weight</span>
            <input type="range" min="0" max="100" step="1" bind:value={e.weight} />
            <input class="num" type="number" min="0" step="1" value={e.weight} onchange={(ev) => (e.weight = clamp(num(ev), 0, 1000))} />
          </label>
          <div class="row tight">
            <label class="field" title="Random scale between these">
              <span>Scale</span>
              <input class="num" type="number" min="0.05" max="20" step="0.05" value={e.scaleMin.toFixed(2)} onchange={(ev) => (e.scaleMin = Math.min(e.scaleMax, clamp(num(ev), 0.05, 20)))} />
              <span>–</span>
              <input class="num" type="number" min="0.05" max="20" step="0.05" value={e.scaleMax.toFixed(2)} onchange={(ev) => (e.scaleMax = Math.max(e.scaleMin, clamp(num(ev), 0.05, 20)))} />
            </label>
            <label class="field" title="Height above the ground in yards; negative sinks it in">
              <span>Sink</span>
              <input class="num" type="number" min="-20" max="20" step="0.1" value={e.sink.toFixed(1)} onchange={(ev) => (e.sink = clamp(num(ev), -20, 20))} />
            </label>
            <label class="field" title="Random tilt each way, in degrees (Follow ground rotation replaces it)">
              <span>Tilt</span>
              <input class="num" type="number" min="0" max="45" step="1" value={e.tilt} onchange={(ev) => (e.tilt = clamp(num(ev), 0, 45))} />°
            </label>
          </div>
        </div>
      </div>
    {/each}

    <div class="row">
      {#if editor.prefab && !brush.entries.some((e) => e.type === editor.prefab)}
        <button class="grow" onclick={addCurrent} title={editor.prefab}>Add {displayName(editor.prefab)}</button>
      {:else}
        <span class="dim grow">Pick a model in the browser below to add it.</span>
      {/if}
    </div>
  {/if}

  <div class="row">
    <button class="grow" disabled={!hasBackend()} onclick={() => importDoodadBrushes()} title="Read brushes from .toml files">Import…</button>
    <button class="grow" disabled={!hasBackend() || !brush} onclick={() => brush && exportDoodadBrush(brush)} title="Save this brush as a .toml file to share">Export…</button>
    {#if editor.tool !== 'doodad'}
      <button class="grow active" onclick={() => (editor.tool = 'doodad')} title="Paint with this brush (8)">Paint</button>
    {/if}
  </div>
  {#if ui.palette !== 'models' && editor.tool === 'doodad'}
    <p class="dim">The browser shows textures; switch it to models to add some.</p>
  {/if}
</div>

<style>
  .brushes {
    padding: 6px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .row.tight {
    gap: 8px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .row button {
    padding: 2px 8px;
    flex: none;
  }
  .row button.grow {
    flex: 1;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .field input:not(.num):not([type='range']) {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
  }
  .field input[type='range'] {
    flex: 1;
    min-width: 40px;
    height: 14px;
  }
  .num {
    width: 46px;
    padding: 1px 4px;
    font: 11px var(--mono);
    text-align: right;
  }
  .section {
    margin: 4px 0 0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
    margin: 0;
  }
  .entry {
    display: flex;
    gap: 6px;
    padding: 4px;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
  }
  .thumb {
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: 4px;
    object-fit: cover;
    background: radial-gradient(circle at 50% 40%, #5a6373, #2b3038 80%);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
  .pct {
    font: 11px var(--mono);
    color: var(--text-dim);
  }
  .x {
    border: none;
    background: transparent;
    padding: 0 4px;
    color: var(--text-dim);
  }
  .x:hover {
    color: var(--text);
  }
</style>
