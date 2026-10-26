<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { ReadVendor, SaveVendor, SearchItems } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { RowList, moveRow, removeRow } from '../lib/ui/rowList.svelte'
	import { QUALITY_VARS } from '../lib/wow/itemTooltip'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltip from './ItemTooltip.svelte'

	// The creature editor's Shop tab (#145): what the creature sells, its npc_vendor rows, edited as a
	// list and saved with Save shop, like the template (the world database keeps no undo).

	/** npc_flags' vendor bit: without it the server opens no shop. */
	const VENDOR_FLAG = 0x4
	/** Item quality colours, as the game draws item names. */
	const QUALITY = QUALITY_VARS

	// The item under the pointer, for its tooltip (#202).
	let hover = $state<{ entry: number; displayId: number; x: number; y: number } | null>(null)
	function hoverItem(entry: number, displayId: number) {
		return {
			onpointerenter: (e: PointerEvent) => (hover = { entry, displayId, x: e.clientX, y: e.clientY }),
			onpointermove: (e: PointerEvent) => hover && hover.entry === entry && ((hover.x = e.clientX), (hover.y = e.clientY)),
			onpointerleave: () => hover?.entry === entry && (hover = null),
		}
	}

	let { entry, npcFlags, onvendorflag, dirty = $bindable(false) }: { entry: number; npcFlags: number; onvendorflag: () => void; dirty?: boolean } = $props()

	let templateId = $state(0)
	let template = $state<vmangos.VendorItem[]>([])
	const rows = new RowList<vmangos.VendorItem[]>({
		empty: [],
		read: async () => {
			const v = await ReadVendor(entry)
			templateId = v.templateId
			template = v.template ?? []
			return v.items ?? []
		},
		key: (list) => JSON.stringify(list.map((i) => [i.item, i.maxCount, i.incrTime, i.itemFlags, i.condition])),
	})
	rows.follow(() => entry)
	$effect(() => {
		dirty = rows.dirty
	})

	function save() {
		void rows.save("Saving the creature's shop", async (items) => {
			await SaveVendor(entry, items)
			setStatus(`Saved the shop of creature ${entry} (${items.length} ${items.length === 1 ? 'item' : 'items'}). Restart the world server to see it in the game.`, 10000)
		})
	}

	/** Drops the unsaved rows (the tab's Revert, the editor's Discard). */
	export function revert() {
		void rows.revert()
	}

	function num(v: string, max: number): number {
		const n = Math.floor(Number(v))
		return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0
	}

	// Adding: a search over item_template by name or entry.
	let query = $state('')
	let results = $state<vmangos.ItemRef[]>([])
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
				const r = await SearchItems(q)
				if (q === query.trim()) results = r ?? []
			} catch (err) {
				rows.error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	function add(r: vmangos.ItemRef) {
		if (rows.rows.some((i) => i.item === r.entry)) {
			setStatus(`${r.name} is already in the shop.`, 4000)
			return
		}
		rows.rows = [...rows.rows, vmangos.VendorItem.createFrom({ item: r.entry, name: r.name, quality: r.quality, displayId: r.displayId, maxCount: 0, incrTime: 0, itemFlags: 0, condition: 0 })]
	}
</script>

<div class="shop">
	{#if rows.error}<p class="error">{rows.error}</p>{/if}
	{#if (npcFlags & VENDOR_FLAG) === 0}
		<p class="warn">
			This creature has no Vendor flag, so the server opens no shop for it.
			<button onclick={onvendorflag}>Set the flag</button>
			<span class="dim">(saved with Save creature)</span>
		</p>
	{/if}

	<div class="head">
		<h3>Sells{rows.rows.length ? ` (${rows.rows.length})` : ''}</h3>
		<button disabled={!rows.dirty || rows.saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!rows.dirty || rows.saving} onclick={save}>{rows.saving ? 'Saving…' : rows.dirty ? 'Save shop' : 'Saved'}</button>
	</div>
	{#if rows.loading}
		<p class="dim">Loading the shop…</p>
	{:else if rows.rows.length === 0}
		<p class="dim">Nothing yet. Find items below and click one to add it.</p>
	{:else}
		<table>
			<thead>
				<tr><th>Item</th><th title="How many it has in stock; 0 is unlimited">Stock</th><th title="Seconds before a sold-out stock comes back">Restock (s)</th><th></th></tr>
			</thead>
			<tbody>
				{#each rows.rows as it, i (it.item)}
					<tr>
						<td class="item" use:idMenu={{ ids: [idOf('item', it.item)], name: it.name }} {...hoverItem(it.item, it.displayId)}
							><ItemIcon displayId={it.displayId} /> <span style:color={QUALITY[it.quality] ?? QUALITY[1]}>{it.name || '(unknown item)'}</span> <span class="dim">{it.item}</span></td
						>
						<td><input type="number" min="0" max="255" value={it.maxCount} oninput={(e) => (it.maxCount = num(e.currentTarget.value, 255))} /></td>
						<td><input type="number" min="0" value={it.incrTime} disabled={it.maxCount === 0} oninput={(e) => (it.incrTime = num(e.currentTarget.value, 4294967295))} /></td>
						<td class="row-actions">
							<button title="Move up" disabled={i === 0} onclick={() => (rows.rows = moveRow(rows.rows, i, -1))}>↑</button>
							<button title="Move down" disabled={i === rows.rows.length - 1} onclick={() => (rows.rows = moveRow(rows.rows, i, 1))}>↓</button>
							<button title="Remove" onclick={() => (rows.rows = removeRow(rows.rows, i))}>✕</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h3>Add items</h3>
	<input class="search" type="search" placeholder="Item name or entry" bind:value={query} />
	{#if searching && !results.length}<p class="dim">Searching…</p>{/if}
	{#if results.length}
		<ul class="results">
			{#each results as r (r.entry)}
				<li>
					<button disabled={rows.rows.some((i) => i.item === r.entry)} onclick={() => add(r)} use:idMenu={{ ids: [idOf('item', r.entry)], name: r.name }} {...hoverItem(r.entry, r.displayId)}>
						<ItemIcon displayId={r.displayId} /> <span style:color={QUALITY[r.quality] ?? QUALITY[1]}>{r.name}</span> <span class="dim">{r.entry}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if query.trim() && !searching}
		<p class="dim">No item matches.</p>
	{/if}

	{#if templateId > 0}
		<h3>Also sells, from vendor list {templateId}</h3>
		<p class="dim">The template's shared list (npc_vendor_template); it is shared with other creatures, so it is shown, not edited, here.</p>
		<ul class="shared">
			{#each template as it (it.item)}
				<li use:idMenu={{ ids: [idOf('item', it.item)], name: it.name }} {...hoverItem(it.item, it.displayId)}>
					<ItemIcon displayId={it.displayId} /> <span style:color={QUALITY[it.quality] ?? QUALITY[1]}>{it.name || '(unknown item)'}</span> <span class="dim">{it.item}{it.maxCount ? ` · stock ${it.maxCount}` : ''}</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if hover}<ItemTooltip entry={hover.entry} displayId={hover.displayId} x={hover.x} y={hover.y} />{/if}
</div>

<style>
	.shop {
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
	.head h3 {
		flex: 1;
		margin: 0;
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
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-weight: 500;
		color: var(--text-dim);
	}
	th,
	td {
		padding: 3px 4px;
		border-bottom: 1px solid var(--border);
	}
	td input {
		width: 70px;
	}
	.row-actions {
		white-space: nowrap;
		text-align: right;
	}
	.row-actions button {
		padding: 1px 6px;
	}
	.search {
		width: 100%;
	}
	.results,
	.shared {
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
	.results button:hover:not(:disabled) {
		background: var(--panel-2);
	}
	.results button:disabled {
		opacity: 0.45;
	}
	.shared li {
		padding: 2px 6px;
	}
</style>
