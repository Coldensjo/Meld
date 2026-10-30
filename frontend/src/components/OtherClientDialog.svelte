<script lang="ts">
	import { onMount } from 'svelte'
	import Modal from './Modal.svelte'
	import PaletteTile from './PaletteTile.svelte'
	import VirtualGrid from './VirtualGrid.svelte'
	import { gridCols, gridWindow } from '../lib/ui/virtualGrid'
	import { buildCatalog, categoryOrder } from '../lib/wow/catalog'
	import { indexCatalog, searchAssets, type SearchItem } from '../lib/wow/search'
	import { listAssets, otherPath } from '../lib/wow/api'
	import { prefs, wow } from '../lib/state/editor.svelte'
	import { hasBackend } from '../lib/io/backend'
	import { browseOther, clientId, forgetOtherClient, importOther, listOther, openOther, other, saveOtherClient } from '../lib/wow/otherClient.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import type { main, wow as wowModels } from '../lib/wails/models'

	// Tools › Import from Another Client… (#858): another client's models, buildings and textures as
	// thumbnails, read-only; the chosen ones go into the current client's patch with every file they
	// need, under the same paths (Go's ImportOtherAssets). A file the current client has a different
	// copy of is replaced only when asked after an import that met one, behind a warning (#878). The
	// clients are the preferences' saved list, a name and a folder each.

	let { onclose }: { onclose: () => void } = $props()

	type Kind = 'm2' | 'wmo' | 'tex'
	const KINDS: [Kind, string][] = [
		['m2', 'Models'],
		['wmo', 'Buildings'],
		['tex', 'Textures'],
	]
	const listKind = (k: Kind) => (k === 'tex' ? 'tileset' : k)

	let kind = $state<Kind>('m2')
	let query = $state('')
	/** Only the assets the current client lacks. */
	let lacking = $state(true)
	/** The chosen assets, as catalog keys (`<kind>:<path>`), in the order they were picked. */
	let chosen = $state<string[]>([])
	let catalog = $state<SearchItem[]>([])
	/** The current client's paths of the kind shown, lower case. */
	let have = $state(new Set<string>())
	let loadingList = $state(false)
	let busy = $state(false)
	let result = $state<main.AssetsImported | null>(null)
	/** What the last import was asked, for its Replace buttons. */
	let last: { paths: string[]; opts: wowModels.ImportOptions } = { paths: [], opts: { replaceAssets: false, replaceNeeded: false } }
	let failure = $state('')
	let newPath = $state('')
	let picked = $state('')

	async function pick(path: string) {
		picked = path
		chosen = []
		result = null
		await openOther(path)
	}

	onMount(() => {
		picked = other.path
		if (!other.loaded && prefs.otherClients.length) void pick(prefs.otherClients[0].path)
		// What Go decoded from the other client is let go of with the dialog.
		return () => void openOther('')
	})

	async function add(path: string) {
		path = path.trim()
		if (!path) return
		saveOtherClient(path)
		newPath = ''
		await pick(path)
	}

	async function browse() {
		const p = await browseOther()
		if (p) await add(p)
	}

	async function remove() {
		const p = picked
		await forgetOtherClient(p)
		picked = ''
		chosen = []
		if (prefs.otherClients.length) await pick(prefs.otherClients[0].path)
	}

	// The other client's list of the kind shown, and the current client's to tell what it lacks.
	let token = 0
	$effect(() => {
		const k = kind
		const ok = other.loaded
		void other.path
		void wow.revision
		const mine = ++token
		if (!ok) {
			catalog = []
			return
		}
		loadingList = true
		void Promise.all([listOther(listKind(k)), listAssets(listKind(k))]).then(([theirs, ours]) => {
			if (mine !== token) return
			catalog = indexCatalog(k, buildCatalog(k, theirs))
			have = new Set(ours.map((p) => p.toLowerCase()))
			loadingList = false
		})
	})

	const id = $derived(clientId(other.path))
	const shown = $derived(lacking ? catalog.filter((it) => !have.has(it.path.toLowerCase())) : catalog)
	const items = $derived(searchAssets(shown, { kind, query, category: '', zone: '' }, categoryOrder(kind)).items)
	const chosenSet = $derived(new Set(chosen))
	const pathOf = (key: string) => key.slice(key.indexOf(':') + 1)

	function toggle(it: SearchItem) {
		chosen = chosenSet.has(it.key) ? chosen.filter((k) => k !== it.key) : [...chosen, it.key]
	}

	async function runImport(paths = chosen.map(pathOf), opts: wowModels.ImportOptions = { replaceAssets: false, replaceNeeded: false }) {
		busy = true
		failure = ''
		result = null
		last = { paths, opts }
		try {
			result = await importOther(paths, opts)
			chosen = []
		} catch (e) {
			failure = String(e)
		} finally {
			busy = false
		}
	}

	const REPLACE_WARNING =
		'The current client then reads the other client’s version of these files: every map and the game show it from then on, and Meld has no command to take it out again. ' +
		'To undo, close Meld and the game and put Data\\patch-3.MPQ.prev (the patch as it was) back over patch-3.MPQ, before Meld writes the patch again.'

	/** Imports the refused assets again, writing their own files over the current client's. */
	async function replaceAssets(paths: string[]) {
		if (!(await askConfirm(`Replace this client’s copy of ${plural(paths.length, 'asset')} with the other client’s? ${REPLACE_WARNING}`, { title: 'Replace this client’s files', ok: 'Replace' }))) return
		// A plain list, not the result's reactive one, for the binding.
		await runImport([...paths], { replaceAssets: true, replaceNeeded: false })
	}

	/** Imports the last import's assets again, writing the needed files kept as they were over the current client's. */
	async function replaceKept(n: number) {
		if (!(await askConfirm(`Replace this client’s copy of the ${plural(n, 'file')} the imported assets need with the other client’s? ${REPLACE_WARNING}`, { title: 'Replace this client’s files', ok: 'Replace' }))) return
		await runImport(last.paths, { ...last.opts, replaceNeeded: true })
	}

	const mb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
	const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

	// The grid renders only the rows in view.
	const GAP = 6
	const TILE = 112
	const rowH = TILE + 22 + GAP
	let scroller = $state<HTMLDivElement>()
	let gridWidth = $state(0)
	let viewHeight = $state(0)
	let scrollTop = $state(0)
	const cols = $derived(gridCols(gridWidth, TILE, GAP))
	const win = $derived(gridWindow(items.length, cols, rowH, scrollTop, viewHeight))
	$effect(() => {
		void kind
		void query
		void lacking
		if (scroller) scroller.scrollTop = 0
		scrollTop = 0
	})
