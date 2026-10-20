<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import { ReadCreatureSpells, SaveCreatureSpells } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { CAST_FLAGS, CAST_TARGETS, castTarget, spellLabel } from '../lib/wow/creatureSpellNames'
	import { spellRef } from '../lib/wow/spells'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'

	// The creature editor's Spells tab (#243): the spells the creature casts in combat, its
	// creature_spells list (creature_template.spell_list_id), edited as a list and saved with Save
	// spells, like the Shop (the world database keeps no undo). Spells are found by name or ID in the
	// client's Spell.dbc, with their icons and text. A list other creatures share is copied on save, so
	// theirs stays as it is; a creature with no list gets one.

	/** The most spells a creature_spells row holds. */
	const SLOTS = 8

	let {
		entry,
		onsaved,
		dirty = $bindable(false),
	}: { entry: number; onsaved: (listId: number) => void; dirty?: boolean } = $props()

	let list = $state<vmangos.CreatureSpells | null>(null)
	let spells = $state<vmangos.CreatureSpell[]>([])
	let saved = $state('[]')
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	/** The client's spells by ID, for the list's names, icons and text. */
	let refs = $state<Record<number, vmangos.SpellRef | null>>({})

	const key = (l: vmangos.CreatureSpell[]) => JSON.stringify(l)
	$effect(() => {
		dirty = key(spells) !== saved
	})

	let loadedFor = -1
	$effect(() => {
		if (entry === loadedFor) return
		loadedFor = entry
		void load()
	})

	// Every spell in the list gets its name, icon and text from the client.
	const asked = new Set<number>()
	$effect(() => {
		for (const s of spells) {
			const id = s.spell
			if (asked.has(id)) continue
			asked.add(id)
			void spellRef(id).then((r) => (refs[id] = r))
		}
	})

	async function load() {
		loading = true
		error = ''
		try {
			const c = await ReadCreatureSpells(entry)
			list = c
			spells = (c.spells ?? []).map((s) => vmangos.CreatureSpell.createFrom({ ...s }))
			saved = key(spells)
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	async function save() {
		saving = true
		const end = startSaving("Saving the creature's spells")
		error = ''
		try {
			const r = await SaveCreatureSpells(entry, spells)
			const before = list?.listId ?? 0
			saved = key(spells)
			if (r.listId !== before) onsaved(r.listId)
			await load()
			const what = spells.length ? `${spells.length} ${spells.length === 1 ? 'spell' : 'spells'} in list ${r.listId}` : 'no spells'
			setStatus(`Saved the spells of creature ${entry} (${what}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}

	function move(i: number, d: number) {
		const j = i + d
		if (j < 0 || j >= spells.length) return
		const l = [...spells]
		;[l[i], l[j]] = [l[j], l[i]]
		spells = l
	}

	function remove(i: number) {
		spells = spells.filter((_, k) => k !== i)
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

	const flagCount = (f: number) => CAST_FLAGS.filter((c) => f & c.bit).length

	/** Adds a spell the picker (#340) found, with the usual timings. */
	function add(r: vmangos.SpellRef) {
		if (spells.length >= SLOTS) {
			setStatus(`A creature casts at most ${SLOTS} spells from its list.`, 4000)
			return
		}
		refs[r.id] = r
		asked.add(r.id)
		spells = [
			...spells,
			vmangos.CreatureSpell.createFrom({ spell: r.id, probability: 100, castTarget: 1, targetParam1: 0, targetParam2: 0, castFlags: 0, initialMin: 5, initialMax: 10, repeatMin: 10, repeatMax: 20, scriptId: 0 }),
		]
	}
</script>

<div class="spells">
	{#if error}<p class="error">{error}</p>{/if}

	<div class="head">
		<h3>Casts in combat{spells.length ? ` (${spells.length} of ${SLOTS})` : ''}</h3>
		<button disabled={!dirty || saving} onclick={() => void load()}>Revert</button>
		<button class="active" disabled={!dirty || saving} onclick={save}>{saving ? 'Saving…' : dirty ? 'Save spells' : 'Saved'}</button>
	</div>
	{#if list && list.listId > 0 && list.shared > 1}
		<p class="warn">Spell list {list.listId} is shared with {list.shared - 1} other {list.shared === 2 ? 'creature' : 'creatures'}. Saving gives this creature its own copy and leaves theirs as they are.</p>
	{:else if list && list.listId > 0}
		<p class="dim">Spell list {list.listId}{list.name ? `, ${list.name}` : ''}.</p>
	{/if}
	{#if loading}
		<p class="dim">Loading the spells…</p>
	{:else if spells.length === 0}
		<p class="dim">No spells yet. Find spells below and click one to add it; saving gives the creature a spell list.</p>
	{:else}
		<ol class="list">
			{#each spells as s, i (i)}
				{@const ref = refs[s.spell]}
				{@const target = castTarget(s.castTarget)}
				<li>
					<div class="title">
						<SpellIcon icon={ref?.icon ?? ''} size={28} />
						<div class="name">
							<span>{ref ? spellLabel(ref.name, ref.rank) : ref === null ? spellLabel('', '') : '…'}</span>
							<span class="dim">{s.spell}</span>
						</div>
						<div class="row-actions">
							<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
							<button title="Move down" disabled={i === spells.length - 1} onclick={() => move(i, 1)}>↓</button>
							<button title="Remove" onclick={() => remove(i)}>✕</button>
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
						{#if target.params[0]}
							<label>{target.params[0]} <input type="number" min="0" max="65535" value={s.targetParam1} oninput={(e) => (s.targetParam1 = num(e.currentTarget.value, 65535))} /></label>
						{/if}
						{#if target.params[1]}
							<label>{target.params[1]} <input type="number" min="0" max="65535" value={s.targetParam2} oninput={(e) => (s.targetParam2 = num(e.currentTarget.value, 65535))} /></label>
						{/if}
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
	<SpellPicker memoryKey="creature" start="npc" onpick={add} disabled={spells.length >= SLOTS} title={spells.length >= SLOTS ? `The list is full (${SLOTS} spells)` : 'Add it to the creature'} />
</div>

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
