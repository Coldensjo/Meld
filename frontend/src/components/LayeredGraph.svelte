<script lang="ts" generics="N extends { layer: number; row: number }, E extends { from: number; to: number }">
	import type { Snippet } from 'svelte'

	// A layered graph's drawing (#948, the quest editor's chain view; meant for the node editor of #30
	// too): boxes placed by their layer (a column, left to right) and row (lib/ui/layered.ts lays them
	// out), and arrows between them in an SVG under the boxes. The caller draws each box's content and
	// says each arrow's tone (its colour and head), whether it is dashed, and its tooltip.
	let {
		nodes,
		edges,
		key,
		node,
		edgeTone = () => 'plain',
		edgeDashed = () => false,
		edgeTitle = () => '',
		width = 220,
		height = 100,
		gapX = 56,
		gapY = 18,
	}: {
		nodes: readonly N[]
		edges: readonly E[]
		/** The id an edge's `from` and `to` name. */
		key: (n: N) => number
		node: Snippet<[N]>
		edgeTone?: (e: E) => 'plain' | 'warn' | 'bad'
		edgeDashed?: (e: E) => boolean
		edgeTitle?: (e: E) => string
		width?: number
		height?: number
		gapX?: number
		gapY?: number
	} = $props()

	const TONES = ['plain', 'warn', 'bad'] as const
	/** Keeps two graphs on a page from sharing their markers' ids. */
	const uid = Math.random().toString(36).slice(2, 8)
	const pad = 12
	const at = $derived(new Map(nodes.map((n) => [key(n), { x: pad + n.layer * (width + gapX), y: pad + n.row * (height + gapY) }])))
	const size = $derived({
		w: pad * 2 + (Math.max(0, ...nodes.map((n) => n.layer)) + 1) * (width + gapX) - gapX,
		h: pad * 2 + (Math.max(0, ...nodes.map((n) => n.row)) + 1) * (height + gapY) - gapY,
	})

	/** An arrow's path: from the right of `from` to the left of `to`, or around below when it goes back or within a column. */
	function path(e: E): string {
		const a = at.get(e.from)
		const b = at.get(e.to)
		if (!a || !b) return ''
		if (b.x > a.x) {
			const x1 = a.x + width
			const y1 = a.y + height / 2
			const x2 = b.x - 4
			const y2 = b.y + height / 2
			const dx = (x2 - x1) / 2
			return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
		}
		const x1 = a.x + width / 2
		const y1 = a.y + height
		const x2 = b.x + width / 2
		const y2 = b.y + height + 4
		const low = Math.max(y1, y2) + gapY + 10
		return `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}`
	}
</script>

<div class="graph" style:width="{size.w}px" style:height="{size.h + gapY + 12}px">
	<svg width={size.w} height={size.h + gapY + 12} aria-hidden="true">
		<defs>
			{#each TONES as t (t)}
				<marker id="lg-arrow-{uid}-{t}" class={t} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
					<path d="M0,0 L10,5 L0,10 z" />
				</marker>
			{/each}
		</defs>
		{#each edges as e (`${e.from}>${e.to}`)}
			{@const t = edgeTone(e)}
			<path class="edge {t}" class:dashed={edgeDashed(e)} d={path(e)} marker-end="url(#lg-arrow-{uid}-{t})"><title>{edgeTitle(e)}</title></path>
		{/each}
	</svg>
	{#each nodes as n (key(n))}
		{@const p = at.get(key(n))}
		{#if p}
			<div class="box" style:left="{p.x}px" style:top="{p.y}px" style:width="{width}px" style:height="{height}px">
				{@render node(n)}
			</div>
		{/if}
	{/each}
</div>

<style>
	.graph {
		position: relative;
		flex: none;
	}
	svg {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.edge {
		fill: none;
		stroke: var(--text-dim);
		stroke-width: 1.5;
		pointer-events: stroke;
	}
	.edge.dashed {
		stroke-dasharray: 5 4;
	}
	.edge.warn {
		stroke: var(--warn);
	}
	.edge.bad {
		stroke: var(--danger);
	}
	marker path {
		fill: var(--text-dim);
	}
	marker.warn path {
		fill: var(--warn);
	}
	marker.bad path {
		fill: var(--danger);
	}
	.box {
		position: absolute;
		display: flex;
	}
</style>
