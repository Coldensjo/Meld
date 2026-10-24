<script lang="ts">
  import { stats, ui } from '../lib/state/editor.svelte'
  import ToolHint from './ToolHint.svelte'
  import { THEMES, themeOf } from '../lib/cubes/mesher'

  const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))

  /** The slot is one line and cuts long hints off; hovering it gives the whole text. */
  let hintTitle = $state('')
</script>

<footer class="status">
  <!-- A message holds the slot for its few seconds; then the current tool's hint shows (#238). -->
  <span class="msg" role="status" title={hintTitle} onmouseenter={(e) => (hintTitle = ui.status === 'Ready' ? (e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim() : '')}>
    {#if ui.status === 'Ready'}<ToolHint />{:else}{ui.status}{/if}
  </span>
  <span class="cell">
    {#if stats.cursor}
      X {stats.cursor.x.toFixed(1)} · Y {stats.cursor.y.toFixed(1)} · Z {stats.cursor.z.toFixed(1)}
    {:else}
      —
    {/if}
  </span>
  {#if stats.cameraLayer >= 0}
    <!-- The layer the camera is in (#62), as the minimap shows it. -->
    <span class="cell" title="The layer of the world the camera is in (0 the top of the sky, 10 the ground, 30 the bottom)">Layer {stats.cameraLayer} · {THEMES[themeOf(stats.cameraLayer)]}</span>
  {/if}
  <span class="cell">{stats.drawCalls} draws · {fmt(stats.triangles)} tris</span>
  <span class="cell fps" class:low={stats.fps < 30}>{stats.fps} FPS</span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 10px;
    height: 24px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-dim);
  }
  .msg {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cell {
    font-family: var(--mono);
    white-space: nowrap;
  }
  .fps {
    color: #7fc77f;
    min-width: 56px;
    text-align: right;
  }
  .fps.low {
    color: var(--danger-text);
  }
</style>
