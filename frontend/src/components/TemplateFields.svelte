<script lang="ts">
	import type { vmangos } from '../../wailsjs/go/models'
	import { withBit, type CreatureField } from '../lib/world/creatureFields'
	import AuraField from './AuraField.svelte'
	import RefField from './RefField.svelte'

	// A group of a template's columns as the creature and game object editors show them: a checkbox
	// list for flags, a checkbox for a 0/1 column, a select where the numbers have names, a picker for a
	// number that names a thing (RefField), a text area for long text, else a text or number input by
	// the column's kind, held to the column's range. A changed column shows in the accent colour, and
	// each label's tooltip names its column.

	interface Props {
		fields: CreatureField[]
		values: Record<string, string>
		/** The table's columns by name, for each input's kind and length. */
		columns: Map<string, vmangos.TemplateColumn>
		/** The changed columns' values. */
		changes: Record<string, string>
		onset: (col: string, value: string) => void
		/** The grid's columns (3). */
		cols?: number
	}
	let { fields, values, columns, changes, onset, cols = 3 }: Props = $props()

	const value = (f: CreatureField) => values[f.col] ?? ''
	const tip = (f: CreatureField) => (f.hint ? `${f.hint} (${f.col})` : f.col)
	/** A whole number column's range for the input, when it has one. */
	const range = (c: vmangos.TemplateColumn | undefined) => (c && (c.min !== 0 || c.max !== 0) ? { min: String(c.min), max: String(c.max) } : { min: c?.kind === 'uint' ? '0' : undefined, max: undefined })
</script>

<div class="grid" style:grid-template-columns="repeat({cols}, 1fr)">
	{#each fields as f (f.col)}
		{@const c = columns.get(f.col)}
		{@const changed = changes[f.col] !== undefined}
		{#if f.ref}
			<RefField {f} value={value(f)} {changed} onset={(v) => onset(f.col, v)} />
		{:else if f.spells}
			<AuraField {f} value={value(f)} {changed} onset={(v) => onset(f.col, v)} />
		{:else if f.long}
			<label class="wide" class:changed title={tip(f)}
				>{f.label}
				<textarea rows="4" value={value(f)} oninput={(e) => onset(f.col, (e.currentTarget as HTMLTextAreaElement).value)}></textarea></label
			>
		{:else if f.flags}
			<fieldset class="wide" class:changed title={f.col}>
				<legend>{f.label}</legend>
				{#each f.flags as [bit, name] (bit)}
					<label class="check"><input type="checkbox" checked={((Number(value(f)) || 0) & bit) !== 0} onchange={(e) => onset(f.col, withBit(value(f), bit, (e.currentTarget as HTMLInputElement).checked))} /> {name}</label>
				{/each}
			</fieldset>
		{:else if f.bool}
			<label class="check" class:changed title={tip(f)}><input type="checkbox" checked={value(f) !== '0' && value(f) !== ''} onchange={(e) => onset(f.col, (e.currentTarget as HTMLInputElement).checked ? '1' : '0')} /> {f.label}</label>
		{:else if f.options}
			<label class:changed title={tip(f)}
				>{f.label}
				<select value={value(f)} onchange={(e) => onset(f.col, (e.currentTarget as HTMLSelectElement).value)}>
					{#if !f.options.some(([v]) => String(v) === value(f))}<option value={value(f)}>{value(f)}</option>{/if}
					{#each f.options as [v, name] (v)}<option value={String(v)}>{name}</option>{/each}
				</select></label
			>
		{:else}
			<label class:changed class:wide={f.wide || (c?.kind === 'text' && (c.maxLen === 0 || c.maxLen > 64))} title={tip(f)}
				><span>{f.label}{#if f.note && f.note(value(f))}<span class="note">· {f.note(value(f))}</span>{/if}</span>
				<input
					type={c?.kind === 'text' ? 'text' : 'number'}
					step={c?.kind === 'float' ? 'any' : '1'}
					min={range(c).min}
					max={range(c).max}
					maxlength={c?.kind === 'text' && c.maxLen ? c.maxLen : undefined}
					value={value(f)}
					oninput={(e) => onset(f.col, (e.currentTarget as HTMLInputElement).value)}
				/></label
			>
		{/if}
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px 10px;
		font-size: 12px;
	}
	.grid label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text-dim);
		min-width: 0;
	}
	.grid input,
	.grid select,
	.grid textarea {
		width: 100%;
		min-width: 0;
	}
	.grid .wide {
		grid-column: 1 / -1;
	}
	.grid textarea {
		resize: vertical;
		font: inherit;
		color: var(--text);
	}
	.note {
		margin-left: 4px;
		color: var(--text);
	}
	.grid input[type='checkbox'] {
		width: auto;
		flex: none;
		margin: 0;
	}
	.grid label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	fieldset {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px 10px;
		margin: 0;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	legend {
		color: var(--text-dim);
		padding: 0 4px;
	}
	.changed,
	.changed input,
	.changed select,
	.changed textarea {
		color: var(--accent);
	}
	.changed input,
	.changed select,
	.changed textarea {
		border-color: var(--accent);
	}
</style>
