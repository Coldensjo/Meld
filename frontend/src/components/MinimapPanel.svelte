<script lang="ts">
  import TileMinimap from './TileMinimap.svelte'
  import { editor } from '../lib/state/editor.svelte'
</script>

<div class="minimap-panel">
  <TileMinimap open={editor.regionBlock} />
  {#if editor.region}
    <p class="label">{editor.region}</p>
    <p class="dim">Outlined on the map: the tiles this map is made of. Saving writes them back to the client.</p>
  {:else}
    <p class="dim">No client region is open. Open one with File › Open WoW Region…</p>
  {/if}
</div>

<style>
  .minimap-panel {
    padding: 10px;
  }
  .label {
    margin: 10px 0 4px;
    font-size: 12px;
  }
  .dim {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
