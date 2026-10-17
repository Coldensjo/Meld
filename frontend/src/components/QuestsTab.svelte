<script lang="ts">
	import { ReadCreatureQuests, SaveCreatureQuests, SearchQuests } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'

	// The creature editor's Quests tab (#145): the quests the creature starts (creature_questrelation)
	// and ends (creature_involvedrelation), edited as two lists and saved with Save quests. Edit opens
	// a quest in the quest editor (#259), and New quest makes one this creature gives and takes in.

	/** npc_flags' quest giver bit: without it the creature offers and takes no quests. */
	const QUEST_GIVER_FLAG = 0x2

	let {
		entry,
		name,
		npcFlags,
		onquestflag,
		dirty = $bindable(false),
	}: { entry: number; name: string; npcFlags: number; onquestflag: () => void; dirty?: boolean } = $props()

	type List = 'starts' | 'ends'
	let quests = $state<{ starts: vmangos.QuestRef[]; ends: vmangos.QuestRef[] }>({ starts: [], ends: [] })
	let saved = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	const key = (q: typeof quests) => JSON.stringify([q.starts.map((r) => [r.quest, r.patchMin, r.patchMax]), q.ends.map((r) => [r.quest, r.patchMin, r.patchMax])])
	$effect(() => {
		dirty = saved !== '' && key(quests) !== saved
	})

	let loadedFor = -1
	$effect(() => {
		if (entry === loadedFor) return
		loadedFor = entry
		void load()
	})

	// The quest editor saved (a title, or this creature's quests from the quest's side): read the
	// lists again, unless they hold edits of their own.
	let version = ui.questsVersion
	$effect(() => {
		const v = ui.questsVersion
		if (v === version) return
		version = v
		if (!dirty) void load()
	})

	const giver = () => ({ kind: 'creature' as const, id: entry, name, ready: (npcFlags & QUEST_GIVER_FLAG) !== 0 })

	function edit(quest: number) {
		ui.questEditor = { entry: quest, giver: giver() }
	}

	function newQuest() {
		ui.questEditor = { entry: -1, giver: giver() }
	}

	async function load() {
		loading = true
		error = ''
		try {
			const q = await ReadCreatureQuests(entry)
			quests = { starts: q.starts ?? [], ends: q.ends ?? [] }
			saved = key(quests)
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
			await SaveCreatureQuests(entry, vmangos.CreatureQuests.createFrom($state.snapshot(quests)))
			saved = key(quests)
			setStatus(`Saved the quests of creature ${entry}: starts ${quests.starts.length}, ends ${quests.ends.length}. Restart the world server to see them in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
		}
	}

	function remove(list: List, i: number) {
		quests[list] = quests[list].filter((_, k) => k !== i)
	}

	function add(list: List, r: vmangos.QuestRef) {
		if (quests[list].some((q) => q.quest === r.quest)) return
		quests[list] = [...quests[list], vmangos.QuestRef.createFrom({ ...r, patchMin: 0, patchMax: 10 })]
	}

	// Adding: a search over quest_template by title or entry.
	let query = $state('')
	let results = $state<vmangos.QuestRef[]>([])
	let searching = $state(false)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		clearTimeout(timer)
		if (!q) {
			results = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = await SearchQuests(q)
				if (q === query.trim()) results = r ?? []
			} catch (err) {
				error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})
</script>

<div class="quests">
	{#if error}<p class="error">{error}</p>{/if}
	{#if (npcFlags & QUEST_GIVER_FLAG) === 0 && (quests.starts.length > 0 || quests.ends.length > 0)}
		<p class="warn">
			This creature has no Quest giver flag, so it offers and takes none of these.
			<button onclick={onquestflag}>Set the flag</button>
			<span class="dim">(saved with Save creature)</span>
		</p>
	{/if}

	<div class="head">
		<span class="dim">{loading ? 'Loading the quests…' : 'Saved to the world database with Save quests, apart from the creature.'}</span>
		<button disabled={!dirty || saving} onclick={() => void load()}>Revert</button>
		<button class="active" disabled={!dirty || saving} onclick={save}>{saving ? 'Saving…' : dirty ? 'Save quests' : 'Saved'}</button>
	</div>

	{#each [['starts', 'Starts', 'Offers these quests to players.'], ['ends', 'Ends', 'Takes these quests in.']] as [list, title, what] (list)}
		{@const rows = quests[list as List]}
		<h3>{title}{rows.length ? ` (${rows.length})` : ''}</h3>
		{#if rows.length === 0}
			<p class="dim">None. {what} Find a quest below to add one.</p>
		{:else}
			<ul class="list">
				{#each rows as r, i (r.quest)}
					<li>
						<span class="lvl">[{r.level}]</span>
						<span class="name">{r.title || '(unknown quest)'}</span>
						<span class="dim">{r.quest}{r.patchMin > 0 || r.patchMax < 10 ? ` · patches ${r.patchMin}–${r.patchMax}` : ''}</span>
						<button title="Open in the quest editor" onclick={() => edit(r.quest)}>Edit</button>
						<button title="Remove" onclick={() => remove(list as List, i)}>✕</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/each}

	<h3>Add quests</h3>
	<span class="add">
		<input class="search" type="search" placeholder="Quest title or entry" bind:value={query} />
		<button onclick={newQuest} title="Make a quest in the quest editor that this creature gives and takes in">New quest…</button>
	</span>
	{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
	{#if results.length}
		<ul class="list results">
			{#each results as r (r.quest)}
				<li>
					<span class="lvl">[{r.level}]</span>
					<span class="name">{r.title}</span>
					<span class="dim">{r.quest}</span>
					<button disabled={quests.starts.some((q) => q.quest === r.quest)} onclick={() => add('starts', r)}>Starts</button>
					<button disabled={quests.ends.some((q) => q.quest === r.quest)} onclick={() => add('ends', r)}>Ends</button>
				</li>
			{/each}
		</ul>
	{:else if query.trim() && !searching}
		<p class="dim">No quest matches.</p>
	{/if}
</div>

<style>
	.quests {
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
	.head span {
		flex: 1;
	}
	.warn {
		margin: 0;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.error {
		margin: 0;
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 4px;
		border-bottom: 1px solid var(--border);
	}
	.list .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lvl {
		color: #ffd100;
		min-width: 28px;
	}
	.list button {
		padding: 1px 6px;
	}
	.results {
		max-height: 260px;
		overflow-y: auto;
	}
	.add {
		display: flex;
		gap: 6px;
	}
	.search {
		flex: 1;
		min-width: 0;
	}
</style>
