<script lang="ts">
	import { createSearch } from '../lib/ui/search.svelte'
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { RowList } from '../lib/ui/rowList.svelte'
	import { InventoryItemTemplate, ReadInventory, SaveInventory, SearchItems } from '../lib/wails/App'
	import { vmangos } from '../lib/wails/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { QUALITY_VARS } from '../lib/wow/itemTooltip'
	import {
		BAG_SLOTS,
		BANK_BAG_SLOTS,
		BANK_END,
		BANK_START,
		DOLL,
		EQUIP_SLOTS,
		KEY_END,
		KEY_START,
		PACK_END,
		PACK_START,
		itemAt,
		keyringSize,
		moveItem,
		newItem,
		placeFor,
		placeKey,
		placeName,
		removeItem,
		samePlace,
		wearProblem,
		type Place,
	} from '../lib/wow/inventory'
	import type { CreatureField } from '../lib/world/creatureFields'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltip from './ItemTooltip.svelte'
	import RefField from './RefField.svelte'

	// The character editor's Equipment and bags (#874): the character's equipment slots laid out as the
	// game's character frame, its bag slots, backpack and bags, its bank, the bank's bags and its
	// keyring (#879), with the Items editor's icons and tooltips. Drag an item to move it (swapping with
	// what is there), pick a square to change the item's stack, durability, enchantment and random
	// property or take it out, and find items to add. Saved with its own Save, like the creature
	// editor's list tabs: Go checks the places again and writes character_inventory and item_instance
	// (internal/vmangos/inventory.go).

	let { guid, race, cls, level, dirty = $bindable(false) }: { guid: number; race: number; cls: number; level: number; dirty?: boolean } = $props()

	type Item = vmangos.InventoryItem
	const QUALITY = QUALITY_VARS

	let elsewhere = $state(0)
	// How many of the bank's bag slots the character has bought (characters.bank_bag_slots, #886), saved
	// with the items, so Go checks the bank's bags against the new count.
	let bankBags = $state(0)
	let savedBankBags = $state(0)
	const lim = $derived({ bankBags })
	const rows = new RowList<Item[]>({
		empty: [],
		read: async () => {
			const inv = await ReadInventory(guid)
			elsewhere = inv.elsewhere
			bankBags = savedBankBags = inv.bankBagSlots
			return inv.items ?? []
		},
		key: (list) => JSON.stringify(list.map((i) => [i.guid, i.container, i.slot, i.entry, i.count, i.durability, i.enchant, i.randomProperty]).sort((a, b) => a[1] - b[1] || a[2] - b[2])),
	})
	rows.follow(() => guid)
	const changed = $derived(rows.dirty || bankBags !== savedBankBags)
	$effect(() => {
		dirty = changed
	})

	/** Drops the unsaved edits (the editor's Revert and Discard). */
	export function revert() {
		refused = ''
		void rows.revert()
	}

	let selected = $state<Place | null>(null)
	/** The place of an item Go refused, outlined until the next save. */
	let refused = $state('')
	const sel = $derived(selected ? (itemAt(rows.rows, selected) ?? null) : null)

	const bagsIn = (slots: readonly number[]) => slots.map((s) => ({ slot: s, bag: itemAt(rows.rows, { container: 0, slot: s }) ?? null })).filter((b) => b.bag && b.bag.template.containerSlots > 0)
	const bags = $derived(bagsIn(BAG_SLOTS))
	const bankBagList = $derived(bagsIn(BANK_BAG_SLOTS))
	const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)
	// The keyring shows the slots the game shows at the character's level, and any slot past them that holds a key.
	const keyEnd = $derived(Math.min(KEY_END, Math.max(KEY_START + keyringSize(level), ...rows.rows.filter((i) => i.container === 0 && i.slot >= KEY_START).map((i) => i.slot + 1))))

	function save() {
		refused = ''
		void rows.save('Saving the equipment', async (items) => {
			const r = await SaveInventory(guid, items, bankBags)
			if (r.refused) {
				refused = r.refused.column
				throw new Error(r.refused.message)
			}
			const n = items.length
			// Read the items again: the new ones have their numbers now.
			await rows.load()
			setStatus(`Saved the equipment and bags (${n} ${n === 1 ? 'item' : 'items'}). The character has them at its next login.`, 10000)
		})
	}

	/** Sets how many of the bank's bag slots are bought, refusing a count below a slot that holds a bag. */
	function setBought(v: number) {
		const n = Math.min(BANK_BAG_SLOTS.length, Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)))
		const last = Math.max(0, ...BANK_BAG_SLOTS.filter((s) => itemAt(rows.rows, { container: 0, slot: s })).map((s) => s - BANK_BAG_SLOTS[0] + 1))
		if (n < last) {
			setStatus(`Bank bag slot ${last} holds a bag: take it out or move it before selling the slot back.`, 6000)
			return
		}
		bankBags = n
	}

	function set(items: Item[] | string) {
		if (typeof items === 'string') {
			setStatus(items, 6000)
			return false
		}
		rows.rows = items
		return true
	}

	// Moving: drag a square onto another.
	let dragFrom = $state<Place | null>(null)
	function drop(to: Place) {
		const from = dragFrom
		dragFrom = null
		if (!from || samePlace(from, to)) return
		if (set(moveItem(rows.rows, from, to, lim))) selected = to
	}

	function takeOut(p: Place) {
		const it = itemAt(rows.rows, p)
		if (!it) return
		const inside = rows.rows.filter((i) => p.container === 0 && i.container === p.slot).length
		rows.rows = removeItem(rows.rows, p)
		if (inside) setStatus(`Took out ${it.template.name} and the ${inside} ${inside === 1 ? 'item' : 'items'} in it.`, 5000)
	}

	function change(field: 'count' | 'durability' | 'enchant', v: number, max: number) {
		const p = selected
		if (!p) return
		const n = Math.min(max, Math.max(field === 'count' ? 1 : 0, Math.floor(Number.isFinite(v) ? v : 0)))
		rows.rows = rows.rows.map((i) => (samePlace(i, p) ? { ...i, [field]: n } : i))
	}

	/** Gives the picked item random property `id` ("of the Bear"; 0 for none), named `name`. */
	function setRandom(id: number, name: string) {
		const p = selected
		if (p) rows.rows = rows.rows.map((i) => (samePlace(i, p) ? { ...i, randomProperty: id, randomName: name } : i))
	}

	// Adding: a search over item_template by name or entry, as the Shop tab's.
	let query = $state('')
	const search = createSearch((q: string) => SearchItems(q).then((r) => r ?? []), { empty: [] as vmangos.ItemRef[], onError: (err) => (rows.error = String(err)) })
	const results = $derived(search.results)
	const searching = $derived(search.searching)
	$effect(() => search.set(query.trim() || null))

	async function add(r: vmangos.ItemRef) {
		try {
			const t = await InventoryItemTemplate(r.entry)
			const p = placeFor(rows.rows, t, selected, lim)
			if (!p) {
				setStatus(`No free place takes ${t.name}.`, 5000)
				return
			}
			rows.rows = [...rows.rows, newItem(t, p)]
			selected = p
		} catch (err) {
			rows.error = String(err)
		}
	}

	// The item under the pointer, for its tooltip.
	let hover = $state<{ entry: number; displayId: number; x: number; y: number } | null>(null)
	function hoverItem(entry: number, displayId: number) {
		return {
			onpointerenter: (e: PointerEvent) => (hover = { entry, displayId, x: e.clientX, y: e.clientY }),
			onpointermove: (e: PointerEvent) => hover && hover.entry === entry && ((hover.x = e.clientX), (hover.y = e.clientY)),
			onpointerleave: () => hover?.entry === entry && (hover = null),
		}
	}

	const ENCHANT: CreatureField = { col: 'enchant', label: 'Enchantment', ref: 'item enchantment', hint: 'The permanent enchantment (SpellItemEnchantment.dbc)' }
