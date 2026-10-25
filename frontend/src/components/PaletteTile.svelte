<script lang="ts">
	import { requestThumb } from '../lib/wow/thumbs'

	interface Props {
		thumbKey: string
		label: string
		title: string
		active?: boolean
		badge?: string
		/** Tile width in px (the image is square). */
		size?: number
		onclick: () => void
		onhover?: (over: boolean) => void
		/** A favourite: a star in the corner. */
		starred?: boolean
		/** A right-click on the tile toggles the favourite, unless the tile has a menu. */
		onstar?: () => void
		/** A right-click on the tile opens this menu (the asset browser's: favourite and model sets). */
		onmenu?: (e: MouseEvent) => void
		/** The name under the picture; off, the tile is only the picture and the name is in its tooltip (#655). */
		showLabel?: boolean
	}
	let { thumbKey, label, title, active = false, badge, size, onclick, onhover, starred = false, onstar, onmenu, showLabel = true }: Props = $props()

	let url = $state('')
	let failed = $state(false)

	/** The scrolling ancestor the tile is seen in (the grid), else the viewport. */
	function scrollRoot(node: HTMLElement): Element | null {
		for (let el = node.parentElement; el; el = el.parentElement) {
			const o = getComputedStyle(el).overflowY
			if (o === 'auto' || o === 'scroll') return el
		}
		return null
	}

	// Request the thumbnail only while the tile is on screen, the tiles nearest the grid's centre
	// first (the priority is the distance to it, with a little of the tile's x to keep rows in order).
	function lazy(node: HTMLElement, key: string) {
		let cancel: (() => void) | null = null
		let current = key
		const io = new IntersectionObserver(
			(entries) => {
				const e = entries[entries.length - 1]
				const visible = e.isIntersecting
				if (visible && !cancel && !url) {
					const root = e.rootBounds
					const r = e.boundingClientRect
					const dy = root ? (r.top + r.bottom - root.top - root.bottom) / 2 : 0
					cancel = requestThumb(
						current,
						(u) => (url = u),
						() => (failed = true),
						Math.abs(dy) + Math.max(0, r.left) * 1e-4,
					)
				} else if (!visible && cancel && !url) {
					cancel()
					cancel = null
				}
			},
			{ root: scrollRoot(node), rootMargin: '120px' },
		)
		io.observe(node)
		return {
			update(k: string) {
				if (k === current) return
				current = k
				cancel?.()
				cancel = null
				url = ''
				failed = false
				io.unobserve(node)
				io.observe(node)
			},
			destroy() {
				io.disconnect()
				cancel?.()
			},
		}
	}
</script>

<button
	class="tile"
	class:active
	class:failed
	aria-pressed={active}
	title={failed ? `${title} (thumbnail failed)` : title}
	{onclick}
	oncontextmenu={(e) => {
		if (onmenu) {
			e.preventDefault()
			onmenu(e)
			return
		}
		if (!onstar) return
		e.preventDefault()
		onstar()
	}}
	use:lazy={thumbKey}
	style:width={size ? `${size}px` : undefined}
	onpointerenter={() => onhover?.(true)}
	onpointerleave={() => onhover?.(false)}
>
	<div class="img">
		{#if url}
			<img src={url} alt="" draggable="false" />
		{:else if failed}
			<span class="x">✕</span>
		{:else}
			<span class="spin"></span>
		{/if}
		{#if badge}<span class="badge">{badge}</span>{/if}
		{#if starred}<span class="star" aria-label="Favourite">★</span>{/if}
	</div>
	{#if showLabel}<span class="label">{label}</span>{/if}
</button>

<style>
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 3px;
		min-width: 0;
		background: var(--bg);
	}
	.tile:hover:not(:disabled) {
		background: var(--panel-2);
		border-color: var(--accent-2);
	}
	.tile.active {
		border-color: var(--accent);
		background: var(--panel-3);
		color: var(--text);
	}
	/* Models with nothing renderable (pure particle effects) */
	.tile.failed {
		opacity: 0.45;
	}
	.img {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: radial-gradient(circle at 50% 40%, var(--preview-glow), var(--preview-edge) 80%);
		overflow: hidden;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.label {
		width: 100%;
		font-size: 11px;
		line-height: 1.2;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.star {
		position: absolute;
		top: 2px;
		right: 4px;
		font-size: 13px;
		color: var(--warn);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	}
	.badge {
		position: absolute;
		top: 3px;
		left: 3px;
		font: 10px var(--mono);
		background: var(--accent);
		color: var(--accent-ink);
		border-radius: 3px;
		padding: 0 4px;
	}
	.x {
		color: var(--text-dim);
	}
	.spin {
		width: 14px;
		height: 14px;
		border: 2px solid var(--panel-3);
		border-top-color: var(--text-dim);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
