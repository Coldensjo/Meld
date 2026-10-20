<script lang="ts" module>
  import type { ToolId } from '../lib/state/editor.svelte'

  export const TOOLS: Array<{ id: ToolId; name: string; desc: string; key: string; letter?: string; icon: string }> = [
    { id: 'select', name: 'Select', desc: 'Click a model, or drag on the ground to select an area and the models in it. Alt+click picks a model or texture.', key: '1', letter: 'V', icon: 'M5 3l14 8-6 2-2 6z' },
    { id: 'sculpt', name: 'Sculpt Terrain', desc: 'Raise, lower, smooth, flatten or roughen the ground under the brush.', key: '2', icon: 'M2 20l6-10 4 6 3-4 7 8z' },
    { id: 'paint', name: 'Paint Textures', desc: 'Paint the picked ground texture, or a mask to fill with one. Each chunk holds up to four textures.', key: '3', letter: 'B', icon: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3zM14 6l3 3' },
    { id: 'road', name: 'Roads', desc: 'Paint a texture with a hard edge and level the ground across it.', key: '4', icon: 'M8 21L10 3M16 21L14 3M12 5v2M12 11v2M12 17v2' },
    { id: 'water', name: 'Water', desc: 'Paint lakes and rivers of water, ocean, magma or slime, or dig lakes and raise shores around the sea.', key: '5', icon: 'M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z' },
    { id: 'place', name: 'Place Objects', desc: 'Place the model picked in the asset browser on the ground or on another model.', key: '6', icon: 'M12 2l7 6v12H5V8zM9 20v-6h6v6' },
    { id: 'clear', name: 'Clear', desc: 'Erase models, or paint out heights, liquids or holes in the brush.', key: '7', icon: 'M4 16l7-9 6 6-5 6H6zM14 20h7' },
    { id: 'doodad', name: 'Doodad Brush', desc: 'Scatter a brush of weighted models over the ground (Ctrl erases them).', key: '8', icon: 'M3 21c0-3.5 1.2-6 3.5-6S10 16.5 10 18.5 7.5 22 3 21zM9 15l9-9M13 3h.01M19 3h.01M21 9h.01M16 7h.01' },
    { id: 'stamp', name: 'Stamp', desc: 'One stroke applies a stack of sculpt and paint brushes together (Edit stack in the options bar).', key: '0', icon: 'M7 3h10v5l-3 3v3h5v3H5v-3h5v-3L7 8zM4 21h16' },
    { id: 'mapdata', name: 'Map Data', desc: 'Paint the zone each chunk belongs to (Alt+click picks the one under the cursor), mark chunks impassable, or cells that grow no grass tufts.', key: '9', icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' },
  ]

  /** The toolbar's icon sizes, smallest and largest (#128); a button is the icon plus a 16px margin. */
  export const TOOLBAR_ICON_MIN = 16
  export const TOOLBAR_ICON_MAX = 44
</script>

<script lang="ts">
  import { editor, prefs } from '../lib/state/editor.svelte'
  import { toCss } from '../lib/ui/uiScale'

  const icon = $derived(Math.min(TOOLBAR_ICON_MAX, Math.max(TOOLBAR_ICON_MIN, Number(prefs.toolbarIcon) || 22)))

  /** The tooltip beside the hovered button (#130): shown after TIP_DELAY, at once when moving on from one. */
  const TIP_DELAY = 300
  /** Its gap to the right of the toolbar, px. */
  const TIP_GAP = 10
  let tip = $state<{ tool: (typeof TOOLS)[number]; x: number; y: number } | null>(null)
  let timer = 0
  let lastHidden = 0

  function showTip(t: (typeof TOOLS)[number], el: HTMLElement) {
    clearTimeout(timer)
    const place = () => {
      const b = el.getBoundingClientRect()
      const bar = el.closest('nav')!.getBoundingClientRect()
      // Rects are in window px, the tip's left and top in the zoomed page's CSS px (#372).
      tip = { tool: t, x: toCss(bar.right) + TIP_GAP, y: toCss(b.top + b.height / 2) }
    }
    if (tip || performance.now() - lastHidden < TIP_DELAY) place()
    else timer = window.setTimeout(place, TIP_DELAY)
  }

  function hideTip() {
    clearTimeout(timer)
    if (tip) lastHidden = performance.now()
    tip = null
  }
</script>

<svelte:window onblur={hideTip} />

<nav class="toolbar" style:--icon="{icon}px">
  {#each TOOLS as t (t.id)}
    <button
      class:active={editor.tool === t.id}
      aria-label={t.name}
      onpointerenter={(e) => showTip(t, e.currentTarget)}
      onpointerleave={hideTip}
      onclick={() => {
        hideTip()
        editor.tool = t.id
      }}
    >
      <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">
        <path d={t.icon} />
      </svg>
      <span class="key">{t.key}</span>
    </button>
  {/each}
</nav>

{#if tip}
  <div class="tip" role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">
    <div class="tip-name">{tip.tool.name} <kbd>{tip.tool.letter ? tip.tool.letter + ', ' : ''}{tip.tool.key}</kbd></div>
    <div class="tip-desc">{tip.tool.desc}</div>
  </div>
{/if}

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
    color: var(--text-strong);
  }
  .key {
    display: none;
  }
  .tip {
    position: fixed;
    z-index: 1000;
    transform: translateY(-50%);
    max-width: 260px;
    padding: 6px 9px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }
  .tip-name {
    color: var(--text);
    font-weight: 600;
  }
  .tip-name kbd {
    margin-left: 4px;
    color: var(--text-dim);
    font-weight: 400;
  }
  .tip-desc {
    margin-top: 2px;
    color: var(--text-dim);
  }
</style>
