<script lang="ts">
	import { copyItems } from '../lib/ui/copyId'
	import { CreateItem, CreateItemOfKind, ExportItems, ImportItems, ItemDisplayVariant, ItemModelLook, ListItemKinds, OpenItemsDialog, PlanItemImport, ReadItemTemplate, SaveItem, SearchItemsSorted } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { askImport as planImport, copyCommand as copyGmCommand, exportRow, runImport } from '../lib/ui/templateIo'
	import { TemplateEditor, checkRefused, tabChangeCounts } from '../lib/ui/templateEditor.svelte'
	import { HELD_TYPES, INVENTORY_TYPES, ITEM_CLASSES, itemTabs, SHOOTS_LIKE, slotKind, subclassOptions } from '../lib/world/itemFields'
	import { tabOfColumn } from '../lib/world/questFields'
	import { forgetItemIcons, forgetItemRow, itemTooltipNames } from '../lib/wow/items'
	import { QUALITY_VARS, tooltipLines, type TooltipNames } from '../lib/wow/itemTooltip'
	import { forgetName } from '../lib/wow/refNames'
	import CreaturePreview from './CreaturePreview.svelte'
	import EquipBonuses from './EquipBonuses.svelte'
	import ItemIcon from './ItemIcon.svelte'
	import ItemLookPicker, { forgetLooks, loadItemDisplays } from './ItemLookPicker.svelte'
	import ItemTooltipBox from './ItemTooltipBox.svelte'
	import EditorFrame from './EditorFrame.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The item editor (#353, Tools › Items…): find an item or make one (blank, or a copy of the open
	// one), edit every column of its item_template row on tabs, and see it as the game shows it: its
	// tooltip, which follows every change before it is saved, and the item in a character's hand (or on
	// its head or shoulders, painted onto its body, or on its back as a cloak, #356), or alone. Its look is one of the client's item displays, picked from a
	// grid of their icons (hovering one previews it) or typed, and its icon can be picked apart from
	// the model: Save then makes the display that pairs them. Save writes the row to the world database; Export writes items to an SQL
	// script, and Import reads one back. The server reads items when it starts.

	const target = $derived(ui.itemEditor)

	let tab = $state('item')
	// The look: a display picked from the client's (a click; the one under the pointer is previewed),
	// or an icon for the item's model, which Save turns into a display.
	let pendingIcon = $state('')
	/** A shot visual for the look, waiting for Save like the icon (-1 for none): Make it shoot like a bow. */
	let pendingVisual = $state(-1)
	/** Change look or Change icon, taking over the middle: the grid's pick and the tile under the pointer. */
	let changing = $state<'' | 'look' | 'icon'>('')
	let candidate = $state<number | string | null>(null)
	let hoverPick = $state<number | string | null>(null)

	const ed = new TemplateEditor<{ entry: number }, vmangos.TemplateRecord>({
		id: (t) => String(t.entry),
		entry: (t) => t.entry,
		read: ReadItemTemplate,
		clear: () => (ui.itemEditor = null),
		dirty: () => lookChanges > 0,
		onopen: () => {
			pendingIcon = ''
			pendingVisual = -1
			changing = ''
		},
		onrevert: () => {
			pendingIcon = ''
			pendingVisual = -1
		},
		onclose: () => (plan = null),
	})
	ed.follow(() => target)
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	const changeCount = $derived(ed.changeCount)
	/** The look's changes waiting for Save, made into a display then: a picked icon, a shot visual. */
	const lookChanges = $derived((pendingIcon ? 1 : 0) + (pendingVisual >= 0 ? 1 : 0))
	const unsaved = $derived(ed.unsaved)
	const tabs = $derived(
		record
			? itemTabs(
					record.columns.map((c) => c.name),
					Number(values.class) || 0,
				)
			: [],
	)
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))
	/** How many changes each tab holds, for its label. */
	const tabChanges = $derived(tabChangeCounts(tabs, changes))

	function open(entry: number) {
		if (target?.entry === entry) return
		ed.leave(() => {
			ed.note = ''
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

	function save() {
		const r = record
		if (!r || !unsaved) return
		void ed.save(
			'Saving the item',
			async () => {
				// A picked icon first becomes a display: the client's that pairs it with the model, or a new one in Meld's patch.
				let added = ''
				if (lookChanges) {
					const d = await ItemDisplayVariant(display, pendingIcon, pendingVisual)
					if (d.added) {
						forgetItemIcons()
						const what = [pendingIcon, pendingVisual >= 0 ? `shooting like ${SHOOTS_LIKE[subclass] ?? 'its weapon'}` : ''].filter(Boolean).join(', ')
						added = ` Added display ${d.id} (its model with ${what}) to the client's patch.`
					}
					values.display_id = String(d.id)
					pendingIcon = ''
					pendingVisual = -1
				}
				const n = changeCount
				if (n > 0) checkRefused(await SaveItem(r.entry, r.patch, ed.changes))
				ed.markSaved()
				forgetItems([r.entry])
				forgetLooks()
				ed.note = `Saved ${n} ${n === 1 ? 'value' : 'values'} of ${values.name} (item ${r.entry}) to the world database.${added} ${RESTART}`
				setStatus(ed.note, 10000)
			},
			// A refused value: show the tab it is on.
			(col) => (tab = tabOfColumn(tabs, col) ?? tab),
		)
	}

	// Find: items by name or entry.
	let query = $state('')
	let found = $state<vmangos.ItemRef[]>([])
	let searching = $state(false)
	let searchVersion = $state(0)
	let timer = 0
	/** The search's orders (#677), done in SQL before its limit of 100, so a broad search gives the highest items, not the first by name. */
	const SORTS: [string, string][] = [
		['name', 'Name'],
		['entry', 'Entry'],
		['quality', 'Quality'],
		['itemLevel', 'Item level'],
		['requiredLevel', 'Required level'],
	]
	/** The number a result shows on the right: its entry, or the level it is sorted by. */
	const sideNumber = (i: vmangos.ItemRef) => (prefs.itemSort === 'itemLevel' ? `ilvl ${i.itemLevel ?? 0}` : prefs.itemSort === 'requiredLevel' ? `lvl ${i.requiredLevel ?? 0}` : String(i.entry))
	$effect(() => {
		const q = query.trim()
		const sort = prefs.itemSort
		const desc = prefs.itemSortDesc
		void searchVersion
		clearTimeout(timer)
		if (!q) {
			found = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = await SearchItemsSorted(q, sort, desc)
				if (q === query.trim() && sort === prefs.itemSort && desc === prefs.itemSortDesc) found = r ?? []
			} catch (err) {
				ed.error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	// A new item: a kind of item (a bow, a cloth chest…) with the usual basics of the database's items
	// of that kind and no stats, a blank junk item, or a copy of the one that was open.
	let newName = $state('')
	let startFrom = $state<'kind' | 'blank' | 'copy'>('kind')
	let creating = $state(false)
	let copySource = $state<{ entry: number; name: string; kind: string } | null>(null)
	const isNew = $derived(target?.entry === -1)

	let kinds = $state<vmangos.ItemKind[]>([])
	let kindClass = $state(2)
	/** The picked kind's subclass and inventory type, as "subclass|invType". */
	let kindKey = $state('')
	const kindClasses = $derived(ITEM_CLASSES.filter(([c]) => kinds.some((k) => k.class === c)))
	const classKinds = $derived(kinds.filter((k) => k.class === kindClass))
	const kindName = (k: vmangos.ItemKind) => {
		const sub = subclassOptions(k.class).find(([v]) => v === k.subclass)?.[1] ?? `Subclass ${k.subclass}`
		const slot = INVENTORY_TYPES.find(([v]) => v === k.invType)?.[1] ?? `Slot ${k.invType}`
		return `${sub} · ${slot}`
	}
	const picked = $derived(classKinds.find((k) => `${k.subclass}|${k.invType}` === kindKey))
	// Another class starts on its most common kind.
	$effect(() => {
		if (classKinds.length && !picked) kindKey = `${[...classKinds].sort((a, b) => b.count - a.count)[0].subclass}|${[...classKinds].sort((a, b) => b.count - a.count)[0].invType}`
	})

	function startNew() {
		if (isNew) return
		ed.leave(() => {
			copySource = record ? { entry: record.entry, name: saved.name ?? '', kind: `${saved.class}|${saved.subclass}|${saved.inventory_type}` } : null
			startFrom = 'kind'
			// The kind of the item that was open, when the database has it.
			if (copySource) {
				const [c, sub, inv] = copySource.kind.split('|').map(Number)
				kindClass = c
				kindKey = `${sub}|${inv}`
			}
			ed.note = ''
			ui.itemEditor = { entry: -1 }
		})
	}
	$effect(() => {
		if (isNew && !kinds.length)
			ListItemKinds().then(
				(k) => (kinds = k ?? []),
				(err) => (ed.error = String(err)),
			)
	})

	async function create() {
		const name = newName.trim()
		if (!name) return
		creating = true
		ed.error = ''
		try {
			let entry: number
			let made: string
			if (startFrom === 'kind' && picked) {
				entry = await CreateItemOfKind(picked.class, picked.subclass, picked.invType, name)
				made = ` with the usual basics of ${kindName(picked).toLowerCase()} items: give it its damage or armour, stats, level and price.`
			} else {
				const base = startFrom === 'copy' && copySource ? copySource.entry : 0
				entry = await CreateItem(base, name)
				made = base ? `, a copy of ${copySource?.name}.` : '. Pick its look on the right.'
			}
			newName = ''
			searchVersion++
			ui.itemEditor = { entry }
			tab = 'item'
			ed.note = `Made item ${entry}, ${name}${made}`
			setStatus(ed.note, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}

	// Export and import: SQL scripts of item_template rows.
	function exportItem() {
		if (record) void exportRow(ed, { kind: 'item', entry: record.entry, name: saved.name, unsaved, write: ExportItems })
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.ItemImport } | null>(null)
	let importing = $state(false)

	function askImport() {
		planImport(ed, { pick: OpenItemsDialog, plan: PlanItemImport, set: (p) => (plan = p) })
	}

	function confirmImport() {
		if (!plan) return
		const { path, plan: p } = plan
		const n = p.items.length
		void runImport(ed, {
			run: () => ImportItems(path),
			clear: () => (plan = null),
			forget: forgetItems,
			open: target?.entry,
			openEntry: (entry) => (ui.itemEditor = { entry }),
			note: () => `Imported ${n} item ${n === 1 ? 'row' : 'rows'} into the world database. ${RESTART}`,
			status: 10000,
			busy: (b) => (importing = b),
		})
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
	/** A ranged weapon's subclass (2 bow, 3 gun, 18 crossbow…), else -1: what its look should shoot like. */
	const subclass = $derived(Number(values.class) === 2 && SHOOTS_LIKE[Number(values.subclass)] ? Number(values.subclass) : -1)
	// The client's looks, for what the item's own shoots like.
	let displayList = $state<vmangos.ItemDisplayEntry[]>([])
	$effect(() => {
		if (subclass >= 0 && !displayList.length)
			void loadItemDisplays().then(
				(d) => (displayList = d),
				() => {},
			)
	})
	const lookInfo = $derived(displayList.find((d) => d.id === display))
	/** The look fires like another weapon than the item is, and no shot visual is waiting for Save. */
	const shotMismatch = $derived(subclass >= 0 && pendingVisual < 0 && !!lookInfo && lookInfo.shoots >= 0 && lookInfo.shoots !== subclass)
	/** The shot visual most of the client's looks of the item's subclass have (5 for bows). */
	const shotVisual = $derived.by(() => {
		const n = new Map<number, number>()
		for (const d of displayList) if (d.shoots === subclass && d.visual) n.set(d.visual, (n.get(d.visual) ?? 0) + 1)
		return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
	})
	/** The display the preview shows: the look under the pointer in the picker, else the item's. */
	const shown = $derived(changing === 'look' ? Number(hoverPick ?? candidate ?? display) || 0 : display)
	/** The icon the tooltip shows: the one under the pointer or picked while changing it, else the one waiting for Save. */
	const iconShown = $derived(changing === 'icon' ? String(hoverPick ?? candidate ?? pendingIcon) : pendingIcon)
	const invType = $derived(Number(values.inventory_type) || 0)
	$effect(() => {
		const key = `${shown}|${invType}|${race}|${sex}`
		if (!record) {
			look = null
			return
		}
		ItemModelLook(shown, invType, race, sex)
			.then((l) => key === `${shown}|${invType}|${race}|${sex}` && (look = l))
			.catch((err) => (ed.error = String(err)))
	})
	/**
	 * Slots whose armour the game paints onto the body (shirt, chest, waist, legs, feet, wrists, hands,
	 * tabard, robe) or hangs on the back (a cloak): no model of its own, so it shows only on the character.
	 */
	const BODY_TYPES = new Set([4, 5, 6, 7, 8, 9, 10, 16, 19, 20])
	const where = $derived(
		HELD_TYPES.has(invType)
			? invType === 14
				? 'on the shield arm'
				: invType === 15 || invType === 25 || invType === 26
					? 'drawn, as a ranged weapon is held'
					: 'in hand'
			: invType === 1
				? 'on the head'
				: invType === 3
					? 'on the shoulders'
					: invType === 16
						? 'on the back'
						: BODY_TYPES.has(invType)
							? 'on the body'
							: '',
	)
	const preview = $derived.by(() => {
		if (!look) return null
		if (alone) return look.item ? { model: look.item, look: look.itemLook, scale: 1 } : null
		return look.model ? { model: look.model, look: look.look, scale: look.scale || 1 } : null
	})
	const previewText = $derived.by(() => {
		if (!record || !look) return ''
		if (!shown) return 'It has no display: no icon and no model. Pick a look below.'
		const raceName = RACES.find(([r]) => r === race)?.[1] ?? ''
		if (look.shown && !alone) return `${HELD_TYPES.has(invType) ? 'Held' : 'Worn'} ${where}, on ${/^[AEIOU]/.test(raceName) ? 'an' : 'a'} ${raceName} ${sex ? 'woman' : 'man'}.`
		if (look.item) return 'The model alone, as the game draws it held or worn.'
		if (BODY_TYPES.has(invType)) return alone ? 'It has no model of its own: the game paints it onto the character, shown On a character.' : 'Its display has nothing the game would paint on this slot: only its icon and tooltip.'
		if (where) return 'Its display has no model the game would show.'
		if (invType > 0) return "The game doesn't show it on a character: only its icon and tooltip."
		return 'It has no model of its own: in the game it is only its icon.'
	})

	// The tooltip follows the unsaved values; the names it shows are read again when the numbers they come from change.
	let names = $state<TooltipNames>({})
	const namesKey = $derived([1, 2, 3, 4, 5].map((i) => values[`spellid_${i}`] ?? '').join(',') + `|${values.required_skill}|${values.required_spell}|${values.required_reputation_faction}`)
	$effect(() => {
		const key = namesKey
		if (!record) return
		void itemTooltipNames($state.snapshot(values)).then((n) => key === namesKey && (names = n))
	})
	const lines = $derived(record ? tooltipLines({ ...values, entry: String(record.entry) }, names) : [])

	/** Picks a display from the client's: its model and icon both. */
	function pickLook(id: number) {
		values.display_id = String(id)
		pendingIcon = ''
		pendingVisual = -1
	}

	/**
	 * Whether the item was shown alone before Change look, which shows it alone (the item itself, large);
	 * body armour, which has no model, stays on the character.
	 */
	let aloneBefore = false

	function startChange(what: 'look' | 'icon') {
		if (what === 'look' && changing !== 'look') {
			aloneBefore = alone
			alone = !BODY_TYPES.has(invType)
		} else if (what === 'icon' && changing === 'look') alone = aloneBefore
		changing = what
		candidate = null
		hoverPick = null
	}

	function endChange() {
		if (changing === 'look') alone = aloneBefore
		changing = ''
	}

	/** Applies the look or icon picked (or `v`, a double click's) and goes back to the item. */
	function applyChange(v: number | string | null = candidate) {
		if (v === null) return
		if (changing === 'look') pickLook(Number(v))
		else if (changing === 'icon') pendingIcon = String(v)
		endChange()
	}

	const changeText = $derived.by(() => {
		if (changing === 'look') {
			const now = `Now display ${display || 'none'}.`
			if (hoverPick !== null && hoverPick !== candidate) return `${now} Showing display ${hoverPick}.`
			if (candidate !== null) return `${now} Picked display ${candidate}: Change look applies it.`
			return `${now} Hover a look below to see it, click one, then Change look.`
		}
		const now = pendingIcon ? `Now ${pendingIcon} (made on Save).` : "Now the look's own icon."
		if (hoverPick !== null && hoverPick !== candidate) return `${now} Showing ${hoverPick}.`
		if (candidate !== null) return `${now} Picked ${candidate}: Change icon applies it, keeping the model.`
		return `${now} Hover an icon below to see it, click one, then Change icon. The model stays.`
	})

	/** The GM command that gives an item: `.additem` puts it in the bags of the player selected, or your own. */
	const addItemCommand = (entry: number) => `.additem ${entry}`

	function copyItemCommand(i: vmangos.ItemRef) {
		const command = addItemCommand(i.entry)
		return copyGmCommand(ed, command, `paste it in the game's chat as a GM to get ${i.name || `item ${i.entry}`} (or give it to the player you have selected). A new or changed item needs the world server restarted first.`)
	}

	/** A search result's right-click menu: open it, or copy the command that gives it in the game. */
	function resultMenu(e: MouseEvent, i: vmangos.ItemRef) {
		e.preventDefault()
		ui.contextMenu = {
			x: e.clientX,
			y: e.clientY,
			title: i.name || `Item ${i.entry}`,
			items: [
				{ label: 'Open', run: () => open(i.entry) },
				{ label: `Copy ${addItemCommand(i.entry)} to the clipboard`, run: () => void copyItemCommand(i) },
				{ separator: true },
				...copyItems({ ids: [{ what: 'item entry', id: i.entry }, ...(i.displayId > 0 ? [{ what: 'display id', id: i.displayId }] : [])], name: i.name }),
			],
		}
	}

	/** Esc closes Change look or icon, then the import's confirmation, before the editor's own. */
	function back(): boolean {
		if (changing) endChange()
		else if (plan) plan = null
		else return false
		return true
	}
</script>

{#if target}
	<EditorFrame {ed} label="Item editor" z={165} unsavedText={`${changeCount + lookChanges} unsaved ${changeCount + lookChanges === 1 ? 'change' : 'changes'} to the item.`} blocked={() => !!ui.contextMenu} {back}>
		{#snippet title()}
			{#if target.entry > 0}
				<h2 style:color={QUALITY_VARS[Number(values.quality)] ?? undefined}><ItemIcon displayId={iconShown ? 0 : display} icon={iconShown} size={20} /> {values.name || saved.name || 'Item'}</h2>
				<span class="dim">item {target.entry}{record ? ` · patch ${record.patch}` : ''}</span>
			{:else if target.entry === -1}
				<h2>New item</h2>
			{:else}
				<h2>Items</h2>
				<span class="dim">Find an item to edit, or make a new one.</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			<button onclick={askImport} title="Read items from an SQL script into the world database">Import…</button>
			{#if record}
				<button onclick={exportItem} title="Write this item to an SQL script">Export…</button>
				<button disabled={!unsaved || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={!unsaved || ed.saving} onclick={save}>
					{ed.saving ? 'Saving…' : unsaved ? `Save item (${changeCount + lookChanges})` : 'Saved'}
				</button>
			{/if}
		{/snippet}
		{#snippet bars()}
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
		{/snippet}

		<div class="body">
			<aside>
				<button class="new" class:active={isNew} onclick={startNew}>New item…</button>
				<input type="search" placeholder="Item name or entry" bind:value={query} aria-label="Find an item" />
				<div class="sort">
					<select bind:value={prefs.itemSort} aria-label="Sort items by" title="Sort the items found by">
						{#each SORTS as [key, label] (key)}<option value={key}>{label}</option>{/each}
					</select>
					<button onclick={() => (prefs.itemSortDesc = !prefs.itemSortDesc)} aria-label="Sort direction" title={prefs.itemSortDesc ? 'High to low: click for low to high' : 'Low to high: click for high to low'}
						>{prefs.itemSortDesc ? '↓' : '↑'}</button
					>
				</div>
				<ul class="found" aria-label="Items found">
					{#each found as i (i.entry)}
						<li>
							<button class:on={i.entry === target.entry} onclick={() => open(i.entry)} oncontextmenu={(e) => resultMenu(e, i)} title="Right-click to copy its entry, its name or the command that gives it in the game">
								<ItemIcon displayId={i.displayId} />
								<span class="name" style:color={i.entry === target.entry ? undefined : QUALITY_VARS[i.quality]}>{i.name || '(no name)'}</span>
								<span class="dim" title="Item {i.entry}">{sideNumber(i)}</span>
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
						<fieldset class="start" aria-label="Start from">
							<legend>Start from</legend>
							<label class="check"><input type="radio" bind:group={startFrom} value="kind" /> A kind of item</label>
							{#if startFrom === 'kind'}
								<div class="kind">
									<select bind:value={kindClass} aria-label="Class" disabled={!kinds.length}>
										{#each kindClasses as [c, name] (c)}<option value={c}>{name}</option>{/each}
									</select>
									<select bind:value={kindKey} aria-label="Type" disabled={!kinds.length}>
										{#each classKinds as k (`${k.subclass}|${k.invType}`)}<option value={`${k.subclass}|${k.invType}`}>{kindName(k)} ({k.count})</option>{/each}
									</select>
								</div>
								<p class="dim">
									{kinds.length
										? `It gets what most of the world database's ${picked ? kindName(picked).toLowerCase() : ''} items have: their look, where it is carried, material, ammo, range, speed, durability and stacks. No damage, armour, stats, effects, binding, level or price: those are yours to set.`
										: 'Reading the kinds of item…'}
								</p>
							{/if}
							<label class="check"><input type="radio" bind:group={startFrom} value="blank" /> A blank item (common junk, no look)</label>
							{#if copySource}
								<label class="check"><input type="radio" bind:group={startFrom} value="copy" /> A copy of {copySource.name} (item {copySource.entry}): its look, stats and effects</label>
							{/if}
						</fieldset>
						<button class="active" disabled={!newName.trim() || creating || (startFrom === 'kind' && !picked)} onclick={create}>{creating ? 'Making…' : 'Make item'}</button>
					</div>
				{:else if target.entry === 0}
					<div class="empty dim">Find an item on the left, make a new one, or import some.</div>
				{:else if changing && record}
					<div class="change" aria-label={changing === 'look' ? 'Change look' : 'Change icon'}>
						<div class="change-bar">
							<div class="what">
								<strong>{changing === 'look' ? 'Change look' : 'Change icon'}</strong>
								<span class="dim">{changeText}</span>
							</div>
							<button onclick={endChange} title="Back to the item (Esc)">Cancel</button>
							<button class="active" disabled={candidate === null} onclick={() => applyChange()}>{changing === 'look' ? 'Change look' : 'Change icon'}</button>
						</div>
						<div class="stage">
							{#if changing === 'look'}
								{@render modelView(true)}
							{:else}
								<div class="icon-stage">
									<ItemIcon displayId={iconShown ? 0 : display} icon={iconShown} size={128} />
									<ItemTooltipBox {lines} displayId={display} icon={iconShown} />
								</div>
							{/if}
						</div>
						<div class="grid-area">
							<ItemLookPicker
								mode={changing === 'look' ? 'looks' : 'icons'}
								kind={slotKind(invType)}
								shoots={subclass}
								selected={candidate ?? (changing === 'look' ? display : pendingIcon)}
								onpick={(v) => (candidate = v)}
								onapply={applyChange}
								onhover={(v) => (hoverPick = v)}
							/>
						</div>
					</div>
				{:else}
					<nav class="tabs">
						{#each tabs as t (t.id)}
							<button class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.title}{tabChanges.get(t.id) ? ` (${tabChanges.get(t.id)})` : ''}</button>
						{/each}
					</nav>
					<div class="scroll">
						{#if !record}
							<p class="dim">{ed.loading ? 'Loading the item…' : ''}</p>
						{:else}
							{#each tabs as t (t.id)}
								{#if t.id === tab}
									{#each t.groups as g (g.title)}
										<h3>{g.title}</h3>
										<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} cols={g.columns} onset={(col, v) => (values[col] = v)} />
									{/each}
									{#if t.id === 'stats'}
										<h3>Equip bonuses</h3>
										<EquipBonuses {values} texts={names.spells ?? {}} onset={(col, v) => (values[col] = v)} />
									{/if}
								{/if}
							{/each}
						{/if}
					</div>
				{/if}
			</section>

			{#if record && target.entry > 0}
				<section class="look" aria-label="How the item looks">
					{#if !changing}{@render modelView(false)}{/if}
					<div class="display" class:changed={changes.display_id !== undefined || pendingIcon !== ''}>
						<ItemIcon displayId={changing === 'look' ? shown : display} icon={iconShown} size={24} />
						<label title="ItemDisplayInfo.dbc ID: the item's model and icon (display_id)"
							>Display <input type="number" min="0" value={values.display_id ?? ''} oninput={(e) => (values.display_id = (e.currentTarget as HTMLInputElement).value)} /></label
						>
					</div>
					<div class="change-buttons">
						<button class:active={changing === 'look'} onclick={() => startChange('look')} title="Pick another of the client's looks: its model and icon">Change look…</button>
						<button class:active={changing === 'icon'} onclick={() => startChange('icon')} title="Pick another icon, keeping the model">Change icon…</button>
					</div>
					{#if pendingIcon}<p class="pending">Icon {pendingIcon}: Save makes the look that pairs it with this model.</p>{/if}
					{#if shotMismatch && lookInfo}
						<div class="shot-warn">
							<span>This look shoots like {SHOOTS_LIKE[lookInfo.shoots]} (its shot visual {lookInfo.visual}), so the game fires {SHOOTS_LIKE[subclass]} on it like one.</span>
							<button disabled={shotVisual < 0} onclick={() => (pendingVisual = shotVisual)}>Make it shoot like {SHOOTS_LIKE[subclass]}</button>
						</div>
					{:else if pendingVisual >= 0}
						<p class="pending">Save makes the look shoot like {SHOOTS_LIKE[subclass]} (shot visual {pendingVisual}), keeping its model, texture and icon.</p>
					{/if}
					<h3>Tooltip</h3>
					<div class="tooltip"><ItemTooltipBox {lines} displayId={changing === 'look' ? shown : display} icon={iconShown} /></div>
				</section>
			{/if}
		</div>
	</EditorFrame>
{/if}

{#snippet modelView(big: boolean)}
	<div class="model" class:big>
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
	<p class="dim preview-text">{previewText}</p>
{/snippet}

<style>
	.bar.plan .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
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
	.sort {
		display: flex;
		gap: 4px;
	}
	.sort select {
		flex: 1;
		min-width: 0;
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
		color: var(--accent-ink);
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
	.start {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.start legend {
		color: var(--text-dim);
		padding: 0 4px;
	}
	.kind {
		display: flex;
		gap: 6px;
		padding-left: 22px;
	}
	.kind select {
		flex: 1;
		min-width: 0;
	}
	.start .dim {
		padding-left: 22px;
	}
	.look {
		/* One width, so the fields beside it never move. */
		flex: none;
		width: min(400px, calc(34 * var(--vw)));
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
		height: min(420px, calc(45 * var(--vh)));
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
		color: var(--accent-ink);
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
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.shot-warn {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 8px;
		border: 1px solid var(--warn);
		border-radius: 4px;
		color: var(--warn);
		font-size: 12px;
	}
	.pending {
		color: var(--accent-text);
		font-size: 12px;
		margin: 0;
	}
	.change-buttons {
		display: flex;
		gap: 6px;
	}
	.change-buttons button {
		flex: 1;
	}
	.change {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
	}
	.change-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.change-bar .what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stage {
		flex: 1 1 50%;
		min-height: 200px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.model.big {
		flex: 1;
		height: auto;
		min-height: 0;
	}
	.icon-stage {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 24px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--preview-bg);
	}
	.grid-area {
		flex: 1 1 40%;
		min-height: 180px;
		display: flex;
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
