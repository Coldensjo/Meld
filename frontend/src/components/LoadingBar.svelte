<script lang="ts">
	import { onMount } from 'svelte'
	import { readLoad, type LoadBatch } from '../lib/wow/loadProgress'

	// The loading bar along the viewport's top (#159): while reads from the client are outstanding,
	// how many of this batch are done and what was asked for last. The counters are plain module
	// state; they are copied here four times a second, and the bar only shows once a batch has run
	// for DELAY ms, so a single quick read while editing never flickers it.

	const DELAY = 400
	const KINDS: Record<string, string> = { model: 'Models', texture: 'Textures', wmonav: 'Building rooms' }

	const snap: LoadBatch = { started: 0, done: 0, failed: 0, kind: '', path: '', since: 0 }
	let shown = $state<{ done: number; started: number; failed: number; what: string; file: string } | null>(null)

	onMount(() => {
		const timer = setInterval(() => {
			readLoad(snap)
			if (!snap.since || performance.now() - snap.since < DELAY) {
				if (shown) shown = null
				return
			}
			shown = {
				done: snap.done,
				started: snap.started,
				failed: snap.failed,
				what: KINDS[snap.kind] ?? snap.kind,
				// The file's name, without its folder or look query.
				file: snap.path.split('?')[0].split(/[\\/]/).pop() ?? snap.path,
			}
		}, 250)
		return () => clearInterval(timer)
	})
</script>

{#if shown}
	<div class="loading" role="progressbar" aria-label="Loading from the client" aria-valuemin={0} aria-valuemax={shown.started} aria-valuenow={shown.done}>
		<div class="fill" style:width="{(shown.done / Math.max(1, shown.started)) * 100}%"></div>
		<div class="label">
			Loading {shown.done} / {shown.started} · {shown.what} · {shown.file}{#if shown.failed}<span class="failed"> · {shown.failed} failed</span>{/if}
		</div>
	</div>
{/if}

<style>
	.loading {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(255, 255, 255, 0.08);
		pointer-events: none;
		z-index: 5;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.25s linear;
	}
	.label {
		position: absolute;
		top: 6px;
		left: 50%;
		transform: translateX(-50%);
		max-width: 70%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 2px 8px;
		border-radius: 3px;
		font-size: 11px;
		/* The box is dark in both themes, so its text is fixed light: the theme's --text is dark in the light theme (#929). */
		color: rgb(232, 232, 232);
		background: rgba(0, 0, 0, 0.55);
	}
	.failed {
		color: rgb(255, 154, 160);
	}
</style>
