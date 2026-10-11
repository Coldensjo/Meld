<script lang="ts" module>
  /** A block of tiles: its top-left tile and its width in tiles. */
  export interface Block {
    x: number
    y: number
    size: number
  }
</script>

<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity'

  interface Props {
    /** The tiles picked, keyed "x,y". With `interactive`, a click on a tile adds or removes it. */
    picked?: SvelteSet<string>
    /** The block the editor has open, outlined on the map. */
    open?: Block | null
    interactive?: boolean
  }

  let { picked, open = null, interactive = false }: Props = $props()

  const TILES = 64
  // The map's grid lines as one path. Tiles are one unit, so the viewBox is the whole map.
  const GRID = Array.from({ length: TILES + 1 }, (_, i) => `M0 ${i}H${TILES}M${i} 0V${TILES}`).join('')

  let svg: SVGSVGElement | undefined = $state()
  let hover = $state<{ x: number; y: number } | null>(null)

  const pickedTiles = $derived(
    picked
      ? [...picked].map((k) => {
          const [x, y] = k.split(',').map(Number)
          return { x, y, key: k }
        })
      : [],
  )

  // The tile under the pointer, or null off the map.
  function tileAt(e: PointerEvent): { x: number; y: number } | null {
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * TILES)
    const y = Math.floor(((e.clientY - r.top) / r.height) * TILES)
    if (x < 0 || y < 0 || x >= TILES || y >= TILES) return null
    return { x, y }
  }

  function press(e: PointerEvent) {
    if (!interactive || !picked) return
    const t = tileAt(e)
    if (!t) return
    const key = `${t.x},${t.y}`
    if (picked.has(key)) picked.delete(key)
    else picked.add(key)
  }

  function move(e: PointerEvent) {
    hover = interactive ? tileAt(e) : null
  }
</script>

<svg
  bind:this={svg}
  class="minimap"
  class:interactive
  viewBox="0 0 {TILES} {TILES}"
  role="img"
  aria-label="Map of tiles{interactive ? ': click tiles to select them' : ''}"
  onpointerdown={press}
  onpointermove={move}
  onpointerleave={() => (hover = null)}
>
  <path d={GRID} class="lines" />
  {#each pickedTiles as t (t.key)}
    <rect x={t.x} y={t.y} width="1" height="1" class="pick" />
  {/each}
  {#if hover}
    <rect x={hover.x} y={hover.y} width="1" height="1" class="hover" />
  {/if}
  {#if open}
    <rect x={open.x} y={open.y} width={open.size} height={open.size} class="open" />
  {/if}
</svg>

<style>
  .minimap {
    display: block;
    width: 100%;
    max-width: 340px;
    aspect-ratio: 1;
    background: var(--panel);
    border: 1px solid var(--border);
    touch-action: none;
  }
  .minimap.interactive {
    cursor: pointer;
  }
  .lines {
    fill: none;
    stroke: var(--text-dim);
    stroke-opacity: 0.35;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .pick {
    fill: var(--accent);
    fill-opacity: 0.55;
  }
  .hover {
    fill: none;
    stroke: var(--text);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .open {
    fill: none;
    stroke: #ffb833;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
</style>
