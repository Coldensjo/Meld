<script lang="ts" module>
	import { keysOf } from '../lib/ui/commands'
	type Use = 'heights' | 'zones' | 'textures' | 'mask'
	/** The conversion's choices, kept for the session. */
	const last = $state({ use: 'heights' as Use, min: 0, max: 100, heightMode: 'set' as 'set' | 'add', tolerance: 40 })
</script>

<script lang="ts">
	import type { vmangos } from '../../wailsjs/go/models'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { hasBackend } from '../lib/io/backend'
	import { chooseReferenceFile, readReferenceFile } from '../lib/io/referenceLoad'
	import { colourHex, copyReference, fitPlace, type ReferenceImage, type ReferenceMode } from '../lib/terrain/referenceImage'
	import { areaName, loadAreas } from '../lib/wow/areas'
	import { isColor } from '../lib/terrain/paletteArray'

	// View › Reference Image (#184): the author's own plan of a zone (a PNG or JPEG of theirs, kept by
	// path in the map file) laid over the map to trace, draped on the ground or over the top-down view,
	// and turned into heights, zones, textures or the mask, each one undo step. A window, not a dialog,
	// so the map stays in reach: with Place by dragging on, the top-down view drags the image's corners.

	const r = $derived(editor.reference)
	/** The image as read, once its pixels are in (ui.referenceVersion moves when they arrive). */
	const img = $derived.by(() => {
		void ui.referenceVersion
		const i = engineRef.current?.referenceImage ?? null
		return i && i.path === r?.path ? i : null
	})
	const colours = $derived(img ? img.colours() : [])
	const fileName = $derived(r ? r.path.slice(Math.max(r.path.lastIndexOf('\\'), r.path.lastIndexOf('/')) + 1) : '')

	/** Each colour's zone, texture and mask choice, for the image they were made for. */
	let choice = $state({ path: '', areas: [] as number[], layers: [] as number[], mask: [] as boolean[] })
	$effect(() => {
		const path = img?.path ?? ''
		if (path === choice.path && choice.areas.length === colours.length) return
		choice = { path, areas: colours.map(() => 0), layers: colours.map(() => -1), mask: colours.map(() => false) }
	})

	let areas = $state<vmangos.Area[]>([])
	$effect(() => {
		if (last.use === 'zones' && !areas.length) void loadAreas().then((a) => (areas = a))
	})

	let busy = $state(false)

	/** Sets the record as one undo step. */
	function commit(next: ReferenceImage | null, label: string, before?: ReferenceImage | null) {
		engineRef.current?.setReference(next, label, before === undefined ? copyReference(editor.reference) : before)
	}

	async function choose() {
		const e = engineRef.current
		if (!e || !hasBackend() || busy) return
		busy = true
		try {
			const path = await chooseReferenceFile()
			if (!path) return
			const loaded = await readReferenceFile(path)
			e.useReferenceImage(loaded)
			const old = editor.reference
			// Another picture keeps the old one's place and width, at its own shape.
			const next: ReferenceImage = old ? { ...old, path, h: (old.w * loaded.pixels.h) / Math.max(1, loaded.pixels.w) } : e.referenceFor(loaded)
			commit(next, old ? 'Change reference image' : 'Add reference image')
			setStatus(`Laid ${path} over the map (${loaded.pixels.w}×${loaded.pixels.h}). The map keeps its path, not the picture.`, 6000)
		} catch (err) {
			setStatus(`Reference image not read: ${err}`, 8000)
		} finally {
			busy = false
		}
	}

	function remove() {
		ui.referenceAdjust = false
		commit(null, 'Remove reference image')
	}

	function set<K extends keyof ReferenceImage>(key: K, value: ReferenceImage[K], label: string) {
		if (!r) return
		commit({ ...r, [key]: value }, label)
	}

	function setMode(mode: ReferenceMode) {
		if (!r || r.mode === mode) return
		if (mode === 'screen') ui.referenceAdjust = false
		if (mode === 'screen' && !ui.topDown) ui.topDown = true
		set('mode', mode, mode === 'screen' ? 'Reference image over the view' : 'Reference image on the ground')
	}

	/** Lays the screen overlay on the ground where it shows now. */
	function pinToGround() {
		const p = engineRef.current?.referenceFromScreen()
		if (!r || !p) {
			setStatus(`Turn on the top-down view${keysOf('topDown') ? ` (${keysOf('topDown')})` : ''} to lay the image where it shows.`, 4000)
			return
		}
		commit({ ...r, ...p, mode: 'ground' }, 'Lay reference image on the ground')
	}

	function fit() {
		const e = engineRef.current
		if (!r || !e || !img) return
		commit({ ...r, ...fitPlace(img.pixels.w, img.pixels.h, e.terrain.worldSize) }, 'Fit reference image to the map')
	}

	function toggleAdjust() {
		ui.referenceAdjust = !ui.referenceAdjust
		if (ui.referenceAdjust && !ui.topDown) ui.topDown = true
		if (ui.referenceAdjust) setStatus('Drag the image to move it, a corner to scale it (Shift frees its shape), Ctrl+drag to turn it. Esc ends.', 6000)
	}

	// The opacity slider shows as it moves and records one step on release.
	let opacityBefore: ReferenceImage | null = null
	function opacityInput(v: number) {
		if (!editor.reference) return
		opacityBefore ??= copyReference(editor.reference)
		editor.reference.opacity = v
	}
	function opacityDone() {
		if (!opacityBefore) return
		commit(editor.reference, 'Reference image opacity', opacityBefore)
		opacityBefore = null
	}

	const num = (e: Event, d: number) => {
		const v = Number((e.target as HTMLInputElement).value)
		return Number.isFinite(v) ? v : d
	}
	const DEG = 180 / Math.PI

	/** A zone typed or chosen for colour k: its "(id)", or a name that matches one. */
	function pickArea(k: number, text: string) {
		const m = /\((\d+)\)\s*$/.exec(text)
		const id = m ? Number(m[1]) : text.trim() ? (areas.find((a) => a.name.toLowerCase() === text.trim().toLowerCase())?.id ?? 0) : 0
		choice.areas[k] = id
	}

	const textureName = (path: string) => (isColor(path) ? path : path.slice(path.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

	function apply() {
		const e = engineRef.current
		if (!e || !r) return
		if (last.use === 'heights') e.referenceToHeights(last.min, last.max, last.heightMode)
		else if (last.use === 'zones') e.referenceToZones(colours, [...choice.areas], last.tolerance)
		else if (last.use === 'textures') e.referenceToTextures(colours, [...choice.layers], last.tolerance)
		else {
			e.referenceToMask(colours, [...choice.mask], last.tolerance)
			if (editor.tool !== 'paint') setStatus('Added to the mask; the Paint tool shows it.', 4000)
		}
	}

	const USES: Array<[Use, string, string]> = [
		['heights', 'Heights', "The image's brightness becomes heights: black Min, white Max"],
		['zones', 'Zones', 'Each colour paints a zone (AreaTable) into the chunks it covers most'],
		['textures', 'Textures', 'Each colour paints a texture of the palette, alone, into its texels'],
		['mask', 'Mask', 'The ticked colours are added to the paint mask'],
	]
	const canApply = $derived(
		!!img &&
			r?.mode === 'ground' &&
			(last.use === 'heights' || (last.use === 'zones' && choice.areas.some((a) => a > 0)) || (last.use === 'textures' && choice.layers.some((l) => l >= 0)) || (last.use === 'mask' && choice.mask.some(Boolean))),
	)
</script>

<aside class="reference" aria-label="Reference image">
	<header>
		<span>Reference image</span>
		<button class="close" onclick={() => ((ui.referenceWindow = false), (ui.referenceAdjust = false))} title="Close" aria-label="Close the reference image window">✕</button>
	</header>
	<div class="body">
		{#if !r}
			<p class="help dim">
				Lay your own plan of the zone (a PNG or JPEG from a paint program or a map tool) over the map to trace it, and turn its colours into heights, zones or textures. The map keeps the picture's path, never the picture.
			</p>
			<button class="active" disabled={!hasBackend() || busy} onclick={() => void choose()}>Choose image…</button>
		{:else}
			<div class="row">
				<span class="file grow" title={r.path}>{fileName}</span>
				<button disabled={!hasBackend() || busy} onclick={() => void choose()} title="Another picture, in the same place">Change…</button>
				<button onclick={remove} title="Take the image off the map (undo puts it back)">Remove</button>
			</div>
			{#if !img}<p class="dim">Reading the picture… (if it doesn't come, the file may have moved: Change… finds it.)</p>{/if}
			<div class="row">
				<label class="check"><input type="checkbox" checked={r.shown} onchange={(e) => set('shown', e.currentTarget.checked, r.shown ? 'Hide reference image' : 'Show reference image')} /> Show</label>
				<input
					class="grow"
					type="range"
					min="0.05"
					max="1"
					step="0.05"
					value={r.opacity}
					oninput={(e) => opacityInput(num(e, r.opacity))}
					onchange={opacityDone}
					aria-label="Opacity"
					title="How much of the picture covers the ground"
				/>
				<span class="val">{Math.round(r.opacity * 100)}%</span>
			</div>
			<div class="seg" role="group" aria-label="Where it shows">
				<button class:active={r.mode === 'ground'} onclick={() => setMode('ground')} title="Draped over the ground, where it lies on the map">On the ground</button>
				<button class:active={r.mode === 'screen'} onclick={() => setMode('screen')} title="Over the top-down view (U), fixed to the screen like tracing paper">Over the view</button>
			</div>
			{#if r.mode === 'ground'}
				<div class="form">
					<span class="k">Centre</span>
					<span class="row">
						<input type="number" step="any" value={+r.x.toFixed(2)} onchange={(e) => set('x', num(e, r.x), 'Move reference image')} aria-label="Centre X" title="X, in yards from the map's west edge" />
						<input type="number" step="any" value={+r.z.toFixed(2)} onchange={(e) => set('z', num(e, r.z), 'Move reference image')} aria-label="Centre Z" title="Z, in yards from the map's north edge" />
					</span>
					<span class="k">Size</span>
					<span class="row">
						<input type="number" min="1" step="any" value={+r.w.toFixed(2)} onchange={(e) => set('w', Math.max(1, num(e, r.w)), 'Scale reference image')} aria-label="Width" title="Width, in yards" />
						<input type="number" min="1" step="any" value={+r.h.toFixed(2)} onchange={(e) => set('h', Math.max(1, num(e, r.h)), 'Scale reference image')} aria-label="Height" title="Height, in yards" />
					</span>
					<label class="k" for="ref-turn">Turn</label>
					<input id="ref-turn" type="number" step="any" value={+(r.turn * DEG).toFixed(2)} onchange={(e) => set('turn', num(e, r.turn * DEG) / DEG, 'Turn reference image')} title="Degrees, clockwise seen from above" />
				</div>
				<div class="row">
					<button class:active={ui.referenceAdjust} onclick={toggleAdjust} title="In the top-down view: drag the image to move it, a corner to scale it (Shift frees its shape), Ctrl+drag to turn it; Esc ends"
						>Place by dragging</button
					>
					<button disabled={!img} onclick={fit} title="Centred over the whole map, its longer side the map's">Fit to map</button>
				</div>
			{:else}
				<p class="help dim">Shown over the top-down view (U), fixed to the screen: move the map under it. The conversions read it from the ground, so lay it there first.</p>
				<button disabled={!img || !ui.topDown} onclick={pinToGround} title="Lays the image on the ground under where it shows now">Lay on the ground as shown</button>
			{/if}

			<h3>Use as</h3>
			<div class="seg" role="group" aria-label="Use as">
				{#each USES as [v, label, title] (v)}
					<button class:active={last.use === v} onclick={() => (last.use = v)} {title}>{label}</button>
				{/each}
			</div>
			{#if last.use === 'heights'}
				<div class="form">
					<label class="k" for="ref-min">Min (black)</label>
					<input id="ref-min" type="number" step="any" bind:value={last.min} />
					<label class="k" for="ref-max">Max (white)</label>
					<input id="ref-max" type="number" step="any" bind:value={last.max} />
					<span class="k">Onto</span>
					<div class="seg">
						<button class:active={last.heightMode === 'set'} onclick={() => (last.heightMode = 'set')} title="The ground under the image takes its heights">Set</button>
						<button class:active={last.heightMode === 'add'} onclick={() => (last.heightMode = 'add')} title="The image's heights are added to the ground">Add</button>
					</div>
				</div>
				<p class="dim">Only the ground under the image changes; transparent pixels leave theirs.</p>
			{:else}
				<div class="row">
					<span class="k">Colour match</span>
					<input class="grow" type="range" min="4" max="128" step="1" bind:value={last.tolerance} aria-label="Colour match" title="How far a pixel's colour may be from a listed one and still count as it; others are left alone" />
					<span class="val">{last.tolerance}</span>
				</div>
				{#if !colours.length}
					<p class="dim">{img ? 'The picture has no colour that covers enough of it.' : 'Waiting for the picture…'}</p>
				{/if}
				<ul class="colours" aria-label="Colours">
					{#each colours as c, k (k)}
						<li>
							{#if last.use === 'mask'}
								<input type="checkbox" bind:checked={choice.mask[k]} aria-label="Mask {colourHex(c)}" />
							{/if}
							<span class="swatch" style:background={colourHex(c)} title={colourHex(c)}></span>
							<span class="share">{(c.share * 100).toFixed(c.share < 0.1 ? 1 : 0)}%</span>
							{#if last.use === 'zones'}
								<input
									class="grow"
									list="meld-ref-areas"
									placeholder={areas.length ? 'Zone: type a name' : 'Zones need the client'}
									value={choice.areas[k] ? `${areaName(choice.areas[k])} (${choice.areas[k]})` : ''}
									onchange={(e) => pickArea(k, e.currentTarget.value)}
									aria-label="Zone for {colourHex(c)}"
								/>
							{:else if last.use === 'textures'}
								<select class="grow" bind:value={choice.layers[k]} aria-label="Texture for {colourHex(c)}">
									<option value={-1}>Leave alone</option>
									{#each editor.palette as tex, i (i)}
										<option value={i}>{textureName(tex)}</option>
									{/each}
								</select>
							{/if}
						</li>
					{/each}
				</ul>
				{#if last.use === 'zones'}
					<datalist id="meld-ref-areas">
						{#each areas as a (a.id)}
							<option value="{areaName(a.id)} ({a.id})"></option>
						{/each}
					</datalist>
				{:else if last.use === 'textures'}
					<p class="dim">The map's palette; add textures to it in the asset browser. A chunk holds four textures: a colour with no room left keeps the paint it had.</p>
				{/if}
			{/if}
			<button class="active" disabled={!canApply} onclick={apply} title={r.mode !== 'ground' ? 'Lay the image on the ground first' : 'One undo step'}>Apply</button>
		{/if}
	</div>
</aside>

<style>
	.reference {
		position: fixed;
		top: 96px;
		right: 300px;
		width: 330px;
		max-height: calc(100 * var(--vh) - 160px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
		font-size: 12px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 26px;
		padding: 0 6px 0 12px;
		background: var(--header);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		flex: none;
	}
	header span {
		flex: 1;
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.body {
		padding: 8px 10px;
		overflow-y: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.body > * {
		flex: none;
	}
	h3 {
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--text-dim);
		font-weight: 600;
	}
	.help {
		margin: 0;
		line-height: 1.35;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
		margin: 0;
	}
	.row {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.row input[type='number'] {
		width: 0;
		flex: 1;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.file {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.val {
		font-family: var(--mono);
		font-size: 11px;
		min-width: 32px;
		text-align: right;
	}
	.check {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.seg {
		display: flex;
		gap: 2px;
	}
	.seg button {
		flex: 1;
	}
	.form {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 6px;
		align-items: center;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.colours {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.colours li {
		display: flex;
		gap: 6px;
		align-items: center;
		min-width: 0;
	}
	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		border: 1px solid var(--border);
		flex: none;
	}
	.share {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text-dim);
		width: 36px;
		text-align: right;
		flex: none;
	}
</style>
