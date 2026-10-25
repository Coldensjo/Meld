<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'

	// Terrain › Smooth Selection (#713): Sculpt › Smooth's kernel over the selected area or the whole map,
	// a number of passes at a strength, as one undo step. Like the Erode dialog it stays up while it runs,
	// with its progress and a Cancel that leaves the ground as it was; closing it cancels too.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const o = editor.smoothArea
	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

	let running = $state(false)
	let share = $state(0)
	let cancelled = false

	async function run() {
		const e = engineRef.current
		if (!e || running) return
		running = true
		cancelled = false
		share = 0
		try {
			const done = await e.smoothArea(
				{ strength: o.strength, passes: o.passes, falloff: o.falloff, width: o.width },
				(f) => (share = f),
				() => cancelled,
			)
			if (done) onclose()
		} finally {
			running = false
		}
	}

	function close() {
		cancelled = true
		onclose()
	}
</script>

<Modal title={editor.selection ? 'Smooth the selected area' : 'Smooth the map'} width={420} onclose={close}>
	<p class="dim">
		Runs the Smooth brush's averaging over {editor.selection ? 'the selected area' : 'the whole map'}: each pass moves every vertex toward the average of the ground around it. More passes even out wider bumps; a pass at 100% is a tenth
		of a second of the brush at full strength.
	</p>
	<div class="grid">
		<label for="smooth-strength" title="How far each pass moves a vertex toward the average of its neighbours">Strength</label>
		<span><input id="smooth-strength" type="number" min="1" max="100" step="1" value={Math.round(o.strength * 100)} disabled={running} onchange={(e) => (o.strength = clamp(num(e), 1, 100) / 100)} /> %</span>
		<label for="smooth-passes" title="How many times the averaging runs; each pass reads what the last one left">Passes</label>
		<span><input id="smooth-passes" type="number" min="1" max="500" step="1" value={o.passes} disabled={running} onchange={(e) => (o.passes = Math.round(clamp(num(e), 1, 500)))} /></span>
		<span></span>
		<label class="check" title="Fade the smoothing in from the edge of the selected area, so the smoothed ground blends into the ground around it">
			<input type="checkbox" checked={o.falloff} disabled={running} onchange={(e) => (o.falloff = (e.target as HTMLInputElement).checked)} />
			Fall off at the edge
		</label>
		<label for="smooth-width" title="How far in from the area's edge the smoothing reaches full strength">Falloff width</label>
		<span><input id="smooth-width" type="number" min="1" max="500" step="1" value={o.width} disabled={running || !o.falloff} onchange={(e) => (o.width = clamp(num(e), 1, 500))} /> yd</span>
	</div>
	{#if running}
		<div class="bar" role="progressbar" aria-label="Smoothing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
			<div class="fill" style:width="{share * 100}%"></div>
		</div>
		<p class="dim">Smoothing… {Math.round(share * 100)}%</p>
	{/if}
	{#snippet actions()}
		<button onclick={close}>Cancel</button>
		<button class="active" disabled={running} onclick={run}>Smooth</button>
	{/snippet}
</Modal>

<style>
	.grid {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 8px;
		align-items: center;
		margin: 10px 0;
	}
	.grid input[type='number'] {
		width: 64px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.bar {
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
	}
</style>
