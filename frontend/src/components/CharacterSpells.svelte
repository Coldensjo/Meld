<script lang="ts">
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ReadCharacterSpells, SaveCharacterSpells, StartingSpells } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { spellRef } from '../lib/wow/spells'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'

	// The character editor's Spells tab (#875): the spells it knows (character_spell), with the
	// client's names and icons, found by name; whether each shows in the spell book (a lower rank of a
	// spell it knows a higher one of doesn't) or is turned off; spells added through the spell picker,
	// and the race and class's starting spells (playercreateinfo_spell) added at once, which a race or
	// class change in the Character tab leaves out. Saved with its own Save; Go refuses a spell the
	// server would delete from every character on loading it (internal/vmangos/charsheet.go).

	let { guid, race, cls, dirty = $bindable(false) }: { guid: number; race: number; cls: number; dirty?: boolean } = $props()

	const rows = new RowList<vmangos.CharacterSpell[]>({
		empty: [],
		read: async () => ((await ReadCharacterSpells(guid)) ?? []).map((s) => ({ ...s })),
		key: (list) => JSON.stringify(list.map((s) => [s.spell, s.active, s.disabled]).sort((a, b) => Number(a[0]) - Number(b[0]))),
	})
	rows.follow(() => guid)
	$effect(() => {
		dirty = rows.dirty
	})

	/** Drops the unsaved edits (the editor's Revert and Discard). */
	export function revert() {
		refused = ''
		void rows.revert()
	}

	/** The client's spells by ID, for the names and icons. */
	let refs = $state<Record<number, vmangos.SpellRef | null>>({})
	const asked = new Set<number>()
	$effect(() => {
		for (const s of rows.rows) {
			const id = s.spell
			if (asked.has(id)) continue
			asked.add(id)
			void spellRef(id).then((r) => (refs[id] = r))
		}
	})
	const label = (id: number) => {
		const r = refs[id]
		return r ? `${r.name}${r.rank ? ` (${r.rank})` : ''}` : `Spell ${id}`
	}

	let filter = $state('')
	const shown = $derived.by(() => {
		const f = filter.trim().toLowerCase()
		return rows.rows.filter((s) => !f || label(s.spell).toLowerCase().includes(f) || String(s.spell) === f).sort((a, b) => label(a.spell).localeCompare(label(b.spell)) || a.spell - b.spell)
	})

	/** The spell Go refused, outlined until the next save. */
	let refused = $state('')

	function set(id: number, field: 'active' | 'disabled', on: boolean) {
		rows.rows = rows.rows.map((s) => (s.spell === id ? { ...s, [field]: on } : s))
	}

	function add(r: vmangos.SpellRef) {
		refs[r.id] = r
		asked.add(r.id)
		if (rows.rows.some((s) => s.spell === r.id)) {
			setStatus(`The character knows ${label(r.id)} already.`, 4000)
			return
		}
		rows.rows = [...rows.rows, { spell: r.id, active: true, disabled: false }]
	}

	async function addStarting() {
		try {
			const ids = (await StartingSpells(race, cls)) ?? []
			const have = new Set(rows.rows.map((s) => s.spell))
			const add = ids.filter((id) => !have.has(id))
			rows.rows = [...rows.rows, ...add.map((spell) => ({ spell, active: true, disabled: false }))]
			setStatus(add.length ? `Added ${add.length} starting ${add.length === 1 ? 'spell' : 'spells'} of the race and class.` : 'The character knows every starting spell of its race and class.', 5000)
		} catch (err) {
			rows.error = String(err)
		}
	}

	function save() {
		refused = ''
		void rows.save('Saving the spells', async (spells) => {
			const r = await SaveCharacterSpells(guid, spells)
			if (r.refused) {
				refused = r.refused.column
				filter = ''
				throw new Error(r.refused.message)
			}
			await rows.load()
			setStatus(`Saved ${spells.length} ${spells.length === 1 ? 'spell' : 'spells'}. The character knows them at its next login.`, 10000)
		})
	}
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Spells{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save spells' : 'Saved'}</button>
	</div>
	<div class="cols">
		<div class="known">
			<div class="row">
				<input type="search" placeholder="Narrow by name or ID" bind:value={filter} aria-label="Find a known spell" />
				<button onclick={addStarting} title="The spells the server gives a new character of this race and class (playercreateinfo_spell)">Add starting spells</button>
			</div>
			{#if rows.loading && !rows.rows.length}
				<p class="dim">Reading the spells…</p>
			{:else}
				<ul class="list" aria-label="Known spells">
					{#each shown as s (s.spell)}
						<li class:refused={refused === String(s.spell)} class:off={!s.active || s.disabled} data-spell={s.spell}>
							<SpellIcon icon={refs[s.spell]?.icon ?? ''} size={24} />
							<span class="name" title="Spell {s.spell}">{label(s.spell)}</span>
							<label title="Shows in the spell book: a lower rank of a spell it knows a higher one of doesn't"
								><input type="checkbox" checked={s.active} onchange={(e) => set(s.spell, 'active', e.currentTarget.checked)} /> Book</label
							>
							<label title="Turned off: kept, but the character can't use it"><input type="checkbox" checked={s.disabled} onchange={(e) => set(s.spell, 'disabled', e.currentTarget.checked)} /> Off</label>
							<button class="x" title="Forget this spell" onclick={() => (rows.rows = rows.rows.filter((k) => k.spell !== s.spell))}>×</button>
						</li>
					{:else}
						<li class="dim">{filter.trim() ? 'No known spell matches.' : 'No spells.'}</li>
					{/each}
				</ul>
			{/if}
		</div>
		<div class="pick">
			<SpellPicker memoryKey="character" start="all" onpick={add} label="Find a spell to teach" listLabel="Spells to teach" height={0} />
		</div>
	</div>
</div>

<style>
	/* The sheet fills the character page's height; its long lists scroll in place (#931). */
	.sheet {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 0;
		flex: 1;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.head,
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row input {
		flex: 1;
	}
	.cols {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 16px;
	}
	.known {
		flex: 1;
		min-width: 300px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.pick {
		flex: 1;
		min-width: 280px;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.list li:hover {
		background: var(--panel-2);
	}
	.list li.off .name {
		color: var(--text-dim);
	}
	.list label {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.name {
		flex: 1;
	}
	.x {
		padding: 0 6px;
	}
	.refused {
		outline: 1px solid var(--danger-text);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
</style>
