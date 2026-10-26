<script lang="ts">
	import type { vmangos } from '../../wailsjs/go/models'
	import { withBit, type CreatureField } from '../lib/world/creatureFields'
	import { classOfBit } from '../lib/wow/classes'
	import AuraField from './AuraField.svelte'
	import ClassIcon from './ClassIcon.svelte'
	import MoneyField from './MoneyField.svelte'
	import RefField from './RefField.svelte'
	import { TEXT_CODES, insertCode } from '../lib/wow/textCodes'

	// A group of a template's columns as the creature and game object editors show them: a checkbox
	// list for flags, a checkbox for a 0/1 column, gold, silver and copper for money, a select where the numbers have names, a picker for a
	// number that names a thing (RefField), a text area for long text, else a text or number input by
	// the column's kind, held to the column's range (offering `suggest`'s values in a datalist). A changed column shows in the accent colour, and
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
		/** Offer the client's `$` text codes under each text area (quest text). */
		codes?: boolean
		/** The record's entry, which a field's `own` list is numbered by (#700). */
		entry?: number
		/** What the record is, as a field's `own` list names it ("this quest's own"). */
		owner?: string
	}
	let { fields, values, columns, changes, onset, cols = 3, codes = false, entry = 0, owner = 'creature' }: Props = $props()

	/** Inserts a `$` code at the text area's caret, through onset so the change is counted. */
	function addCode(e: MouseEvent, col: string, code: string) {
		const ta = (e.currentTarget as HTMLElement).closest('label')?.querySelector('textarea')
		if (!ta) return
		const r = insertCode(ta.value, ta.selectionStart, ta.selectionEnd, code)
		onset(col, r.value)
		ta.value = r.value
		ta.focus()
		ta.setSelectionRange(r.caret, r.caret)
	}

	const value = (f: CreatureField) => values[f.col] ?? ''
	const tip = (f: CreatureField) => (f.hint ? `${f.hint} (${f.col})` : f.col)
	/** A whole number column's range for the input, when it has one. */
	const range = (c: vmangos.TemplateColumn | undefined) => (c && (c.min !== 0 || c.max !== 0) ? { min: String(c.min), max: String(c.max) } : { min: c?.kind === 'uint' ? '0' : undefined, max: undefined })
</script>

{#snippet select(f: CreatureField)}
	<select value={value(f)} onchange={(e) => onset(f.col, (e.currentTarget as HTMLSelectElement).value)}>
		{#if !f.options?.some(([v]) => String(v) === value(f))}<option value={value(f)}>{value(f)}</option>{/if}
		{#each f.options ?? [] as [v, name] (v)}<option value={String(v)}>{name}</option>{/each}
	</select>
{/snippet}

<div class="grid" style:grid-template-columns="repeat({cols}, 1fr)">
	{#each fields as f (f.col)}
		{@const c = columns.get(f.col)}
		{@const changed = changes[f.col] !== undefined}
		{#if f.ref}
			<RefField {f} value={value(f)} {changed} onset={(v) => onset(f.col, v)} {entry} {owner} />
		{:else if f.spells}
			<AuraField {f} value={value(f)} {changed} onset={(v) => onset(f.col, v)} />
		{:else if f.long}
			<label class="wide" class:changed title={tip(f)}
				>{f.label}
				<textarea rows="4" value={value(f)} oninput={(e) => onset(f.col, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
				{#if codes}
					<span class="codes"
						>Codes:
						{#each TEXT_CODES as t (t.code)}<button type="button" class="code" title="{t.meaning}. Click to insert at the cursor." onclick={(e) => addCode(e, f.col, t.code)}>{t.label}</button>{/each}
						<span class="codemean">{TEXT_CODES.map((t) => `${t.code.slice(0, 2)} ${t.meaning}`).join(', ')}.</span></span
					>
				{/if}</label
			>
		{:else if f.flags}
			<fieldset class="wide" class:changed title={f.col}>
				<legend>{f.label}</legend>
				{#each f.flags as [bit, name] (bit)}
					<label class="check"
						><input type="checkbox" checked={((Number(value(f)) || 0) & bit) !== 0} onchange={(e) => onset(f.col, withBit(value(f), bit, (e.currentTarget as HTMLInputElement).checked))} />{#if f.classes === 'mask'}<ClassIcon
								id={classOfBit(bit)}
							/>{/if}
						{name}</label
					>
				{/each}
			</fieldset>
		{:else if f.money}
			<label class:changed title={tip(f)}
				>{f.label}
				<MoneyField value={Number(value(f)) || 0} signed={f.money === 'signed'} costsHint={f.hint} onset={(v) => onset(f.col, String(v))} /></label
			>
		{:else if f.bool}
			<label class="check" class:changed title={tip(f)}><input type="checkbox" checked={value(f) !== '0' && value(f) !== ''} onchange={(e) => onset(f.col, (e.currentTarget as HTMLInputElement).checked ? '1' : '0')} /> {f.label}</label
			>
		{:else if f.options}
			<label class:changed title={tip(f)}
				>{f.label}
				{#if f.classes === 'id'}
					<!-- A class: the picked one's icon beside the select (#682). -->
					<div class="pick">
						<ClassIcon id={Number(value(f)) || 0} />
						{@render select(f)}
					</div>
				{:else}
					{@render select(f)}
				{/if}</label
			>
		{:else}
			<label class:changed class:wide={f.wide || (c?.kind === 'text' && (c.maxLen === 0 || c.maxLen > 64))} title={tip(f)}
				><span
					>{f.label}{#if f.note && f.note(value(f))}<span class="note">· {f.note(value(f))}</span>{/if}</span
				>
				<input
					type={c?.kind === 'text' ? 'text' : 'number'}
					step={c?.kind === 'float' ? 'any' : '1'}
					min={range(c).min}
					max={range(c).max}
					maxlength={c?.kind === 'text' && c.maxLen ? c.maxLen : undefined}
					list={f.suggest ? `suggest-${f.col}` : undefined}
					value={value(f)}
					oninput={(e) => onset(f.col, (e.currentTarget as HTMLInputElement).value)}
				/>{#if f.suggest}<datalist id="suggest-{f.col}"
						>{#each f.suggest as v (typeof v === 'string' ? v : v[0])}{#if typeof v === 'string'}<option value={v}></option>{:else}<option value={v[0]}>{v[1]}</option>{/if}{/each}</datalist
					>{/if}</label
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
	.codes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		font-size: 11px;
	}
	.code {
		padding: 0 5px;
		font-family: var(--mono);
		font-size: 11px;
	}
	.codemean {
		flex-basis: 100%;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
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
		color: var(--accent-text);
	}
	.changed input,
	.changed select,
	.changed textarea {
		border-color: var(--accent);
	}
</style>
