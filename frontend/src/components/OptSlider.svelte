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
    width: 52px;
    padding: 1px 4px;
    font: 11px var(--mono);
    text-align: right;
  }
  input[type='range'] {
    height: 14px;
  }
</style>
