<script lang="ts">
	import { NextPage, ReadObjectPages, SavePages } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { RowList, moveRow, removeRow } from '../lib/ui/rowList.svelte'
	import { objectTypeName } from '../lib/world/spawnInfo'

	// The game object editor's Text tab (#139): what a readable object says when a player uses it (a
	// tombstone, a plaque, a wanted poster), its page_text pages, edited as a list and saved with the
	// editor's Save, as the Contents tab is (the world database keeps no undo). A text object (type 9)
	// reads from the page its data0 names, a goober (type 10) from its data7; each page names the next.
	// Other objects, items and texts can read the same pages: the tab names them, and gives this
	// object a copy of its own on asking. An object of another type can be made readable here.

	interface Props {
		/** The object template's entry. */
		entry: number
		name: string
		/** The template's type as the editor has it now, saved or not. */
		type: number
		/** The column holding its first page (pageColumn), null for a type that reads none. */
		column: string | null
		/** Its first page, as the editor has it now. */
		page: number
		/** Points the object at first page `id`. */
		onsetpage: (id: number) => void
		/** Turns the object into a text object (template changes, saved with Save). */
		onmakereadable: () => void
		dirty?: boolean
	}
	let { entry, name, type, column, page, onsetpage, onmakereadable, dirty = $bindable(false) }: Props = $props()

	/** The first page the pages are edited for, their texts and entries, what else reads them, and the object's spawns. */
	type Text = { first: number; pages: string[]; entries: number[]; users: vmangos.PageUser[]; spawns: number }
	const rows = new RowList<Text>({
		empty: { first: 0, pages: [], entries: [], users: [], spawns: 0 },
		read: async () => {
			const r = await ReadObjectPages(entry, page)
			const pages = r.pages ?? []
			return { first: page, pages: pages.map((p) => p.text), entries: pages.map((p) => p.entry), users: r.users ?? [], spawns: r.spawns }
		},
		// The first page leads the key, so a copy (a new first page) counts as an edit.
		key: (t) => `${t.first}|${JSON.stringify(t.pages)}`,
	})
	const pages = $derived(rows.rows.pages)
	const users = $derived(rows.rows.users)
	const spawns = $derived(rows.rows.spawns)
	const first = $derived(rows.rows.first)
	$effect(() => {
		dirty = column !== null && first > 0 && rows.dirty
	})

	// The pages follow the object and its first page; a first page this tab picked itself (a copy) keeps them.
	rows.follow(() => `${entry}|${page}`)

	/** Drops the unsaved pages: reads the ones the object points at again. */
	export function revert() {
		rows.followed = `${entry}|${page}`
		void rows.revert()
	}

	/** Writes the pages; returns how many it saved, or -1 when nothing needed saving. */
	export async function save(): Promise<number> {
		if (!dirty) return -1
		await SavePages(first, pages)
		rows.markSaved()
		// Read back the entries the new pages got.
		void rows.load()
		return pages.length
	}

	/** Moves the object onto a new first page, keeping `texts` as its pages (a copy, or a first text). */
	async function newText(texts: string[], said: string) {
		try {
			const id = await NextPage()
			rows.followed = `${entry}|${id}`
			rows.rows = { first: id, pages: texts, entries: [], users: [], spawns }
			onsetpage(id)
			setStatus(said.replace('{id}', String(id)), 8000)
		} catch (err) {
			rows.error = String(err)
		}
	}

	function setPage(i: number, text: string) {
		const l = [...pages]
		l[i] = text
		rows.rows.pages = l
	}

	/** Adds an empty page after page `i` (-1: at the end). */
	function addPage(i: number) {
		const at = i < 0 ? pages.length : i + 1
		rows.rows.pages = [...pages.slice(0, at), '', ...pages.slice(at)]
		rows.rows.entries = [...rows.rows.entries.slice(0, at), 0, ...rows.rows.entries.slice(at)]
	}
	function move(i: number, d: number) {
		rows.rows.pages = moveRow(pages, i, d)
		rows.rows.entries = moveRow(rows.rows.entries, i, d)
	}
	function remove(i: number) {
		rows.rows.pages = removeRow(pages, i)
		rows.rows.entries = removeRow(rows.rows.entries, i)
	}

	const spawnWord = (n: number) => `${n} ${n === 1 ? 'spawn' : 'spawns'}`
	const userText = (u: vmangos.PageUser) => (u.kind === 'object' ? `game object ${u.entry} · ${spawnWord(u.spawns)}` : u.kind === 'item' ? `item ${u.entry}` : `page ${u.entry} of another text`)
