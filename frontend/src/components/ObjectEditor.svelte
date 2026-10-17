<script lang="ts">
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { CreateObject, NextObjectLoot, ObjectModel, ReadObject, SaveObject } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { changedValues, fieldGroups } from '../lib/world/creatureFields'
	import { objectFieldGroups } from '../lib/world/objectFields'
	import { objectEntryFields } from '../lib/world/spawnEdits'
	import { objectTypeName, spawnType } from '../lib/world/spawnInfo'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import CreaturePreview from './CreaturePreview.svelte'
	import LootTab from './LootTab.svelte'
	import { forgetObjectTemplates, loadObjectTemplates, objectCategory } from './SpawnBrowser.svelte'
	import SpawnFields from './SpawnFields.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The game object editor (#136): one game object full screen, as the creature editor is for
	// creatures. The left shows its model; the right edits the spawn it was opened from (its place,
	// respawn time, and which object it is: a vein can become another vein, each change an undo step
	// saved with the region's spawns) and its template, every column of gameobject_template, saved to
	// the world database with Save. A new object starts here too, from scratch or as a copy. Contents
	// (#220) edits what a chest holds, its loot list, saved with the same Save.

	type Tab = 'spawn' | 'object' | 'contents' | 'new'

	const target = $derived(ui.objectEditor)
	/** The spawn the editor was opened from, as the panel's copy of it. */
	const spawn = $derived(target?.key && editor.selectedSpawn && spawnKey(editor.selectedSpawn) === target.key ? editor.selectedSpawn : null)

	let tab = $state<Tab>('object')
	let record = $state<vmangos.TemplateRecord | null>(null)
	let values = $state<Record<string, string>>({})
	let saved = $state<Record<string, string>>({})
	let error = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let confirmClose = $state(false)
	let lootDirty = $state(false)
	let lootTab = $state<LootTab | null>(null)

	const changes = $derived(changedValues(values, saved))
	const changeCount = $derived(Object.keys(changes).length)
	/** Anything unsaved: the template's values or the contents. */
	const unsaved = $derived(changeCount > 0 || lootDirty)
	const groups = $derived(record ? fieldGroups(record.columns.map((c) => c.name), objectFieldGroups(Number(values.type) || 0)) : [])
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))

	// Opening another object reads its template and picks the first tab.
	let loadedFor = ''
	$effect(() => {
		const t = target
		if (!t) return
		const id = `${t.key}|${t.entry}`
		if (id === loadedFor) return
		const sameSpawn = loadedFor !== '' && loadedFor.startsWith(`${t.key}|`) && t.key !== null
		loadedFor = id
		if (t.entry === 0) tab = 'new'
		else if (!sameSpawn) tab = t.key ? 'spawn' : 'object'
		if (t.entry > 0) copySource = null
		record = null
		values = {}
		saved = {}
		error = ''
		confirmClose = false
		lootDirty = false
		if (t.entry > 0) void load(t.entry)
	})

	async function load(entry: number) {
		loading = true
		try {
			const r = await ReadObject(entry)
			if (ui.objectEditor?.entry !== entry) return
			record = r
			values = { ...r.values }
			saved = { ...r.values }
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	// The spawn turned into another object (here, or by an undo): the Object tab follows it, once its
	// unsaved template changes are dealt with.
	let askedFor = -1
	$effect(() => {
		const t = target
		const s = spawn
		if (!t || !s || t.entry === 0 || s.entry === t.entry) return
		const follow = () => (ui.objectEditor = { key: t.key, entry: s.entry })
		if (!unsaved) {
			follow()
			return
		}
		if (askedFor === s.entry) return
		askedFor = s.entry
		afterDiscard = follow
		confirmClose = true
	})

	// The model of the template's display, for the preview.
	let templateModel = $state('')
	$effect(() => {
		const d = Number(values.displayId) || 0
		if (!record) return
		ObjectModel(d)
			.then((m) => (templateModel = m))
			.catch(() => (templateModel = ''))
	})

	/** The object under the pointer in the Change object list, shown big until the pointer leaves. */
	let hovered = $state<vmangos.ObjectTemplate | null>(null)
	const usingSpawn = $derived(tab === 'spawn' && spawn !== null)
	const preview = $derived(
		!target || target.entry === 0
			? null
			: hovered
				? { model: hovered.model, scale: hovered.size || 1, what: `${hovered.name} (entry ${hovered.entry})` }
				: usingSpawn && spawn
					? { model: spawn.model, scale: spawn.scale, what: 'this spawn as placed' }
					: record
						? { model: templateModel, scale: Number(values.size) || 1, what: "the object template's display" }
						: null,
	)

	const unsavedText = $derived(
		[changeCount ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'} to the object` : '', lootDirty ? 'unsaved changes to the contents' : '']
			.filter(Boolean)
			.join(', ') + '.',
	)

	/** What to do once unsaved changes are discarded: close, unless something else asked first. */
	let afterDiscard: (() => void) | null = null

	function close(force = false) {
		if (unsaved && !force) {
			afterDiscard = null
			confirmClose = true
			return
		}
		ui.objectEditor = null
		loadedFor = ''
		hovered = null
	}

	function discard() {
		revert()
		confirmClose = false
		const then = afterDiscard
		afterDiscard = null
		if (then) then()
		else close(true)
	}

	/** Drops the unsaved template values and contents. */
	function revert() {
		values = { ...saved }
		lootTab?.revert()
	}

	// Save writes the template first, so a chest points at its loot list before the list is written.
	async function save() {
		if (!record || !unsaved) return
		saving = true
		error = ''
		try {
			if (changeCount > 0) {
				const before = { ...saved }
				await SaveObject(record.entry, record.patch, changes)
				saved = { ...values }
				forgetObjectTemplates()
				await engineRef.current?.applyObjectTemplate(record.entry, values, before)
			}
			const rows = (await lootTab?.save()) ?? -1
			const what = rows >= 0 ? ` and its contents (${rows} ${rows === 1 ? 'row' : 'rows'})` : ''
			setStatus(`Saved ${values.name} (entry ${record.entry})${what} to the world database. Restart the world server and the game to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
		}
	}

	/**
	 * Makes the object a chest (Contents' Make it a chest): type 3 with a new, empty loot list, the lock
	 * of an ordinary chest such as the Solid Chest (57: Open and Treasure, so anyone opens it with the
	 * Opening cast), taken when looted so the spawn's respawn time brings it back. The other data
	 * columns meant something else for the old type, so they are cleared. Saved with Save.
	 */
	async function makeChest() {
		if (!record) return
		try {
			const loot = await NextObjectLoot()
			const v = { ...values }
			for (const c of record.columns) if (/^data\d+$/.test(c.name)) v[c.name] = '0'
			Object.assign(v, { type: '3', data0: '57', data1: String(loot), data3: '1' })
			values = v
			setStatus(`${values.name} is a chest now, with loot list ${loot}: add what it holds, then Save.`, 8000)
		} catch (err) {
			error = String(err)
		}
	}

	/** The template as the Place tool and the spawn's entry change take it, from the record's values. */
	function templateOf(entry: number, v: Record<string, string>): vmangos.ObjectTemplate {
		return { entry, name: v.name ?? '', type: Number(v.type) || 0, display: Number(v.displayId) || 0, size: Number(v.size) || 1, model: templateModel }
	}

	function place() {
		if (!record) return
		ui.placeObject = templateOf(record.entry, saved)
		ui.placeCreature = null
		editor.tool = 'select'
		close(true)
		setStatus(`Click the ground to place ${saved.name}. Shift+click places more; Esc stops.`, 10000)
	}

	// Change object: the world database's object templates, narrowed by category and a search.
	let templates = $state<vmangos.ObjectTemplate[]>([])
	let templatesError = $state('')
	let category = $state('')
	let query = $state('')
	$effect(() => {
		if (tab !== 'spawn' || templates.length) return
		loadObjectTemplates()
			.then((list) => (templates = list))
			.catch((err) => (templatesError = String(err)))
	})
	const current = $derived(spawn ? templates.find((t) => t.entry === spawn.entry) : undefined)
	// The list opens on the spawn's own category (Ore for a vein); "" lists every one.
	let categoryFor = -1
	$effect(() => {
		if (!spawn || spawn.guid === categoryFor || !templates.length) return
		categoryFor = spawn.guid
		category = current ? objectCategory(current) : objectTypeName(spawn.type)
		query = ''
	})
	const categories = $derived([...new Set(templates.map(objectCategory))].sort())
	const LIMIT = 200
	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase()
		return templates.filter((t) => (category === '' || objectCategory(t) === category) && (q === '' || t.name.toLowerCase().includes(q) || String(t.entry) === q))
	})

	function changeTo(t: vmangos.ObjectTemplate) {
		const s = spawn
		if (!s || t.entry === s.entry) return
		hovered = null
		void engineRef.current?.editSpawn(spawnKey(s), objectEntryFields(t), `Change ${s.name} to ${t.name}`)
	}

	// A new object: from scratch or as a copy of the one that was open.
	let newName = $state('')
	let copyThis = $state(true)
	let creating = $state(false)
	let copySource = $state<{ entry: number; name: string } | null>(null)
	function startNew() {
		if (target?.entry === 0) return
		copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
		const go = () => (ui.objectEditor = { key: null, entry: 0 })
		if (unsaved) {
			afterDiscard = go
			confirmClose = true
			return
		}
		go()
	}
	async function create() {
		const name = newName.trim()
		if (!name) return
		creating = true
		error = ''
		try {
			const base = copyThis && copySource ? copySource.entry : 0
			const entry = await CreateObject(base, name)
			newName = ''
			forgetObjectTemplates()
			templates = []
			ui.objectEditor = { key: null, entry }
			setStatus(`Made game object ${entry}, ${name}. Edit it, save, then place it.`, 8000)
		} catch (err) {
			error = String(err)
		} finally {
			creating = false
		}
	}

	function onKey(e: KeyboardEvent) {
		// The quest editor over it takes its own Esc.
		if (!target || ui.questEditor) return
		if (e.key === 'Escape') {
			const el = e.target as HTMLElement | null
			if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
				el.blur()
				return
			}
			e.preventDefault()
			if (confirmClose && unsaved) confirmClose = false
			else close()
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if target}
	<div class="editor" role="dialog" aria-modal="true" aria-label="Game object editor">
		<header>
			<div class="title">
				{#if target.entry > 0}
					<h2>{values.name || saved.name || 'Game object'}</h2>
					<span class="dim">
						entry {target.entry}{spawn ? ` · spawn ${spawn.guid}` : ''}{record ? ` · ${objectTypeName(Number(values.type) || 0)}` : ''}
					</span>
				{:else}
					<h2>New game object</h2>
				{/if}
			</div>
			<div class="actions">
				{#if record}
					<button disabled={saving} onclick={place} title="Place this object in the region">Place in world</button>
					<button disabled={!unsaved || saving} onclick={revert}>Revert</button>
					<button class="active" disabled={!unsaved || saving} onclick={save}>
						{saving ? 'Saving…' : unsaved ? `Save object (${changeCount + (lootDirty ? 1 : 0)})` : 'Saved'}
					</button>
				{/if}
				<button onclick={() => close()} title="Close (Esc)">Close</button>
			</div>
		</header>
		{#if confirmClose && unsaved}
			<div class="bar warn">
				<span>{unsavedText}</span>
				<button onclick={() => (confirmClose = false)}>Keep editing</button>
				<button class="danger" onclick={discard}>Discard them</button>
			</div>
		{/if}
		{#if error}<div class="bar error">{error}</div>{/if}

		<div class="body">
			<section class="left">
				{#if preview && preview.model}
					<CreaturePreview type={spawnType({ model: preview.model })} scale={preview.scale} />
				{:else}
					<div class="empty dim">
						{loading ? 'Loading…' : target.entry === 0 ? 'Name the new object on the right.' : preview ? 'Its display has no model: it is invisible in the game.' : ''}
					</div>
				{/if}
				<div class="under">
					<span class="dim">{preview ? `Showing ${preview.what}.` : ''}</span>
				</div>
			</section>

			<section class="right">
				<nav class="tabs">
					{#if spawn}<button class:on={tab === 'spawn'} onclick={() => (tab = 'spawn')}>This spawn</button>{/if}
					{#if record}<button class:on={tab === 'object'} onclick={() => (tab = 'object')}>Object</button>{/if}
					{#if record}<button class:on={tab === 'contents'} onclick={() => (tab = 'contents')}>Contents</button>{/if}
					<button class:on={target.entry === 0} onclick={startNew}>New object</button>
				</nav>

				<div class="scroll">
					{#if target.entry === 0}
						<div class="new">
							<p>Make a game object of your own for the world database. It gets the first free entry; edit it, save it, and place it.</p>
							<label>Name <input type="text" maxlength="100" placeholder="Name" bind:value={newName} /></label>
							{#if copySource}
								<label class="check"><input type="checkbox" bind:checked={copyThis} /> Copy {copySource.name} (its type, display, loot and lock)</label>
							{:else}
								<p class="dim">It starts as a generic object of size 1 with no display: set its type and display under Object once it's made. To start from an existing object, open that one and choose New object there.</p>
							{/if}
							<button class="active" disabled={!newName.trim() || creating} onclick={create}>{creating ? 'Making…' : 'Make object'}</button>
						</div>
					{:else if tab === 'spawn' && spawn}
						<h3>Which object</h3>
						<p class="dim">
							Now {spawn.name} (entry {spawn.entry}). Pick another to turn this spawn into it: an undo step, saved with the region's spawns{spawn.pool ? '. The other spawns of its pool stay as they are' : ''}.
						</p>
						<div class="pick">
							<select bind:value={category} aria-label="Category">
								<option value="">Every category</option>
								{#each categories as c (c)}<option value={c}>{c}</option>{/each}
							</select>
							<input type="search" placeholder="Search by name or entry" bind:value={query} />
						</div>
						{#if templatesError}<p class="error">{templatesError}</p>{/if}
						<ul class="list" aria-label="Game objects" onmouseleave={() => (hovered = null)}>
							{#each matches.slice(0, LIMIT) as t (t.entry)}
								<li>
									<button class="row" class:active={t.entry === spawn.entry} title="Entry {t.entry}" onclick={() => changeTo(t)} onmouseenter={() => (hovered = t)}>
										<span class="name">{t.name}</span>
										<span class="dim">{t.entry}{t.model ? '' : ' · no model'}</span>
									</button>
								</li>
							{:else}
								<li class="dim">{templates.length ? 'Nothing matches.' : 'Reading the objects…'}</li>
							{/each}
						</ul>
						{#if matches.length > LIMIT}<p class="dim">Showing {LIMIT} of {matches.length}. Narrow the search to see the rest.</p>{/if}
						<h3>This spawn</h3>
						<SpawnFields s={spawn} />
						<p class="dim hint">Changes to this spawn are undo steps and are saved with the region's spawns (File › Save Spawns to Database…).</p>
					{:else if tab === 'contents'}
						<!-- The Contents tab stays mounted below, so its unsaved rows survive a tab switch. -->
					{:else if record}
						{#each groups as g (g.title)}
							<h3>{g.title}</h3>
							<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={(col, v) => (values[col] = v)} />
						{/each}
					{:else if loading}
						<p class="dim">Loading the object…</p>
					{/if}
					{#if record && target.entry > 0}
						<div hidden={tab !== 'contents'}>
							<LootTab
								bind:this={lootTab}
								bind:dirty={lootDirty}
								entry={record.entry}
								name={values.name || saved.name || 'This object'}
								type={Number(values.type) || 0}
								loot={Number(values.data1) || 0}
								consumed={(Number(values.data3) || 0) !== 0}
								restock={Number(values.data2) || 0}
								{spawn}
								onmakechest={makeChest}
								onsetloot={(id) => (values.data1 = String(id))}
								onset={(col, v) => (values[col] = v)}
							/>
						</div>
					{/if}
				</div>
			</section>
		</div>
	</div>
{/if}

<style>
	.editor {
		position: fixed;
		inset: 0;
		z-index: 150;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.title {
		flex: 1;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
	.bar.warn span {
		flex: 1;
	}
	.bar.error,
	.error {
		color: var(--danger);
		overflow-wrap: anywhere;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.left {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.under {
		font-size: 12px;
	}
	.right {
		/* One width on every tab, so the preview beside it never moves. */
		flex: none;
		width: min(560px, 45vw);
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--panel);
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		border-radius: 4px 4px 0 0;
		border-bottom: none;
	}
	.tabs button.on {
		background: var(--accent);
		color: #fff;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.pick {
		display: flex;
		gap: 6px;
	}
	.pick input {
		flex: 1;
		min-width: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 240px;
		flex: none;
		overflow-y: auto;
		border: 1px solid var(--border);
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 4px 8px;
		font-size: 12px;
	}
	.row.active {
		background: var(--accent);
		color: #fff;
	}
	.row .name {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.new {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 13px;
	}
	.new label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.new label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.new p {
		margin: 0;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.hint {
		font-size: 11px;
	}
</style>
