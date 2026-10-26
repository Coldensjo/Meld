<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { ReadCreatureSpells, SaveCreatureSpells } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { CAST_FLAGS, CAST_TARGETS, SELECT_FLAGS, castTarget, paramKind, spellLabel } from '../lib/wow/creatureSpellNames'
	import { spellRef } from '../lib/wow/spells'
	import { RowList, moveRow, removeRow } from '../lib/ui/rowList.svelte'
	import RefField from './RefField.svelte'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'

	// The creature editor's Spells tab (#243): the spells the creature casts in combat, its
	// creature_spells list (creature_template.spell_list_id), edited as a list and saved with Save
	// spells, like the Shop (the world database keeps no undo). Spells are found by name or ID in the
	// client's Spell.dbc, with their icons and text. A list other creatures share is copied on save, so
	// theirs stays as it is; a creature with no list gets one.

	/** The most spells a creature_spells row holds. */
	const SLOTS = 8

	let { entry, onsaved, dirty = $bindable(false) }: { entry: number; onsaved: (listId: number) => void; dirty?: boolean } = $props()

	let list = $state<vmangos.CreatureSpells | null>(null)
	const rows = new RowList<vmangos.CreatureSpell[]>({
		empty: [],
		read: async () => {
			const c = await ReadCreatureSpells(entry)
			list = c
			// Plain objects, which the state proxies (a class instance it would not), so an edit in place shows and counts.
			return (c.spells ?? []).map((s): vmangos.CreatureSpell => ({ ...s }))
		},
	})
	rows.follow(() => entry)
	$effect(() => {
		dirty = rows.dirty
	})

	/** The client's spells by ID, for the list's names, icons and text. */
	let refs = $state<Record<number, vmangos.SpellRef | null>>({})

	// Every spell in the list gets its name, icon and text from the client.
	const asked = new Set<number>()
	$effect(() => {
		for (const s of rows.rows) {
			const id = s.spell
			if (asked.has(id)) continue
			asked.add(id)
			void spellRef(id).then((r) => (refs[id] = r))
		}
	})

	/** Drops the unsaved spells (the tab's Revert, the editor's Discard). */
	export function revert() {
		void rows.revert()
	}

	function save() {
		void rows.save("Saving the creature's spells", async (spells) => {
			const r = await SaveCreatureSpells(entry, spells)
			const before = list?.listId ?? 0
			rows.markSaved()
			if (r.listId !== before) onsaved(r.listId)
			const n = spells.length
			await rows.load()
			const what = n ? `${n} ${n === 1 ? 'spell' : 'spells'} in list ${r.listId}` : 'no spells'
			setStatus(`Saved the spells of creature ${entry} (${what}). Restart the world server to see it in the game.`, 10000)
		})
	}

	function num(v: string, max: number): number {
		const n = Math.floor(Number(v))
		return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0
	}

	/** A new target: parameters it doesn't use go back to 0, which the server wants. */
	function setTarget(s: vmangos.CreatureSpell, id: number) {
		s.castTarget = id
		const p = castTarget(id).params
		if (!p[0]) s.targetParam1 = 0
		if (!p[1]) s.targetParam2 = 0
	}

	function setFlag(s: vmangos.CreatureSpell, bit: number, on: boolean) {
		s.castFlags = on ? s.castFlags | bit : s.castFlags & ~bit
	}

	/** The least of a delay pair, keeping the most at least as large (the server skips a spell otherwise). */
	function setMin(s: vmangos.CreatureSpell, which: 'initial' | 'repeat', v: number) {
		if (which === 'initial') {
			s.initialMin = v
			if (s.initialMax < v) s.initialMax = v
		} else {
			s.repeatMin = v
			if (s.repeatMax < v) s.repeatMax = v
		}
	}
	function setMax(s: vmangos.CreatureSpell, which: 'initial' | 'repeat', v: number) {
		if (which === 'initial') {
			s.initialMax = v
			if (s.initialMin > v) s.initialMin = v
		} else {
			s.repeatMax = v
			if (s.repeatMin > v) s.repeatMin = v
		}
	}

	/** Every select flag the list names, to show the bits it doesn't. */
	const SELECT_MASK = SELECT_FLAGS.reduce((m, f) => m | f.bit, 0)

	const flagCount = (f: number) => CAST_FLAGS.filter((c) => f & c.bit).length

	/** Adds a spell the picker (#340) found, with the usual timings. */
	function add(r: vmangos.SpellRef) {
		if (rows.rows.length >= SLOTS) {
			setStatus(`A creature casts at most ${SLOTS} spells from its list.`, 4000)
			return
		}
		refs[r.id] = r
		asked.add(r.id)
		rows.rows = [...rows.rows, { spell: r.id, probability: 100, castTarget: 1, targetParam1: 0, targetParam2: 0, castFlags: 0, initialMin: 5, initialMax: 10, repeatMin: 10, repeatMax: 20, scriptId: 0 }]
	}
