<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'

	// Terrain › Erode (#165): water drops, then thermal passes, over the selected area or the whole map,
	// as one undo step. The dialog stays up while it runs, with its progress and a Cancel that leaves the
	// ground as it was; closing it cancels too.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const o = editor.erode
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
			const done = await e.erodeArea(
				{ density: o.density, passes: o.passes, talus: o.talus, seed: o.seed, mask: o.mask },
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

<Modal title={editor.selection ? 'Erode the selected area' : 'Erode the map'} width={420} onclose={close}>
	<p class="dim">
		Water drops run downhill over {editor.selection ? 'the selected area' : 'the whole map'}, carving gullies and leaving their load where they slow down; then loose ground slides off whatever is still steeper than the talus angle. Run
		it again for deeper gullies, as Gaea chains its erosion passes.
	</p>
	<div class="grid">
		<label for="erode-density" title="Water drops for each cell of the ground (a cell is 4.17 yd); more carves deeper gullies">Water drops</label>
		<span><input id="erode-density" type="number" min="0" max="10" step="0.1" value={o.density} disabled={running} onchange={(e) => (o.density = clamp(num(e), 0, 10))} /> a cell</span>
		<label for="erode-passes" title="Thermal passes after the drops; each moves half of what is too steep">Thermal passes</label>
		<span><input id="erode-passes" type="number" min="0" max="100" step="1" value={o.passes} disabled={running} onchange={(e) => (o.passes = Math.round(clamp(num(e), 0, 100)))} /></span>
		<label for="erode-talus" title="The steepest slope loose ground holds; steeper ground slides down">Talus angle</label>
		<span><input id="erode-talus" type="number" min="5" max="80" step="1" value={o.talus} disabled={running} onchange={(e) => (o.talus = clamp(num(e), 5, 80))} /> °</span>
		<label for="erode-seed" title="Where the drops start; the same seed erodes the same ground the same way">Seed</label>
		<span><input id="erode-seed" type="number" min="1" step="1" value={o.seed} disabled={running} onchange={(e) => (o.seed = Math.max(1, Math.round(clamp(num(e), 1, 2 ** 31))))} /></span>
		<span></span>
		<label class="check" title="Replace the paint mask with where the drops left their load and loose ground slid to, full where a yard or more settled; then Paint › Fill Mask with Paint Texture lays dirt or gravel there">
			<input type="checkbox" checked={o.mask} disabled={running} onchange={(e) => (o.mask = (e.target as HTMLInputElement).checked)} />
			Mask where sediment settled
		</label>
	</div>
	{#if running}
		<div class="bar" role="progressbar" aria-label="Eroding" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
			<div class="fill" style:width="{share * 100}%"></div>
		</div>
		<p class="dim">Eroding… {Math.round(share * 100)}%</p>
	{/if}
	{#snippet actions()}
		<button onclick={close}>Cancel</button>
		<button class="active" disabled={running} onclick={run}>Erode</button>
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
