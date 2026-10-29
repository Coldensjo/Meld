<script lang="ts">
	import { RowList } from '../lib/ui/rowList.svelte'
	import { createSearch } from '../lib/ui/search.svelte'
	import { ReadCharacterQuests, SaveCharacterQuests, SearchQuests } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { QUEST_LOG_SIZE, QUEST_STATES, inQuestLog, questState, withQuestState, type QuestState } from '../lib/wow/characterSheet'

	// The character editor's Quests tab (#881): its character_queststatus rows, the ones in the quest
	// log first (in the order the server fills the log in), then the ones done, each with its state
	// (in progress, ready to turn in, failed, done, not taken); quests found by title or entry are
	// added in progress or done. Saved with its own Save; Go checks the list as the server reads it at
	// login (internal/vmangos/charquests.go SaveCharacterQuests): a quest quest_template lacks, and a
	// quest log of more than 20, are refused.

	let { guid, dirty = $bindable(false) }: { guid: number; dirty?: boolean } = $props()

	const rows = new RowList<vmangos.CharacterQuest[]>({
		empty: [],
		read: async () => ((await ReadCharacterQuests(guid)) ?? []).map((q) => ({ ...q })),
		key: (list) => JSON.stringify(list.map((q) => [q.quest, q.status, q.rewarded])),
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

	/** The quest Go refused, outlined until the next save. */
	let refused = $state('')
	let filter = $state('')
	const matches = (q: vmangos.CharacterQuest, f: string) => !f || q.title.toLowerCase().includes(f) || String(q.quest) === f
	const logCount = $derived(rows.rows.filter(inQuestLog).length)
	const groups = $derived.by(() => {
		const f = filter.trim().toLowerCase()
		const shown = rows.rows.filter((q) => matches(q, f))
		const byTitle = (a: vmangos.CharacterQuest, b: vmangos.CharacterQuest) => a.title.localeCompare(b.title) || a.quest - b.quest
		return [
			{ name: `Quest log (${logCount} of ${QUEST_LOG_SIZE})`, list: shown.filter(inQuestLog) },
			{ name: 'Done', list: shown.filter((q) => questState(q) === 'done').sort(byTitle) },
			{ name: 'Not taken', list: shown.filter((q) => questState(q) === 'none').sort(byTitle) },
		].filter((g) => g.list.length)
	})

	function setState(id: number, s: QuestState) {
		rows.rows = rows.rows.map((q) => (q.quest === id ? withQuestState(q, s) : q))
	}

	function add(r: vmangos.QuestRef, s: QuestState) {
		if (rows.rows.some((q) => q.quest === r.quest)) {
			setStatus(`The character has ${r.title || `quest ${r.quest}`} already.`, 4000)
			return
		}
		const q: vmangos.CharacterQuest = { quest: r.quest, title: r.title, level: r.level, status: 0, rewarded: false, repeatable: false, timeLimit: 0, known: true }
		rows.rows = [...rows.rows, withQuestState(q, s)]
	}

	function save() {
		refused = ''
		void rows.save('Saving the quests', async (quests) => {
			const r = await SaveCharacterQuests(guid, quests)
			if (r.refused) {
				refused = r.refused.column
				filter = ''
				throw new Error(r.refused.message)
			}
			await rows.load()
			setStatus(`Saved ${quests.length} ${quests.length === 1 ? 'quest' : 'quests'}. The character has them at its next login.`, 10000)
		})
	}

	// Adding: a search over quest_template by title or entry.
	let query = $state('')
	const search = createSearch((q: string) => SearchQuests(q).then((r) => r ?? []), { empty: [] as vmangos.QuestRef[], onError: (err) => (rows.error = String(err)) })
	$effect(() => search.set(query.trim() || null))
	const had = $derived(new Set(rows.rows.map((q) => q.quest)))
</script>

<div class="sheet">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Quests{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save quests' : 'Saved'}</button>
	</div>
	<p class="dim">
		A quest marked done gives none of its rewards (experience, money, items, reputation); the server teaches only the spell it rewards, at the next login. A quest put in the log starts with none of its objectives done and without the
		item its giver hands over.
	</p>
	<div class="cols">
		<div class="known">
			<input type="search" placeholder="Narrow by title or entry" bind:value={filter} aria-label="Find a character's quest" />
			{#if rows.loading && !rows.rows.length}
				<p class="dim">Reading the quests…</p>
			{:else}
				{#each groups as g (g.name)}
					<h4>{g.name}</h4>
					<ul class="list" aria-label={g.name}>
						{#each g.list as q (q.quest)}
							<li class:refused={refused === String(q.quest)} class:unknown={!q.known} data-quest={q.quest}>
								<span class="lvl">[{q.level}]</span>
								<span class="name" title="Quest {q.quest}{q.repeatable ? ', repeatable' : ''}{q.timeLimit ? `, timed (${Math.round(q.timeLimit / 60)} min)` : ''}{q.known ? '' : ': the server has no such quest and skips it'}"
									>{q.title || `Quest ${q.quest}`}</span
								>
								<select value={questState(q)} aria-label="State" onchange={(e) => setState(q.quest, e.currentTarget.value as QuestState)}>
									{#each QUEST_STATES as [s, n, hint] (s)}<option value={s} title={hint}>{n}</option>{/each}
								</select>
								<button class="x" title="Forget this quest: the character can take it again" onclick={() => (rows.rows = rows.rows.filter((k) => k.quest !== q.quest))}>×</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="dim">{filter.trim() ? 'No quest matches.' : 'No quests.'}</p>
				{/each}
			{/if}
		</div>
		<div class="pick">
			<input type="search" placeholder="Quest title or entry" bind:value={query} aria-label="Find a quest to add" />
			{#if search.searching && !search.results.length}<p class="dim">Searching…</p>{/if}
			{#if search.results.length}
				<ul class="list results" aria-label="Quests to add">
					{#each search.results as r (r.quest)}
						<li data-add={r.quest}>
							<span class="lvl">[{r.level}]</span>
							<span class="name" title="Quest {r.quest}">{r.title}</span>
							<button disabled={had.has(r.quest)} title="Put it in the quest log" onclick={() => add(r, 'progress')}>Take</button>
							<button disabled={had.has(r.quest)} title="Mark it turned in, without its rewards" onclick={() => add(r, 'done')}>Done</button>
						</li>
					{/each}
				</ul>
			{:else if query.trim() && !search.searching}
				<p class="dim">No quest matches.</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.sheet {
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
	h4 {
		margin: 6px 0 0;
		font-size: 12px;
		font-weight: 600;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cols {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.known,
	.pick {
		flex: 1;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.results {
		max-height: 360px;
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
	.list li.unknown .name {
		color: var(--text-dim);
		text-decoration: line-through;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lvl {
		color: var(--warn);
		min-width: 28px;
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
