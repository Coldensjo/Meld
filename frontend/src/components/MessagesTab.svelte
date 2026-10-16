<script lang="ts">
	import { ReadGossip, SaveGreeting } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'

	// The creature editor's Messages tab (#145): what the creature says when a player talks to it, its
	// gossip menu's greeting. Broadcast texts are shared between creatures, so Go never edits one: a
	// save adds new text rows and points this creature's menu at them (copying a shared menu first).

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

	$effect(() => {
		dirty = male !== savedMale || female !== savedFemale
	})

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
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	async function save() {
		saving = true
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
		}
	}
</script>

<div class="messages">
	{#if error}<p class="error">{error}</p>{/if}
	<div class="head">
		<h3>Greeting</h3>
		<button disabled={!dirty || saving} onclick={() => ((male = savedMale), (female = savedFemale))}>Revert</button>
		<button class="active" disabled={!dirty || saving || !male.trim()} onclick={save}>{saving ? 'Saving…' : dirty ? 'Save greeting' : 'Saved'}</button>
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
		{#if gossip?.options?.length}
			<h3>Options ({gossip.options.length})</h3>
			<p class="dim">The lines a player can pick. Kept as they are (a copied menu keeps them too).</p>
			<ul>
				{#each gossip.options as o, i (i)}<li>{o}</li>{/each}
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
		color: var(--danger);
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
</style>
