<script lang="ts" module>
	import { ListCreatureTemplates, ListObjectTemplates } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { spawnType, creatureTypeName, objectTypeName, rankName } from '../lib/world/spawnInfo'

	// The world database's creature and game object templates, read once for the whole session (the
	// Go side caches them too). The pipette and the options bar use them by entry.
	let creaturesPromise: Promise<vmangos.CreatureTemplate[]> | null = null
	export function loadCreatureTemplates(): Promise<vmangos.CreatureTemplate[]> {
		if (!creaturesPromise) {
			creaturesPromise = ListCreatureTemplates().then((c) => c ?? [])
			creaturesPromise.catch(() => (creaturesPromise = null))
		}
		return creaturesPromise
	}
	let objectsPromise: Promise<vmangos.ObjectTemplate[]> | null = null
	export function loadObjectTemplates(): Promise<vmangos.ObjectTemplate[]> {
		if (!objectsPromise) {
			objectsPromise = ListObjectTemplates().then((o) => o ?? [])
			objectsPromise.catch(() => (objectsPromise = null))
		}
		return objectsPromise
	}
	/** Reads the object templates again next time, after one was saved or made (the Go side forgets its list too). */
	export function forgetObjectTemplates() {
		objectsPromise = null
	}

	/** The browser's spawn tabs: monsters, NPCs (creatures with npc flags) and game objects. */
	export type SpawnKind = 'creature' | 'npc' | 'object'

	/** The key a template is revealed and remembered by, like a catalog key. */
	export const creatureKey = (t: vmangos.CreatureTemplate) => `${t.npcFlags ? 'npc' : 'creature'}:${t.entry}`
	export const objectKey = (t: vmangos.ObjectTemplate) => `object:${t.entry}`

	/** A creature's level range as the tile badge shows it. */
	export const levelText = (t: { levelMin: number; levelMax: number }) => (t.levelMin === t.levelMax ? `${t.levelMin}` : `${t.levelMin}–${t.levelMax}`)

	const HERBS =
		/\b(peacebloom|silverleaf|earthroot|mageroyal|briarthorn|stranglekelp|bruiseweed|steelbloom|grave moss|kingsblood|liferoot|fadeleaf|goldthorn|khadgar's whisker|wintersbite|firebloom|purple lotus|arthas' tears|sungrass|blindweed|ghost mushroom|gromsblood|golden sansam|dreamfoil|mountain silversage|plaguebloom|icecap|black lotus|bloodthistle)\b/i
	const ORE = /\b(vein|deposit|dark iron|mithril|thorium|truesilver)\b/i

	/** An object's category: the herbs and ore veins the client lumps in with chests get their own. */
	export function objectCategory(t: vmangos.ObjectTemplate): string {
		if (t.type === 3) {
			if (ORE.test(t.name)) return 'Ore'
			if (HERBS.test(t.name)) return 'Herb'
		}
		return objectTypeName(t.type)
	}
</script>

