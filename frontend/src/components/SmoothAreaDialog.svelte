<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'

	import type { AreaShapeMode } from '../lib/terrain/smoothArea'

	// Terrain › Smooth Selection (#713): Sculpt › Smooth's kernel over the selected area or the whole map,
	// a number of passes at a strength, as one undo step. Like the Erode dialog it stays up while it runs,
	// with its progress and a Cancel that leaves the ground as it was; closing it cancels too. Its Mode
	// (#721) runs Raise, Lower, Flatten or Roughen over the same area instead, in one pass.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const o = editor.smoothArea
	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)

	const MODES: { id: AreaShapeMode; verb: string; hint: string }[] = [
		{
			id: 'smooth',
			verb: 'Smooth',
			hint: "Runs the Smooth brush's averaging: each pass moves every vertex toward the average of the ground around it. More passes even out wider bumps; a pass at 100% is a tenth of a second of the brush at full strength.",
		},
		{ id: 'raise', verb: 'Raise', hint: 'Lifts the ground by the amount. Without the falloff the area rises as a block, with a cliff at its edge.' },
		{ id: 'lower', verb: 'Lower', hint: 'Sinks the ground by the amount. Without the falloff the area sinks as a block, with a cliff at its edge.' },
		{ id: 'flatten', verb: 'Flatten', hint: "Levels the ground to the area's average height, or to a height you type." },
		{ id: 'roughen', verb: 'Roughen', hint: "Adds the Noise brush's bumps: up to the amplitude up or down, about the bump size across." },
	]
	const mode = $derived(MODES.find((m) => m.id === o.mode) ?? MODES[0])
	const area = $derived(editor.selection ? 'the selected area' : 'the map')

	function pick(m: AreaShapeMode) {
		o.mode = m
		if (m !== 'smooth') o.shape = m
	}

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
				{ ...o },
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

<Modal title="{mode.verb} {area}" width={420} onclose={close}>
	<p class="dim">{mode.hint}</p>
	<div class="grid">
		<label for="smooth-mode" title="What the pass does to the ground in {area}">Mode</label>
		<span>
			<select id="smooth-mode" value={o.mode} disabled={running} onchange={(e) => pick((e.target as HTMLSelectElement).value as AreaShapeMode)}>
				{#each MODES as m (m.id)}
					<option value={m.id}>{m.verb}</option>
				{/each}
			</select>
		</span>
		{#if o.mode === 'smooth'}
			<label for="smooth-strength" title="How far each pass moves a vertex toward the average of its neighbours">Strength</label>
			<span><input id="smooth-strength" type="number" min="1" max="100" step="1" value={Math.round(o.strength * 100)} disabled={running} onchange={(e) => (o.strength = clamp(num(e), 1, 100) / 100)} /> %</span>
			<label for="smooth-passes" title="How many times the averaging runs; each pass reads what the last one left">Passes</label>
			<span><input id="smooth-passes" type="number" min="1" max="500" step="1" value={o.passes} disabled={running} onchange={(e) => (o.passes = Math.round(clamp(num(e), 1, 500)))} /></span>
		{:else if o.mode === 'flatten'}
			<label for="smooth-target" title="The height the ground is levelled to">Flatten to</label>
			<span>
				<select id="smooth-target" value={o.flatten} disabled={running} onchange={(e) => (o.flatten = (e.target as HTMLSelectElement).value as 'average' | 'height')}>
					<option value="average">The area's average</option>
					<option value="height">A height</option>
				</select>
			</span>
			<label for="smooth-height" title="The height in yards">Height</label>
			<span><input id="smooth-height" type="number" min="-2000" max="2000" step="0.5" value={o.height} disabled={running || o.flatten !== 'height'} onchange={(e) => (o.height = clamp(num(e), -2000, 2000))} /> yd</span>
		{:else}
			<label for="smooth-amount" title={o.mode === 'roughen' ? 'How far the bumps reach up or down' : 'How far the ground moves at full strength'}>{o.mode === 'roughen' ? 'Amplitude' : 'Amount'}</label>
			<span><input id="smooth-amount" type="number" min="0.1" max="500" step="0.5" value={o.amount} disabled={running} onchange={(e) => (o.amount = clamp(num(e), 0.1, 500))} /> yd</span>
			{#if o.mode === 'roughen'}
				<label for="smooth-scale" title="About how wide a bump is">Bump size</label>
				<span><input id="smooth-scale" type="number" min="1" max="500" step="1" value={o.scale} disabled={running} onchange={(e) => (o.scale = clamp(num(e), 1, 500))} /> yd</span>
				<label for="smooth-seed" title="Another seed gives other bumps">Seed</label>
				<span><input id="smooth-seed" type="number" min="0" max="99999" step="1" value={o.seed} disabled={running} onchange={(e) => (o.seed = Math.round(clamp(num(e), 0, 99999)))} /></span>
			{/if}
		{/if}
		<span></span>
		<label class="check" title="Fade the pass in from the edge of the selected area, so the changed ground blends into the ground around it">
			<input type="checkbox" checked={o.falloff} disabled={running} onchange={(e) => (o.falloff = (e.target as HTMLInputElement).checked)} />
			Fall off at the edge
		</label>
		<label for="smooth-width" title="How far in from the area's edge the pass reaches full strength">Falloff width</label>
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
		<button class="active" disabled={running} onclick={run}>{mode.verb}</button>
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
