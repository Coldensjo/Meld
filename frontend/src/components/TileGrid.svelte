<script lang="ts">
	import { MAP_TILES } from '../lib/wow/format'
	import { MAX_WORLD_TILES, boundingSquare, editTiles, gridTile, tileOf, type TileOp, type TileSquare } from '../lib/terrain/tileMask'

	// The client's 64×64 tile grid, on which a map made for the client picks its tiles (#46), as Noggit
	// Red's map creation wizard: a click adds a tile, Ctrl+click takes one away and Shift+click adds the
	// 3×3 round it; a drag goes on doing the same. The tiles fit in a square of MAX_WORLD_TILES a side,
	// with `keep` (the square a map has already, which can't shrink). `onchange` gets the tiles once the
	// press is over, so a drag is one change.

	interface Props {
		tiles: ReadonlySet<number>
		onchange: (tiles: Set<number>) => void
		keep?: TileSquare | null
		/** Pixels a tile. */
		cell?: number
	}
	let { tiles, onchange, keep = null, cell = 6 }: Props = $props()

	const px = $derived(MAP_TILES * cell)
	let canvas = $state<HTMLCanvasElement>()
	/** The tiles while a press goes on, null otherwise. */
	let draft = $state<Set<number> | null>(null)
	let op: TileOp = 'add'
	let last = -1
	let hover = $state<{ x: number; y: number } | null>(null)
	let note = $state('')
	const shown = $derived(draft ?? tiles)
	const square = $derived(boundingSquare(shown, keep))

	function tileAt(e: PointerEvent): { x: number; y: number } | null {
		const r = canvas!.getBoundingClientRect()
		const x = Math.floor(((e.clientX - r.left) / r.width) * MAP_TILES)
		const y = Math.floor(((e.clientY - r.top) / r.height) * MAP_TILES)
		return x >= 0 && y >= 0 && x < MAP_TILES && y < MAP_TILES ? { x, y } : null
	}

	function apply(t: { x: number; y: number }) {
		const id = gridTile(t.x, t.y)
		if (id === last) return
		last = id
		const res = editTiles(draft ?? tiles, t.x, t.y, op, keep, MAX_WORLD_TILES)
		if ('error' in res) note = res.error
		else {
			note = ''
			draft = res.tiles
		}
	}

	function down(e: PointerEvent) {
		if (e.button !== 0) return
		const t = tileAt(e)
		if (!t) return
		op = e.ctrlKey || e.metaKey ? 'remove' : e.shiftKey ? 'add3' : 'add'
		last = -1
		draft = new Set(tiles)
		// A synthetic press (a probe) has no live pointer to capture.
		try {
			canvas!.setPointerCapture(e.pointerId)
		} catch {
			/* the press still works, only without capture */
		}
		apply(t)
	}

	function move(e: PointerEvent) {
		const t = tileAt(e)
		hover = t
		if (draft && t) apply(t)
	}

	function up() {
		if (!draft) return
		const next = draft
		draft = null
		const same = next.size === tiles.size && [...next].every((id) => tiles.has(id))
		if (!same) onchange(next)
	}

	$effect(() => {
		const c = canvas
		if (!c) return
		const ctx = c.getContext('2d')
		if (!ctx) return
		const css = getComputedStyle(c)
		const accent = css.getPropertyValue('--accent-2').trim() || '#4b9cf5'
		const dim = css.getPropertyValue('--border').trim() || '#3a3a3a'
		c.width = c.height = px
		ctx.fillStyle = '#16181c'
		ctx.fillRect(0, 0, px, px)
		// A faint line every tile, a stronger one every eight, and the world's middle.
		ctx.fillStyle = 'rgba(255,255,255,0.04)'
		for (let i = 1; i < MAP_TILES; i++) {
			ctx.fillRect(i * cell, 0, 1, px)
			ctx.fillRect(0, i * cell, px, 1)
		}
		ctx.fillStyle = dim
		for (let i = 8; i < MAP_TILES; i += 8) {
			ctx.fillRect(i * cell, 0, 1, px)
			ctx.fillRect(0, i * cell, px, 1)
		}
		ctx.fillStyle = accent
		for (const id of shown) {
			const t = tileOf(id)
			ctx.fillRect(t.x * cell + 1, t.y * cell + 1, cell - 1, cell - 1)
		}
		const sq = square
		if (sq) {
			ctx.strokeStyle = 'rgba(255,255,255,0.7)'
			ctx.lineWidth = 1
			ctx.strokeRect(sq.x * cell + 0.5, sq.y * cell + 0.5, sq.size * cell, sq.size * cell)
		}
		if (keep) {
			ctx.setLineDash([2, 2])
			ctx.strokeStyle = 'rgba(255,255,255,0.45)'
			ctx.strokeRect(keep.x * cell + 0.5, keep.y * cell + 0.5, keep.size * cell, keep.size * cell)
			ctx.setLineDash([])
		}
		const h = hover
		if (h) {
			ctx.strokeStyle = '#ffffff'
			ctx.strokeRect(h.x * cell + 0.5, h.y * cell + 0.5, cell, cell)
		}
	})
</script>

<div class="tilegrid" data-tilegrid>
	<canvas
		bind:this={canvas}
		style:width="{px}px"
		style:height="{px}px"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onpointerleave={() => (hover = null)}
		title="Click adds a tile, Ctrl+click takes one away, Shift+click adds the 3×3 round it; drag to go on"
	></canvas>
	<div class="readout">
		<span>{shown.size} {shown.size === 1 ? 'tile' : 'tiles'}{square ? ` in ${square.size}×${square.size} from ${square.x}, ${square.y}` : ''}</span>
		<span class="dim">{hover ? `Tile ${hover.x}, ${hover.y}` : ''}</span>
	</div>
	{#if note}<p class="warn">{note}</p>{/if}
</div>

<style>
	.tilegrid {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	canvas {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		cursor: crosshair;
		touch-action: none;
		image-rendering: pixelated;
	}
	.readout {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
	}
	.dim {
		color: var(--text-dim);
	}
	.warn {
		margin: 0;
		color: var(--danger-text);
		font-size: 11px;
	}
</style>
