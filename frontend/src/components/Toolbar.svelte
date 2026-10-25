<script lang="ts" module>
	import { TOOLS } from '../lib/ui/tools'
	export { TOOLS }

	/** The toolbar's icon sizes, smallest and largest (#128); a button is the icon plus a 16px margin. */
	export const TOOLBAR_ICON_MIN = 16
	export const TOOLBAR_ICON_MAX = 44
</script>

<script lang="ts">
	import { editor, prefs } from '../lib/state/editor.svelte'
	import { toCss } from '../lib/ui/uiScale'
	import { firstKeyOf, keysOf } from '../lib/ui/commands'

	const icon = $derived(Math.min(TOOLBAR_ICON_MAX, Math.max(TOOLBAR_ICON_MIN, Number(prefs.toolbarIcon) || 22)))

	/** The tooltip beside the hovered button (#130): shown after TIP_DELAY, at once when moving on from one. */
	const TIP_DELAY = 300
	/** Its gap to the toolbar, px. */
	const TIP_GAP = 10
	/** The toolbar is at the window's right edge (#654), so its tooltip opens to its left. */
	const right = $derived(prefs.toolbarSide === 'right')
	let tip = $state<{ tool: (typeof TOOLS)[number]; x: number; y: number } | null>(null)
	let timer = 0
	let lastHidden = 0

	function showTip(t: (typeof TOOLS)[number], el: HTMLElement) {
		clearTimeout(timer)
		const place = () => {
			const b = el.getBoundingClientRect()
			const bar = el.closest('nav')!.getBoundingClientRect()
			// Rects are in window px, the tip's left and top in the zoomed page's CSS px (#372).
			tip = { tool: t, x: right ? toCss(bar.left) - TIP_GAP : toCss(bar.right) + TIP_GAP, y: toCss(b.top + b.height / 2) }
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

<nav class="toolbar" class:right style:--icon="{icon}px">
	{#each TOOLS as t (t.id)}
		<button
			class:active={editor.tool === t.id}
			aria-label={t.name}
			aria-pressed={editor.tool === t.id}
			onfocus={(e) => e.currentTarget.matches(':focus-visible') && showTip(t, e.currentTarget)}
			onblur={hideTip}
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
			<span class="key">{firstKeyOf(`tool:${t.id}`)}</span>
		</button>
	{/each}
</nav>

{#if tip}
	<div class="tip" class:right role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px">
		<div class="tip-name">
			{tip.tool.name}
			{#if keysOf(`tool:${tip.tool.id}`)}<kbd>{keysOf(`tool:${tip.tool.id}`)}</kbd>{/if}
		</div>
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
	.toolbar.right {
		border-right: none;
		border-left: 1px solid var(--border);
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
	/* Its right edge at x, beside a toolbar on the right. */
	.tip.right {
		transform: translate(-100%, -50%);
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
