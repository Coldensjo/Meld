<script lang="ts" module>
	import { ExportIcons, ExportIconsDialog, ImportIcons, ListItemIcons, OpenIconsDialog } from '../../wailsjs/go/main/App'

	// The list is read once a session; forgetIcons drops it after icons were added.
	let icons: Promise<string[]> | null = null

	export function loadIcons(): Promise<string[]> {
		if (!icons) {
			icons = ListItemIcons().then((d) => d ?? [])
			icons.catch(() => (icons = null))
		}
		return icons
	}

	/** Drops the icon list, after icons were added (#364). */
	export function forgetIcons() {
		icons = null
	}
</script>

<script lang="ts">
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow } from '../lib/ui/virtualGrid'
	import { forgetIconImages } from '../lib/wow/items'
	import { forgetSpellIcons } from '../lib/wow/spells'
	import ItemIcon from './ItemIcon.svelte'

	// The grid of every icon of the client (names under Interface\Icons), shared by the item editor's
	// and the spell editor's Change icon views and the Icons tool (#683), so the three don't diverge.
	// A search narrows it; only the rows in view are drawn. Hovering a tile previews it, a click picks
	// it, a double click picks it and applies it. Import PNG… adds PNG files to the client as icons
	// and picks the first, and Export saves the icons the search shows as PNG files in a folder (#364).

	interface Props {
		/** The icon picked now, drawn highlighted. */
		selected: string
		onpick: (name: string) => void
		/** A double click: pick it and apply it. */
		onapply?: (name: string) => void
		/** The tile under the pointer (null when it leaves the grid). */
		onhover?: (name: string | null) => void
		/** Which icons come first: the items' (INV_…), the rest (the spells' and abilities'), or by name. */
		iconsFirst?: 'items' | 'spells' | 'none'
	}
	let { selected, onpick, onapply, onhover, iconsFirst = 'items' }: Props = $props()

	let query = $state('')
	let iconList = $state<string[]>([])
	let error = $state('')
	let loading = $state(true)
	/** What the last import or export did. */
	let note = $state('')
	let busy = $state(false)

	$effect(() => {
		loading = true
		loadIcons()
			.then(
				(d) => (iconList = d),
				(e) => (error = String(e)),
			)
			.finally(() => (loading = false))
	})

	const iconMatches = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/\s+/g, '_')
		const list = q ? iconList.filter((i) => i.toLowerCase().includes(q)) : iconList
		if (iconsFirst === 'none') return list
		const inv = (n: string) => /^inv_/i.test(n) === (iconsFirst === 'items')
		return [...list.filter(inv), ...list.filter((n) => !inv(n))]
	})
	const count = $derived(iconMatches.length)

	// The grid draws only the rows in view.
	const TILE = 44
	const GAP = 6
	const rowH = TILE + GAP
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	let scroller: HTMLDivElement | undefined = $state()
	const cols = $derived(gridCols(width, TILE, GAP))
	const win = $derived(gridWindow(count, cols, rowH, scrollTop, height))
	$effect(() => {
		void iconMatches
		scroller?.scrollTo(0, 0)
		scrollTop = 0
	})

	const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

	async function importIcons() {
		const paths = await OpenIconsDialog().catch((e) => ((error = String(e)), null))
		if (!paths?.length) return
		busy = true
		error = note = ''
		try {
			const r = await ImportIcons(paths)
			const names = r.names ?? []
			const parts: string[] = []
			if (names.length) {
				forgetIcons()
				forgetIconImages(names)
				forgetSpellIcons(names)
				iconList = await loadIcons()
				query = names.length === 1 ? names[0] : ''
				onpick(names[0])
				const it = names.length === 1 ? 'it' : 'them'
				const when = r.waiting ? ` Meld's patch takes ${it} once the game has closed;` : ''
				parts.push(`Added ${names.join(', ')} to the client's icons.${when} ${r.waiting ? 'the' : 'The'} game shows ${it} from its next start.`)
			}
			if (r.refused?.length) parts.push(`Not added: ${r.refused.join('; ')}.`)
			note = parts.join(' ')
		} catch (e) {
			error = String(e)
		} finally {
			busy = false
		}
	}

	async function exportIcons() {
		const names = iconMatches
		if (!names.length) return
		const dir = await ExportIconsDialog().catch((e) => ((error = String(e)), ''))
		if (!dir) return
		busy = true
		error = note = ''
		try {
			const r = await ExportIcons(names, dir)
			const failed = r.failed ?? []
			note = `Saved ${plural(r.written, 'icon')} as PNG in ${dir}.${failed.length ? ` Not read: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}`
		} catch (e) {
			error = String(e)
		} finally {
			busy = false
		}
	}

	const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
</script>

<div class="picker" data-icon-grid>
	<div class="row">
		<input type="search" placeholder="Search: an icon name, such as sword, INV_Axe or potion" bind:value={query} aria-label="Search the icons" />
		<span class="dim">{count.toLocaleString()} icons</span>
		<button disabled={busy} onclick={importIcons} title="Add PNG files to the client as icons, each named after its file (square; scaled to 64x64)">Import PNG…</button>
		<button disabled={busy || !count} onclick={exportIcons} title="Save the icons shown (all of them, or the search's matches) as PNG files in a folder">Export {count === iconList.length ? 'all' : count.toLocaleString()} as PNG…</button
		>
	</div>
	{#if error}<p class="error">{error}</p>{/if}
	{#if note}<p class="note">{note}</p>{/if}
	<div
		class="grid-wrap"
		role="listbox"
		aria-label="Icons"
		tabindex="-1"
		bind:this={scroller}
		bind:clientWidth={width}
		bind:clientHeight={height}
		onscroll={(e) => (scrollTop = (e.currentTarget as HTMLDivElement).scrollTop)}
		onpointerleave={() => onhover?.(null)}
	>
		{#if loading}
			<p class="dim">Reading the client's icons…</p>
		{:else if !count}
			<p class="dim">Nothing matches.</p>
		{:else}
			<VirtualGrid items={iconMatches} {win} {cols} tile={TILE} gap={GAP} {rowH} key={(name) => name}>
				{#snippet cell(name: string)}
					<button class="icon-btn" class:on={same(name, selected)} style:width="{TILE}px" style:height="{TILE}px" title={name} onclick={() => onpick(name)} ondblclick={() => onapply?.(name)} onpointerover={() => onhover?.(name)}>
						<ItemIcon icon={name} size={36} />
					</button>
				{/snippet}
			</VirtualGrid>
		{/if}
	</div>
</div>

<style>
	.picker {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.row input {
		flex: 2;
		min-width: 0;
	}
	.row button {
		flex: none;
		white-space: nowrap;
	}
	.grid-wrap {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 6px;
	}
	.icon-btn {
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
	}
	.icon-btn:hover {
		border-color: var(--text-dim);
	}
	.icon-btn.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-ink);
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
		white-space: nowrap;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
	.note {
		color: var(--text-dim);
		margin: 0;
	}
</style>