</script>

{#snippet square(p: Place, label: string)}
	{@const it = itemAt(rows.rows, p)}
	{@const worn = it && p.container === 0 && p.slot < BAG_SLOTS[0] ? wearProblem(it.template, race, cls, level) : ''}
	{@const locked = p.container === 0 && p.slot >= BANK_BAG_SLOTS[0] && p.slot <= BANK_BAG_SLOTS[5] && p.slot - BANK_BAG_SLOTS[0] >= bankBags}
	<button
		class="sq"
		class:locked
		class:sel={selected && samePlace(selected, p)}
		class:refused={refused === placeKey(p)}
		class:warn={!!worn}
		class:new={it?.guid === 0}
		data-place={placeKey(p)}
		title={it ? '' : `${placeName(p)} (${locked ? 'not bought' : 'empty'})`}
		draggable={!!it}
		ondragstart={(e) => {
			dragFrom = p
			hover = null
			e.dataTransfer?.setData('text/plain', placeKey(p))
		}}
		ondragend={() => (dragFrom = null)}
		ondragover={(e) => dragFrom && e.preventDefault()}
		ondrop={(e) => {
			e.preventDefault()
			drop(p)
		}}
		onclick={() => (selected = p)}
		{...it ? hoverItem(it.entry, it.template.displayId) : {}}
	>
		{#if it}
			<ItemIcon displayId={it.template.displayId} size={36} />
			{#if it.count > 1}<span class="count">{it.count}</span>{/if}
		{:else}
			<span class="empty">{label}</span>
		{/if}
	</button>
{/snippet}

<div class="inv">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	<div class="head">
		<h3>Equipment and bags</h3>
		<button disabled={!changed || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!changed || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : changed ? 'Save equipment' : 'Saved'}</button>
	</div>
	{#if rows.loading && !rows.rows.length}
		<p class="dim">Reading the items…</p>
	{:else}
		<div class="cols">
			<div class="doll" aria-label="Equipment">
				<div class="side">
					{#each DOLL.left as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
				<div class="side">
					{#each DOLL.right as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
				<div class="bottom">
					{#each DOLL.bottom as s (s)}{@render square({ container: 0, slot: s }, EQUIP_SLOTS[s].short)}{/each}
				</div>
			</div>
			<div class="bags">
				<div class="label dim">Bags</div>
				<div class="row" aria-label="Bag slots">
					{#each BAG_SLOTS as s (s)}{@render square({ container: 0, slot: s }, 'Bag')}{/each}
				</div>
				<div class="label dim">Backpack</div>
				<div class="grid" aria-label="Backpack">
					{#each range(PACK_START, PACK_END) as s (s)}{@render square({ container: 0, slot: s }, '')}{/each}
				</div>
				{#each bags as b (b.slot)}
					<div class="label" style:color={QUALITY[b.bag?.template.quality ?? 1] ?? QUALITY[1]}>{b.bag?.template.name}</div>
					<div class="grid" aria-label="Bag {b.slot - BAG_SLOTS[0] + 1}">
						{#each range(0, b.bag?.template.containerSlots ?? 0) as s (s)}{@render square({ container: b.slot, slot: s }, '')}{/each}
					</div>
				{/each}
				<div class="label dim">Keyring</div>
				<div class="grid" aria-label="Keyring">
					{#each range(KEY_START, keyEnd) as s (s)}{@render square({ container: 0, slot: s }, 'Key')}{/each}
				</div>
			</div>
			<div class="bags">
				<div class="label dim">Bank</div>
				<div class="grid wide" aria-label="Bank">
					{#each range(BANK_START, BANK_END) as s (s)}{@render square({ container: 0, slot: s }, '')}{/each}
				</div>
				<div class="label dim">
					Bank bags (<input
						class="bought"
						type="number"
						min="0"
						max={BANK_BAG_SLOTS.length}
						aria-label="Bank bag slots bought"
						title="characters.bank_bag_slots: the bank's bag slots the character has bought"
						class:refused={refused === 'bankBagSlots'}
						value={bankBags}
						onchange={(e) => {
							setBought(e.currentTarget.valueAsNumber)
							e.currentTarget.value = String(bankBags)
						}}
					/>
					of {BANK_BAG_SLOTS.length} bought)
				</div>
				<div class="row" aria-label="Bank bag slots">
					{#each BANK_BAG_SLOTS as s (s)}{@render square({ container: 0, slot: s }, 'Bag')}{/each}
				</div>
				{#each bankBagList as b (b.slot)}
					<div class="label" style:color={QUALITY[b.bag?.template.quality ?? 1] ?? QUALITY[1]}>{b.bag?.template.name}</div>
					<div class="grid" aria-label="Bank bag {b.slot - BANK_BAG_SLOTS[0] + 1}">
						{#each range(0, b.bag?.template.containerSlots ?? 0) as s (s)}{@render square({ container: b.slot, slot: s }, '')}{/each}
					</div>
				{/each}
			</div>
		</div>

		<div class="details" aria-label="Selected item">
			{#if !selected}
				<p class="dim">Pick a square to change its item, or drag an item to move it. Items you find below go into the picked square, or the first free place that takes them.</p>
			{:else if !sel}
				<p class="dim">{placeName(selected)} is empty. Find an item below to put it here.</p>
			{:else}
				{@const t = sel.template}
				{@const worn = selected.container === 0 && selected.slot < BAG_SLOTS[0] ? wearProblem(t, race, cls, level) : ''}
				<div class="title" use:idMenu={{ ids: [idOf('item', sel.entry)], name: t.name }} {...hoverItem(sel.entry, t.displayId)}>
					<ItemIcon displayId={t.displayId} size={28} />
					<strong style:color={QUALITY[t.quality] ?? QUALITY[1]}>{t.name || '(unknown item)'}{sel.randomProperty ? ` ${sel.randomName}` : ''}</strong>
					<span class="dim">{sel.entry} · {placeName(selected)}{sel.guid ? ` · item ${sel.guid}` : ' · new'}</span>
				</div>
				{#if worn}<p class="warnText">The character can't wear it ({worn}): the server sends it by mail at login.</p>{/if}
				<div class="fields">
					<label>Count <input type="number" min="1" max={Math.max(1, t.stackable)} disabled={t.stackable <= 1} value={sel.count} oninput={(e) => change('count', Number(e.currentTarget.value), Math.max(1, t.stackable))} /></label>
					<label
						>Durability {#if t.maxDurability}<span class="dim">of {t.maxDurability}</span>{/if}
						<input type="number" min="0" max={t.maxDurability} disabled={!t.maxDurability} value={sel.durability} oninput={(e) => change('durability', Number(e.currentTarget.value), t.maxDurability)} /></label
					>
					<div class="ench">
						<RefField f={ENCHANT} value={String(sel.enchant)} changed={false} onset={(v) => change('enchant', Number(v), 0xffff)} />
					</div>
					{#if t.randomProperty > 0 || sel.randomProperty}
						{@const choices = t.randomChoices ?? []}
						<label class="random"
							>Random property
							<select
								value={sel.randomProperty}
								onchange={(e) => {
									const id = Number(e.currentTarget.value)
									setRandom(id, choices.find((c) => c.id === id)?.name ?? sel?.randomName ?? '')
								}}
							>
								<option value={0}>None</option>
								{#if sel.randomProperty && !choices.some((c) => c.id === sel.randomProperty)}<option value={sel.randomProperty}>{sel.randomName || `property ${sel.randomProperty}`}</option>{/if}
								{#each choices as c (c.id)}<option value={c.id}>{c.name} ({c.chance}%)</option>{/each}
							</select></label
						>
					{/if}
				</div>
				<div class="row">
					<button disabled={!t.maxDurability || sel.durability === t.maxDurability} onclick={() => change('durability', t.maxDurability, t.maxDurability)}>Repair</button>
					<button class="danger" onclick={() => selected && takeOut(selected)}>Take out</button>
				</div>
			{/if}
		</div>
		<p class="dim">
			Saved items are what the character has at its next login. Adding items needs the world server stopped (it numbers new items from the highest number it read at start); moving, changing and taking out need only the character out
			of the world. An added item rolls its random property as the server's .additem does.{elsewhere ? ` ${elsewhere} more ${elsewhere === 1 ? 'item is' : 'items are'} in its buyback slots, which this leaves as they are.` : ''}
		</p>

		<h3>Add items</h3>
		<input class="search" type="search" placeholder="Item name or entry" bind:value={query} />
		{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
		{#if results.length}
			<ul class="results">
				{#each results as r (r.entry)}
					<li>
						<button onclick={() => add(r)} use:idMenu={{ ids: [idOf('item', r.entry)], name: r.name }} {...hoverItem(r.entry, r.displayId)}>
							<ItemIcon displayId={r.displayId} /> <span style:color={QUALITY[r.quality] ?? QUALITY[1]}>{r.name}</span> <span class="dim">{r.entry}</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else if query.trim() && !searching}
			<p class="dim">No item matches.</p>
		{/if}
	{/if}
	{#if hover}<ItemTooltip entry={hover.entry} displayId={hover.displayId} x={hover.x} y={hover.y} />{/if}
</div>

<style>
	.inv {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
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
	.cols {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.doll {
		display: grid;
		grid-template-columns: auto auto;
		column-gap: 96px;
		row-gap: 8px;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bottom {
		grid-column: 1 / -1;
		display: flex;
		justify-content: center;
		gap: 4px;
	}
	.bags {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.bags .row {
		display: flex;
		gap: 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, 42px);
		gap: 4px;
	}
	.grid.wide {
		grid-template-columns: repeat(6, 42px);
	}
	.label {
		margin-top: 4px;
	}
	.bought {
		width: 3.5em;
	}
	.bought.refused {
		outline: 1px solid var(--danger-text);
	}
	.sq.locked {
		opacity: 0.45;
		border-style: dashed;
	}
	.fields .random {
		grid-column: 1 / span 2;
	}
	.sq {
		position: relative;
		width: 42px;
		height: 42px;
		padding: 2px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel-2);
	}
	.sq.sel {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.sq.new {
		background: color-mix(in srgb, var(--accent) 14%, var(--panel-2));
	}
	.sq.warn {
		border-color: var(--warn);
	}
	.sq.refused {
		outline: 2px solid var(--danger-text);
	}
	.empty {
		font-size: 9px;
		color: var(--text-dim);
	}
	.count {
		position: absolute;
		right: 3px;
		bottom: 1px;
		font-size: 11px;
		font-weight: 600;
		/* Over the game's icon art in either theme, as the game draws a stack's count. */
		color: rgb(255, 255, 255);
		text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
		pointer-events: none;
	}
	.details {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--panel);
	}
	.details p {
		margin: 0;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fields {
		display: grid;
		grid-template-columns: 120px 140px 1fr;
		gap: 8px 12px;
		align-items: start;
	}
	.fields label {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.warnText {
		color: var(--warn);
	}
	.error {
		margin: 0;
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.search {
		width: 100%;
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
	}
	.results button {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		padding: 3px 6px;
	}
	.results button:hover {
		background: var(--panel-2);
	}
	.dim {
		color: var(--text-dim);
	}
</style>
