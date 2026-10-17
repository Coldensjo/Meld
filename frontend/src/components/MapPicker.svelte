<script lang="ts">
  import type { TileBlock as Block } from '../lib/io/regionGrow'

  // A continent seen from above, stitched from the client's minimap, on which a square of tiles is
  // picked by dragging. Scroll zooms around the cursor and a right or middle drag pans, so a small
  // region can be found by eye rather than by tile number.

  interface Props {
    /** The map's folder name, e.g. "Azeroth". */
    map: string
    block: Block | null
    /** The most tiles a side the block may have. */
    maxSize?: number
    /** Jump the view to a tile rect when set (a zone's extent). */
    focus?: { x0: number; y0: number; x1: number; y1: number } | null
  }
  let { map, block = $bindable(), maxSize = 8, focus = null }: Props = $props()

  const TILES = 64
  const VIEW = 560
  let viewEl: HTMLDivElement | undefined = $state()
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let hover = $state<{ x: number; y: number } | null>(null)
  let dragStart: { x: number; y: number } | null = null
  let panning: { x: number; y: number; px: number; py: number } | null = null
  let loaded = $state(false)
  let failed = $state(false)

  const src = $derived(`/wow/overview?map=${encodeURIComponent(map)}`)
  $effect(() => {
    void src
    loaded = false
    failed = false
  })
  /** Pixels per tile at the current zoom. */
  const scale = $derived((VIEW * zoom) / TILES)

  // Keep the map covering the view.
  function clampPan() {
    const max = 0
    const min = VIEW - VIEW * zoom
    panX = Math.min(max, Math.max(min, panX))
    panY = Math.min(max, Math.max(min, panY))
  }

  function tileAt(e: PointerEvent): { x: number; y: number } | null {
    if (!viewEl) return null
    const r = viewEl.getBoundingClientRect()
    const x = Math.floor((e.clientX - r.left - panX) / scale)
    const y = Math.floor((e.clientY - r.top - panY) / scale)
    if (x < 0 || y < 0 || x >= TILES || y >= TILES) return null
    return { x, y }
  }

  /** The square block covering tiles a and b, no bigger than maxSize, kept on the map. */
  function square(a: { x: number; y: number }, b: { x: number; y: number }): Block {
    const x0 = Math.min(a.x, b.x)
    const y0 = Math.min(a.y, b.y)
    const size = Math.min(maxSize, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + 1)
    return { x: Math.min(x0, TILES - size), y: Math.min(y0, TILES - size), size }
  }

  function down(e: PointerEvent) {
    viewEl?.setPointerCapture(e.pointerId)
    if (e.button !== 0) {
      panning = { x: e.clientX, y: e.clientY, px: panX, py: panY }
      return
    }
    const t = tileAt(e)
    if (!t) return
    dragStart = t
    block = square(t, t)
  }
  function move(e: PointerEvent) {
    if (panning) {
      panX = panning.px + (e.clientX - panning.x)
      panY = panning.py + (e.clientY - panning.y)
      clampPan()
      return
    }
    const t = tileAt(e)
    hover = t
    if (dragStart && t) block = square(dragStart, t)
  }
  function up() {
    dragStart = null
    panning = null
  }
  function wheel(e: WheelEvent) {
    e.preventDefault()
    if (!viewEl) return
    const r = viewEl.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const next = Math.min(6, Math.max(1, zoom * (e.deltaY > 0 ? 0.8 : 1.25)))
    // Zoom about the cursor: the map point under it stays put.
    panX = mx - ((mx - panX) * next) / zoom
    panY = my - ((my - panY) * next) / zoom
    zoom = next
    clampPan()
  }

  /** Centres the view on a tile rect, zoomed so it fills about half the view. */
  function show(r: { x0: number; y0: number; x1: number; y1: number }) {
    const span = Math.max(r.x1 - r.x0, r.y1 - r.y0, 4)
    zoom = Math.min(6, Math.max(1, TILES / (span * 2)))
    const s = (VIEW * zoom) / TILES
    panX = VIEW / 2 - ((r.x0 + r.x1) / 2) * s
    panY = VIEW / 2 - ((r.y0 + r.y1) / 2) * s
    clampPan()
  }
  $effect(() => {
    if (focus) show(focus)
  })

  // With nothing to focus on, the view fits the tiles the map actually has, since a continent sits in
  // the middle of the 64x64 grid with empty space around it.
  $effect(() => {
    const m = map
    if (focus) return
    fetch(`/wow/tiles?map=${encodeURIComponent(m)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Array<{ X: number; Y: number }>>) : []))
      .then((tiles) => {
        if (m !== map || focus || !tiles.length) return
        let x0 = TILES, y0 = TILES, x1 = 0, y1 = 0
        for (const t of tiles) {
          x0 = Math.min(x0, t.X)
          y0 = Math.min(y0, t.Y)
          x1 = Math.max(x1, t.X + 1)
          y1 = Math.max(y1, t.Y + 1)
        }
        const span = Math.max(x1 - x0, y1 - y0)
        zoom = Math.min(6, Math.max(1, (TILES / span) * 0.95))
        const sc = (VIEW * zoom) / TILES
        panX = VIEW / 2 - ((x0 + x1) / 2) * sc
        panY = VIEW / 2 - ((y0 + y1) / 2) * sc
        clampPan()
      })
      .catch(() => {})
  })
</script>

<div class="wrap">
  <div
    class="view"
    bind:this={viewEl}
    role="img"
    aria-label="Map of {map}: drag to pick a square of tiles, scroll to zoom"
    style:width="{VIEW}px"
    style:height="{VIEW}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onpointerleave={() => (hover = null)}
    onwheel={wheel}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="layer" style:transform="translate({panX}px, {panY}px) scale({zoom})">
      <img {src} alt="" draggable="false" width={VIEW} height={VIEW} onload={() => (loaded = true)} onerror={() => (failed = true)} />
      <svg viewBox="0 0 {TILES} {TILES}" width={VIEW} height={VIEW}>
        {#if focus}
          <rect x={focus.x0} y={focus.y0} width={focus.x1 - focus.x0} height={focus.y1 - focus.y0} class="zone" />
        {/if}
        {#if hover && !block}
          <rect x={hover.x} y={hover.y} width="1" height="1" class="hover" />
        {/if}
        {#if block}
          <rect x={block.x} y={block.y} width={block.size} height={block.size} class="block" />
        {/if}
      </svg>
    </div>
    {#if !loaded && !failed}<p class="note">Stitching the map from the client's minimap…</p>{/if}
    {#if failed}<p class="note">No minimap for {map} in the client.</p>{/if}
  </div>
  <p class="dim">
    {#if block}
      Tiles {block.x}–{block.x + block.size - 1} × {block.y}–{block.y + block.size - 1} ({block.size}×{block.size}, {Math.round(block.size * 533.3)} yards across).
    {:else}
      Drag on the map to pick a square of up to {maxSize}×{maxSize} tiles. Scroll to zoom, right-drag to pan.
    {/if}
  </p>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .view {
    position: relative;
    overflow: hidden;
    background: #0d1118;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  img {
    display: block;
    image-rendering: auto;
  }
  svg {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .hover {
    fill: none;
    stroke: #fff;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .block {
    fill: var(--accent);
    fill-opacity: 0.25;
    stroke: #ffb833;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .zone {
    fill: none;
    stroke: #fff;
    stroke-opacity: 0.5;
    stroke-dasharray: 4 3;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .note {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--text-dim);
    pointer-events: none;
  }
  .dim {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