<script lang="ts">
	import { idOf, openIdMenu } from '../lib/ui/copyId'
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow, rowTop } from '../lib/ui/virtualGrid'
	import { editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { entryFrom } from '../lib/tools/spawnBrush'
	import type { SearchItem } from '../lib/wow/search'
	import { onDestroy, tick, untrack } from 'svelte'
	import { byLevel, readView, writeView, type BrowserView } from '../lib/wow/browserViews'
	import { prefetchAround, prefetchThumbs } from '../lib/wow/thumbs'

	// The asset browser's Creatures, NPCs and Objects tabs: the world database's templates as
	// rendered tiles in a virtualised grid, narrowed by category (creature type, or object type with
	// herbs and ore apart) and a search over names and entries (the browser's header holds the search
	// box and the order, #651). A creature tile shows its level. A
	// pick makes the template what the Place tool puts down.

	interface Props {
		kind: SpawnKind
		/** The tile under the pointer, for the browser's preview. */
		onhover: (item: SearchItem | null) => void
		/** How many templates the search and category leave, for the browser header's count. */
		count?: number
	}
	let { kind, onhover, count = $bindable(0) }: Props = $props()

	let creatures = $state<vmangos.CreatureTemplate[]>([])
	let objects = $state<vmangos.ObjectTemplate[]>([])
	let error = $state('')
	let loading = $state(true)
	$effect(() => {
		loading = true
		const p = kind === 'object' ? loadObjectTemplates().then((o) => (objects = o)) : loadCreatureTemplates().then((c) => (creatures = c))
		p.catch((err) => (error = String(err))).finally(() => (loading = false))
	})

	/** One tile: a creature or an object template, with what the grid and the preview need. */
	interface Tile {
		key: string
		name: string
		sub: string
		category: string
		badge?: string
		thumb: string
		path: string
		title: string
		entry: number
		creature?: vmangos.CreatureTemplate
		object?: vmangos.ObjectTemplate
	}

	const all = $derived.by((): Tile[] => {
		if (kind === 'object') {
			return objects
				.filter((t) => t.model)
				.map((t) => ({
					key: objectKey(t),
					name: t.name,
					sub: objectTypeName(t.type),
					category: objectCategory(t),
					thumb: spawnType({ model: t.model }),
					path: t.model,
					title: `${t.name} (object ${t.entry})\n${objectTypeName(t.type)}`,
					entry: t.entry,
					object: t,
				}))
		}
		const npc = kind === 'npc'
		return creatures
			.filter((t) => t.model && (t.npcFlags !== 0) === npc)
			.map((t) => ({
				key: creatureKey(t),
				name: t.name,
				sub: t.subname,
				category: creatureTypeName(t.type),
				badge: levelText(t),
				thumb: spawnType({ model: t.model, look: t.look }),
				path: `${t.model}${t.look ? `?${t.look}` : ''}`,
				title: `${t.name}${t.subname ? ` <${t.subname}>` : ''} (creature ${t.entry})\nLevel ${levelText(t)} ${rankName(t.rank)} ${creatureTypeName(t.type)}`,
				entry: t.entry,
				creature: t,
			}))
	})

	// Each tab's search and category live in the preferences, as the asset browser's do (#123).
	const view = $derived(readView(prefs.browserViews, kind))
	const query = $derived(view.query)
	const category = $derived(view.category)
	/** The creature tabs' order; objects have no level, so their tab keeps the database's. */
	const sort = $derived(kind === 'object' ? '' : view.sort)
	function setView(patch: Partial<BrowserView>, k: SpawnKind = kind) {
		prefs.browserViews = writeView(prefs.browserViews, k, patch)
	}

	const categories = $derived.by(() => {
		const n = new Map<string, number>()
		for (const t of all) n.set(t.category, (n.get(t.category) ?? 0) + 1)
		return [...n].sort((a, b) => b[1] - a[1])
	})

	const items = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const list = all.filter((t) => (!category || t.category === category) && (!words.length || words.every((w) => `${t.entry} ${t.name} ${t.sub}`.toLowerCase().includes(w))))
		if (!sort) return list
		const cmp = byLevel(sort === 'level-desc')
		return list.sort((a, b) => cmp(a.creature!, b.creature!))
	})
	$effect(() => {
		count = items.length
	})

	/** The template the Place tool puts down now, drawn highlighted. */
	const activeKey = $derived(ui.placeCreature ? creatureKey(ui.placeCreature) : ui.placeObject ? objectKey(ui.placeObject) : '')

	function pick(t: Tile) {
		// The Doodad tool's Creatures mode: the creature joins the spawn brush (#171), or weighs more if it is in.
		if (t.creature && editor.tool === 'doodad' && editor.doodadMode === 'creatures') {
			const sb = prefs.spawnBrush
			const had = sb.entries.find((e) => e.entry === t.creature!.entry)
			if (had) had.weight += 1
			else sb.entries = [...sb.entries, entryFrom(t.creature)]
			setStatus(had ? `${t.name} weighs ${had.weight} in the spawn brush now.` : `${t.name} joins the spawn brush.`, 3000)
			return
		}
		if (t.creature) {
			ui.placeCreature = t.creature
			ui.placeObject = null
		} else if (t.object) {
			ui.placeObject = t.object
			ui.placeCreature = null
		}
		// The Place tool's preview is the template's model.
		editor.prefab = t.thumb
		if (editor.tool !== 'place') editor.tool = 'place'
	}

	const asItem = (t: Tile): SearchItem => ({ kind: 'm2', key: t.thumb, path: t.path, name: t.name, category: t.category, zone: t.sub || (t.creature ? `Level ${t.badge}` : ''), tokens: [], nameTokens: [], text: '' })

	// The grid renders only the rows in view.
	const GAP = 6
	const tile = $derived(prefs.browserTile)
	const rowH = $derived(tile + (prefs.browserNames ? 22 : 0) + GAP)
	let width = $state(0)
	let height = $state(0)
	let scrollTop = $state(0)
	let scroller: HTMLDivElement | undefined = $state()
	const cols = $derived(gridCols(width, tile, GAP))
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, height))
	// The rows just outside the view are prepared after the ones in it, so scrolling finds them ready.
	$effect(() => {
		prefetchAround(items.length, cols, win.first, win.last, (i) => items[i].thumb)
		return () => prefetchThumbs([])
	})
	/** The tab whose list the grid shows, so a new list knows whether it came with a tab change. */
	let shownKind: SpawnKind | null = null
	// A new list from the same tab (another search or category) starts at the top; a tab changed to,
	// or the templates loaded, goes back to where that tab was left.
	$effect(() => {
		void items
		const k = kind
		if (loading || error) {
			shownKind = null
			return
		}
		const top = untrack(() => (k === shownKind ? 0 : view.scroll))
		shownKind = k
		void tick().then(() => {
			scroller?.scrollTo(0, top)
			scrollTop = scroller?.scrollTop ?? 0
		})
	})

	// The scroll position is kept once the scrolling stops, for the tab it happened in.
	let pendingScroll: { kind: SpawnKind; top: number } | null = null
	let scrollTimer: ReturnType<typeof setTimeout> | undefined
	function flushScroll() {
		clearTimeout(scrollTimer)
		if (pendingScroll) setView({ scroll: Math.round(pendingScroll.top) }, pendingScroll.kind)
		pendingScroll = null
	}
	function onScroll(e: Event) {
		scrollTop = (e.currentTarget as HTMLDivElement).scrollTop
		if (loading || error) return
		if (pendingScroll && pendingScroll.kind !== kind) flushScroll()
		pendingScroll = { kind, top: scrollTop }
		clearTimeout(scrollTimer)
		scrollTimer = setTimeout(flushScroll, 300)
	}
	onDestroy(flushScroll)

	// The pipette's pick (ui.revealAsset with a creature: or object: key) is shown: its category,
	// no search, and its row scrolled into view.
	$effect(() => {
		const req = ui.revealAsset
		if (!req || !req.key.startsWith(`${kind}:`)) return
		void reveal(req.key)
	})
	async function reveal(key: string) {
		const t = all.find((x) => x.key === key)
		if (!t) return
		setView({ query: '', category: t.category })
		await tick()
		await tick()
		const idx = items.indexOf(t)
		if (idx < 0 || !scroller) return
		scroller.scrollTo({ top: Math.max(0, rowTop(idx, cols, rowH) - GAP * 3) })
		scrollTop = scroller.scrollTop
	}