</script>

<div class="text">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}

	{#if column === null}
		<p>A {objectTypeName(type).toLowerCase()} has nothing to read: only a text object (a tombstone, a plaque, a note) or a goober shows pages when used.</p>
		<p><button class="active" onclick={onmakereadable}>Make it readable</button></p>
		<p class="dim">Its type becomes Text; what the data columns meant for a {objectTypeName(type).toLowerCase()} is cleared. Then give it its text here. Saved with Save.</p>
		{#if spawns > 0}
			<p class="warn">{name} has {spawnWord(spawns)} in the world, and every one becomes readable. To change only this spawn, make a copy (New object, then turn this spawn into it under This spawn).</p>
		{/if}
	{:else if page <= 0}
		<p>{name} has no text yet, so using it shows nothing.</p>
		<p><button class="active" onclick={() => newText([''], `${name} now reads page {id}. Write it, then Save.`)}>Give it text</button></p>
	{:else}
		{#if users.length}
			<div class="warn">
				<p>
					This text is shared: {users.length === 1 ? 'something else reads' : `${users.length} other things read`} its pages, so a change here changes {users.length === 1 ? 'its' : 'theirs'} too.
				</p>
				<ul class="users">
					{#each users.slice(0, 8) as u (`${u.kind}${u.entry}`)}
						<li use:idMenu={u.kind === 'page' ? { ids: [idOf('page', u.entry)] } : { ids: [idOf(u.kind === 'item' ? 'item' : 'object', u.entry)], name: u.name }}>
							{u.kind === 'page' ? `“${u.name}…”` : u.name} <span class="dim">{userText(u)}</span>
						</li>
					{/each}
					{#if users.length > 8}<li class="dim">and {users.length - 8} more</li>{/if}
				</ul>
				<button onclick={() => newText([...pages], `${name} now reads page {id}, a copy of the shared text. Save to keep it.`)}>Give {name} its own copy</button>
			</div>
		{/if}

		<div class="head">
			<h3>Pages{pages.length ? ` (${pages.length})` : ''}</h3>
			<span class="dim">from page {page}{spawns ? ` · ${spawnWord(spawns)} of ${name}` : ''}</span>
		</div>
		{#if rows.loading}
			<p class="dim">Loading the text…</p>
		{:else}
			{#if pages.length === 0}
				<p class="dim">Page {page} isn't in the world database yet: add a page to write it.</p>
			{/if}
			{#each pages as text, i (i)}
				<div class="page">
					<div class="page-head">
						<span class="num">Page {i + 1}</span>
						<span class="dim">{rows.rows.entries[i] ? `entry ${rows.rows.entries[i]}` : 'new'}</span>
						<span class="grow"></span>
						<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
						<button title="Move down" disabled={i === pages.length - 1} onclick={() => move(i, 1)}>↓</button>
						<button title="Add a page after this one" onclick={() => addPage(i)}>+</button>
						<button title="Remove this page" disabled={pages.length === 1} onclick={() => remove(i)}>✕</button>
					</div>
					<textarea rows="8" spellcheck="true" aria-label="Page {i + 1}" value={text} oninput={(e) => setPage(i, e.currentTarget.value)}></textarea>
				</div>
			{/each}
			<p><button onclick={() => addPage(-1)}>Add a page</button></p>
			<p class="dim">
				$B is a line break and $N the reader's name, as in the client's own pages; a page that starts with &lt;HTML&gt; is shown as written, with its headings and paragraphs. The Object tab sets the language it is written in and its
				page material (parchment, stone, marble…).
			</p>
			<p class="dim">
				Saved to the world database with Save. Restart the world server to read it in the game; the game keeps the pages it has read in WDB\pagetextcache.wdb, and Meld takes the changed ones out of it once the game is closed.
			</p>
		{/if}
	{/if}
</div>

<style>
	.text {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	p {
		margin: 0;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 13px;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.head h3 {
		flex: 1;
	}
	.warn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel-2);
	}
	.users {
		margin: 0;
		padding-left: 16px;
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
	}
	.page {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.page-head .num {
		font-weight: 600;
	}
	.page-head .grow {
		flex: 1;
	}
	.page-head button {
		padding: 1px 6px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		font: inherit;
		line-height: 1.4;
	}
</style>
