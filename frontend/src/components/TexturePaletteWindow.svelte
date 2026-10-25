<script lang="ts">
	import PaletteTile from './PaletteTile.svelte'
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'

	// A floating quick texture palette (Noggit Red's Quick Access Texture Palette): the map's own textures,
	// kept with the map, where a click makes one the paint texture and switches to Paint, without going
	// through the asset browser. It floats over the viewport like the History window and can be closed.

	const entries = $derived(editor.palette.map((p, i) => ({ p, i })))
	const name = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

	function pick(i: number) {
		const e = engineRef.current
		if (!e) return
		const slot = e.useTexture(editor.palette[i])
		if (slot < 0) return
		if (editor.tool === 'sculpt' && editor.sculptPaint === 'texture') {
			editor.sculptPaintLayer = slot
			return
		}
		if (editor.tool === 'path') {
			e.path((t, c) => t.setField(c, 'texture', editor.palette[slot]))
			return
		}
		editor.paintLayer = slot
		if (editor.tool !== 'paint' && editor.tool !== 'road') editor.tool = 'paint'
	}

	const active = (i: number) => (editor.tool === 'sculpt' && editor.sculptPaint === 'texture' ? editor.sculptPaintLayer : editor.paintLayer) === i
</script>

{#if ui.texturePalette}
	<aside class="palette" aria-label="Map textures">
		<header>
			<span>Map textures</span>
			<span class="count">{entries.length}</span>
			<button class="close" onclick={() => (ui.texturePalette = false)} title="Close" aria-label="Close the texture palette">✕</button>
		</header>
		<div class="grid">
			{#each entries as e (e.i)}
				{#if e.p.startsWith('#')}
					<button class="swatch" class:active={active(e.i)} style:background={e.p} title={e.p} onclick={() => pick(e.i)} aria-label="Colour {e.p}"></button>
				{:else}
					<PaletteTile thumbKey={'tex:' + e.p} label={name(e.p)} title={e.p} size={64} active={active(e.i)} badge={String(e.i + 1)} onclick={() => pick(e.i)} />
				{/if}
			{/each}
		</div>
		<p class="dim">The textures this map uses. A click paints with one; new ones come from the asset browser.</p>
	</aside>
{/if}

<style>
	.palette {
		position: fixed;
		bottom: 340px;
		left: 52px;
		width: 300px;
		max-height: calc(100 * var(--vh) - 200px);
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		z-index: 40;
		overflow: hidden;
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
	.count {
		margin-left: auto;
		font-weight: 400;
		font-family: var(--mono);
	}
	.close {
		border: none;
		background: transparent;
		padding: 0 6px;
		color: var(--text-dim);
	}
	.close:hover {
		color: var(--text);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 64px);
		gap: 6px;
		padding: 8px;
		overflow-y: auto;
		min-height: 0;
	}
	.swatch {
		width: 64px;
		height: 64px;
		border-radius: 4px;
	}
	.swatch.active {
		outline: 2px solid var(--accent);
	}
	.dim {
		margin: 0;
		padding: 0 10px 8px;
		font-size: 11px;
		color: var(--text-dim);
	}
</style>
