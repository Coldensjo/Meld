<script lang="ts">
  import Modal from './Modal.svelte'
  import Slider from './Slider.svelte'
  import { editor, stats } from '../lib/state/editor.svelte'
  import { NO_ROLE } from '../lib/terrain/roles'

  const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

  // The map's facts and its world settings (File > Map Properties). The sea is one level for the
  // whole map, so it is set here and nowhere else; a part of Azeroth keeps the client's ocean.

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  /** The map's size: in client tiles for a region, else in cells. */
  const tiles = $derived(editor.regionBlock ? `${editor.regionBlock.size}×${editor.regionBlock.size} tiles` : `${editor.mapSize} × ${editor.mapSize} cells`)
  const azeroth = $derived(!!editor.region)
</script>

<Modal title="Map Properties" width={400} {onclose}>
  <div class="facts">
    <span class="k">Name</span><span title={editor.mapName}>{editor.mapName}</span>
    <span class="k">Size</span><span>{tiles}</span>
    {#if editor.region}<span class="k">Region</span><span title={editor.region}>{editor.region}</span>{/if}
    {#if editor.filePath}<span class="k">File</span><span title={editor.filePath}>{editor.filePath}</span>{/if}
    <span class="k">Models</span><span>{stats.objects}</span>
    <span class="k">Textures</span><span>{editor.palette.length}</span>
    {#if editor.spawns.length}<span class="k">Spawns</span><span>{editor.spawns.length}</span>{/if}
  </div>
  <div class="section">World</div>
  <label class="check" title="Ocean at the sea level wherever the ground lies below it. Lakes and rivers are painted with the Water tool."
    ><input type="checkbox" bind:checked={editor.waterEnabled} /> Sea</label
  >
  {#if editor.waterEnabled}
    {#if azeroth}
      <div class="facts">
        <span class="k">Sea level</span><span>{editor.waterLevel.toFixed(1)}</span>
      </div>
      <p class="dim">A part of Azeroth keeps the client's sea level.</p>
    {:else}
      <Slider label="Sea level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
      <p class="dim">One level for the whole map. Dig lake, Raise shore and Auto-paint shape the coast around it.</p>
    {/if}
  {/if}
  <label class="check" title="Steep slopes are drawn as rock in the editor's view only. Nothing is painted, so the client will not show it: paint the rock with Sculpt's by-slope painting instead."
    ><input type="checkbox" bind:checked={editor.autoCliff} /> Show steep slopes as rock (preview only)</label
  >
  <div class="section">Texture roles</div>
  <p class="dim">The textures Sculpt paints by slope while it shapes the ground: rock on the steep, dirt rimming its foot. Pick them from the map's palette (the asset browser adds textures to it).</p>
  <div class="facts">
    <label class="k" for="role-rock">Rock</label>
    <select id="role-rock" bind:value={editor.roles.rock}>
      <option value={NO_ROLE}>none</option>
      {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
    </select>
    <label class="k" for="role-dirt">Dirt</label>
    <select id="role-dirt" bind:value={editor.roles.dirt}>
      <option value={NO_ROLE}>none</option>
      {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
    </select>
  </div>
  {#snippet actions()}
    <button class="active" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .facts {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 3px 8px;
    margin: 4px 0;
    font-size: 12px;
  }
  .facts span:not(.k) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .k {
    color: var(--text-dim);
    font-size: 11px;
  }
  .section {
    margin: 12px 0 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
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
    margin: 2px 0 6px;
  }
</style>
