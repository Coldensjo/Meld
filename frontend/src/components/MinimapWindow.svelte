<script lang="ts">
  import { stats, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { drawLayerMap } from '../lib/cubes/layerMap'
  import { THEMES, themeOf } from '../lib/cubes/mesher'

  // A floating minimap over the viewport (M opens and closes it), after noggit's minimap window: the
  // layer of the world the camera is in, from above, with what lies below it showing darker (#62), and
  // the camera's spot and facing. A click moves the camera there. It is redrawn when the layer or the
  // cubes change, checked with the 2 Hz stats.

  let canvas: HTMLCanvasElement | undefined = $state()
  let drawnFor = ''

  /** Redraws the layer when the world, the layer or its cubes changed. Runs with every stats refresh. */
  $effect(() => {
    const view = stats.view
    const e = engineRef.current
    if (!view || !e || !canvas || !ui.minimap) return
    const world = e.activeDocument().world
    const key = `${e.activeDocumentId()}|${view.layer}|${view.cubes}`
    if (key === drawnFor) return
    drawnFor = key
    const side = Math.max(world.sizeX, world.sizeZ)
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(side, side)
    drawLayerMap(world, view.layer, side, img.data)
    ctx.putImageData(img, 0, 0)
  })

  /**
   * Where a click sent the camera, until the next stats refresh (2 Hz) reports it: the marker moves
   * with the click rather than up to half a second later (#129).
   */
  let jumped = $state<{ x: number; z: number } | null>(null)
  $effect(() => {
    void stats.view
    jumped = null
  })

  /** The camera's spot and facing as a small arrow in cells. */
  const marker = $derived.by(() => {
    const v = stats.view
    if (!v) return null
    const cs = v.world / Math.max(1, v.cells)
    const x = (jumped?.x ?? v.x) / cs
    const z = (jumped?.z ?? v.z) / cs
    // Facing: the way the camera looks, in map cells (the yaw's forward is (-sin, -cos)).
    const fx = -Math.sin(v.yaw)
    const fz = -Math.cos(v.yaw)
    const len = Math.max(3, v.cells / 24)
    return { x, z, tipX: x + fx * len, tipZ: z + fz * len, size: Math.max(1.5, v.cells / 60) }
  })

  function jump(e: MouseEvent) {
    const v = stats.view
    const eng = engineRef.current
    const el = e.currentTarget as HTMLElement
    if (!v || !eng) return
    const r = el.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * v.world
    const z = ((e.clientY - r.top) / r.height) * v.world
    eng.controller.focus(x, z)
    jumped = { x: eng.controller.target.x, z: eng.controller.target.z }
  }
</script>

{#if ui.minimap}
  <aside class="minimap" aria-label="Minimap">
    <header>
      <span>Minimap{stats.view && stats.view.layer >= 0 ? ` · layer ${stats.view.layer} (${THEMES[themeOf(stats.view.layer)]})` : ''}</span>
      <button class="close" onclick={() => (ui.minimap = false)} title="Close (M)" aria-label="Close the minimap">✕</button>
    </header>
    <button type="button" class="map" onclick={jump} title="Click to move the camera there" aria-label="The layer: click to move the camera there">
      <canvas bind:this={canvas}></canvas>
      {#if stats.view}
        {@const v = stats.view}
        <svg viewBox="0 0 {v.cells} {v.cells}" preserveAspectRatio="none">
          {#if marker}
            <line x1={marker.x} y1={marker.z} x2={marker.tipX} y2={marker.tipZ} class="facing" />
            <circle cx={marker.x} cy={marker.z} r={marker.size} class="camera" />
          {/if}
        </svg>
      {/if}
    </button>
  </aside>
{/if}

<style>
  .minimap {
    position: fixed;
    top: 96px;
    left: 50px;
    width: 260px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    z-index: 40;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 6px 0 12px;
    background: var(--header);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    flex: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .close {
    border: none;
    background: transparent;
    padding: 0 6px;
    color: var(--text-dim);
  }
  .close:hover {
    color: var(--text);
  }
  .map {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 0;
    cursor: crosshair;
    background: #0b0d10;
  }
  canvas,
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
  }
  svg {
    image-rendering: auto;
  }
  .camera {
    fill: #fff;
    stroke: #000;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .facing {
    stroke: #fff;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
</style>
