<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import { DeleteConditionText, ReadGossip, SaveConditionText, SaveGossipOptions, SaveGreeting } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import MoneyField from './MoneyField.svelte'
	import RefField from './RefField.svelte'
	import type { CreatureField } from '../lib/world/creatureFields'
	import { setStatus } from '../lib/state/editor.svelte'
	import { RowList } from '../lib/ui/rowList.svelte'
	import { ACTION_TALK, AI_EVENTS, CHAT_TYPES, GOSSIP_ACTIONS, GOSSIP_ICONS, nameOf, nextOptionId } from '../lib/wow/gossipNames'

	// The creature editor's Messages tab (#145, #158): what the creature says when a player talks to
	// it, its gossip menu's greeting, its texts shown under a condition (#160) and options, and the
	// lines its AI says on its own (read only). Broadcast texts are shared between creatures, so Go
	// never edits one: a greeting or conditioned text save adds new text rows and points this
	// creature's menu at them, an edited option text goes into the option's own row, and a shared
	// menu is copied first. An option's menu, script, map point and condition, and a text's
	// condition, are pickers of the world database's rows (#700).

	const MENU: CreatureField = { col: 'action_menu_id', label: 'Menu', ref: 'gossip', options: [[-1, 'Closes the window']], hint: 'The gossip menu it opens; −1 closes the window' }
	const SCRIPT: CreatureField = { col: 'action_script_id', label: 'Script', ref: 'gossip script', hint: 'A gossip_scripts id run when it is picked (0 for none)' }
	const POI: CreatureField = { col: 'action_poi_id', label: 'Map point', ref: 'map point', hint: 'A point of interest marked on the map (0 for none)' }
	const CONDITION: CreatureField = { col: 'condition_id', label: 'Condition', ref: 'condition', hint: 'A conditions row the option needs to show (0 always)' }
	const TEXT_CONDITION: CreatureField = { col: 'condition_entry', label: 'Condition', ref: 'condition', hint: 'The conditions row that must hold' }
	/** A picker's text as a number (an emptied box is 0). */
	const num = (v: string) => Number(v) || 0

	let { entry, onsaved, dirty = $bindable(false) }: { entry: number; onsaved: (menuId: number) => void; dirty?: boolean } = $props()

	let gossip = $state<vmangos.Gossip | null>(null)
	let male = $state('')
	let female = $state('')
	let savedMale = $state('')
	let savedFemale = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	/** A text shown under a condition, being edited: textId 0 is a new row; saved* are as last read. */
	type CondText = { textId: number; condition: number; male: string; female: string; savedCondition: number; savedMale: string; savedFemale: string }
	let conds = $state<CondText[]>([])
	let savingCond = $state(-1)
	const condDirty = (c: CondText) => c.textId === 0 || c.condition !== c.savedCondition || c.male !== c.savedMale || c.female !== c.savedFemale
	const anyCondDirty = $derived(conds.some(condDirty))

	function readConds(g: vmangos.Gossip) {
		conds = (g.texts ?? [])
			.filter((t) => t.condition !== 0)
			.map((t) => {
				const female = t.female !== t.male ? t.female : ''
				return { textId: t.textId, condition: t.condition, male: t.male, female, savedCondition: t.condition, savedMale: t.male, savedFemale: female }
			})
	}

	function addCond() {
		const top = Math.max(0, ...conds.map((c) => c.condition))
		conds.push({ textId: 0, condition: top, male: '', female: '', savedCondition: 0, savedMale: '', savedFemale: '' })
	}

	function revertCond(i: number) {
		const c = conds[i]
		if (c.textId === 0) {
			conds.splice(i, 1)
			return
		}
		c.condition = c.savedCondition
		c.male = c.savedMale
		c.female = c.savedFemale
	}

	async function saveCond(i: number) {
		const c = conds[i]
		savingCond = i
		const end = startSaving("Saving the creature's conditioned text")
		error = ''
		try {
			const r = await SaveConditionText(entry, c.textId, c.condition, c.male, c.female)
			onsaved(r.menuId)
			await load()
			setStatus(`Saved the text creature ${entry} shows under condition ${c.condition} (gossip menu ${r.menuId}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			savingCond = -1
			end()
		}
	}

	async function deleteCond(i: number) {
		const c = conds[i]
		if (c.textId === 0) {
			conds.splice(i, 1)
			return
		}
		savingCond = i
		const end = startSaving("Removing the creature's conditioned text")
		error = ''
		try {
			const r = await DeleteConditionText(entry, c.textId)
			onsaved(r.menuId)
			await load()
			setStatus(`Removed the text creature ${entry} showed under condition ${c.savedCondition} (gossip menu ${r.menuId}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			savingCond = -1
			end()
		}
	}

	/** The options being edited, and as last read (JSON), to tell an edit. */
	const optionRows = new RowList<vmangos.GossipOption[]>({ empty: [] })
	const options = $derived(optionRows.rows)
	let savingOptions = $state(false)
	const optionsDirty = $derived(optionRows.dirty)
	const greetingDirty = $derived(male !== savedMale || female !== savedFemale)

	$effect(() => {
		dirty = greetingDirty || optionsDirty || anyCondDirty
	})

	function readOptions(g: vmangos.Gossip) {
		optionRows.set((g.options ?? []).map((o) => ({ ...o })))
	}

	function addOption() {
		options.push({
			id: nextOptionId(options.map((o) => o.id)),
			icon: 0,
			text: '',
			broadcastText: 0,
			action: ACTION_TALK,
			npcFlag: GOSSIP_ACTIONS[ACTION_TALK].flag,
			actionMenu: -1,
			actionPoi: 0,
			actionScript: 0,
			boxCoded: false,
			boxMoney: 0,
			boxText: '',
			boxBroadcastText: 0,
			condition: 0,
		})
	}

	function setAction(o: vmangos.GossipOption, action: number) {
		o.action = action
		o.npcFlag = GOSSIP_ACTIONS[action]?.flag ?? 1
	}

	/** Swaps option i with the one `by` places away; the numbers stay in place, so the order is the list's. */
	function move(i: number, by: number) {
		const j = i + by
		if (j < 0 || j >= options.length) return
		const a = options[i]
		const b = options[j]
		;[a.id, b.id] = [b.id, a.id]
		options[i] = b
		options[j] = a
	}

	/** Whether the creature lacks the flag an option needs, so the server hides the option. */
	const hidden = (o: vmangos.GossipOption) => !!gossip && (o.npcFlag & (gossip.npcFlags ?? 0)) === 0

	async function saveOptions() {
		savingOptions = true
		const endOptions = startSaving("Saving the creature's gossip options")
		error = ''
		try {
			const r = await SaveGossipOptions(entry, options)
			onsaved(r.menuId)
			await load()
			setStatus(`Saved ${options.length} gossip options of creature ${entry} (gossip menu ${r.menuId}). Restart the world server to see them in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			savingOptions = false
			endOptions()
		}
	}

	let loadedFor = -1
	$effect(() => {
		if (entry === loadedFor) return
		loadedFor = entry
		void load()
	})

	async function load() {
		loading = true
		error = ''
		try {
			const g = await ReadGossip(entry)
			gossip = g
			const t = g.texts?.find((x) => x.condition === 0)
			savedMale = male = t?.male ?? ''
			// A female text equal to the male one is shown empty: it follows the male text.
			savedFemale = female = t && t.female !== t.male ? t.female : ''
			readOptions(g)
			readConds(g)
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	/** Drops every unsaved change: the greeting, the conditioned texts and the options (the editor's Discard). */
	export function revert() {
		void load()
	}

	async function save() {
		saving = true
		const end = startSaving("Saving the creature's greeting")
		error = ''
		try {
			const r = await SaveGreeting(entry, male, female)
			onsaved(r.menuId)
			await load()
			setStatus(`Saved the greeting of creature ${entry} (gossip menu ${r.menuId}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
			end()
		}
	}
</script>

<div class="messages">
	{#if error}<p class="error">{error}</p>{/if}
	<div class="head">
		<h3>Greeting</h3>
		<button disabled={!greetingDirty || saving} onclick={() => ((male = savedMale), (female = savedFemale))}>Revert</button>
		<button class="active" disabled={!greetingDirty || saving || !male.trim()} onclick={save}>{saving ? 'Saving…' : greetingDirty ? 'Save greeting' : 'Saved'}</button>
	</div>
	{#if loading}
		<p class="dim">Loading what it says…</p>
	{:else}
		<p class="dim">
			What it says when a player talks to it.
			{#if !gossip?.menuId}
				It has no gossip menu yet: saving makes one and sets its Gossip flag.
			{:else if (gossip.shared ?? 0) > 1}
				Its gossip menu ({gossip.menuId}) is shared by {gossip.shared} creatures: saving gives this one its own copy, so the others keep theirs.
			{:else}
				Gossip menu {gossip.menuId}.
			{/if}
			$N is the player's name, $C their class, $R their race, $B a line break, and $gsir:madam; picks a word by the player's sex.
		</p>
		<label>To a man (and to a woman, if the next box is empty)<textarea rows="5" bind:value={male}></textarea></label>
		<label>To a woman (optional)<textarea rows="3" bind:value={female} placeholder="Same as above"></textarea></label>

		<div class="head">
			<h3>Shown under a condition ({conds.length})</h3>
			<button onclick={addCond} title="Add a text shown instead of the greeting when a condition holds">Add text</button>
		</div>
		<p class="dim">
			Each replaces the greeting when its condition (a row of the conditions table) holds; of those that hold, the highest-numbered condition wins. A saved text is a new text row, so other creatures showing the old one keep it{(gossip?.shared ??
				0) > 1
				? '; this shared menu is copied for this creature first'
				: ''}.
		</p>
		{#each conds as c, i (c)}
			<div class="option">
				<div class="line">
					<div class="cond"><RefField f={TEXT_CONDITION} value={String(c.condition)} changed={c.condition !== c.savedCondition} onset={(v) => (c.condition = num(v))} /></div>
					<span class="dim">{c.textId ? `text ${c.textId}` : 'new'}</span>
					<span class="row-actions">
						<button disabled={!condDirty(c) || savingCond >= 0} onclick={() => revertCond(i)}>Revert</button>
						<button class="active" disabled={!condDirty(c) || savingCond >= 0 || !c.male.trim() || !(c.condition > 0)} onclick={() => saveCond(i)}>{savingCond === i ? 'Saving…' : condDirty(c) ? 'Save' : 'Saved'}</button>
						<button disabled={savingCond >= 0} onclick={() => deleteCond(i)} title="Remove this text from the creature's menu">✕</button>
					</span>
				</div>
				<label>To a man (and to a woman, if the next box is empty)<textarea rows="3" bind:value={c.male}></textarea></label>
				<label>To a woman (optional)<textarea rows="2" bind:value={c.female} placeholder="Same as above"></textarea></label>
			</div>
		{/each}

		<div class="head">
			<h3>Options ({options.length})</h3>
			<button disabled={!gossip?.menuId} onclick={addOption} title="Add a line the player can pick">Add option</button>
			<button disabled={!optionsDirty || savingOptions} onclick={() => gossip && readOptions(gossip)}>Revert</button>
			<button class="active" disabled={!optionsDirty || savingOptions || !gossip?.menuId} onclick={saveOptions}>{savingOptions ? 'Saving…' : optionsDirty ? 'Save options' : 'Saved'}</button>
		</div>
		<p class="dim">
			{#if !gossip?.menuId}
				The lines a player can pick. Save a greeting first: that makes the creature's gossip menu.
			{:else}
				The lines a player can pick, in this order. Talk opens another gossip menu (−1 closes the window); the others open their window. An edited text is kept with the option, so other creatures using the same text keep theirs{(gossip.shared ??
					0) > 1
					? '; this shared menu is copied for this creature first'
					: ''}.
			{/if}
		</p>
		{#each options as o, i (o)}
			<div class="option">
				<div class="line">
					<span class="dim num-id" title="The option's number in the menu (gossip_menu_option.id)">{o.id}</span>
					<select bind:value={o.icon} title="The icon beside the line" aria-label="Icon">
						{#each GOSSIP_ICONS as name, n (n)}<option value={n}>{name}</option>{/each}
					</select>
					<input class="text" bind:value={o.text} placeholder="What the player says" aria-label="Text" />
					<select value={o.action} onchange={(e) => setAction(o, Number(e.currentTarget.value))} title="What picking it does" aria-label="Action">
						{#each GOSSIP_ACTIONS as a, n (n)}<option value={n}>{a.name}</option>{/each}
					</select>
					<span class="row-actions">
						<button disabled={i === 0} onclick={() => move(i, -1)} title="Move up">↑</button>
						<button disabled={i === options.length - 1} onclick={() => move(i, 1)} title="Move down">↓</button>
						<button onclick={() => options.splice(i, 1)} title="Delete the option">✕</button>
					</span>
				</div>
				<div class="refs">
					{#if o.action === ACTION_TALK}
						<RefField f={MENU} value={String(o.actionMenu)} changed={false} onset={(v) => (o.actionMenu = num(v))} />
					{/if}
					<RefField f={SCRIPT} value={String(o.actionScript)} changed={false} onset={(v) => (o.actionScript = num(v))} />
					<RefField f={POI} value={String(o.actionPoi)} changed={false} onset={(v) => (o.actionPoi = num(v))} />
					<RefField f={CONDITION} value={String(o.condition)} changed={false} onset={(v) => (o.condition = num(v))} />
				</div>
				<div class="line small">
					<label class="cost" title="What the player pays to pick it; the box asks first">Cost <MoneyField value={o.boxMoney} onset={(v) => (o.boxMoney = v)} /></label>
					<label class="box" title="A box asking the player to confirm (empty for none)">Box <input bind:value={o.boxText} placeholder="none" /></label>
					<label class="check" title="The box asks for a typed code"><input type="checkbox" bind:checked={o.boxCoded} /> Code</label>
				</div>
				{#if hidden(o)}
					<p class="warn">Hidden in the game: the creature lacks the {GOSSIP_ACTIONS[o.action]?.flagName ?? 'needed'} flag (Creature tab, npc_flags).</p>
				{/if}
			</div>
		{/each}

		{#if gossip?.lines?.length}
			<h3>What it says on its own ({gossip.lines.length})</h3>
			<p class="dim">Lines its creature AI says (creature_ai_events and their talk scripts). Listed only; they are edited with the scripts.</p>
			<ul>
				{#each gossip.lines as l, i (i)}
					<li><span class="dim">{nameOf(AI_EVENTS, l.event)}{l.chance < 100 ? ` (${l.chance}%)` : ''} · {nameOf(CHAT_TYPES, l.chat)}</span> {l.text}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.messages {
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
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	textarea {
		width: 100%;
		resize: vertical;
		font: inherit;
	}
	ul {
		margin: 0;
		padding-left: 18px;
	}
	li {
		padding: 2px 0;
	}
	.option {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px 0;
		border-bottom: 1px solid var(--border);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.line .text {
		flex: 1;
		min-width: 160px;
	}
	.line.small label {
		flex-direction: row;
		align-items: center;
		gap: 4px;
	}
	.line .cost {
		width: 240px;
	}
	.line .cond {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
	}
	.refs {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px 8px;
	}
	.line .row-actions {
		margin-left: auto;
	}
	.line.small .box input {
		width: 140px;
	}
	.num-id {
		min-width: 18px;
		text-align: right;
	}
	.row-actions button {
		padding: 1px 6px;
	}
	.warn {
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
</style>
