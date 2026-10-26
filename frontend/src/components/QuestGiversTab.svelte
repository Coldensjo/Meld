<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { ReadQuestGivers, SaveQuestGivers, SearchCreatures } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { editor } from '../lib/state/editor.svelte'
	import { RowList, removeRow } from '../lib/ui/rowList.svelte'
	import { loadObjectTemplates } from './SpawnBrowser.svelte'

	// The quest editor's Givers tab (#259): the creatures and game objects that start the quest
	// (creature_questrelation, gameobject_questrelation) and end it (the involvedrelation tables), seen
	// from the quest's side, saved with the quest's Save. A creature offers no quest without the Quest
	// giver flag: one that lacks it gets it on Save unless its box is cleared. A game object must be a
	// Quest giver (type 2) to be added: Meld never changes its type for the author (#293's decision),
	// so another object is refused, saying why (Go refuses it too).

	let { entry, dirty = $bindable(false) }: { entry: number; dirty?: boolean } = $props()

	type List = 'starts' | 'ends'
	type Lists = { starts: vmangos.QuestGiver[]; ends: vmangos.QuestGiver[] }
	/** The creatures without the flag that get it on Save, by entry. */
	let flag = $state<Record<number, boolean>>({})

	const id = (g: vmangos.QuestGiver) => `${g.kind}:${g.id}`
	const lists = new RowList<Lists>({
		empty: { starts: [], ends: [] },
		read: async () => {
			const g = await ReadQuestGivers(entry)
			flag = {}
			return { starts: g.starts ?? [], ends: g.ends ?? [] }
		},
		key: (g) => JSON.stringify([g.starts.map((r) => [id(r), r.patchMin, r.patchMax]), g.ends.map((r) => [id(r), r.patchMin, r.patchMax])]),
	})
	const givers = $derived(lists.rows)
	/** The creatures of the lists that lack the flag. */
	const unflagged = $derived([...new Map([...givers.starts, ...givers.ends].filter((g) => g.kind === 'creature' && !g.ready).map((g) => [g.id, g])).values()])
	const flagging = $derived(unflagged.filter((g) => flag[g.id] !== false).map((g) => g.id))
	$effect(() => {
		dirty = lists.dirty || flagging.length > 0
	})
	lists.follow(() => entry)

	/** Drops the unsaved lists (the quest editor's Revert and Discard). */
	export function revert() {
		void lists.revert()
	}

	/** Writes the lists (and the flags), and says what it wrote; '' when nothing changed. */
	export async function save(): Promise<string> {
		if (!dirty) return ''
		await SaveQuestGivers(entry, vmangos.QuestGivers.createFrom($state.snapshot(givers)), flagging)
		const flagged = flagging.length
		await lists.load()
		const n = (k: List) => givers[k].length
		return `givers (starts ${n('starts')}, ends ${n('ends')}${flagged ? `; ${flagged} given the Quest giver flag` : ''})`
	}

	function remove(list: List, i: number) {
		lists.rows[list] = removeRow(lists.rows[list], i)
	}

	/** An object that can't be added: not a Quest giver, so the server would ignore it. */
	const refused = (g: vmangos.QuestGiver) => g.kind === 'object' && !g.ready
	const refusedText = 'Not a Quest giver object (type 2), so the server ignores its quests: set its Type to Quest giver in the game object editor first'

	function add(list: List, g: vmangos.QuestGiver) {
		if (givers[list].some((r) => id(r) === id(g))) return
		if (refused(g)) {
			lists.error = `${g.name} (object ${g.id}): ${refusedText}.`
			return
		}
		lists.error = ''
		lists.rows[list] = [...givers[list], vmangos.QuestGiver.createFrom({ ...g, patchMin: 0, patchMax: 10 })]
	}

	// Adding: a search over creatures (the world database) or game objects (the object list).
	let kind = $state<'creature' | 'object'>('creature')
	let query = $state('')
	let results = $state<vmangos.QuestGiver[]>([])
	let searching = $state(false)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		const k = kind
		clearTimeout(timer)
		if (!q) {
			results = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				let r: vmangos.QuestGiver[]
				if (k === 'creature') {
					r = ((await SearchCreatures(q)) ?? []).map((c) =>
						vmangos.QuestGiver.createFrom({ kind: 'creature', id: c.entry, name: c.subname ? `${c.name} <${c.subname}>` : c.name, ready: (c.npcFlags & 0x2) !== 0, spawns: -1, patchMin: 0, patchMax: 10 }),
					)
				} else {
					const lq = q.toLowerCase()
					r = (await loadObjectTemplates())
						.filter((o) => o.name.toLowerCase().includes(lq) || String(o.entry) === q)
						.slice(0, 100)
						.map((o) => vmangos.QuestGiver.createFrom({ kind: 'object', id: o.entry, name: o.name, ready: o.type === 2, spawns: -1, patchMin: 0, patchMax: 10 }))
				}
				if (q === query.trim() && k === kind) results = r
			} catch (err) {
				lists.error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	/** The spawn selected on the map, offered as a giver. */
	const selected = $derived.by(() => {
		const s = editor.selectedSpawn
		if (!s) return null
		const isObject = s.kind === 'object'
		return vmangos.QuestGiver.createFrom({ kind: isObject ? 'object' : 'creature', id: s.entry, name: s.name, ready: isObject ? s.type === 2 : (s.npcFlags & 0x2) !== 0, spawns: -1, patchMin: 0, patchMax: 10 })
	})

	const what = (g: vmangos.QuestGiver) => (g.kind === 'object' ? 'Object' : 'NPC')
	const spawnsText = (g: vmangos.QuestGiver) => (g.spawns < 0 ? '' : g.spawns === 0 ? ' · not spawned anywhere' : ` · ${g.spawns} ${g.spawns === 1 ? 'spawn' : 'spawns'}`)
</script>

<div class="givers">
	{#if lists.error}<p class="error">{lists.error}</p>{/if}
	<p class="dim">{lists.loading ? 'Loading the givers…' : 'Who offers the quest and who takes it in. Saved with Save quest.'}</p>

	{#each [['starts', 'Starts it', 'Offered by'], ['ends', 'Ends it', 'Handed in to']] as [list, title, what2] (list)}
		{@const rows = givers[list as List]}
		<h3>{title}{rows.length ? ` (${rows.length})` : ''}</h3>
		{#if rows.length === 0}
			<p class="dim">{what2} no one yet. {list === 'ends' ? 'A quest no one ends can never be handed in. ' : ''}Find a creature or object below to add one.</p>
		{:else}
			<ul class="list" aria-label={title}>
				{#each rows as g, i (id(g))}
					<li use:idMenu={{ ids: [idOf(g.kind, g.id)], name: g.name }}>
						<span class="kind">{what(g)}</span>
						<span class="name">{g.name || `(no ${g.kind} ${g.id})`}</span>
						<span class="dim">{g.id}{spawnsText(g)}{g.patchMin > 0 || g.patchMax < 10 ? ` · patches ${g.patchMin}–${g.patchMax}` : ''}</span>
						<button title="Remove" onclick={() => remove(list as List, i)}>✕</button>
					</li>
					{#if !g.ready}
						<li class="warn">
							{#if g.kind === 'creature'}
								<label class="check"
									><input type="checkbox" checked={flag[g.id] !== false} onchange={(e) => (flag[g.id] = e.currentTarget.checked)} /> No Quest giver flag, so it offers and takes no quests: give it the flag on Save</label
								>
							{:else}
								<span>Not a quest giver object (type 2), so the server ignores it here: change its type in the game object editor, or remove it.</span>
							{/if}
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
	{/each}

	<h3>Add</h3>
	{#if selected}
		<p class="sel">
			Selected on the map: <b>{selected.name}</b> <span class="dim">({what(selected)} {selected.id})</span>
			<button disabled={refused(selected) || givers.starts.some((r) => id(r) === id(selected))} title={refused(selected) ? refusedText : ''} onclick={() => add('starts', selected)}>Starts</button>
			<button disabled={refused(selected) || givers.ends.some((r) => id(r) === id(selected))} title={refused(selected) ? refusedText : ''} onclick={() => add('ends', selected)}>Ends</button>
		</p>
	{/if}
	<span class="search">
		<button class:on={kind === 'creature'} onclick={() => (kind = 'creature')}>Creatures</button>
		<button class:on={kind === 'object'} onclick={() => (kind = 'object')}>Objects</button>
		<input type="search" placeholder={kind === 'creature' ? 'Creature name or entry' : 'Object name or entry'} bind:value={query} />
	</span>
	{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
	{#if results.length}
		<ul class="list results">
			{#each results as r (id(r))}
				<li use:idMenu={{ ids: [idOf(r.kind, r.id)], name: r.name }}>
					<span class="name">{r.name}</span>
					<span class="dim">{r.id}{r.ready ? '' : r.kind === 'creature' ? ' · no Quest giver flag' : ' · not a quest giver (type 2), so it cannot be added'}</span>
					<button disabled={refused(r) || givers.starts.some((q) => id(q) === id(r))} title={refused(r) ? refusedText : ''} onclick={() => add('starts', r)}>Starts</button>
					<button disabled={refused(r) || givers.ends.some((q) => id(q) === id(r))} title={refused(r) ? refusedText : ''} onclick={() => add('ends', r)}>Ends</button>
				</li>
			{/each}
		</ul>
	{:else if query.trim() && !searching}
		<p class="dim">Nothing matches.</p>
	{/if}
</div>

<style>
	.givers {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 13px;
	}
	p {
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.dim {
		color: var(--text-dim);
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
	.list li.warn {
		color: var(--warn);
		padding-left: 52px;
	}
	.kind {
		min-width: 44px;
		color: var(--text-dim);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.list button,
	.sel button,
	.search button {
		padding: 1px 6px;
	}
	button.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.results {
		max-height: 260px;
		overflow-y: auto;
	}
	.search {
		display: flex;
		gap: 4px;
	}
	.search input {
		flex: 1;
		min-width: 0;
	}
	label.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
