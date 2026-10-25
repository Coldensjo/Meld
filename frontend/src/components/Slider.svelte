<script lang="ts">
	interface Props {
		label: string
		value: number
		min: number
		max: number
		step?: number
		digits?: number
		/** Fires on release (use for undo commits). */
		onchange?: (v: number) => void
		oninput?: (v: number) => void
		onstart?: () => void
	}
	let { label, value = $bindable(), min, max, step = 0.01, digits = 2, onchange, oninput, onstart }: Props = $props()
</script>

<label class="slider">
	<span class="row">
		<span>{label}</span>
		<span class="val">{value.toFixed(digits)}</span>
	</span>
	<input type="range" {min} {max} {step} bind:value onpointerdown={() => onstart?.()} oninput={() => oninput?.(value)} onchange={() => onchange?.(value)} />
</label>

<style>
	.slider {
		display: block;
		margin-bottom: 8px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		color: var(--text-dim);
		font-size: 12px;
	}
	.val {
		font-family: var(--mono);
		color: var(--text);
	}
</style>
