<script lang="ts">
	import PaletteTile from './PaletteTile.svelte'
	import { editor, prefs, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { LAYERS } from '../lib/terrain/layers'
	import { isColor } from '../lib/terrain/paletteArray'
	import { SLOTS } from '../lib/terrain/chunkPaint'

	// The texture layers of the paint chunk under the cursor, as the game has them: four slots, an
	// unused one shown as an empty layer. With an area selected (the Select tool's drag on the
	// ground), the panel is about every chunk the area touches instead, and lists their textures
	// together. Replace on a layer waits for the next texture picked in the asset browser and puts it
	// in that layer's place; Delete empties the layer. Both act on the hovered chunk, or on all the
	// selected chunks, and are one undo step.
	const texName = (p: string) => p.slice(p.search(/[^\\/]*$/)).replace(/\.blp$/i, '')
	const colorName = (p: string) => LAYERS.find((l) => l.swatch.toLowerCase() === p.toLowerCase())?.name ?? p
	const label = (p: string) => (isColor(p) ? colorName(p) : texName(p))

	interface Layer {
		tex: number
		/** How many of the chunks hold it (for a selection of several). */
		chunks: number
	}

	/** The chunks the panel is about and their layers: the selected chunks, else the hovered one. */
	const view = $derived.by(() => {
		// Every History change and tab switch bumps historyVersion; the selection and the hovered chunk are reactive.
		void ui.historyVersion
		const e = engineRef.current
		if (!e) return null
		const selected = e.selectedChunks()
		if (selected.length) {
			return { chunks: selected, layers: e.chunksContents(selected) as Layer[], hover: false }
		}
		const c = editor.hoverChunk
		if (c < 0) return null
		const layers: Array<Layer | null> = Array.from({ length: SLOTS }, () => null)
		for (const t of e.chunkContents(c)) layers[t.slot] = { tex: t.tex, chunks: 1 }
		return { chunks: [c], layers, hover: true }
	})

	const sameChunks = (a: number[], b: number[]) => a.length === b.length && a.every((c, i) => c === b[i])
	/** The texture waiting for a pick, when it is in the chunks the panel shows. */
	const replacing = $derived(ui.replaceSlot && view && sameChunks(ui.replaceSlot.chunks, view.chunks) ? ui.replaceSlot.tex : -1)

	function replace(tex: number) {
		if (!view) return
		ui.replaceSlot = { chunks: [...view.chunks], tex }
		ui.palette = 'textures'
		prefs.browserCollapsed = false
	}

	function remove(tex: number) {
		if (!view) return
		if (replacing === tex) ui.replaceSlot = null
		engineRef.current?.deleteTextureInChunks(view.chunks, tex)
	}

	function removeAll() {
		if (!view) return
		ui.replaceSlot = null
		engineRef.current?.clearChunks(view.chunks)
	}
</script>

{#snippet layer(l: Layer, many: boolean)}
	{@const p = editor.palette[l.tex]}
	<div class="row" class:target={replacing === l.tex}>
		<div class="thumb">
			{#if isColor(p)}
				<span class="swatch" style:background={p}></span>
			{:else}
				<PaletteTile thumbKey={'tex:' + p} label="" title="" onclick={() => {}} />
			{/if}
		</div>
		<div class="name" title={p}>
			<span class="nm">{label(p)}</span>
			{#if many && view}<span class="sub">{l.chunks} of {view.chunks.length} chunks</span>{/if}
		</div>
		{#if replacing === l.tex}
			<button onclick={() => (ui.replaceSlot = null)} title="Stop waiting for a texture">Cancel</button>
		{:else}
			<button onclick={() => replace(l.tex)} title={many ? 'Pick a texture in the browser below to put in its place, in every selected chunk' : 'Pick a texture in the browser below to put in this layer, in this chunk only'}
				>Replace</button
			>
		{/if}
		<button class="del" onclick={() => remove(l.tex)} title={many ? 'Remove this texture from every selected chunk' : 'Remove this texture from this chunk, leaving the layer empty'} aria-label="Delete layer">✕</button>
	</div>
{/snippet}

<div class="layers">
	{#if view && !view.hover}
		<div class="head">
			<span>{view.chunks.length} {view.chunks.length === 1 ? 'chunk' : 'chunks'} selected</span>
			{#if view.layers.length}
				<button onclick={removeAll} title="Empty every layer of every selected chunk">Delete all</button>
			{/if}
		</div>
		{#each view.layers as l (l?.tex)}
			{#if l}{@render layer(l, true)}{/if}
		{/each}
		{#if !view.layers.length}
			<div class="row empty"><span class="thumb"></span><span class="nm">Empty</span></div>
		{/if}
	{:else if view}
		{#each view.layers as l, k (k)}
			{#if l}
				{@render layer(l, false)}
			{:else}
				<div class="row empty"><span class="thumb"></span><span class="nm">Empty</span></div>
			{/if}
		{/each}
	{:else}
		<div class="hint">Move the cursor over the ground to see the textures of the chunk under it, or select an area to work on all its chunks.</div>
	{/if}
	{#if replacing >= 0}
		<div class="hint">Pick a texture in the browser below.</div>
	{/if}
</div>

<style>
	.layers {
		padding: 2px 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px;
		font-size: 11px;
		color: var(--text-dim);
		border-bottom: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 8px;
		border-bottom: 1px solid var(--border);
	}
	.row.target {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.row.empty {
		opacity: 0.6;
	}
	.row.empty .thumb {
		border-style: dashed;
	}
	button {
		padding: 1px 8px;
		font-size: 11px;
		flex: none;
	}
	.del {
		width: 22px;
		padding: 1px 0;
		color: var(--text-dim);
	}
	.del:hover {
		color: var(--bad);
	}
	.thumb {
		display: block;
		width: 32px;
		height: 32px;
		flex: none;
		border: 1px solid var(--border-soft);
	}
	.thumb :global(.tile) {
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: transparent;
		pointer-events: none;
	}
	.thumb :global(.label) {
		display: none;
	}
	.thumb :global(.img) {
		border-radius: 0;
	}
	.swatch {
		display: block;
		width: 100%;
		height: 100%;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.nm,
	.sub {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: 10px;
		color: var(--text-dim);
	}
	.hint {
		padding: 8px;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
