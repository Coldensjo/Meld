<script lang="ts">
  import { stats, ui } from '../lib/state/editor.svelte'

  const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
</script>

<footer class="status">
  <span class="msg">{ui.status}</span>
  <span class="cell">
    {#if stats.cursor}
      X {stats.cursor.x.toFixed(1)} · Y {stats.cursor.y.toFixed(1)} · Z {stats.cursor.z.toFixed(1)}
    {:else}
      —
    {/if}
  </span>
  <span class="cell">{stats.objects} objects</span>
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
    color: var(--danger);
  }
</style>