</script>

<div class="spawn-browser">
	<div class="body">
		<nav class="facets">
			<button class="facet" aria-pressed={!category} class:active={!category} onclick={() => setView({ category: '' })}>All <span>{all.length.toLocaleString()}</span></button>
			{#each categories as [name, n] (name)}
				<button class="facet" aria-pressed={category === name} class:active={category === name} onclick={() => setView({ category: category === name ? '' : name })}>{name} <span>{n.toLocaleString()}</span></button>
			{/each}
		</nav>
		<div class="grid-wrap" role="group" aria-label="Templates" tabindex="-1" bind:this={scroller} bind:clientWidth={width} bind:clientHeight={height} onscroll={onScroll} onpointerleave={() => onhover(null)}>
			{#if error}
				<p class="hint error">{error}</p>
			{:else if loading}
				<p class="hint">Reading the world database…</p>
			{:else if !items.length}
				<p class="hint">Nothing matches.</p>
			{:else}
				<VirtualGrid {items} {win} {cols} {tile} gap={GAP} {rowH} key={(t) => t.key}>
					{#snippet cell(t: Tile)}
						<PaletteTile
							thumbKey={t.thumb}
							label={t.name}
							title={t.title}
							size={tile}
							badge={t.badge}
							showLabel={prefs.browserNames}
							active={t.key === activeKey}
							onclick={() => pick(t)}
							onhover={(on) => on && onhover(asItem(t))}
							onmenu={(e) => openIdMenu(e, { ids: [idOf(kind === 'object' ? 'object' : 'creature', t.entry)], name: t.name })}
						/>
					{/snippet}
				</VirtualGrid>
			{/if}
		</div>
	</div>
</div>

<style>
	.spawn-browser {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	.body {
		display: flex;
		min-height: 0;
		flex: 1;
	}
	.facets {
		width: 150px;
		flex: none;
		overflow-y: auto;
		padding: 4px;
		border-right: 1px solid var(--border);
	}
	.facet {
		display: flex;
		justify-content: space-between;
		width: 100%;
		border: none;
		background: transparent;
		padding: 3px 6px;
		text-align: left;
		border-radius: 4px;
		font-size: 11px;
	}
	.facet span {
		color: var(--text-dim);
		font-family: var(--mono);
	}
	.facet.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.facet.active span {
		color: rgba(255, 255, 255, 0.75);
	}
	.grid-wrap {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding: 6px;
		position: relative;
	}
	.hint {
		color: var(--text-dim);
		font-size: 12px;
		margin: 8px;
	}
	.hint.error {
		color: var(--danger-text);
	}
</style>
