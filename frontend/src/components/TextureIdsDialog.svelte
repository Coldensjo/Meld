<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity'
	import Modal from './Modal.svelte'
	import { editor, setStatus } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { TEXTURES } from '../lib/cubes/world'
	import { textureUrl } from '../lib/cubes/textures'
	import { textureUse } from '../lib/cubes/textureIds'

	/** The texture id of Tibia item 0: item n is texture TIBIA_BASE + n (internal/otbm TextureBase). */
	const TIBIA_BASE = 0x8000
	import { hasBackend } from '../lib/io/mapio'
	import { LoadItemSprites } from '../../wailsjs/go/main/App'

	// The texture ids the open world's faces are painted with (Edit › Textures in This World, 3dgame
	// #216): every texture the editor knows, then any id it does not (#215), most used first, named and
	// coloured by the world's hints where it has them (a Tibia map's item ids, #218). Rows are picked one,
	// several (Ctrl) or a run (Shift) at a time (#223); the grid on the right picks what they become, and
	// the bar under both shows the change before Replace makes it, one undo step for all.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const world = engineRef.current?.activeDocument().world
	/** Counted again after every replace, so the rows follow it. */
	let use = $state(world ? textureUse(world) : new Map<number, number>())
	let search = $state('')
	/** Version of the world's pictures and names, bumped when they change, so the lists follow. */
	let imagesVersion = $state(0)
	/** Which rows the list shows: every texture, those painted somewhere, or the ids the editor does not know. */
	let show = $state<'all' | 'used' | 'unknown'>('used')
	/** The ids picked to be replaced. */
	const picked = new SvelteSet<number>()
	/** The row a Shift+click runs from. */
	let anchor = $state<number | null>(null)
	/** The texture they become; 0 unpaints. */
	let target = $state<number | null>(null)
	let targetSearch = $state('')

	const known = (id: number) => id < TEXTURES.length
	const hint = (id: number) => (known(id) ? undefined : world?.hints.get(id))
	const nameOf = (id: number) => (id === 0 ? 'unpainted' : known(id) ? TEXTURES[id] : (hint(id)?.name ?? 'unknown'))
	const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`
	const faces = (id: number) => use.get(id) ?? 0
	/** The Tibia item id an imported texture stands for (TextureBase + item id, internal/otbm), -1 for others. */
	const itemOf = (id: number) => (id >= TIBIA_BASE ? id - TIBIA_BASE : -1)
	/**
	 * Whether `id` matches the search `q`: a number (or "item <n>") its texture id or its Tibia item id
	 * from the start (#227), so 4526 finds grass, item 4526, and not cot, texture 34526; words its name.
	 */
	function matches(id: number, q: string): boolean {
		if (!q) return true
		const n = /^(?:item\s*)?(\d+)$/.exec(q)?.[1]
		if (n) return String(id).startsWith(n) || (itemOf(id) >= 0 && String(itemOf(id)).startsWith(n))
		return nameOf(id).toLowerCase().includes(q)
	}

	const rows = $derived.by(() => {
		// Every texture takes in the world's named ones too, the imported Tibia textures it does not use (#227).
		const ids = show === 'all' && world ? new Set([...use.keys(), ...world.hints.keys()]) : use.keys()
		const unknown = [...ids].filter((id) => !known(id)).sort((a, b) => faces(b) - faces(a) || a - b)
		const knownIds = [...TEXTURES.keys()].slice(1)
		const all = show === 'unknown' ? unknown.filter((id) => faces(id) > 0) : knownIds.concat(unknown)
		const q = search.trim().toLowerCase()
		if (imagesVersion < 0) return []
		return all.filter((id) => (show === 'all' || faces(id) > 0) && matches(id, q))
	})
	/** Which textures the grid offers: the game's, the world's Tibia textures with a picture (#227), or both. */
	let targetShow = $state<'all' | 'game' | 'tibia'>('all')
	/** The textures a row can become: unpainted, every texture the editor knows, then the world's own with a picture, by name. */
	const targets = $derived.by(() => {
		const q = targetSearch.trim().toLowerCase()
		const game = targetShow === 'tibia' ? [] : [0, ...[...TEXTURES.keys()].slice(1)]
		const tibia = targetShow === 'game' || imagesVersion < 0 || !world ? [] : [...world.images.keys()].filter((id) => !known(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a - b)
		return game.concat(tibia).filter((id) => matches(id, q))
	})
	const pickedList = $derived([...picked].sort((a, b) => faces(b) - faces(a)))
	const pickedFaces = $derived(pickedList.reduce((n, id) => n + faces(id), 0))
	/** The picked ids that would change: all but the target itself. */
	const changing = $derived(target === null ? [] : pickedList.filter((id) => id !== target))

	/** A row's click: picks it alone, Ctrl adds or drops it, Shift picks the run from the last one clicked. */
	function pick(e: MouseEvent, id: number) {
		if (e.shiftKey && anchor !== null) {
			const a = rows.indexOf(anchor)
			const b = rows.indexOf(id)
			if (a >= 0 && b >= 0) {
				if (!(e.ctrlKey || e.metaKey)) picked.clear()
				for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (faces(rows[i]) > 0) picked.add(rows[i])
				return
			}
		}
		if (e.ctrlKey || e.metaKey) {
			if (picked.has(id)) picked.delete(id)
			else picked.add(id)
		} else {
			picked.clear()
			picked.add(id)
		}
		anchor = id
	}

	/** A row's tick box: adds or drops it, keeping the others. */
	function toggle(id: number) {
		if (picked.has(id)) picked.delete(id)
		else picked.add(id)
		anchor = id
	}

	function pickAllShown() {
		for (const id of rows) if (faces(id) > 0) picked.add(id)
	}

	const picture = (id: number) => (imagesVersion >= 0 && !known(id) ? world?.images.get(id) : undefined)

	/**
	 * Import Tibia textures (3dgame #224, #227): Go asks for a .zip of item sprites named by item id and
	 * reads those that lie on a cube face, for the world's unknown ids and every ground, floor, wall and
	 * border of the map's items.otb, with their names; they join the world's pictures and names, one undo
	 * step, and can be painted and replaced with.
	 */
	async function importTextures() {
		if (!world) return
		const ids = [...new Set([...use.keys(), ...world.hints.keys()])].filter((id) => !known(id))
		try {
			const got = await LoadItemSprites(ids)
			if (!got?.summary) return
			const images = new Map(world.images)
			for (const [id, png] of Object.entries(got.images ?? {})) images.set(Number(id), png)
			const hints = new Map(world.hints)
			for (const h of got.hints ?? []) hints.set(h.id, { id: h.id, colour: h.colour, name: h.name })
			engineRef.current?.setWorldTextures(images, hints, 'Import Tibia textures')
			imagesVersion++
			setStatus(got.summary, 12000)
		} catch (err) {
			setStatus(`Import Tibia textures failed: ${err}`, 8000)
		}
	}

	/** Paint with the texture picked in the grid: the Cubes tool's Paint mode takes it (#227). */
	function paintWith() {
		if (target === null || target === 0) return
		editor.cubeTexture = target
		editor.tool = 'cube'
		editor.cubeMode = 'paint'
		setStatus(`Painting with ${target} ${nameOf(target)}.`, 4000)
		onclose()
	}

	function replace() {
		if (target === null || !changing.length) return
		const to = target
		const n = engineRef.current?.replaceTexture(changing, to) ?? 0
		const what = changing.length === 1 ? `Texture ${changing[0]} (${nameOf(changing[0])})` : `${changing.length} textures`
		setStatus(`${what} replaced with ${to ? `${to} (${nameOf(to)})` : 'unpainted'} on ${n} cubes (Ctrl+Z undoes it).`, 5000)
		if (world) use = textureUse(world)
		picked.clear()
		anchor = null
	}
</script>

{#snippet swatch(id: number, size: number)}
	{@const h = hint(id)}
	{#if id === 0}
		<span class="swatch none" style:width="{size}px" style:height="{size}px" title="unpainted: the cube kind's own texture"></span>
	{:else if known(id)}
		<img class="swatch" src={textureUrl(id)} alt="" style:width="{size}px" style:height="{size}px" />
	{:else if picture(id)}
		<img class="swatch" src="data:image/png;base64,{picture(id)}" alt="" style:width="{size}px" style:height="{size}px" />
	{:else if h}
		<span class="swatch" style:width="{size}px" style:height="{size}px" style:background={hex(h.colour)}></span>
	{:else}
		<span class="swatch missing" style:width="{size}px" style:height="{size}px"></span>
	{/if}
{/snippet}

<Modal title="Textures in This World" width={940} {onclose}>
	{#if world}
		<div class="cols">
			<section class="from" aria-label="Textures to replace">
				<h3>Replace</h3>
				<div class="tools">
					<input type="search" placeholder="Search by id or name" bind:value={search} aria-label="Search the world's textures" />
					<select bind:value={show} aria-label="Which textures to list">
						<option value="used">In this world</option>
						<option value="unknown">Unknown ids only</option>
						<option value="all">Every texture</option>
					</select>
				</div>
				<div class="tools">
					<button onclick={pickAllShown} title="Pick every listed texture that faces are painted with">Select all shown</button>
					<button onclick={() => picked.clear()} disabled={!picked.size}>Clear</button>
					<button onclick={importTextures} disabled={!hasBackend()} title="Read a .zip of Tibia item sprites named by item id (0102_item_image.png): every ground, floor, wall and border of the map's items.otb becomes a texture with its name, to paint and replace with, and the world's own show theirs; trees, monsters and objects keep their colour">Import Tibia textures…</button>
					<span class="dim">{picked.size} picked · click, Ctrl+click, Shift+click</span>
				</div>
				<div class="rows" role="listbox" aria-multiselectable="true">
					{#each rows as id (id)}
						{@const n = faces(id)}
						<div class="row" class:unused={!n} class:unknown={!known(id)} class:picked={picked.has(id)} role="option" aria-selected={picked.has(id)} tabindex="-1" onclick={(e) => n && pick(e, id)} onkeydown={(e) => e.key === ' ' && n && toggle(id)}>
							<input type="checkbox" checked={picked.has(id)} disabled={!n} onclick={(e) => e.stopPropagation()} onchange={() => toggle(id)} aria-label="Pick texture {id}" />
							{@render swatch(id, 28)}
							<span class="id">{id}</span>
							<span class="name" title={nameOf(id)}>{nameOf(id)}</span>
							<span class="count">{n ? `${n.toLocaleString()} faces` : 'unused'}</span>
						</div>
					{:else}
						<p class="dim empty">No textures match.</p>
					{/each}
				</div>
			</section>
			<section class="to" aria-label="Texture to replace with">
				<h3>With</h3>
				<div class="tools">
					<input type="search" placeholder="Search by name, texture id or item id" bind:value={targetSearch} aria-label="Search the textures to replace with" />
					<select bind:value={targetShow} aria-label="Which textures to offer">
						<option value="all">All textures</option>
						<option value="game">The game's</option>
						<option value="tibia">Tibia's</option>
					</select>
					<button onclick={paintWith} disabled={!target} title="Paint faces with the texture picked here: the Cubes tool's Paint mode">Paint with it</button>
				</div>
				<div class="grid" role="listbox">
					{#each targets as id (id)}
						<button class="tile" class:chosen={target === id} role="option" aria-selected={target === id} onclick={() => (target = id)} title="{id ? `${id} ` : ''}{nameOf(id)}{itemOf(id) >= 0 ? ` · texture ${id}` : ''}">
							{@render swatch(id, 56)}
							<span class="tile-name">{nameOf(id).replace(/ \(item \d+\)$/, '')}</span>
							{#if itemOf(id) >= 0}<span class="tile-id">item {itemOf(id)}</span>{/if}
						</button>
					{/each}
				</div>
			</section>
		</div>
		<div class="bar">
			{#if !picked.size}
				<span class="dim">Pick the textures to replace on the left, and what they become on the right.</span>
			{:else}
				<div class="change">
					<div class="side">
						<div class="stack">
							{#each pickedList.slice(0, 6) as id (id)}{@render swatch(id, 40)}{/each}
							{#if pickedList.length > 6}<span class="more">+{pickedList.length - 6}</span>{/if}
						</div>
						<span class="label">{pickedList.length === 1 ? `${pickedList[0]} ${nameOf(pickedList[0])}` : `${pickedList.length} textures`} · {pickedFaces.toLocaleString()} faces</span>
					</div>
					<span class="arrow">→</span>
					<div class="side">
						{#if target === null}
							<span class="swatch empty-target" style:width="40px" style:height="40px"></span>
							<span class="label dim">pick a texture on the right</span>
						{:else}
							{@render swatch(target, 40)}
							<span class="label">{target ? `${target} ` : ''}{nameOf(target)}</span>
						{/if}
					</div>
				</div>
				<button class="active" disabled={!changing.length} onclick={replace} title="Paint every face of the picked textures with the chosen one, as one undo step">Replace</button>
			{/if}
		</div>
	{/if}
	{#snippet actions()}
		<button onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	section {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	h3 {
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 600;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
		font-size: 12px;
	}
	.tools {
		flex-wrap: wrap;
	}
	.tools button {
		white-space: nowrap;
	}
	.tools input[type='search'] {
		flex: 1;
		min-width: 0;
	}
	.rows,
	.grid {
		height: 400px;
		overflow-y: auto;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
		border-radius: 4px;
	}
	.row {
		display: grid;
		grid-template-columns: 18px 28px 48px 1fr 100px;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		font-size: 12px;
		cursor: default;
		user-select: none;
	}
	.row:not(.unused):hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.row.picked {
		background: rgba(26, 111, 209, 0.35);
	}
	.row.unused {
		color: var(--text-dim);
	}
	.row.unknown .name {
		font-style: italic;
	}
	.id,
	.count {
		font-variant-numeric: tabular-nums;
	}
	.id {
		text-align: right;
	}
	.count {
		text-align: right;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
		align-content: start;
		gap: 4px;
		padding: 4px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px 2px;
		border: 2px solid transparent;
		border-radius: 4px;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 11px;
	}
	.tile:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	.tile.chosen {
		border-color: var(--accent, #1a6fd1);
		background: rgba(26, 111, 209, 0.25);
	}
	.tile-name {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tile-id {
		color: var(--text-dim);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.swatch {
		display: inline-block;
		flex: none;
		object-fit: cover;
		object-position: top;
		image-rendering: pixelated;
		border-radius: 2px;
	}
	.missing {
		background: repeating-conic-gradient(#f0f 0 25%, #000 0 50%) 0 0 / 8px 8px;
	}
	.none {
		background: repeating-linear-gradient(45deg, #444 0 4px, #333 4px 8px);
	}
	.empty-target {
		border: 1px dashed var(--text-dim);
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
		min-height: 64px;
		padding: 8px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.04);
		font-size: 12px;
	}
	.change {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}
	.side {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.stack {
		display: flex;
		gap: 2px;
		align-items: center;
	}
	.more {
		padding: 0 4px;
		color: var(--text-dim);
	}
	.arrow {
		font-size: 22px;
		color: var(--text-dim);
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 260px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.empty {
		padding: 8px;
	}
</style>
