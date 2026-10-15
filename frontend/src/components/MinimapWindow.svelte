<script lang="ts">
  import { editor, stats, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'

  // A floating minimap over the viewport (M opens and closes it), after noggit's minimap window: the
  // whole map from above, with the client's overview behind it for a part of Azeroth, the tile
  // borders, and the camera's spot and facing. A click moves the camera there. The ground is drawn
  // from the heights (grey by height, blue under the sea) so a new world has a map too; it is
  // redrawn when the heights change, checked with the 2 Hz stats.

  const TILE_CELLS = 128
  let canvas: HTMLCanvasElement | undefined = $state()
  let drawnFor = ''

  /** Redraws the heights when the map or its heights changed. Runs with every stats refresh. */
  $effect(() => {
    const view = stats.view
    const e = engineRef.current
    if (!view || !e || !canvas || !ui.minimap) return
    const t = e.terrain
    const key = `${t.size}|${t.heightsVersion}|${editor.waterEnabled ? editor.waterLevel : 'dry'}`
    if (key === drawnFor) return
    drawnFor = key
    draw(canvas, t.heights, t.size, editor.waterEnabled ? editor.waterLevel : -Infinity)
  })

  function draw(c: HTMLCanvasElement, heights: Float32Array, size: number, sea: number) {
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    if (!ctx) return
    const V = size + 1
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
    const span = Math.max(1, hi - Math.max(lo, sea))
    const img = ctx.createImageData(size, size)
    const d = img.data
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const h = heights[z * V + x]
        const i = (z * size + x) * 4
        if (h < sea) {
          const depth = Math.min(1, (sea - h) / 30)
          d[i] = 20 + 20 * (1 - depth)
          d[i + 1] = 60 + 40 * (1 - depth)
          d[i + 2] = 110 + 50 * (1 - depth)
        } else {
          const v = 70 + 150 * Math.min(1, (h - Math.max(lo, sea)) / span)
          d[i] = v
          d[i + 1] = v
          d[i + 2] = v * 0.92
        }
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  /** The map's tile borders, in cells, as one path; none for a map smaller than a tile. */
  const grid = $derived.by(() => {
    const size = stats.view?.cells ?? 0
    if (size <= TILE_CELLS) return ''
    let p = ''
    for (let i = TILE_CELLS; i < size; i += TILE_CELLS) p += `M${i} 0V${size}M0 ${i}H${size}`
    return p
  })

  /** The camera's spot and facing as a small arrow in cells. */
  const marker = $derived.by(() => {
    const v = stats.view
    if (!v) return null
    const cs = v.world / Math.max(1, v.cells)
    const x = v.x / cs
    const z = v.z / cs
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
  }
</script>

{#if ui.minimap}
  <aside class="minimap" aria-label="Minimap">
    <header>
      <span>Minimap{editor.region ? ` · ${editor.region}` : ''}</span>
      <button class="close" onclick={() => (ui.minimap = false)} title="Close (M)" aria-label="Close the minimap">✕</button>
    </header>
    <button type="button" class="map" onclick={jump} title="Click to move the camera there" aria-label="The map: click to move the camera there">
      <canvas bind:this={canvas}></canvas>
      {#if stats.view}
        {@const v = stats.view}
        <svg viewBox="0 0 {v.cells} {v.cells}" preserveAspectRatio="none">
          {#if editor.regionBlock && editor.regionMap}
            {@const b = editor.regionBlock}
            <!-- The continent's overview, cropped to the open block: the whole map is 64 tiles a side. -->
            <svg x="0" y="0" width={v.cells} height={v.cells} viewBox="{b.x} {b.y} {b.size} {b.size}" preserveAspectRatio="none">
              <image href="/wow/overview?map={encodeURIComponent(editor.regionMap)}" x="0" y="0" width="64" height="64" preserveAspectRatio="none" />
            </svg>
          {/if}
          {#if grid}<path d={grid} class="tiles" />{/if}
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
  .tiles {
    fill: none;
    stroke: #ffb833;
    stroke-opacity: 0.8;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
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
