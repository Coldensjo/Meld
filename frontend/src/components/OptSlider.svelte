<script lang="ts">
	// Compact "label [slider] [value]" control for the options bar.
	interface Props {
		label: string
		value: number
		min: number
		max: number
		step?: number
		digits?: number
		width?: number
		title?: string
	}
	let { label, value = $bindable(), min, max, step = 0.01, digits = 0, width = 90, title }: Props = $props()

	function onNumber(e: Event) {
		const v = parseFloat((e.target as HTMLInputElement).value)
		if (!Number.isNaN(v)) value = Math.min(max, Math.max(min, v))
	}
</script>

<label class="opt" {title}>
	<span>{label}</span>
	<input type="range" {min} {max} {step} bind:value style:width="{width}px" />
	<input class="num" type="number" {min} {max} {step} value={value.toFixed(digits)} onchange={onNumber} />
</label>

<style>
	.opt {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
		color: var(--text-dim);
	}
	.num {
		/* Room for five characters of value; the spin arrows are hidden, since the slider and the arrow keys
		   step it, so the options bar keeps one row. */
		width: 46px;
		padding: 1px 0 1px 4px;
		font: 11px var(--mono);
		text-align: right;
	}
	.num::-webkit-inner-spin-button,
	.num::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}
	.num {
		appearance: textfield;
	}
	input[type='range'] {
		height: 14px;
	}
</style>
