<script lang="ts">
	import { tick } from 'svelte'
	import { ui } from '../lib/state/editor.svelte'
	import { focusMenuEdge, menuMoveFocus } from '../lib/ui/menuKeys'
	import { cssViewport, toCss } from '../lib/ui/uiScale'

	// The viewport's right-click menu: a plain right-click (no orbit drag) on a creature, an object
	// of the region or a placed model opens it with what can be done to that thing. It closes on a
	// pick, a click elsewhere or Escape. It takes the focus on its first item when it opens (#370):
	// Up/Down/Home/End move between the items, Escape and Tab close it and give the focus back to what
	// held it, and keys pressed in it stop there, so the map's hotkeys don't fire meanwhile.

	const close = () => (ui.contextMenu = null)
	let el = $state<HTMLDivElement | undefined>()
	/** What held the focus before the menu opened, for Escape and Tab to go back to. */
	let back: HTMLElement | null = null

	$effect(() => {
		const m = ui.contextMenu
		if (!m) return
		const active = document.activeElement
		if (!el?.contains(active)) back = active instanceof HTMLElement && active !== document.body ? active : null
		tick().then(() => {
			if (ui.contextMenu === m && !el?.contains(document.activeElement)) focusMenuEdge(el) || el?.focus()
		})
	})

	// Keep the menu on screen when opened near the right or bottom edge. `m` is in window px (a
	// pointer's position), `left` and `top` in the zoomed page's CSS px (#372).
	const style = $derived.by(() => {
		const m = ui.contextMenu
		if (!m) return ''
		const w = el?.offsetWidth ?? 220
		const h = el?.offsetHeight ?? 120
		const vp = cssViewport()
		const x = Math.min(toCss(m.x), vp.w - w - 8)
		const y = Math.min(toCss(m.y), vp.h - h - 8)
		return `left:${Math.max(0, x)}px;top:${Math.max(0, y)}px`
	})

	function onWindowDown(e: PointerEvent) {
		if (el && !el.contains(e.target as Node)) close()
	}

	/** Closes the menu and puts the focus back where it was before it opened. */
	function closeBack() {
		const to = back
		back = null
		close()
		if (to?.isConnected) to.focus({ preventScroll: true })
		else (document.activeElement as HTMLElement | null)?.blur?.()
	}

	function onMenuKey(e: KeyboardEvent) {
		e.stopPropagation()
		if (e.ctrlKey || e.altKey || e.metaKey) return
		if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault()
			closeBack()
		} else if (el && menuMoveFocus(el, e.key)) e.preventDefault()
	}
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={(e) => ui.contextMenu && e.key === 'Escape' && close()} onblur={close} />

{#if ui.contextMenu}
	<div class="menu" role="menu" tabindex="-1" aria-label={ui.contextMenu.title ?? 'Context menu'} bind:this={el} {style} oncontextmenu={(e) => e.preventDefault()} onkeydown={onMenuKey}>
		{#if ui.contextMenu.title}<div class="title">{ui.contextMenu.title}</div>{/if}
		{#each ui.contextMenu.items as it, i (i)}
			{#if it.separator}
				<div class="sep"></div>
			{:else}
				<button
					class="item"
					class:danger={it.danger}
					role="menuitem"
					tabindex="-1"
					disabled={it.disabled}
					onclick={() => {
						close()
						it.run?.()
					}}
				>
					<span class="label">{it.label}</span>
					{#if it.shortcut}<span class="sc">{it.shortcut}</span>{/if}
				</button>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.menu {
		position: fixed;
		z-index: 180;
		min-width: 200px;
		padding: 4px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		font-size: 12px;
	}
	.menu:focus {
		outline: none;
	}
	.title {
		padding: 4px 8px 6px;
		color: var(--text-dim);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 320px;
	}
	.sep {
		height: 1px;
		margin: 4px 6px;
		background: var(--border);
	}
	.item {
		display: flex;
		align-items: center;
		width: 100%;
		gap: 12px;
		border: none;
		background: transparent;
		padding: 5px 8px;
		border-radius: 4px;
		text-align: left;
	}
	.item .label {
		flex: 1;
	}
	.item .sc {
		color: var(--text-dim);
		font-family: var(--mono);
		font-size: 11px;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--accent);
		color: var(--accent-ink);
		outline: none;
	}
	.item:hover:not(:disabled) .sc,
	.item:focus-visible .sc {
		color: var(--accent-ink);
	}
	.item.danger:hover:not(:disabled),
	.item.danger:focus-visible {
		background: var(--danger);
		color: var(--accent-ink);
	}
	.item:disabled {
		opacity: 0.45;
	}
</style>
