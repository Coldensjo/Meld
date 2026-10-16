<script lang="ts" module>
  import type { ToolId } from '../lib/state/editor.svelte'

  export const TOOLS: Array<{ id: ToolId; name: string; key: string; letter?: string; icon: string }> = [
    { id: 'select', name: 'Select: click a model, or drag on the ground to select an area and the models in it. Alt+click picks a model or texture', key: '1', letter: 'V', icon: 'M5 3l14 8-6 2-2 6z' },
    { id: 'sculpt', name: 'Sculpt Terrain', key: '2', icon: 'M2 20l6-10 4 6 3-4 7 8z' },
    { id: 'paint', name: 'Paint Textures', key: '3', letter: 'B', icon: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3zM14 6l3 3' },
    { id: 'road', name: 'Roads', key: '4', icon: 'M8 21L10 3M16 21L14 3M12 5v2M12 11v2M12 17v2' },
    { id: 'water', name: 'Water', key: '5', icon: 'M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z' },
    { id: 'place', name: 'Place Objects', key: '6', icon: 'M12 2l7 6v12H5V8zM9 20v-6h6v6' },
    { id: 'clear', name: 'Clear: erase models or paint in the brush', key: '7', icon: 'M4 16l7-9 6 6-5 6H6zM14 20h7' },
    { id: 'doodad', name: 'Doodad brush: scatter a brush of weighted models over the ground (Ctrl erases them)', key: '8', icon: 'M3 21c0-3.5 1.2-6 3.5-6S10 16.5 10 18.5 7.5 22 3 21zM9 15l9-9M13 3h.01M19 3h.01M21 9h.01M16 7h.01' },
    { id: 'stamp', name: 'Stamp: one stroke applies a stack of sculpt and paint brushes together (Edit stack in the options bar)', key: '0', icon: 'M7 3h10v5l-3 3v3h5v3H5v-3h5v-3L7 8zM4 21h16' },
    { id: 'mapdata', name: 'Map data: paint the zone each chunk belongs to (Alt+click picks the one under the cursor), mark chunks impassable, or cells that grow no grass tufts', key: '9', icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' },
  ]

  /** The toolbar's icon sizes, smallest and largest (#128); a button is the icon plus a 16px margin. */
  export const TOOLBAR_ICON_MIN = 16
  export const TOOLBAR_ICON_MAX = 44
</script>

<script lang="ts">
  import { editor, prefs } from '../lib/state/editor.svelte'

  const icon = $derived(Math.min(TOOLBAR_ICON_MAX, Math.max(TOOLBAR_ICON_MIN, Number(prefs.toolbarIcon) || 22)))
</script>

<nav class="toolbar" style:--icon="{icon}px">
  {#each TOOLS as t (t.id)}
    <button
      class:active={editor.tool === t.id}
      title="{t.name} ({t.letter ? t.letter + ', ' : ''}{t.key})"
      aria-label={t.name}
      onclick={() => (editor.tool = t.id)}
    >
      <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
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
    align-items: center;
    gap: 2px;
    padding: 6px 4px;
    /* At the larger icon sizes the tools may not fit a short window. */
    overflow-y: auto;
    scrollbar-width: none;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }
  button {
    flex: none;
    width: calc(var(--icon) + 16px);
    height: calc(var(--icon) + 16px);
    padding: 0;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    border-radius: var(--radius);
    color: var(--text-dim);
  }
  button:hover:not(.active) {
    background: var(--panel-2);
    color: var(--text);
  }
  button.active {
    background: var(--panel-3);
    color: #fff;
  }
  .key {
    display: none;
  }
</style>
