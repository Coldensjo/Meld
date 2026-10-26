<script lang="ts">
	import { ExportIcons, ExportIconsDialog, SpellsWithIcon } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { hasBackend } from '../lib/io/backend'
	import { ui } from '../lib/state/editor.svelte'
	import { leaveField, takeEscape } from '../lib/state/escape'
	import { copyToClipboard } from '../lib/ui/clipboard'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import IconGrid from './IconGrid.svelte'
	import ItemIcon from './ItemIcon.svelte'
	import { loadItemDisplays } from './ItemLookPicker.svelte'

	// The Icons tool (#683, Tools › Icons…): every icon of the client in the grid the item and spell
	// editors pick from (IconGrid, with Import PNG… and Export as PNG…, #364), and the picked one large,
	// with its name, its SpellIcon.dbc ID and who uses it. An icon is a file under Interface\Icons with
	// no number of its own: Copy name copies the file's name, Copy spell icon ID the SpellIcon.dbc row
	// that names it (an icon no spell has used has none; the spell editor adds it when a spell first
	// takes it). Items reach an icon through their display (ItemDisplayInfo.dbc), never by an ID of it,
	// so the tool only says which items show it (the owner's decision on #683: 1A, 2A).

	const target = $derived(ui.iconsTool)

	let picked = $state('')
	let hover = $state<string | null>(null)
	const shown = $derived(hover ?? picked)

	/** The spells that show the picked icon (vmangos.IconSpells), null while it is read. */
	let spells = $state<{ spellIconId: number; count: number; spells: vmangos.SpellRef[] | null } | null>(null)
	let displays = $state<vmangos.ItemDisplayEntry[]>([])
	let note = $state('')
	let error = $state('')
	let root = $state<HTMLElement | null>(null)

	$effect(() => {
		if (target?.icon) picked = target.icon
	})

	// The item displays are read once (with the items that use them, when the world database is up).
	$effect(() => {
		if (!target) return
		void loadItemDisplays().then(
			(d) => (displays = d),
			() => (displays = []),
		)
	})

	$effect(() => {
		const name = picked
		spells = null
		if (!name) return
		void SpellsWithIcon(name).then(
			(s) => name === picked && (spells = s),
			(e) => {
				if (name !== picked) return
				spells = { spellIconId: 0, count: 0, spells: [] }
				error = String(e)
			},
		)
	})

	/** The items whose display shows the picked icon: how many, and a few of their names. */
	const items = $derived.by(() => {
		const l = picked.toLowerCase()
		let count = 0
		let looks = 0
		const names: string[] = []
		if (!l) return { count, looks, names }
		for (const d of displays) {
			if (d.icon.toLowerCase() !== l) continue
			looks++
			count += d.uses
			for (const n of d.names ?? []) if (names.length < 8 && !names.includes(n)) names.push(n)
		}
		return { count, looks, names }
	})

	async function copy(text: string, what: string) {
		try {
			await copyToClipboard(text)
			note = `Copied ${what} ${text}.`
			error = ''
		} catch (e) {
			error = String(e)
		}
	}

	async function exportPicked() {
		const name = picked
		if (!name) return
		const dir = await ExportIconsDialog().catch((e) => ((error = String(e)), ''))
		if (!dir) return
		try {
			const r = await ExportIcons([name], dir)
			error = ''
			note = r.written ? `Saved ${name}.png in ${dir}.` : `Could not read ${name}.`
		} catch (e) {
			error = String(e)
		}
	}

	function close() {
		ui.iconsTool = null
		hover = null
		note = error = ''
	}

	function onKey(e: KeyboardEvent) {
		if (!target || e.key !== 'Escape' || ui.contextMenu) return
		if (!takeEscape(e, root)) return
		if (leaveField(e)) return
		e.preventDefault()
		close()
	}

	const more = (n: number, listed: number) => (n > listed ? ` and ${(n - listed).toLocaleString()} more` : '')
</script>

<svelte:window onkeydown={onKey} />

