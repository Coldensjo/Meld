<script lang="ts">
	import { cssViewport, toCss } from '../lib/ui/uiScale'

	// Developer help: hold F8 and the part of the UI under the cursor is named. Components tag their
	// root elements with data-ui (see svelte.config.js), so the label reads as the component chain
	// ("Dock › DockPanel") followed by the element itself ("button.tab.active").

	const KEY = 'F8'

	let active = $state(false)
	// The pointer, in plain variables: it moves constantly and only matters while F8 is held.
	let lx = 0
	let ly = 0
	let x = $state(0)
	let y = $state(0)
	let box = $state<{ left: number; top: number; width: number; height: number } | null>(null)
	let chain = $state<string[]>([])
	let element = $state('')
	let text = $state('')

	/** "tag.class1.class2", with Svelte's scoping hash classes left out. */
	function describe(el: Element) {
		const classes = [...el.classList].filter((c) => !c.startsWith('svelte-'))
		const id = el.id ? `#${el.id}` : ''
		return el.tagName.toLowerCase() + id + classes.map((c) => `.${c}`).join('')
	}

	function inspect(clientX: number, clientY: number) {
		x = clientX
		y = clientY
		const el = document.elementFromPoint(clientX, clientY)
		if (!el || el.closest('.debug-overlay')) return
		// The rect is in window px; the overlay's left and top are in the zoomed page's CSS px (#372).
		const r = el.getBoundingClientRect()
		box = { left: toCss(r.left), top: toCss(r.top), width: toCss(r.width), height: toCss(r.height) }
		const names: string[] = []
		for (let n: Element | null = el; n; n = n.parentElement) {
			const ui = n.getAttribute('data-ui')
			if (ui && names[0] !== ui) names.unshift(ui)
		}
		chain = names
		element = describe(el)
		const t = (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ') ?? ''
		text = t.length > 40 ? t.slice(0, 40) + '…' : t
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key !== KEY || e.repeat) return
		e.preventDefault()
		active = true
		inspect(lx, ly)
	}
	function onKeyUp(e: KeyboardEvent) {
		if (e.key === KEY) active = false
	}
	function onMove(e: MouseEvent) {
		lx = e.clientX
		ly = e.clientY
		if (active) inspect(lx, ly)
	}
	// Losing focus (alt-tab) would leave the overlay stuck on.
	function onBlur() {
		active = false
	}

	// The pointer in the page's CSS px, for the label's position.
	const cx = $derived(toCss(x))
	const cy = $derived(toCss(y))
	const flipX = $derived(cx > cssViewport().w - 320)
	const flipY = $derived(cy > cssViewport().h - 90)
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onmousemove={onMove} onblur={onBlur} />

{#if active}
	<div class="debug-overlay">
		{#if box}
			<div class="box" style:left="{box.left}px" style:top="{box.top}px" style:width="{box.width}px" style:height="{box.height}px"></div>
		{/if}
		<div class="label" style:left="{flipX ? cx - 316 : cx + 14}px" style:top="{flipY ? cy - 80 : cy + 14}px">
			<div class="chain">{chain.length ? chain.join(' › ') : '(no component)'}</div>
			<div class="el">{element}</div>
			{#if text}<div class="text">“{text}”</div>{/if}
			{#if box}<div class="size">{Math.round(box.width)} × {Math.round(box.height)} px</div>{/if}
		</div>
	</div>
{/if}

<style>
	.debug-overlay {
		position: fixed;
		inset: 0;
		pointer-events: none;
		z-index: 10000;
	}
	.box {
		position: fixed;
		outline: 2px solid #ff4fd8;
		outline-offset: -1px;
		background: rgba(255, 79, 216, 0.12);
		border-radius: 2px;
	}
	.label {
		position: fixed;
		max-width: 300px;
		padding: 6px 8px;
		background: rgba(20, 20, 20, 0.95);
		border: 1px solid #ff4fd8;
		border-radius: 4px;
		font: 11px/1.4 var(--mono);
		color: #eee;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}
	.chain {
		color: #ff9ae8;
		font-weight: 600;
	}
	.el {
		color: #8fd3ff;
		word-break: break-all;
	}
	.text,
	.size {
		color: #999;
	}
</style>
