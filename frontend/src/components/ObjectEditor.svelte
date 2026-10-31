<script lang="ts">
	import { untrack } from 'svelte'
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { SERVER_RELOADS } from '../lib/io/applyNote'
	import { shareForget } from '../lib/toolwin/editorPage'
	import type { SlotTarget } from '../lib/toolwin/editors'
	import { mapActions, selectSpawnOnMap } from '../lib/toolwin/spawnFieldsHost.svelte'
	import { CreateObject, ExportObjects, ImportObjects, NextObjectLoot, ObjectModel, OpenObjectsDialog, PlanObjectImport, ReadObject, SaveObject } from '../lib/wails/App'
	import type { vmangos } from '../lib/wails/models'
	import { TemplateEditor } from '../lib/ui/templateEditor.svelte'
	import { focusField } from '../lib/ui/focusField'
	import { askImport as planImport, exportRow, runImport } from '../lib/ui/templateIo'
	import { fieldGroups } from '../lib/world/creatureFields'
	import { objectFieldGroups, pageColumn } from '../lib/world/objectFields'
	import { objectEntryFields } from '../lib/world/spawnEdits'
	import { objectTypeName, spawnType } from '../lib/world/spawnInfo'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import CreaturePreview from './CreaturePreview.svelte'
	import DisplayPicker, { forgetObjectDisplays } from './DisplayPicker.svelte'
	import EditorFrame from './EditorFrame.svelte'
	import LootTab from './LootTab.svelte'
	import ObjectSoundsTab from './ObjectSoundsTab.svelte'
	import PagesTab from './PagesTab.svelte'
	import QuestsTab from './QuestsTab.svelte'
	import { forgetObjectTemplates, loadObjectTemplates, objectCategory } from './SpawnBrowser.svelte'
	import SpawnFields from './SpawnFields.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The game object editor (#136): one game object full screen, as the creature editor is for
	// creatures. The left shows its model; the right edits the spawn it was opened from (its place,
	// respawn time, and which object it is: a vein can become another vein, each change an undo step
	// saved with the region's spawns) and its template, every column of gameobject_template, saved to
	// the world database with Save. A new object starts here too, from scratch or as a copy. Contents
	// (#220) edits what a chest holds, its loot list, saved with the same Save. Quests (#293) edits the
	// quests the object offers and takes in, saved apart with its own Save quests, as the creature
	// editor's tab does; only a Quest giver object (type 2) gets new ones. Find object (#351), the tab
	// Tools › Game Objects… opens on, lists every object template with no spawn selected, and a click
	// opens that object to edit. Display (#230) picks the template's display from thumbnails, as the
	// creature editor's Looks tab does; hovering a tile shows it big on the left. Sounds (#674) sets the
	// sounds the game plays near the object, its display's sound slots in the client's
	// GameObjectDisplayInfo.dbc, written into Meld's patch with the same Save; a display other objects share
	// can be copied to one of the object's own there first (#723). Text (#139) edits what a
	// readable object (a tombstone, a plaque, a note) says, its page_text pages, saved with the same Save.
	// Export… and Import… (#939) write and read an SQL script of the object's template rows with its
	// quests and contents (internal/vmangos/objectscripts.go).

	// In the desktop app it opens as its own OS window (#916, components/toolwin/EditorToolWindow.svelte), as
	// the creature editor does: it runs whole on that page's own `ui.objectEditor` and tells the window when it
	// has unsaved changes. What it does on the map (the spawn's fields and its change to another object, a
	// saved template applied to its spawns, Place in world, a pool mate picked) goes through mapActions
	// (lib/toolwin/spawnFieldsHost.svelte.ts): in its window each is a command the main page runs as an undo
	// step of its History; the spawn it shows is the main page's selected one.
	let { onunsaved }: { onunsaved?: (unsaved: boolean) => void } = $props()
	const map = mapActions()

	type Tab = 'spawn' | 'object' | 'display' | 'text' | 'sounds' | 'contents' | 'quests' | 'find' | 'new'

	/** GAMEOBJECT_TYPE_QUESTGIVER: the one object type the server lets offer and take quests. */
	const QUEST_GIVER_TYPE = 2
	/** GAMEOBJECT_TYPE_TEXT: a readable object, its first page in data0. */
	const TEXT_TYPE = 9

	const target = $derived(ui.objectEditor)
	/** The spawn the editor was opened from, as the panel's copy of it. */
	const spawn = $derived(target?.key && editor.selectedSpawn && spawnKey(editor.selectedSpawn) === target.key ? editor.selectedSpawn : null)

	let tab = $state<Tab>('object')
	let lootDirty = $state(false)
	let lootTab = $state<LootTab | null>(null)
	let questsDirty = $state(false)
	let questsTab = $state<QuestsTab | null>(null)
	let soundsDirty = $state(false)
	let soundsTab = $state<ObjectSoundsTab | null>(null)
	let pagesDirty = $state(false)
	let pagesTab = $state<PagesTab | null>(null)

	// Opening another object reads its template and picks the first tab.
	const ed = new TemplateEditor<{ key: string | null; entry: number }, vmangos.TemplateRecord>({
		id: (t) => `${t.key}|${t.entry}`,
		entry: (t) => t.entry,
		read: ReadObject,
		clear: () => (ui.objectEditor = null),
		dirty: () => lootDirty || questsDirty || soundsDirty || pagesDirty,
		onopen: (t, before) => {
			const sameSpawn = before !== '' && before.startsWith(`${t.key}|`) && t.key !== null
			if (t.entry === 0) {
				tab = wantNew ? 'new' : 'find'
				// Opened from the Tools menu: the search starts over, on every category.
				if (!wantNew) {
					category = ''
					query = ''
				}
			} else if (!sameSpawn) tab = t.key ? 'spawn' : 'object'
			wantNew = false
			if (t.entry > 0) copySource = null
			lootDirty = false
			questsDirty = false
			soundsDirty = false
			pagesDirty = false
		},
		onrevert: () => {
			lootTab?.revert()
			soundsTab?.revert()
			pagesTab?.revert()
		},
		ondiscard: () => questsTab?.revert(),
		onclose: () => {
			hovered = null
			hoveredDisplay = null
		},
	})
	ed.follow(() => target)
	// Opened on a tab of its own (the right-click menu's Edit text…), once the opening above has picked its first one.
	$effect(() => {
		const want = target?.tab
		if (want) untrack(() => (tab = want))
	})
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	const changeCount = $derived(ed.changeCount)
	/** Anything unsaved that Save object writes: the template's values, the contents, the text or the sounds. */
	const unsaved = $derived(changeCount > 0 || lootDirty || pagesDirty || soundsDirty)
	/** Anything unsaved at all, the quests (saved apart) too: what closing asks about. */
	const anyUnsaved = $derived(ed.unsaved)
	$effect(() => onunsaved?.(anyUnsaved))

	/** Opens the editor on `t` (its window was opened again on another object or spawn, or on its Text tab), asking about unsaved changes first. */
	export function openTarget(t: SlotTarget) {
		const next = { key: t.key ?? null, entry: t.entry, ...(t.tab ? { tab: t.tab } : {}), ...(t.field ? { field: t.field } : {}) }
		if (!target) ui.objectEditor = next
		else if (target.key !== next.key || target.entry !== next.entry) ed.leave(() => (ui.objectEditor = next))
		else if (next.tab) tab = next.tab
		else if (t.field) wantField = t.field
	}

	// Opened on a column (File › Check Map's Edit, #951): once its template is read, the Object tab,
	// scrolled to the column's field.
	let wantField = $state<string | null>(null)
	$effect(() => {
		const f = target?.field
		if (f) untrack(() => (wantField = f))
	})
	$effect(() => {
		const col = wantField
		if (!col || !record || record.entry !== target?.entry) return
		untrack(() => {
			wantField = null
			tab = 'object'
			focusField(col)
		})
	})

	/** Closes the editor, asking first with unsaved changes: its window's own close button (#916). */
	export function askClose() {
		ed.close()
	}

	/** Forgets the object templates and displays the lists read, here and in the main page. */
	function forgetObjects() {
		forgetObjectTemplates()
		forgetObjectDisplays()
		shareForget({ objectTemplates: true })
	}
	// The model of the template's display, for the preview and the Display box's note.
	let templateModel = $state('')
	$effect(() => {
		const d = Number(values.displayId) || 0
		if (!record) return
		ObjectModel(d)
			.then((m) => (templateModel = m))
			.catch(() => (templateModel = ''))
	})

	const groups = $derived(
		record
			? fieldGroups(
					record.columns.map((c) => c.name),
					objectFieldGroups(Number(values.type) || 0, templateModel),
				)
			: [],
	)
	/** The column holding the object's first page, for the Text tab (null for a type that reads none). */
	const pageCol = $derived(pageColumn(Number(values.type) || 0))
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))

	// The spawn turned into another object (here, or by an undo): the Object tab follows it, once its
	// unsaved template changes are dealt with.
	let askedFor = -1
	$effect(() => {
		const t = target
		const s = spawn
		if (!t || !s || t.entry === 0 || s.entry === t.entry) return
		const follow = () => (ui.objectEditor = { key: t.key, entry: s.entry })
		if (!anyUnsaved) {
			follow()
			return
		}
		if (askedFor === s.entry) return
		askedFor = s.entry
		ed.leave(follow)
	})

	/** The object under the pointer in the Change object list, shown big until the pointer leaves. */
	let hovered = $state<vmangos.ObjectTemplate | null>(null)
	/** The display under the pointer in the Display tab's picker. */
	let hoveredDisplay = $state<vmangos.DisplayEntry | null>(null)
	const usingSpawn = $derived(tab === 'spawn' && spawn !== null)
	const preview = $derived(
		!target
			? null
			: hovered
				? { model: hovered.model, scale: hovered.size || 1, what: `${hovered.name} (entry ${hovered.entry})` }
				: tab === 'display' && hoveredDisplay
					? { model: hoveredDisplay.model, scale: Number(values.size) || 1, what: `display ${hoveredDisplay.id}` }
					: target.entry === 0
						? null
						: usingSpawn && spawn
							? { model: spawn.model, scale: spawn.scale, what: 'this spawn as placed' }
							: record
								? { model: templateModel, scale: Number(values.size) || 1, what: "the object template's display" }
								: null,
	)

	const unsavedText = $derived(
		[
			changeCount ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'} to the object` : '',
			lootDirty ? 'unsaved changes to the contents' : '',
			pagesDirty ? 'unsaved changes to the text' : '',
			soundsDirty ? 'unsaved changes to the sounds' : '',
			questsDirty ? 'unsaved changes to the quests' : '',
		]
			.filter(Boolean)
			.join(', ') + '.',
	)

	// Save writes the template first, so a chest points at its loot list before the list is written.
	function save() {
		const r = record
		if (!r || !unsaved) return
		void ed.save('Saving the game object', async () => {
			if (changeCount > 0) {
				const before = { ...saved }
				await SaveObject(r.entry, r.patch, changes)
				ed.markSaved()
				forgetObjects()
				await map.applyObjectTemplate(r.entry, $state.snapshot(values), before)
			}
			const rows = (await lootTab?.save()) ?? -1
			const pages = (await pagesTab?.save()) ?? -1
			const what = (rows >= 0 ? ` and its contents (${rows} ${rows === 1 ? 'row' : 'rows'})` : '') + (pages >= 0 ? ` and its text (${pages} ${pages === 1 ? 'page' : 'pages'})` : '')
			const database = changeCount > 0 || rows >= 0 || pages >= 0
			// The sounds last: they are the client's, and the database's share is written by then.
			const sounds = (await soundsTab?.save()) ?? null
			const heard = !sounds?.changed ? '' : sounds.waiting ? " Its sounds wait for the game to close, then go into the client's patch." : " Its sounds are in the client's patch."
			const said = database ? `Saved ${values.name} (entry ${r.entry})${what} to the world database. ${SERVER_RELOADS} Restart the game to see it there.` : `Saved the sounds of ${values.name}'s display.`
			setStatus(said + heard + (sounds?.changed && !database ? ' Restart the game to hear them.' : ''), 10000)
		})
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
			ed.values = v
			setStatus(`${values.name} is a chest now, with loot list ${loot}: add what it holds, then Save.`, 8000)
		} catch (err) {
			ed.error = String(err)
		}
	}

	/**
	 * Makes the object readable (Text's Make it readable): a text object (type 9) with no text yet, which
	 * the Text tab then gives. The other data columns meant something else for the old type, so they are
	 * cleared. Saved with Save.
	 */
	function makeReadable() {
		if (!record) return
		const v = { ...values }
		for (const c of record.columns) if (/^data\d+$/.test(c.name)) v[c.name] = '0'
		v.type = String(TEXT_TYPE)
		ed.values = v
		setStatus(`${values.name} is a text object now: give it its text, then Save.`, 8000)
	}

	/** The template as the Place tool and the spawn's entry change take it, from the record's values. */
	function templateOf(entry: number, v: Record<string, string>): vmangos.ObjectTemplate {
		return { entry, name: v.name ?? '', type: Number(v.type) || 0, display: Number(v.displayId) || 0, size: Number(v.size) || 1, model: templateModel }
	}

	function place() {
		if (!record) return
		map.placeObject(templateOf(record.entry, $state.snapshot(saved)))
		ed.close(true)
		setStatus(`Click the ground to place ${saved.name}. Shift+click places more; Esc stops.`, 10000)
	}

	// Change object: the world database's object templates, narrowed by category and a search.
	let templates = $state<vmangos.ObjectTemplate[]>([])
	let templatesError = $state('')
	let category = $state('')
	let query = $state('')
	$effect(() => {
		if ((tab !== 'spawn' && tab !== 'find') || templates.length) return
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

	/** Find object's click: opens that object on its Object tab, once unsaved changes are dealt with. */
	function openObject(t: vmangos.ObjectTemplate) {
		hovered = null
		if (target?.entry === t.entry) {
			tab = 'object'
			return
		}
		const go = () => (ui.objectEditor = { key: null, entry: t.entry })
		ed.leave(go)
	}

	/** A pool mate was picked: the editor moves to it, once unsaved changes are dealt with. */
	function switchTo(o: vmangos.WorldSpawn) {
		const go = () => {
			selectSpawnOnMap(o)
			ui.objectEditor = { key: spawnKey(o), entry: o.entry }
		}
		ed.leave(go)
	}

	function changeTo(t: vmangos.ObjectTemplate) {
		const s = spawn
		if (!s || t.entry === s.entry) return
		hovered = null
		map.edit(spawnKey(s), objectEntryFields(t), `Change ${s.name} to ${t.name}`)
	}

	// A new object: from scratch or as a copy of the one that was open.
	let newName = $state('')
	let copyThis = $state(true)
	let creating = $state(false)
	let copySource = $state<{ entry: number; name: string } | null>(null)
	/** Set just before New object opens the editor on entry 0, which otherwise opens on Find object. */
	let wantNew = false
	function startNew() {
		if (target?.entry === 0) {
			tab = 'new'
			return
		}
		copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
		const go = () => {
			wantNew = true
			ui.objectEditor = { key: null, entry: 0 }
		}
		ed.leave(go)
	}
	async function create() {
		const name = newName.trim()
		if (!name) return
		creating = true
		ed.error = ''
		try {
			const base = copyThis && copySource ? copySource.entry : 0
			const entry = await CreateObject(base, name)
			newName = ''
			forgetObjects()
			templates = []
			ui.objectEditor = { key: null, entry }
			setStatus(`Made game object ${entry}, ${name}. Edit it, save, then place it.`, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}

	// Export and import (#939): SQL scripts of gameobject_template rows with the quests each object starts
	// and ends and a chest's contents (internal/vmangos/objectscripts.go).
	function exportObject() {
		if (record) void exportRow(ed, { kind: 'object', entry: record.entry, name: saved.name ?? '', unsaved, write: ExportObjects })
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.ObjectImport } | null>(null)
	let importing = $state(false)

	function askImport() {
		planImport(ed, { pick: OpenObjectsDialog, plan: PlanObjectImport, set: (p) => (plan = p) })
	}

	function confirmImport() {
		if (!plan) return
		const { path } = plan
		void runImport(ed, {
			run: () => ImportObjects(path),
			clear: () => (plan = null),
			forget: () => {
				forgetObjects()
				templates = []
			},
			open: target?.entry,
			openEntry: (entry) => {
				// The open object's tabs read their rows again: the import replaced its quests and contents.
				if (entry === target?.entry) {
					lootTab?.revert()
					questsTab?.revert()
				}
				ui.objectEditor = { key: entry === target?.entry ? target.key : null, entry }
			},
			note: (entries) => `Imported ${entries.length} game ${entries.length === 1 ? 'object' : 'objects'} into the world database. ${SERVER_RELOADS} Restart the game to see it there.`,
			status: 10000,
			busy: (b) => (importing = b),
		})
	}

	/** A list the import replaces, as the plan bar says it. */
	function listText(l: vmangos.ListImport): string {
		return `${l.what} of ${l.of} ${l.entry} (${l.rows}${l.had ? `, replacing ${l.had}` : ''})`
	}

	/** The objects that hold a loot list the import replaces, as the plan bar says them. */
	function sharedText(shared: vmangos.LootShare[]): string {
		const list = shared.slice(0, 8).map((s) => `${s.name || 'object'} (${s.entry}, loot list ${s.loot}${s.spawns ? `, ${s.spawns} ${s.spawns === 1 ? 'spawn' : 'spawns'}` : ''})`)
		return list.join('; ') + (shared.length > 8 ? `; and ${shared.length - 8} more` : '')
	}
</script>

{#if target}
	<EditorFrame {ed} kind="object" label="Game object editor" z="editor" {unsavedText} blocked={() => !!ui.questEditor}>
		{#snippet title()}
			{#if target.entry > 0}
				<h2>{values.name || saved.name || 'Game object'}</h2>
				<span class="dim">
					entry {target.entry}{spawn ? ` · spawn ${spawn.guid}` : ''}{record ? ` · ${objectTypeName(Number(values.type) || 0)}` : ''}
				</span>
			{:else if tab === 'new'}
				<h2>New game object</h2>
			{:else}
				<h2>Game objects</h2>
				<span class="dim">Find one to edit, or make a new one</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			<button onclick={askImport} title="Read game objects, with their quests and contents, from an SQL script into the world database">Import…</button>
			{#if record}
				<button onclick={exportObject} title="Write this object, with its quests and contents, to an SQL script">Export…</button>
				<button disabled={ed.saving} onclick={place} title="Place this object in the region">Place in world</button>
				<button disabled={!unsaved || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={!unsaved || ed.saving} onclick={save}>
					{ed.saving ? 'Saving…' : unsaved ? `Save object (${changeCount + (lootDirty ? 1 : 0) + (pagesDirty ? 1 : 0) + (soundsDirty ? 1 : 0)})` : 'Saved'}
				</button>
			{/if}
		{/snippet}
		{#snippet bars()}
			{#if plan}
				{@const rows = plan.plan.objects}
				<div class="bar warn plan">
					<div class="what">
						<strong>Import {rows.length} game object {rows.length === 1 ? 'row' : 'rows'} into the world database?</strong>
						<span>
							{rows
								.slice(0, 12)
								.map((o) => `${o.name || 'object'} (${o.entry}${o.patch ? `, patch ${o.patch}` : ''}${o.exists ? ', replaces it' : ', new'})`)
								.join('; ')}{rows.length > 12 ? `; and ${rows.length - 12} more` : ''}.
						</span>
						{#if plan.plan.lists?.length}
							<span>Replaces the lists: {plan.plan.lists.slice(0, 12).map(listText).join('; ')}{plan.plan.lists.length > 12 ? `; and ${plan.plan.lists.length - 12} more` : ''}.</span>
						{:else}
							<span>The script carries no quest lists or contents: the objects keep theirs.</span>
						{/if}
						{#if plan.plan.shared?.length}<span>Other objects here hold a loot list it replaces, and get the new contents too: {sharedText(plan.plan.shared)}.</span>{/if}
						{#if plan.plan.missingItems?.length}<span>Items this world database lacks, which the contents then list but the server leaves out: {plan.plan.missingItems.join(', ')}. Import them first (Tools › Items).</span>{/if}
						{#if plan.plan.missingQuests?.length}<span>Quests this world database lacks, which the server leaves out: {plan.plan.missingQuests.join(', ')}.</span>{/if}
						{#if plan.plan.others}<span>{plan.plan.others} list {plan.plan.others === 1 ? 'statement or row is' : 'statements and rows are'} of objects or loot lists the script's templates don't name, and left out.</span>{/if}
						{#if plan.plan.skipped}<span>{plan.plan.skipped} other {plan.plan.skipped === 1 ? 'statement is' : 'statements are'} left out: only gameobject_template rows, quest lists and contents are imported.</span>{/if}
						{#if plan.plan.unknown?.length}<span>Columns this server's tables lack are left out: {plan.plan.unknown.join(', ')}.</span>{/if}
						<span>A replaced object or list can't be brought back, unless you exported it first.</span>
					</div>
					<button onclick={() => (plan = null)}>Cancel</button>
					<button class="active" disabled={importing} onclick={confirmImport}>{importing ? 'Importing…' : 'Import'}</button>
				</div>
			{/if}
		{/snippet}

		<div class="body">
			<section class="left">
				{#if preview && preview.model}
					<CreaturePreview type={spawnType({ model: preview.model })} scale={preview.scale} />
				{:else}
					<div class="empty dim">
						{ed.loading
							? 'Loading…'
							: target.entry === 0
								? tab === 'new'
									? 'Name the new object on the right.'
									: 'Point at an object in the list to see it here.'
								: preview
									? 'Its display has no model: it is invisible in the game.'
									: ''}
					</div>
				{/if}
				<div class="under">
					<span class="dim">{preview ? `Showing ${preview.what}.` : ''}</span>
				</div>
			</section>

			<section class="right">
				<nav class="tabs">
					{#if !spawn}<button class:on={tab === 'find'} onclick={() => (tab = 'find')}>Find object</button>{/if}
					{#if spawn}<button class:on={tab === 'spawn'} onclick={() => (tab = 'spawn')}>This spawn</button>{/if}
					{#if record}<button class:on={tab === 'object'} onclick={() => (tab = 'object')}>Object</button>{/if}
					{#if record}<button class:on={tab === 'display'} onclick={() => (tab = 'display')}>Display</button>{/if}
					{#if record}<button class:on={tab === 'text'} onclick={() => (tab = 'text')}>Text{pagesDirty ? ' (1)' : ''}</button>{/if}
					{#if record}<button class:on={tab === 'sounds'} onclick={() => (tab = 'sounds')}>Sounds{soundsDirty ? ' (1)' : ''}</button>{/if}
					{#if record}<button class:on={tab === 'contents'} onclick={() => (tab = 'contents')}>Contents</button>{/if}
					{#if record}<button class:on={tab === 'quests'} onclick={() => (tab = 'quests')}>Quests{questsDirty ? ' (1)' : ''}</button>{/if}
					<button class:on={tab === 'new'} onclick={startNew}>New object</button>
				</nav>

				<div class="scroll">
					{#if tab === 'new' && target.entry === 0}
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
					{:else if tab === 'find' && !spawn}
						<p class="dim">Every game object in the world database. Pick one to open it and edit its template, contents and quests.</p>
						<div class="pick">
							<select bind:value={category} aria-label="Category">
								<option value="">Every category</option>
								{#each categories as c (c)}<option value={c}>{c}</option>{/each}
							</select>
							<input type="search" placeholder="Search by name or entry" bind:value={query} />
						</div>
						{#if templatesError}<p class="error">{templatesError}</p>{/if}
						<ul class="list tall" aria-label="Game objects" onmouseleave={() => (hovered = null)}>
							{#each matches.slice(0, LIMIT) as t (t.entry)}
								<li>
									<button
										class="row"
										use:idMenu={{ ids: [idOf('object', t.entry)], name: t.name }}
										class:active={t.entry === target.entry}
										title="Entry {t.entry}"
										onclick={() => openObject(t)}
										onmouseenter={() => (hovered = t)}
									>
										<span class="name">{t.name}</span>
										<span class="dim">{objectCategory(t)} · {t.entry}{t.model ? '' : ' · no model'}</span>
									</button>
								</li>
							{:else}
								<li class="dim">{templates.length ? 'Nothing matches.' : 'Reading the objects…'}</li>
							{/each}
						</ul>
						{#if matches.length > LIMIT}<p class="dim">Showing {LIMIT} of {matches.length}. Narrow the search to see the rest.</p>{/if}
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
									<button
										class="row"
										use:idMenu={{ ids: [idOf('object', t.entry)], name: t.name }}
										class:active={t.entry === spawn.entry}
										title="Entry {t.entry}"
										onclick={() => changeTo(t)}
										onmouseenter={() => (hovered = t)}
									>
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
						<SpawnFields s={spawn} onswitch={switchTo} />
						<p class="dim hint">Changes to this spawn are undo steps and are saved with the region's spawns (File › Save Spawns to Database…).</p>
					{:else if tab === 'display' && record}
						<p class="dim">
							{Number(values.displayId) > 0 ? `Now display ${values.displayId}${templateModel ? `: ${templateModel}` : ', which has no model'}.` : 'No display yet: it is invisible in the game.'}
							A click sets it, saved with Save object. Hover a tile to see it big on the left.
						</p>
						<DisplayPicker kind="object" selected={Number(values.displayId) || 0} onpick={(d) => (values.displayId = String(d.id))} onhover={(d) => (hoveredDisplay = d)} />
					{:else if tab === 'contents' || tab === 'quests' || tab === 'sounds' || tab === 'text'}
						<!-- The Contents, Text, Quests and Sounds tabs stay mounted below, so their unsaved rows survive a tab switch. -->
					{:else if record}
						{#each groups as g (g.title)}
							<h3>{g.title}</h3>
							<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={(col, v) => (values[col] = v)} />
						{/each}
					{:else if ed.loading}
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
						<div hidden={tab !== 'text'}>
							<PagesTab
								bind:this={pagesTab}
								bind:dirty={pagesDirty}
								entry={record.entry}
								name={values.name || saved.name || 'This object'}
								type={Number(values.type) || 0}
								column={pageCol}
								page={pageCol ? Number(values[pageCol]) || 0 : 0}
								onsetpage={(id) => pageCol && (values[pageCol] = String(id))}
								onmakereadable={makeReadable}
							/>
						</div>
						<div hidden={tab !== 'sounds'}>
							<ObjectSoundsTab
								bind:this={soundsTab}
								bind:dirty={soundsDirty}
								display={Number(values.displayId) || 0}
								savedDisplay={Number(saved.displayId) || 0}
								active={tab === 'sounds'}
								onowndisplay={(d) => (values.displayId = String(d))}
							/>
						</div>
						<div hidden={tab !== 'quests'}>
							<QuestsTab bind:this={questsTab} bind:dirty={questsDirty} kind="object" entry={record.entry} name={saved.name || values.name || ''} ready={Number(saved.type) === QUEST_GIVER_TYPE} />
						</div>
					{/if}
				</div>
			</section>
		</div>
	</EditorFrame>
{/if}

<style>
	.bar.plan .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
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
		width: min(560px, calc(45 * var(--vw)));
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--panel);
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
	.list.tall {
		max-height: none;
		flex: 1;
		min-height: 120px;
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
		color: var(--accent-ink);
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