{#if target}
	<div class="editor" role="dialog" aria-modal="true" aria-label="Icons" bind:this={root} use:dialogFocus>
		<header>
			<div class="title">
				<h2>Icons</h2>
				<span class="dim">The client's icons: find one, copy its name or ID, export icons as PNG files or import PNG files as new icons.</span>
			</div>
			<div class="actions">
				<button onclick={close} title="Close (Esc)">Close</button>
			</div>
		</header>
		{#if error}<div class="bar error">{error}</div>{/if}
		{#if note}<div class="bar ok">{note}</div>{/if}
		<div class="body">
			<section class="grid-area">
				<IconGrid selected={picked} iconsFirst="none" onpick={(n) => (picked = n)} onapply={(n) => copy(n, 'the name')} onhover={(n) => (hover = n)} />
			</section>
			<aside aria-label="The icon">
				{#if shown}
					<div class="stage"><ItemIcon icon={shown} size={128} /></div>
					<h3 class="name" title={shown}>{shown}</h3>
					<p class="dim path">Interface\Icons\{shown}.blp</p>
				{/if}
				{#if picked}
					<div class="buttons">
						<button onclick={() => copy(picked, 'the name')} title="Copy the icon's name, the file's name under Interface\Icons">Copy name</button>
						<button disabled={!spells?.spellIconId} onclick={() => spells && copy(String(spells.spellIconId), 'the spell icon ID')} title="Copy the SpellIcon.dbc ID that names this icon, the number a spell's SpellIconID holds"
							>Copy spell icon ID{spells?.spellIconId ? ` (${spells.spellIconId})` : ''}</button
						>
						<button onclick={exportPicked} title="Save this icon as a PNG file in a folder">Export as PNG…</button>
					</div>
					<div class="uses">
						<h4>Spells</h4>
						{#if !spells}
							<p class="dim">Reading…</p>
						{:else if !spells.spellIconId}
							<p class="dim">No spell uses it, and SpellIcon.dbc has no row for it yet: the spell editor adds one when a spell first takes it.</p>
						{:else if !spells.count}
							<p class="dim">SpellIcon {spells.spellIconId}; no spell uses it.</p>
						{:else}
							<p class="dim">SpellIcon {spells.spellIconId}, shown by {spells.count.toLocaleString()} spell{spells.count === 1 ? '' : 's'}:</p>
							<ul class="spells">
								{#each spells.spells ?? [] as s (s.id)}
									<li>{s.name}{s.rank ? ` (${s.rank})` : ''} <span class="dim">{s.id}</span></li>
								{/each}
							</ul>
							{#if spells.count > (spells.spells?.length ?? 0)}<p class="dim">…and the other ranks and copies of them.</p>{/if}
						{/if}
						<h4>Items</h4>
						{#if !items.looks}
							<p class="dim">No item display shows it.</p>
						{:else if !items.count}
							<p class="dim">{items.looks} item display{items.looks === 1 ? '' : 's'} show{items.looks === 1 ? 's' : ''} it; no item uses {items.looks === 1 ? 'it' : 'them'} (or the world database is not running).</p>
						{:else}
							<p class="dim">{items.count.toLocaleString()} item{items.count === 1 ? '' : 's'}, through {items.looks} display{items.looks === 1 ? '' : 's'}: {items.names.join(', ')}{more(items.count, items.names.length)}.</p>
						{/if}
					</div>
				{:else}
					<p class="dim">Pick an icon to see it large, copy its name or ID and see what uses it. A double click copies its name.</p>
				{/if}
			</aside>
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
		display: flex;
		align-items: baseline;
		gap: 12px;
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
		padding: 8px 16px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
		overflow-wrap: anywhere;
	}
	.bar.error {
		color: var(--danger-text);
	}
	.bar.ok {
		color: var(--ok);
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.grid-area {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: 12px;
	}
	aside {
		width: 320px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-left: 1px solid var(--border);
		background: var(--panel);
		overflow-y: auto;
		font-size: 12px;
	}
	.stage {
		display: grid;
		place-items: center;
		padding: 12px;
	}
	.name {
		margin: 0;
		font-size: 14px;
		text-transform: none;
		letter-spacing: normal;
		overflow-wrap: anywhere;
		user-select: text;
	}
	.path {
		margin: 0;
		overflow-wrap: anywhere;
		user-select: text;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	h4 {
		margin: 8px 0 4px;
		font-size: 12px;
	}
	.uses p {
		margin: 0;
	}
	.spells {
		list-style: none;
		margin: 4px 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.spells li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.dim {
		color: var(--text-dim);
	}
</style>