</script>

<Modal title="Import from another client" width={980} {onclose}>
	<div class="other" data-ui="OtherClientDialog">
		<div class="row">
			<label for="other-client">Client</label>
			<select id="other-client" value={picked} disabled={!prefs.otherClients.length || other.loading} onchange={(e) => void pick(e.currentTarget.value)}>
				{#if !picked}<option value="">Pick a client…</option>{/if}
				{#each prefs.otherClients as c (c.path)}<option value={c.path} title={c.path}>{c.name}</option>{/each}
			</select>
			<button disabled={!picked} onclick={() => void remove()}>Remove</button>
			<input class="path" placeholder="Another 1.12 client's folder" bind:value={newPath} onkeydown={(e) => e.key === 'Enter' && void add(newPath)} aria-label="Client folder" />
			<button disabled={!newPath.trim()} onclick={() => void add(newPath)}>Add</button>
			<button disabled={!hasBackend()} onclick={() => void browse()}>Browse…</button>
		</div>
		<p class="status dim">
			{#if other.loading}Opening {picked}…
			{:else if other.error}<span class="err">{other.error}</span>
			{:else if other.loaded}{other.path}: {other.files.toLocaleString()} files, read only.
			{:else}Add another client's folder to see its models and textures. Meld only reads it.{/if}
		</p>
		<div class="row">
			<div class="kinds" role="tablist">
				{#each KINDS as [k, label] (k)}
					<button role="tab" aria-selected={kind === k} class:active={kind === k} onclick={() => (kind = k)}>{label}</button>
				{/each}
			</div>
			<input class="search" type="search" placeholder="Search" bind:value={query} aria-label="Search" />
			<label class="check"><input type="checkbox" bind:checked={lacking} /> Only what this client lacks</label>
		</div>
		<div class="grid-wrap" bind:this={scroller} bind:clientWidth={gridWidth} bind:clientHeight={viewHeight} onscroll={() => (scrollTop = scroller?.scrollTop ?? 0)} role="group" aria-label="Other client's assets">
			{#if !other.loaded}
				<p class="hint dim">No client open.</p>
			{:else if loadingList}
				<p class="hint dim">Listing…</p>
			{:else if !items.length}
				<p class="hint dim">{lacking && catalog.length ? 'This client has all of them. Untick “Only what this client lacks” to see them all.' : 'Nothing matches.'}</p>
			{:else}
				<VirtualGrid {items} {win} {cols} tile={TILE} gap={GAP} {rowH} key={(it) => it.key}>
					{#snippet cell(it: SearchItem)}
						<PaletteTile
							thumbKey={`${it.kind}:${otherPath(id, it.path)}`}
							label={it.name}
							title={have.has(it.path.toLowerCase()) ? `${it.path} (this client has a file there)` : it.path}
							size={TILE}
							active={chosenSet.has(it.key)}
							badge={have.has(it.path.toLowerCase()) ? 'has' : undefined}
							onclick={() => toggle(it)}
						/>
					{/snippet}
				</VirtualGrid>
			{/if}
		</div>
		{#if failure}<p class="err">{failure}</p>{/if}
		{#if result}
			<div class="result" role="status">
				{#if result.imported.length}
					<p>
						Imported {plural(result.imported.length, 'asset')} ({plural(result.files, 'file')}, {mb(result.bytes)}) into the client's patch{result.waiting ? '. They wait for the game to close, then go in.' : '.'}
						The asset browser lists them; the game shows them from its next start.
					</p>
				{/if}
				{#if result.present.length}<p class="dim">{plural(result.present.length, 'asset')} this client has already: {result.present.join(', ')}</p>{/if}
				{#if result.refused.length}
					<p class="err">Not imported:</p>
					<ul>
						{#each result.refused as r (r)}<li>{r}</li>{/each}
					</ul>
					{#if result.differs.length}
						{@const differs = result.differs}
						<p class="replace">
							<button class="replace-assets" disabled={busy} onclick={() => void replaceAssets(differs)}>Replace this client’s copy…</button>
							<span class="dim">of the {plural(differs.length, 'asset')} it has a different file for</span>
						</p>
					{/if}
				{/if}
				{#if result.kept.length}
					{@const kept = result.kept.length}
					<details>
						<summary>{plural(kept, 'file')} this client has a different copy of, kept as it is</summary>
						<ul>
							{#each result.kept as k (k)}<li>{k}</li>{/each}
						</ul>
					</details>
					<p class="replace">
						<button class="replace-kept" disabled={busy} onclick={() => void replaceKept(kept)}>Replace this client’s copy…</button>
						<span class="dim">of the {plural(kept, 'file')} kept</span>
					</p>
				{/if}
				{#if result.replaced.length}
					<details>
						<summary class="warn">{plural(result.replaced.length, 'file')} written over this client’s copy (patch-3.MPQ.prev holds the patch as it was)</summary>
						<ul>
							{#each result.replaced as r (r)}<li>{r}</li>{/each}
						</ul>
					</details>
				{/if}
				{#if result.missing.length}
					<details>
						<summary>{plural(result.missing.length, 'file')} named but in neither client</summary>
						<ul>
							{#each result.missing as m (m)}<li>{m}</li>{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}
	</div>
	{#snippet actions()}
		<span class="dim chosen">{chosen.length ? `${plural(chosen.length, 'asset')} chosen` : 'Click thumbnails to choose them.'}</span>
		<button disabled={!chosen.length || busy} onclick={() => (chosen = [])}>Clear</button>
		<button class="active" disabled={!chosen.length || busy || !wow.loaded} onclick={() => void runImport()}>{busy ? 'Importing…' : 'Import'}</button>
		<button onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.other {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.row select {
		min-width: 160px;
	}
	.path,
	.search {
		flex: 1;
		min-width: 0;
	}
	.status {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kinds {
		display: flex;
		gap: 2px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.grid-wrap {
		height: min(460px, calc(100 * var(--vh) - 380px));
		min-height: 200px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px;
	}
	.hint {
		margin: 12px;
	}
	.err {
		color: var(--danger-text);
	}
	.result p {
		margin: 4px 0;
	}
	.result ul {
		margin: 2px 0 6px;
		padding-left: 18px;
		max-height: 120px;
		overflow-y: auto;
		font: 11px var(--mono);
	}
	.replace {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.warn {
		color: var(--warn);
	}
	.chosen {
		margin-right: auto;
	}
</style>
