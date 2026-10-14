<script lang="ts">
  import TileMinimap from './TileMinimap.svelte'
  import { editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { extendRegion } from '../lib/io/mapio'
  import type { Side } from '../lib/io/regionGrow'

  function extend(side: Side) {
    const e = engineRef.current
    if (e && !ui.busy) void extendRegion(e, side)
  }
</script>

<div class="minimap-panel">
  <TileMinimap open={editor.regionBlock} map={editor.regionMap} onextend={editor.regionBlock ? extend : undefined} />
  {#if editor.region}
    <p class="label">{editor.region}</p>
    <p class="dim">Outlined on the map: the tiles this map is made of. Saving writes them back to the client. A plus on a side adds the next tiles that way (the map stays square, so one more row or column comes along); save first, since the bigger map is read from the client.</p>
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
