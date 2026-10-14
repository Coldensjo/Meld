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
  import { growableSides, type Side } from '../lib/io/regionGrow'

  interface Props {
    /** The tiles picked, keyed "x,y". With `interactive`, a click on a tile adds or removes it. */
    picked?: SvelteSet<string>
    /** The block the editor has open, outlined on the map. */
    open?: Block | null
    interactive?: boolean
    /** The map's folder name: its overview from the client's minimap is drawn behind the grid. */
    map?: string
    /** With this, a plus on each side of the open block adds the next tiles that way. */
    onextend?: (side: Side) => void
  }

  let { picked, open = null, interactive = false, map = '', onextend }: Props = $props()

  const SIDES: Array<{ side: Side; name: string }> = [
    { side: 'n', name: 'north' },
    { side: 'e', name: 'east' },
    { side: 's', name: 'south' },
    { side: 'w', name: 'west' },
  ]
  const growable = $derived(open && onextend ? growableSides(open) : [])
  /** Where a side's plus sits, as a percentage of the map: the middle of that side of the block. */
  function plusAt(side: Side): { left: number; top: number } {
    const b = open!
    const cx = ((b.x + b.size / 2) / TILES) * 100
    const cy = ((b.y + b.size / 2) / TILES) * 100
    const x0 = (b.x / TILES) * 100
    const x1 = ((b.x + b.size) / TILES) * 100
    const y0 = (b.y / TILES) * 100
    const y1 = ((b.y + b.size) / TILES) * 100
    switch (side) {
      case 'n':
        return { left: cx, top: y0 }
      case 's':
        return { left: cx, top: y1 }
      case 'e':
        return { left: x1, top: cy }
      default:
        return { left: x0, top: cy }
    }
  }

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

<div class="wrap">
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
  {#if map}
    <image href="/wow/overview?map={encodeURIComponent(map)}" x="0" y="0" width={TILES} height={TILES} preserveAspectRatio="none" />
  {/if}
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
{#if open && onextend}
  {#each SIDES.filter((s) => growable.includes(s.side)) as s (s.side)}
    {@const at = plusAt(s.side)}
    <button class="plus {s.side}" style:left="{at.left}%" style:top="{at.top}%" title="Add the tiles to the {s.name} ({open.size + 1}×{open.size + 1} tiles)" aria-label="Add the tiles to the {s.name}" onclick={() => onextend(s.side)}>+</button>
  {/each}
{/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    max-width: 340px;
  }
  .plus {
    position: absolute;
    width: 18px;
    height: 18px;
    padding: 0;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: #ffb833;
    border: 1px solid #000;
    color: #000;
    font: bold 13px/1 var(--font, sans-serif);
    line-height: 16px;
    text-align: center;
    cursor: pointer;
  }
  /* Each plus sits just outside its side, so a one-tile block has them around it like a compass. */
  .plus.n {
    transform: translate(-50%, calc(-100% - 2px));
  }
  .plus.s {
    transform: translate(-50%, 2px);
  }
  .plus.e {
    transform: translate(2px, -50%);
  }
  .plus.w {
    transform: translate(calc(-100% - 2px), -50%);
  }
  .plus:hover {
    background: #ffd27a;
  }
  .minimap {
    display: block;
    width: 100%;
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
