<script lang="ts">
	import { startSaving } from '../lib/state/saving'
	import { ReadGossip, SaveGossipOptions, SaveGreeting } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { ACTION_TALK, AI_EVENTS, CHAT_TYPES, GOSSIP_ACTIONS, GOSSIP_ICONS, nameOf, nextOptionId } from '../lib/wow/gossipNames'

	// The creature editor's Messages tab (#145, #158): what the creature says when a player talks to
	// it, its gossip menu's greeting and options, and the lines its AI says on its own (read only).
	// Broadcast texts are shared between creatures, so Go never edits one: a greeting save adds new
	// text rows and points this creature's menu at them, an edited option text goes into the option's
	// own row, and a shared menu is copied first.

	let {
		entry,
		onsaved,
		dirty = $bindable(false),
	}: { entry: number; onsaved: (menuId: number) => void; dirty?: boolean } = $props()

	let gossip = $state<vmangos.Gossip | null>(null)
	let male = $state('')
	let female = $state('')
	let savedMale = $state('')
	let savedFemale = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	/** The menu row the greeting is: the one shown without a condition. */
	const greeting = $derived(gossip?.texts?.find((t) => t.condition === 0) ?? null)
	const conditional = $derived(gossip?.texts?.filter((t) => t !== greeting) ?? [])

	/** The options being edited, and as last read (JSON), to tell an edit. */
	let options = $state<vmangos.GossipOption[]>([])
	let savedOptions = $state('[]')
	let savingOptions = $state(false)
	const optionsDirty = $derived(JSON.stringify(options) !== savedOptions)
	const greetingDirty = $derived(male !== savedMale || female !== savedFemale)

	$effect(() => {
		dirty = greetingDirty || optionsDirty
	})

	function readOptions(g: vmangos.Gossip) {
		options = (g.options ?? []).map((o) => ({ ...o }))
		savedOptions = JSON.stringify(options)
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
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
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

		{#if conditional.length}
			<h3>Shown under a condition</h3>
			<p class="dim">These replace the greeting when their condition holds; they are kept as they are.</p>
			<ul>
				{#each conditional as t (t.textId)}
					<li><span class="dim">condition {t.condition} · text {t.textId}</span> {t.male}</li>
				{/each}
			</ul>
		{/if}

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
				The lines a player can pick, in this order. Talk opens another gossip menu (−1 closes the window); the others open their window. An edited text is kept with the option, so other creatures using the same text keep theirs{(gossip.shared ?? 0) > 1 ? '; this shared menu is copied for this creature first' : ''}.
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
				<div class="line small">
					{#if o.action === ACTION_TALK}
						<label title="The gossip menu it opens; −1 closes the window">Menu <input type="number" min="-1" bind:value={o.actionMenu} /></label>
					{/if}
					<label title="A gossip_scripts id run when it is picked (0 for none)">Script <input type="number" min="0" bind:value={o.actionScript} /></label>
					<label title="A point of interest marked on the map (0 for none)">Map point <input type="number" min="0" bind:value={o.actionPoi} /></label>
					<label title="A conditions row the option needs to show (0 always)">Condition <input type="number" min="0" bind:value={o.condition} /></label>
					<label title="Copper the player pays to pick it; the box asks first">Cost <input type="number" min="0" bind:value={o.boxMoney} /></label>
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
	.line.small input[type='number'] {
		width: 64px;
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
