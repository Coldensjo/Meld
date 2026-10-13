<script lang="ts">
  import TileMinimap from './TileMinimap.svelte'
  import { editor } from '../lib/state/editor.svelte'
</script>

<div class="minimap-panel">
  <TileMinimap open={editor.regionBlock} map={editor.regionMap} />
  {#if editor.region}
    <p class="label">{editor.region}</p>
    <p class="dim">Outlined on the map: the tiles this map is made of. Saving writes them back to the client.</p>
  {:else}
    <p class="dim">This map is not a part of a continent. File › Open Part of Azeroth… opens one.</p>
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
