<script lang="ts">
	// A numeric property field: a label and a number box. Dragging the label sideways scrubs the
	// value (Shift for 10× steps), like Blender's and Unity's fields; typing a number sets it exactly.
	// `onstart` fires before the first change of a scrub or an edit, `oninput` on every live change
	// and `onchange` once at the end, so a scrub can preview live and commit one undo step.
	interface Props {
		label: string
		value: number
		step?: number
		digits?: number
		min?: number
		max?: number
		unit?: string
		title?: string
		onstart?: () => void
		oninput?: (v: number) => void
		onchange?: (v: number) => void
	}
	let { label, value, step = 0.1, digits = 1, min = -Infinity, max = Infinity, unit = '', title, onstart, oninput, onchange }: Props = $props()

	const clamp = (v: number) => Math.min(max, Math.max(min, v))

	function scrub(e: PointerEvent) {
		if (e.button !== 0) return
		const el = e.currentTarget as HTMLElement
		const startX = e.clientX
		const start = value
		let moved = false
		el.setPointerCapture(e.pointerId)
		const move = (ev: PointerEvent) => {
			const dx = ev.clientX - startX
			if (!moved) {
				if (Math.abs(dx) < 2) return
				moved = true
				onstart?.()
			}
			const v = clamp(start + dx * step * (ev.shiftKey ? 10 : 1))
			oninput?.(Number(v.toFixed(Math.max(digits, 2))))
		}
		const up = (ev: PointerEvent) => {
			el.removeEventListener('pointermove', move)
			el.removeEventListener('pointerup', up)
			el.removeEventListener('pointercancel', up)
			if (!moved) return
			const dx = ev.clientX - startX
			onchange?.(Number(clamp(start + dx * step * (ev.shiftKey ? 10 : 1)).toFixed(Math.max(digits, 2))))
		}
		el.addEventListener('pointermove', move)
		el.addEventListener('pointerup', up)
		el.addEventListener('pointercancel', up)
	}

	function typed(e: Event) {
		const input = e.target as HTMLInputElement
		const v = parseFloat(input.value)
		if (Number.isNaN(v)) {
			input.value = value.toFixed(digits)
			return
		}
		onstart?.()
		onchange?.(clamp(v))
	}
</script>

<label class="field" {title}>
	<span class="label" role="slider" tabindex="-1" aria-valuenow={value} aria-label={label} onpointerdown={scrub} title={title ? `${title}. Drag to change.` : 'Drag to change'}>{label}</span>
	<input type="number" {step} value={value.toFixed(digits)} onchange={typed} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
	{#if unit}<span class="unit">{unit}</span>{/if}
</label>

<style>
	.field {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
	}
	.label {
		width: 58px;
		flex: none;
		color: var(--text-dim);
		font-size: 11px;
		cursor: ew-resize;
		user-select: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label:hover {
		color: var(--text);
	}
	input {
		flex: 1;
		min-width: 0;
		width: 0;
		padding: 2px 4px;
		font: 11px var(--mono);
		text-align: right;
	}
	.unit {
		width: 14px;
		flex: none;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
