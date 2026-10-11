<script lang="ts" module>
  import type { ToolId } from '../lib/state/editor.svelte'

  export const TOOLS: Array<{ id: ToolId; name: string; key: string; icon: string }> = [
    { id: 'select', name: 'Select / Move', key: '1', icon: 'M5 3l14 8-6 2-2 6z' },
    { id: 'sculpt', name: 'Sculpt Terrain', key: '2', icon: 'M2 20l6-10 4 6 3-4 7 8z' },
    { id: 'paint', name: 'Paint Textures', key: '3', icon: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3zM14 6l3 3' },
    { id: 'road', name: 'Roads', key: '4', icon: 'M8 21L10 3M16 21L14 3M12 5v2M12 11v2M12 17v2' },
    { id: 'water', name: 'Water', key: '5', icon: 'M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z' },
    { id: 'place', name: 'Place Objects', key: '6', icon: 'M12 2l7 6v12H5V8zM9 20v-6h6v6' },
  ]
</script>

<script lang="ts">
  import { editor } from '../lib/state/editor.svelte'
</script>

<nav class="toolbar">
  {#each TOOLS as t (t.id)}
    <button
      class:active={editor.tool === t.id}
      title="{t.name} ({t.key})"
      aria-label={t.name}
      onclick={() => (editor.tool = t.id)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
        <path d={t.icon} />
      </svg>
      <span class="key">{t.key}</span>
    </button>
  {/each}
</nav>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 6px;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }
  button {
    position: relative;
    width: 44px;
    height: 44px;
    padding: 0;
    display: grid;
    place-items: center;
    background: transparent;
    border-color: transparent;
  }
  button:hover:not(.active) {
    border-color: var(--border);
  }
  button.active {
    background: var(--accent);
    border-color: var(--accent);
  }
  .key {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font: 9px var(--mono);
    opacity: 0.6;
  }
</style>
