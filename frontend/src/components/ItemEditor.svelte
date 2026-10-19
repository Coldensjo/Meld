<script lang="ts">
	import { CreateItem, ExportItems, ImportItems, ItemModelLook, OpenItemsDialog, PlanItemImport, ReadItemTemplate, SaveItem, SearchItems } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { changedValues } from '../lib/world/creatureFields'
	import { HELD_TYPES, itemTabs } from '../lib/world/itemFields'
	import { tabOfColumn } from '../lib/world/questFields'
	import { forgetItemRow, itemTooltipNames } from '../lib/wow/items'
	import { QUALITY_COLORS, tooltipLines, type TooltipNames } from '../lib/wow/itemTooltip'
	import { forgetName } from '../lib/wow/refNames'
	import CreaturePreview from './CreaturePreview.svelte'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltipBox from './ItemTooltipBox.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The item editor (#353, Tools › Items…): find an item or make one (blank, or a copy of the open
	// one), edit every column of its item_template row on tabs, and see it as the game shows it: its
	// tooltip, which follows every change before it is saved, and the item in a character's hand (or on
	// its head or shoulders), or alone. Its look is one of the client's item displays, taken from
	// another item or typed. Save writes the row to the world database; Export writes items to an SQL
	// script, and Import reads one back. The server reads items when it starts.

	const target = $derived(ui.itemEditor)

	let tab = $state('item')
	let record = $state<vmangos.TemplateRecord | null>(null)
	let values = $state<Record<string, string>>({})
	let saved = $state<Record<string, string>>({})
	let error = $state('')
	let note = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let confirmClose = $state(false)

	const changes = $derived(changedValues(values, saved))
	const changeCount = $derived(Object.keys(changes).length)
	const unsaved = $derived(changeCount > 0)
	const tabs = $derived(record ? itemTabs(record.columns.map((c) => c.name), Number(values.class) || 0) : [])
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))
	/** How many changes each tab holds, for its label. */
	const tabChanges = $derived(new Map(tabs.map((t) => [t.id, t.groups.reduce((n, g) => n + g.fields.filter((f) => changes[f.col] !== undefined).length, 0)])))

	// Opening another item reads it.
	let loadedFor = 0
	$effect(() => {
		const t = target
		if (!t) {
			loadedFor = 0
			return
		}
		if (t.entry === loadedFor) return
		loadedFor = t.entry
		record = null
		values = {}
		saved = {}
		error = ''
		confirmClose = false
		if (t.entry > 0) void load(t.entry)
	})

	async function load(entry: number) {
		loading = true
		try {
			const r = await ReadItemTemplate(entry)
			if (ui.itemEditor?.entry !== entry) return
			record = r
			values = { ...r.values }
			saved = { ...r.values }
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	/** What to do once unsaved changes are discarded: close, unless something else asked first. */
	let afterDiscard: (() => void) | null = null

	/** Runs `go` now, or once the unsaved changes are kept or discarded. */
	function leave(go: () => void) {
		if (!unsaved) {
			go()
			return
		}
		afterDiscard = go
		confirmClose = true
	}

	function close(force = false) {
		if (unsaved && !force) {
			afterDiscard = null
			confirmClose = true
			return
		}
		ui.itemEditor = null
		loadedFor = 0
		note = ''
		plan = null
	}

	function discard() {
		revert()
		confirmClose = false
		const then = afterDiscard
		afterDiscard = null
		if (then) then()
		else close(true)
	}

	function revert() {
		values = { ...saved }
	}

	function open(entry: number) {
		if (target?.entry === entry) return
		leave(() => {
			note = ''
			ui.itemEditor = { entry }
		})
	}

	/** Forgets what the session knows of items that changed, so tooltips and pickers read them again. */
	function forgetItems(entries: number[]) {
		for (const e of entries) {
			forgetItemRow(e)
			forgetName('item', e)
		}
		searchVersion++
	}

	const RESTART = 'Restart the world server for the server to use it; the game asks for the item again when it starts from Meld.'

	async function save() {
		if (!record || !unsaved) return
		saving = true
		error = ''
		note = ''
		try {
			const n = changeCount
			await SaveItem(record.entry, record.patch, changes)
			saved = { ...values }
			forgetItems([record.entry])
			note = `Saved ${n} ${n === 1 ? 'value' : 'values'} of ${values.name} (item ${record.entry}) to the world database. ${RESTART}`
			setStatus(note, 10000)
		} catch (err) {
			error = String(err)
			// A refused value: show the tab it is on.
			const col = error.replace(/^Error:\s*/, '').split(/\s/)[0]
			const t = tabOfColumn(tabs, col)
			if (t) tab = t
		} finally {
			saving = false
		}
	}

	// Find: items by name or entry.
	let query = $state('')
	let found = $state<vmangos.ItemRef[]>([])
	let searching = $state(false)
	let searchVersion = $state(0)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		void searchVersion
		clearTimeout(timer)
		if (!q) {
			found = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = await SearchItems(q)
				if (q === query.trim()) found = r ?? []
			} catch (err) {
				error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	// A new item: blank, or a copy of the one that was open.
	let newName = $state('')
	let copyThis = $state(true)
	let creating = $state(false)
	let copySource = $state<{ entry: number; name: string } | null>(null)
	const isNew = $derived(target?.entry === -1)

	function startNew() {
		if (isNew) return
		leave(() => {
			copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
			copyThis = copySource !== null
			note = ''
			ui.itemEditor = { entry: -1 }
		})
	}

	async function create() {
		const name = newName.trim()
		if (!name) return
		creating = true
		error = ''
		try {
			const base = copyThis && copySource ? copySource.entry : 0
			const entry = await CreateItem(base, name)
			newName = ''
			searchVersion++
			ui.itemEditor = { entry }
			tab = 'item'
			note = `Made item ${entry}, ${name}. Fill it in and save.${base ? '' : ' Give it a look with Take the look of…, on the right.'}`
			setStatus(note, 8000)
		} catch (err) {
			error = String(err)
		} finally {
			creating = false
		}
	}

	// Export and import: SQL scripts of item_template rows.
	async function exportItem() {
		if (!record) return
		error = ''
		try {
			const file = (saved.name || `item-${record.entry}`).replace(/[^\w\- ]+/g, '').trim() || `item-${record.entry}`
			const path = await ExportItems([record.entry], file)
			if (!path) return
			note = `Exported ${saved.name} (item ${record.entry}) to ${path}${unsaved ? ', as saved: the unsaved changes are not in it' : ''}.`
			setStatus(note, 8000)
		} catch (err) {
			error = String(err)
		}
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.ItemImport } | null>(null)
	let importing = $state(false)

	function askImport() {
		leave(async () => {
			error = ''
			note = ''
			try {
				const path = await OpenItemsDialog()
				if (!path) return
				plan = { path, plan: await PlanItemImport(path) }
			} catch (err) {
				error = String(err)
			}
		})
	}

	async function confirmImport() {
		if (!plan) return
		importing = true
		error = ''
		try {
			const entries = (await ImportItems(plan.path)) ?? []
			const n = plan.plan.items.length
			plan = null
			forgetItems(entries)
			// The open item is read again when the import wrote it.
			if (target && entries.includes(target.entry)) {
				loadedFor = 0
				ui.itemEditor = { entry: target.entry }
			} else if (entries.length) ui.itemEditor = { entry: entries[0] }
			note = `Imported ${n} item ${n === 1 ? 'row' : 'rows'} into the world database. ${RESTART}`
			setStatus(note, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			importing = false
		}
	}

	// The preview: the item on a character of the chosen race and sex, or alone.
	const RACES: Array<[number, string]> = [
		[1, 'Human'],
		[2, 'Orc'],
		[3, 'Dwarf'],
		[4, 'Night Elf'],
		[5, 'Undead'],
		[6, 'Tauren'],
		[7, 'Gnome'],
		[8, 'Troll'],
	]
	let race = $state(1)
	let sex = $state(0)
	let alone = $state(false)
	let look = $state<vmangos.ItemLook | null>(null)
	const display = $derived(Number(values.display_id) || 0)
	const invType = $derived(Number(values.inventory_type) || 0)
	$effect(() => {
		const key = `${display}|${invType}|${race}|${sex}`
		if (!record) {
			look = null
			return
		}
		ItemModelLook(display, invType, race, sex)
			.then((l) => key === `${display}|${invType}|${race}|${sex}` && (look = l))
			.catch((err) => (error = String(err)))
	})
	/** Slots whose armour the game paints onto the body (shirt, chest, waist, legs, feet, wrists, hands, back, tabard, robe). */
	const BODY_TYPES = new Set([4, 5, 6, 7, 8, 9, 10, 16, 19, 20])
	const where = $derived(
		HELD_TYPES.has(invType) ? (invType === 14 ? 'on the shield arm' : invType === 15 || invType === 25 || invType === 26 ? 'drawn, as a ranged weapon is held' : 'in hand') : invType === 1 ? 'on the head' : invType === 3 ? 'on the shoulders' : '',
	)
	const preview = $derived.by(() => {
		if (!look) return null
		if (alone) return look.item ? { model: look.item, look: look.itemLook, scale: 1 } : null
		return look.model ? { model: look.model, look: look.look, scale: look.scale || 1 } : null
	})
	const previewText = $derived.by(() => {
		if (!record || !look) return ''
		if (!display) return 'It has no display: no icon and no model. Take the look of another item below.'
		const raceName = RACES.find(([r]) => r === race)?.[1] ?? ''
		if (look.shown && !alone) return `${invType === 1 || invType === 3 ? 'Worn' : 'Held'} ${where}, on ${/^[AEIOU]/.test(raceName) ? 'an' : 'a'} ${raceName} ${sex ? 'woman' : 'man'}.`
		if (look.item) return 'The model alone, as the game draws it held or worn.'
		if (where) return 'Its display has no model the game would show.'
		if (BODY_TYPES.has(invType)) return "Armour for the body is painted onto the character's skin in the game, which Meld doesn't show: only its icon and tooltip here."
		if (invType > 0) return "The game doesn't show it on a character: only its icon and tooltip."
		return 'It has no model of its own: in the game it is only its icon.'
	})

	// The tooltip follows the unsaved values; the names it shows are read again when the numbers they come from change.
	let names = $state<TooltipNames>({})
	const namesKey = $derived(
		[1, 2, 3, 4, 5].map((i) => values[`spellid_${i}`] ?? '').join(',') + `|${values.required_skill}|${values.required_spell}|${values.required_reputation_faction}`,
	)
	$effect(() => {
		const key = namesKey
		if (!record) return
		void itemTooltipNames($state.snapshot(values)).then((n) => key === namesKey && (names = n))
	})
	const lines = $derived(record ? tooltipLines({ ...values, entry: String(record.entry) }, names) : [])

	// Take the look of another item: its display_id.
	let lookOpen = $state(false)
	let lookQuery = $state('')
	let lookFound = $state<vmangos.ItemRef[]>([])
	let lookTimer = 0
	$effect(() => {
		const q = lookQuery.trim()
		clearTimeout(lookTimer)
		if (!q) {
			lookFound = []
			return
		}
		lookTimer = window.setTimeout(() => {
			SearchItems(q)
				.then((r) => q === lookQuery.trim() && (lookFound = (r ?? []).filter((i) => i.displayId > 0)))
				.catch((err) => (error = String(err)))
		}, 250)
	})
	function takeLook(i: vmangos.ItemRef) {
		values.display_id = String(i.displayId)
		lookOpen = false
		lookQuery = ''
	}

	function onKey(e: KeyboardEvent) {
		if (!target || e.key !== 'Escape') return
		const el = e.target as HTMLElement | null
		if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
			el.blur()
			return
		}
		e.preventDefault()
		if (plan) plan = null
		else if (confirmClose && unsaved) confirmClose = false
		else close()
	}
</script>

<svelte:window onkeydown={onKey} />

{#if target}
	<div class="editor" role="dialog" aria-modal="true" aria-label="Item editor">
		<header>
			<div class="title">
				{#if target.entry > 0}
					<h2 style:color={QUALITY_COLORS[Number(values.quality)] ?? undefined}>{values.name || saved.name || 'Item'}</h2>
					<span class="dim">item {target.entry}{record ? ` · patch ${record.patch}` : ''}</span>
				{:else if target.entry === -1}
					<h2>New item</h2>
				{:else}
					<h2>Items</h2>
					<span class="dim">Find an item to edit, or make a new one.</span>
				{/if}
			</div>
			<div class="actions">
				<button onclick={askImport} title="Read items from an SQL script into the world database">Import…</button>
				{#if record}
					<button onclick={exportItem} title="Write this item to an SQL script">Export…</button>
					<button disabled={!unsaved || saving} onclick={revert}>Revert</button>
					<button class="active" disabled={!unsaved || saving} onclick={save}>
						{saving ? 'Saving…' : unsaved ? `Save item (${changeCount})` : 'Saved'}
					</button>
				{/if}
				<button onclick={() => close()} title="Close (Esc)">Close</button>
			</div>
		</header>
		{#if plan}
			<div class="bar warn plan">
				<div class="what">
					<strong>Import {plan.plan.items.length} item {plan.plan.items.length === 1 ? 'row' : 'rows'} into the world database?</strong>
					<span>
						{plan.plan.items
							.slice(0, 12)
							.map((i) => `${i.name || 'item'} (${i.entry}${i.patch ? `, patch ${i.patch}` : ''}${i.exists ? ', replaces it' : ', new'})`)
							.join('; ')}{plan.plan.items.length > 12 ? `; and ${plan.plan.items.length - 12} more` : ''}.
					</span>
					{#if plan.plan.skipped}<span>{plan.plan.skipped} other {plan.plan.skipped === 1 ? 'statement is' : 'statements are'} left out: only item_template rows are imported.</span>{/if}
					{#if plan.plan.unknown?.length}<span>Columns this server's item_template lacks are left out: {plan.plan.unknown.join(', ')}.</span>{/if}
					<span>A replaced item can't be brought back, unless you exported it first.</span>
				</div>
				<button onclick={() => (plan = null)}>Cancel</button>
				<button class="active" disabled={importing} onclick={confirmImport}>{importing ? 'Importing…' : 'Import'}</button>
			</div>
		{/if}
		{#if confirmClose && unsaved}
			<div class="bar warn">
				<span>{changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'} to the item.</span>
				<button onclick={() => (confirmClose = false)}>Keep editing</button>
				<button class="danger" onclick={discard}>Discard them</button>
			</div>
		{/if}
		{#if error}<div class="bar error">{error}</div>{/if}
		{#if note && !error}<div class="bar ok">{note}</div>{/if}

		<div class="body">
			<aside>
				<button class="new" class:active={isNew} onclick={startNew}>New item…</button>
				<input type="search" placeholder="Item name or entry" bind:value={query} aria-label="Find an item" />
				<ul class="found" aria-label="Items found">
					{#each found as i (i.entry)}
						<li>
							<button class:on={i.entry === target.entry} onclick={() => open(i.entry)}>
								<ItemIcon displayId={i.displayId} />
								<span class="name" style:color={i.entry === target.entry ? undefined : QUALITY_COLORS[i.quality]}>{i.name || '(no name)'}</span>
								<span class="dim">{i.entry}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{searching ? 'Searching…' : query.trim() ? 'No item matches.' : 'Type a name to search the world database.'}</li>
					{/each}
				</ul>
			</aside>

			<section class="main">
				{#if target.entry === -1}
					<div class="new-form">
						<p>Make an item of your own for the world database. It gets the first free entry; fill it in and save.</p>
						<label>Name <input type="text" maxlength="255" placeholder="Name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && create()} /></label>
						{#if copySource}
							<label class="check"><input type="checkbox" bind:checked={copyThis} /> Copy {copySource.name} (item {copySource.entry}): its look, stats and effects</label>
						{/if}
						{#if !copySource || !copyThis}
							<p class="dim">It starts as a common junk item with no look. To start from an existing item, open that one and choose New item there.</p>
						{/if}
						<button class="active" disabled={!newName.trim() || creating} onclick={create}>{creating ? 'Making…' : 'Make item'}</button>
					</div>
				{:else if target.entry === 0}
					<div class="empty dim">Find an item on the left, make a new one, or import some.</div>
				{:else}
					<nav class="tabs">
						{#each tabs as t (t.id)}
							<button class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.title}{tabChanges.get(t.id) ? ` (${tabChanges.get(t.id)})` : ''}</button>
						{/each}
					</nav>
					<div class="scroll">
						{#if !record}
							<p class="dim">{loading ? 'Loading the item…' : ''}</p>
						{:else}
							{#each tabs as t (t.id)}
								{#if t.id === tab}
									{#each t.groups as g (g.title)}
										<h3>{g.title}</h3>
										<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={(col, v) => (values[col] = v)} />
									{/each}
								{/if}
							{/each}
						{/if}
					</div>
				{/if}
			</section>

			{#if record && target.entry > 0}
				<section class="look" aria-label="How the item looks">
					<div class="model">
						{#if preview}
							<CreaturePreview model={preview.model} look={preview.look} scale={preview.scale} />
						{:else}
							<div class="empty dim">{look ? 'Nothing to show.' : 'Loading…'}</div>
						{/if}
					</div>
					<div class="controls">
						<div class="seg" role="group" aria-label="Show">
							<button class:on={!alone} onclick={() => (alone = false)}>On a character</button>
							<button class:on={alone} onclick={() => (alone = true)}>Item alone</button>
						</div>
						{#if !alone}
							<select bind:value={race} aria-label="Race">
								{#each RACES as [id, name] (id)}<option value={id}>{name}</option>{/each}
							</select>
							<select bind:value={sex} aria-label="Sex">
								<option value={0}>Male</option>
								<option value={1}>Female</option>
							</select>
						{/if}
					</div>
					<p class="dim">{previewText}</p>
					<div class="display" class:changed={changes.display_id !== undefined}>
						<ItemIcon displayId={display} size={24} />
						<label title="ItemDisplayInfo.dbc ID: the item's model and icon (display_id)"
							>Display <input type="number" min="0" value={values.display_id ?? ''} oninput={(e) => (values.display_id = (e.currentTarget as HTMLInputElement).value)} /></label
						>
						<button onclick={() => (lookOpen = !lookOpen)}>Take the look of…</button>
					</div>
					{#if lookOpen}
						<div class="lookpick">
							<input type="search" placeholder="Another item's name or entry" bind:value={lookQuery} aria-label="Find an item to take the look of" />
							<ul class="found small">
								{#each lookFound.slice(0, 40) as i (i.entry)}
									<li>
										<button onclick={() => takeLook(i)} title="Display {i.displayId}">
											<ItemIcon displayId={i.displayId} />
											<span class="name" style:color={QUALITY_COLORS[i.quality]}>{i.name}</span>
											<span class="dim">{i.displayId}</span>
										</button>
									</li>
								{:else}
									<li class="dim">{lookQuery.trim() ? 'No item with a look matches.' : 'Type the name of an item whose look you want.'}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<h3>Tooltip</h3>
					<div class="tooltip"><ItemTooltipBox {lines} displayId={display} /></div>
				</section>
			{/if}
		</div>
	</div>
{/if}

<style>
	.editor {
		position: fixed;
		inset: 0;
		z-index: 165;
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
	.bar.plan .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bar.error {
		color: var(--danger);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.bar.ok {
		color: #6fdc6f;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	aside {
		width: 280px;
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
	.found.small {
		flex: none;
		max-height: 220px;
		border: 1px solid var(--border);
	}
	.found button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 3px 6px;
		text-align: left;
	}
	.found button:hover {
		background: var(--panel-2);
	}
	.found button.on {
		background: var(--accent);
		color: #fff;
	}
	.found .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
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
		padding: 12px 16px;
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
	.look {
		/* One width, so the fields beside it never move. */
		flex: none;
		width: min(400px, 34vw);
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-left: 1px solid var(--border);
		background: var(--panel);
		overflow-y: auto;
	}
	.model {
		flex: none;
		height: min(420px, 45vh);
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.controls {
		display: flex;
		gap: 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.seg {
		display: flex;
	}
	.seg button {
		border-radius: 0;
	}
	.seg button:first-child {
		border-radius: 4px 0 0 4px;
	}
	.seg button:last-child {
		border-radius: 0 4px 4px 0;
	}
	.seg button.on {
		background: var(--accent);
		color: #fff;
	}
	.display {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.display label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-dim);
	}
	.display input {
		width: 90px;
	}
	.display.changed input {
		color: var(--accent);
		border-color: var(--accent);
	}
	.lookpick {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.tooltip {
		display: flex;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
</style>
