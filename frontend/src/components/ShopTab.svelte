<script lang="ts">
	import { ReadVendor, SaveVendor, SearchItems } from '../../wailsjs/go/main/App'
	import { vmangos } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { QUALITY_COLORS } from '../lib/wow/itemTooltip'
	import ItemIcon from './ItemIcon.svelte'
	import ItemTooltip from './ItemTooltip.svelte'

	// The creature editor's Shop tab (#145): what the creature sells, its npc_vendor rows, edited as a
	// list and saved with Save shop, like the template (the world database keeps no undo).

	/** npc_flags' vendor bit: without it the server opens no shop. */
	const VENDOR_FLAG = 0x4
	/** Item quality colours, as the game draws item names. */
	const QUALITY = QUALITY_COLORS

	// The item under the pointer, for its tooltip (#202).
	let hover = $state<{ entry: number; displayId: number; x: number; y: number } | null>(null)
	function hoverItem(entry: number, displayId: number) {
		return {
			onpointerenter: (e: PointerEvent) => (hover = { entry, displayId, x: e.clientX, y: e.clientY }),
			onpointermove: (e: PointerEvent) => hover && hover.entry === entry && ((hover.x = e.clientX), (hover.y = e.clientY)),
			onpointerleave: () => hover?.entry === entry && (hover = null),
		}
	}

	let {
		entry,
		npcFlags,
		onvendorflag,
		dirty = $bindable(false),
	}: { entry: number; npcFlags: number; onvendorflag: () => void; dirty?: boolean } = $props()

	let items = $state<vmangos.VendorItem[]>([])
	let saved = $state<string>('[]')
	let templateId = $state(0)
	let template = $state<vmangos.VendorItem[]>([])
	let loading = $state(false)
	let saving = $state(false)
	let error = $state('')

	const key = (list: vmangos.VendorItem[]) => JSON.stringify(list.map((i) => [i.item, i.maxCount, i.incrTime, i.itemFlags, i.condition]))
	$effect(() => {
		dirty = key(items) !== saved
	})

	let loadedFor = -1
	$effect(() => {
		if (entry === loadedFor) return
		loadedFor = entry
		void load()
	})

	async function load() {
		loading = true
		error = ''
		try {
			const v = await ReadVendor(entry)
			items = v.items ?? []
			saved = key(items)
			templateId = v.templateId
			template = v.template ?? []
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	async function save() {
		saving = true
		error = ''
		try {
			await SaveVendor(entry, items)
			saved = key(items)
			setStatus(`Saved the shop of creature ${entry} (${items.length} ${items.length === 1 ? 'item' : 'items'}). Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			saving = false
		}
	}

	function revert() {
		void load()
	}

	function move(i: number, d: number) {
		const j = i + d
		if (j < 0 || j >= items.length) return
		const list = [...items]
		;[list[i], list[j]] = [list[j], list[i]]
		items = list
	}

	function remove(i: number) {
		items = items.filter((_, k) => k !== i)
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
				error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

	function add(r: vmangos.ItemRef) {
		if (items.some((i) => i.item === r.entry)) {
			setStatus(`${r.name} is already in the shop.`, 4000)
			return
		}
		items = [...items, vmangos.VendorItem.createFrom({ item: r.entry, name: r.name, quality: r.quality, displayId: r.displayId, maxCount: 0, incrTime: 0, itemFlags: 0, condition: 0 })]
	}
</script>

<div class="shop">
	{#if error}<p class="error">{error}</p>{/if}
	{#if (npcFlags & VENDOR_FLAG) === 0}
		<p class="warn">
			This creature has no Vendor flag, so the server opens no shop for it.
			<button onclick={onvendorflag}>Set the flag</button>
			<span class="dim">(saved with Save creature)</span>
		</p>
	{/if}

	<div class="head">
		<h3>Sells{items.length ? ` (${items.length})` : ''}</h3>
		<button disabled={!dirty || saving} onclick={revert}>Revert</button>
		<button class="active" disabled={!dirty || saving} onclick={save}>{saving ? 'Saving…' : dirty ? 'Save shop' : 'Saved'}</button>
	</div>
	{#if loading}
		<p class="dim">Loading the shop…</p>
	{:else if items.length === 0}
		<p class="dim">Nothing yet. Find items below and click one to add it.</p>
	{:else}
		<table>
			<thead>
				<tr><th>Item</th><th title="How many it has in stock; 0 is unlimited">Stock</th><th title="Seconds before a sold-out stock comes back">Restock (s)</th><th></th></tr>
			</thead>
			<tbody>
				{#each items as it, i (it.item)}
					<tr>
						<td class="item" {...hoverItem(it.item, it.displayId)}><ItemIcon displayId={it.displayId} /> <span style:color={QUALITY[it.quality] ?? QUALITY[1]}>{it.name || '(unknown item)'}</span> <span class="dim">{it.item}</span></td>
						<td><input type="number" min="0" max="255" value={it.maxCount} oninput={(e) => (it.maxCount = num(e.currentTarget.value, 255))} /></td>
						<td><input type="number" min="0" value={it.incrTime} disabled={it.maxCount === 0} oninput={(e) => (it.incrTime = num(e.currentTarget.value, 4294967295))} /></td>
						<td class="row-actions">
							<button title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
							<button title="Move down" disabled={i === items.length - 1} onclick={() => move(i, 1)}>↓</button>
							<button title="Remove" onclick={() => remove(i)}>✕</button>
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
					<button disabled={items.some((i) => i.item === r.entry)} onclick={() => add(r)} {...hoverItem(r.entry, r.displayId)}>
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
				<li {...hoverItem(it.item, it.displayId)}><ItemIcon displayId={it.displayId} /> <span style:color={QUALITY[it.quality] ?? QUALITY[1]}>{it.name || '(unknown item)'}</span> <span class="dim">{it.item}{it.maxCount ? ` · stock ${it.maxCount}` : ''}</span></li>
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