</script>

<div class="spells">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}

	<div class="head">
		<h3>Casts in combat{rows.rows.length ? ` (${rows.rows.length} of ${SLOTS})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save spells' : 'Saved'}</button>
	</div>
	{#if list && list.listId > 0 && list.shared > 1}
		<p class="warn">Spell list {list.listId} is shared with {list.shared - 1} other {list.shared === 2 ? 'creature' : 'creatures'}. Saving gives this creature its own copy and leaves theirs as they are.</p>
	{:else if list && list.listId > 0}
		<p class="dim">Spell list {list.listId}{list.name ? `, ${list.name}` : ''}.</p>
	{/if}
	{#if rows.loading}
		<p class="dim">Loading the spells…</p>
	{:else if rows.rows.length === 0}
		<p class="dim">No spells yet. Find spells below and click one to add it; saving gives the creature a spell list.</p>
	{:else}
		<ol class="list">
			{#each rows.rows as s, i (i)}
				{@const ref = refs[s.spell]}
				{@const target = castTarget(s.castTarget)}
				<li>
					<div class="title" use:idMenu={{ ids: [idOf('spell', s.spell)], name: ref?.name }}>
						<SpellIcon icon={ref?.icon ?? ''} size={28} />
						<div class="name">
							<span>{ref ? spellLabel(ref.name, ref.rank) : ref === null ? spellLabel('', '') : '…'}</span>
							<span class="dim">{s.spell}</span>
						</div>
						<div class="row-actions">
							<button title="Move up" disabled={i === 0} onclick={() => (rows.rows = moveRow(rows.rows, i, -1))}>↑</button>
							<button title="Move down" disabled={i === rows.rows.length - 1} onclick={() => (rows.rows = moveRow(rows.rows, i, 1))}>↓</button>
							<button title="Remove" onclick={() => (rows.rows = removeRow(rows.rows, i))}>✕</button>
						</div>
					</div>
					{#if ref?.text}<p class="text">{ref.text}</p>{/if}
					<div class="grid">
						<label title="The chance it casts the spell when its timer is up"
							>Chance (%) <input type="number" min="1" max="100" value={s.probability} oninput={(e) => (s.probability = Math.max(1, num(e.currentTarget.value, 100)))} /></label
						>
						<label class="wide"
							>Cast at
							<select value={s.castTarget} onchange={(e) => setTarget(s, Number(e.currentTarget.value))}>
								{#each CAST_TARGETS as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
								{#if !CAST_TARGETS.some((t) => t.id === s.castTarget)}<option value={s.castTarget}>{target.name}</option>{/if}
							</select>
						</label>
						{#if target.params[0]}{@render param(s, 'targetParam1', target.params[0])}{/if}
						{#if target.params[1]}{@render param(s, 'targetParam2', target.params[1])}{/if}
						<label title="Seconds after the fight starts, a random time from the first to the second"
							>First cast (s)
							<span class="pair"
								><input type="number" min="0" max="65535" value={s.initialMin} onchange={(e) => setMin(s, 'initial', num(e.currentTarget.value, 65535))} /> to
								<input type="number" min="0" max="65535" value={s.initialMax} onchange={(e) => setMax(s, 'initial', num(e.currentTarget.value, 65535))} /></span
							>
						</label>
						<label title="Seconds between casts, a random time from the first to the second"
							>Then every (s)
							<span class="pair"
								><input type="number" min="0" max="65535" value={s.repeatMin} onchange={(e) => setMin(s, 'repeat', num(e.currentTarget.value, 65535))} /> to
								<input type="number" min="0" max="65535" value={s.repeatMax} onchange={(e) => setMax(s, 'repeat', num(e.currentTarget.value, 65535))} /></span
							>
						</label>
					</div>
					<details>
						<summary>Conditions and flags{flagCount(s.castFlags) ? ` (${flagCount(s.castFlags)} set)` : ''}{s.scriptId ? ` · runs script ${s.scriptId}` : ''}</summary>
						<div class="flags">
							{#each CAST_FLAGS as f (f.bit)}
								<label title={f.hint}><input type="checkbox" checked={(s.castFlags & f.bit) !== 0} onchange={(e) => setFlag(s, f.bit, e.currentTarget.checked)} /> {f.name}</label>
							{/each}
						</div>
					</details>
				</li>
			{/each}
		</ol>
	{/if}

	<h3>Add spells</h3>
	<SpellPicker memoryKey="creature" start="npc" onpick={add} disabled={rows.rows.length >= SLOTS} title={rows.rows.length >= SLOTS ? `The list is full (${SLOTS} spells)` : 'Add it to the creature'} />
</div>

{#snippet param(s: vmangos.CreatureSpell, key: 'targetParam1' | 'targetParam2', label: string)}
	{@const kind = paramKind(label)}
	{#if kind === 'creature' || kind === 'spell'}
		<RefField f={{ col: key === 'targetParam1' ? 'target_param1' : 'target_param2', label, ref: kind }} value={String(s[key])} changed={false} onset={(v) => (s[key] = num(v, 65535))} />
	{:else if kind === 'select flags'}
		<fieldset class="wide select-flags">
			<legend>{label}</legend>
			{#each SELECT_FLAGS as f (f.bit)}
				<label class="check"><input type="checkbox" checked={(s[key] & f.bit) !== 0} onchange={(e) => (s[key] = e.currentTarget.checked ? s[key] | f.bit : s[key] & ~f.bit)} /> {f.name}</label>
			{/each}
			{#if s[key] & ~SELECT_MASK}<span class="dim">Other bits: {s[key] & ~SELECT_MASK}</span>{/if}
		</fieldset>
	{:else if kind === 'bool'}
		<label class="check" title="Leave out the creature's current target"><input type="checkbox" checked={s[key] !== 0} onchange={(e) => (s[key] = e.currentTarget.checked ? 1 : 0)} /> {label}</label>
	{:else}
		<label>{label} <input type="number" min="0" max="65535" value={s[key]} oninput={(e) => (s[key] = num(e.currentTarget.value, 65535))} /></label>
	{/if}
{/snippet}

<style>
	.spells {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.head h3 {
		flex: 1;
		margin: 0;
	}
	p {
		margin: 0;
	}
	.warn {
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list > li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 6px;
		align-items: baseline;
		font-size: 13px;
	}
	.text {
		color: var(--text-dim);
		line-height: 1.35;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 6px 10px;
	}
	.grid label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		color: var(--text-dim);
	}
	.grid label.wide {
		grid-column: span 2;
	}
	.grid label.check {
		flex-direction: row;
		align-items: center;
		gap: 4px;
	}
	.select-flags {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 2px 10px;
		margin: 0;
		padding: 4px 8px 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-dim);
	}
	.grid .check input {
		width: auto;
	}
	.grid input,
	.grid select {
		min-width: 0;
		width: 100%;
	}
	.pair {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.pair input {
		width: 0;
		flex: 1;
	}
	details summary {
		cursor: pointer;
		color: var(--text-dim);
	}
	.flags {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 2px 10px;
		padding-top: 4px;
	}
	.flags label {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.row-actions {
		white-space: nowrap;
	}
	.row-actions button {
		padding: 1px 6px;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
