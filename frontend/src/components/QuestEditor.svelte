<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { CreateQuest, DeleteQuest, PlanQuestDelete, ReadQuest, SaveQuest, SaveQuestGivers, SearchQuests } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { TemplateEditor, checkRefused, tabChangeCounts } from '../lib/ui/templateEditor.svelte'
	import { questTabs, tabOfColumn } from '../lib/world/questFields'
	import { forgetName } from '../lib/wow/refNames'
	import EditorFrame from './EditorFrame.svelte'
	import QuestGiversTab from './QuestGiversTab.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The quest editor (#259, World › Quests…, or a quest's Edit in the creature editor's Quests tab):
	// find a quest or make one (blank, or a copy of the open one), edit every column of its
	// quest_template row on tabs, and say who starts and ends it. Save writes the row (Go checks it
	// against the server's rules first) and then the givers; nothing is written before. The server
	// reads quests when it starts or on `.reload all_quest`.

	const target = $derived(ui.questEditor)

	let tab = $state('quest')
	let giversDirty = $state(false)
	let giversTab = $state<QuestGiversTab | null>(null)
	/** What deleting the open quest removes, while its confirmation is up. */
	let plan = $state<vmangos.QuestDeletePlan | null>(null)
	let deleting = $state(false)

	const ed = new TemplateEditor<{ entry: number }, vmangos.TemplateRecord>({
		id: (t) => String(t.entry),
		entry: (t) => t.entry,
		read: ReadQuest,
		clear: () => (ui.questEditor = null),
		dirty: () => giversDirty,
		onopen: () => {
			plan = null
			giversDirty = false
		},
		onrevert: () => giversTab?.revert(),
	})
	ed.follow(() => target)
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	const changeCount = $derived(ed.changeCount)
	const unsaved = $derived(ed.unsaved)
	const tabs = $derived(record ? questTabs(record.columns.map((c) => c.name)) : [])
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))
	/** How many changes each tab holds, for its label. */
	const tabChanges = $derived(tabChangeCounts(tabs, changes))

	function open(entry: number) {
		if (target?.entry === entry) return
		ed.leave(() => {
			ed.note = ''
			ui.questEditor = { entry }
		})
	}

	// Save: the row first (refused whole if a value breaks a rule), then the givers.
	function save() {
		const r = record
		if (!r || !unsaved) return
		void ed.save(
			'Saving the quest',
			async () => {
				const done: string[] = []
				const n = changeCount
				if (n > 0) {
					checkRefused(await SaveQuest(r.entry, r.patch, changes))
					ed.markSaved()
					forgetName('quest', r.entry)
					done.push(`${n} ${n === 1 ? 'value' : 'values'}`)
				}
				const g = (await giversTab?.save()) ?? ''
				if (g) done.push(g)
				ui.questsVersion++
				ed.note = `Saved ${done.join(' and ')} of ${values.Title || 'the quest'} (quest ${r.entry}) to the world database. Restart the world server, or type .reload all_quest in the game as a GM, for the server to use it.`
				setStatus(ed.note, 10000)
			},
			// A refused value: show the tab it is on.
			(col) => (tab = tabOfColumn(tabs, col) ?? tab),
		)
	}

	// Delete: read what goes (rows of each table, quests that name this one, characters that have
	// it), ask, then remove it; nothing is written before the confirmation.
	async function askDelete() {
		if (!record) return
		ed.error = ''
		ed.note = ''
		try {
			plan = await PlanQuestDelete(record.entry)
		} catch (err) {
			ed.error = String(err)
		}
	}

	async function confirmDelete() {
		if (!record || !plan) return
		const entry = record.entry
		const title = plan.title || `quest ${entry}`
		deleting = true
		ed.error = ''
		try {
			await DeleteQuest(entry)
			forgetName('quest', entry)
			plan = null
			ui.questsVersion++
			ui.questEditor = { entry: 0 }
			ed.note = `Deleted quest ${entry}, ${title}, from the world database. Restart the world server, or type .reload all_quest in the game as a GM, for the server to drop it.`
			setStatus(ed.note, 10000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			deleting = false
		}
	}

	// Find: quests by title or entry.
	let query = $state('')
	let found = $state<vmangos.QuestRef[]>([])
	let searching = $state(false)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		void ui.questsVersion
		clearTimeout(timer)
		if (!q) {
			found = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = await SearchQuests(q)
				if (q === query.trim()) found = r ?? []
			} catch (err) {
				ed.error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	// A new quest: blank, or a copy of the one that was open, given and taken in by the creature it
	// was asked for from (the creature editor's Quests tab).
	let newTitle = $state('')
	let copyThis = $state(false)
	let giveIt = $state(true)
	let creating = $state(false)
	let copySource = $state<{ entry: number; title: string } | null>(null)
	const isNew = $derived(target?.entry === -1)

	function startNew() {
		if (isNew) return
		ed.leave(() => {
			copySource = record ? { entry: record.entry, title: saved.Title ?? '' } : null
			copyThis = false
			ed.note = ''
			ui.questEditor = { entry: -1, giver: target?.giver }
		})
	}

	async function create() {
		const title = newTitle.trim()
		if (!title) return
		creating = true
		ed.error = ''
		try {
			const base = copyThis && copySource ? copySource.entry : 0
			const entry = await CreateQuest(base, title)
			const g = target?.giver
			let given = ''
			if (g && giveIt) {
				const giver = vmangos.QuestGiver.createFrom({ ...g, patchMin: 0, patchMax: 10, spawns: 0 })
				await SaveQuestGivers(entry, vmangos.QuestGivers.createFrom({ starts: [giver], ends: [giver] }), g.kind === 'creature' && !g.ready ? [g.id] : [])
				given = `, started and ended by ${g.name}`
			}
			newTitle = ''
			ui.questsVersion++
			ui.questEditor = { entry, giver: g }
			tab = 'quest'
			ed.note = `Made quest ${entry}, ${title}${given}. Fill it in and save.`
			setStatus(ed.note, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}
</script>

{#if target}
	<EditorFrame {ed} label="Quest editor" z={160} unsavedText={`Unsaved changes to ${[changeCount ? 'the quest' : '', giversDirty ? 'its givers' : ''].filter(Boolean).join(' and ')}.`}>
		{#snippet title()}
			{#if target.entry > 0}
				<h2>{values.Title || saved.Title || 'Quest'}</h2>
				<span class="dim">quest {target.entry}{record ? ` · level ${values.QuestLevel} · patch ${record.patch}` : ''}</span>
			{:else if target.entry === -1}
				<h2>New quest</h2>
			{:else}
				<h2>Quests</h2>
				<span class="dim">Find a quest to edit, or make a new one.</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if record}
				<button disabled={!unsaved || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={!unsaved || ed.saving} onclick={save}>
					{ed.saving ? 'Saving…' : unsaved ? `Save quest (${changeCount + (giversDirty ? 1 : 0)})` : 'Saved'}
				</button>
				<button class="danger" disabled={ed.saving || deleting} onclick={askDelete} title="Remove this quest from the world database">Delete quest…</button>
			{/if}
		{/snippet}
		{#snippet bars()}
			{#if plan && record}
				<div class="bar warn delete">
					<div class="what">
						<strong>Delete {plan.title || 'quest'} (quest {record.entry}) from the world database?</strong>
						<span>Removes {plan.rows.map((r) => `${r.count} ${r.count === 1 ? 'row' : 'rows'} of ${r.table}`).join(', ')}.</span>
						{#if plan.links.length}
							<span>Quests that name it lose that link (set to 0): {plan.links.map((l) => `${l.title || 'quest'} (${l.quest}: ${l.columns.join(', ')})`).join('; ')}.</span>
						{/if}
						{#if plan.characters > 0}
							<span>{plan.characters} {plan.characters === 1 ? 'character has' : 'characters have'} it in the log or done: the server drops it from the log at their next login. Their rows are not touched.</span>
						{:else if plan.characters < 0}
							<span>The characters database could not be read, so characters that have it are not counted.</span>
						{/if}
						<span>Unsaved changes to this quest are lost. This cannot be undone.</span>
					</div>
					<button onclick={() => (plan = null)}>Keep it</button>
					<button class="danger" disabled={deleting} onclick={confirmDelete}>{deleting ? 'Deleting…' : 'Delete quest'}</button>
				</div>
			{/if}
		{/snippet}

		<div class="body">
			<aside>
				<button class="new" class:active={isNew} onclick={startNew}>New quest…</button>
				<input type="search" placeholder="Quest title or entry" bind:value={query} aria-label="Find a quest" />
				<ul class="found" aria-label="Quests found">
					{#each found as q (q.quest)}
						<li>
							<button class:on={q.quest === target.entry} onclick={() => open(q.quest)} use:idMenu={{ ids: [idOf('quest', q.quest)], name: q.title }}>
								<span><span class="lvl">[{q.level}]</span> {q.title || '(no title)'}</span>
								<span class="dim">{q.quest}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{searching ? 'Searching…' : query.trim() ? 'No quest matches.' : 'Type a title to search the world database.'}</li>
					{/each}
				</ul>
			</aside>

			<section class="main">
				{#if target.entry === -1}
					<div class="new-form">
						<p>Make a quest of your own for the world database. It gets the first free entry; fill it in, say who gives it, and save.</p>
						<label>Title <input type="text" placeholder="Title" bind:value={newTitle} onkeydown={(e) => e.key === 'Enter' && create()} /></label>
						{#if copySource}
							<label class="check"><input type="checkbox" bind:checked={copyThis} /> Copy {copySource.title} (quest {copySource.entry}): its texts, objectives and rewards, not its givers</label>
						{/if}
						{#if target.giver}
							<label class="check"
								><input type="checkbox" bind:checked={giveIt} /> Started and ended by {target.giver.name} ({target.giver.kind}
								{target.giver.id}){target.giver.kind === 'creature' && !target.giver.ready ? ', which gets the Quest giver flag' : ''}</label
							>
						{/if}
						{#if !copySource}
							<p class="dim">It starts as a level 1 quest anyone may take, with no objectives or rewards. To start from an existing quest, open that one and choose New quest there.</p>
						{/if}
						<button class="active" disabled={!newTitle.trim() || creating} onclick={create}>{creating ? 'Making…' : 'Make quest'}</button>
					</div>
				{:else if target.entry === 0}
					<div class="empty dim">Find a quest on the left, or make a new one.</div>
				{:else}
					<nav class="tabs">
						{#each tabs as t (t.id)}
							<button class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.title}{tabChanges.get(t.id) ? ` (${tabChanges.get(t.id)})` : ''}</button>
						{/each}
						{#if record}<button class:on={tab === 'givers'} onclick={() => (tab = 'givers')}>Givers{giversDirty ? ' (1)' : ''}</button>{/if}
					</nav>
					<div class="scroll">
						{#if !record}
							<p class="dim">{ed.loading ? 'Loading the quest…' : ''}</p>
						{:else}
							{#each tabs as t (t.id)}
								{#if t.id === tab}
									{#each t.groups as g (g.title)}
										<h3>{g.title}</h3>
										<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} codes entry={record.entry} owner="quest" onset={(col, v) => (values[col] = v)} />
									{/each}
								{/if}
							{/each}
							<!-- The givers stay mounted, so their unsaved rows survive a tab switch. -->
							<div hidden={tab !== 'givers'}>
								<QuestGiversTab bind:this={giversTab} bind:dirty={giversDirty} entry={record.entry} />
							</div>
						{/if}
					</div>
				{/if}
			</section>
		</div>
	</EditorFrame>
{/if}

<style>
	.bar.delete .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	aside {
		width: 300px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-right: 1px solid var(--border);
		background: var(--panel);
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		flex: 1;
		font-size: 12px;
	}
	.found button {
		width: 100%;
		display: flex;
		justify-content: space-between;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 4px 6px;
		text-align: left;
	}
	.found button:hover {
		background: var(--panel-2);
	}
	.found button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.lvl {
		color: var(--warn);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 880px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.new-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		max-width: 560px;
		font-size: 13px;
	}
	.new-form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.new-form label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.new-form p {
		margin: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
