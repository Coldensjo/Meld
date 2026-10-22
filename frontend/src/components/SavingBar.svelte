<script lang="ts">
	import { ui } from '../lib/state/editor.svelte'

	// The Saving bar in the middle of the window (#343): while any save runs (the map, a compile, a
	// publish, the spawns, the database editors' Save buttons; `lib/state/saving.ts`), what is being
	// saved over a moving stripe. The bindings report no progress, so the bar has no percentage; a
	// publish's log lines show under it. It shows once a save has run for DELAY ms, so a quick save
	// doesn't flash it, and it takes no clicks, so the dialogs under it (the quit dialog) still work.

	const DELAY = 400

	let shown = $state(false)

	$effect(() => {
		if (!ui.saving) {
			shown = false
			return
		}
		if (shown) return
		const timer = setTimeout(() => (shown = true), DELAY)
		return () => clearTimeout(timer)
	})
</script>

{#if shown && ui.saving}
	<div class="saving" role="progressbar" aria-label={ui.saving} aria-busy="true">
		<div class="title">{ui.saving}…</div>
		<div class="track"><div class="stripe"></div></div>
		{#if ui.savingDetail}<div class="detail">{ui.savingDetail}</div>{/if}
	</div>
{/if}

<style>
	.saving {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 320px;
		max-width: calc(80 * var(--vw));
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		pointer-events: none;
		/* Above the full-screen editors and Modal (200), below the tooltips (1000). */
		z-index: 900;
	}
	.title {
		margin-bottom: 8px;
		font-size: 12px;
		color: var(--text);
	}
	.track {
		position: relative;
		height: 4px;
		overflow: hidden;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
	}
	.stripe {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 30%;
		background: var(--accent);
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			left: -30%;
		}
		to {
			left: 100%;
		}
	}
	/* No moving stripe for reduced motion: a still, dimmer bar says the save is running. */
	@media (prefers-reduced-motion: reduce) {
		.stripe {
			left: 0;
			width: 100%;
			opacity: 0.5;
			animation: none;
		}
	}
	.detail {
		margin-top: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
