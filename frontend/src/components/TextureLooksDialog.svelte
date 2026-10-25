<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { lookFlags, lookOf, type Look } from '../lib/world/textureLooks'

	// World › Texture Looks (Noggit Red's texture animation and overbright settings): per texture of the
	// map, whether the client scrolls it (direction and speed) and draws it overbright. A texture left on
	// "The client's" keeps what the client's tiles give it on export. Each change is an undo step.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const textures = $derived(editor.palette.filter((p) => !p.startsWith('#')))
	const textureName = (p: string) => p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, '')
	const TURNS = [0, 1, 2, 3, 4, 5, 6, 7]

	/** Sets (or with null clears) a texture's own look, as one undo step. */
	function set(path: string, look: Look | null) {
		const before = { ...editor.textureLooks }
		const after = { ...before }
		if (look) after[path] = lookFlags(look)
		else delete after[path]
		editor.textureLooks = after
		engineRef.current?.history.push({
			label: `Look of ${textureName(path)}`,
			undo: () => (editor.textureLooks = { ...before }),
			redo: () => (editor.textureLooks = { ...after }),
		})
	}

	function change(path: string, patch: Partial<Look>) {
		set(path, { ...lookOf(editor.textureLooks[path] ?? 0), ...patch })
	}
</script>

<Modal title="Texture looks" width={620} {onclose}>
	<p class="dim">
		How the client draws each texture besides its picture: scrolling (lava, water, slime) and overbright (a glow). A texture on "The client's" keeps what the client's tiles give it. The editor's view scrolls and brightens the textures
		this map sets.
	</p>
	{#if !textures.length}
		<p class="dim">The map has no client textures yet. Textures picked in the asset browser appear here.</p>
	{:else}
		<div class="rows">
			{#each textures as path (path)}
				{@const own = editor.textureLooks[path]}
				{@const look = lookOf(own ?? 0)}
				<span class="name" title={path}>{textureName(path)}</span>
				<select value={own === undefined ? 'client' : 'own'} onchange={(e) => set(path, (e.target as HTMLSelectElement).value === 'own' ? look : null)} aria-label="Look of {textureName(path)}">
					<option value="client">The client's</option>
					<option value="own">This map's</option>
				</select>
				{#if own !== undefined}
					<span class="opts">
						<label class="check"><input type="checkbox" checked={look.animate} onchange={(e) => change(path, { animate: (e.target as HTMLInputElement).checked })} /> Scroll</label>
						<select value={look.turn} disabled={!look.animate} onchange={(e) => change(path, { turn: Number((e.target as HTMLSelectElement).value) })} title="The direction it scrolls, in 45° steps" aria-label="Direction">
							{#each TURNS as t (t)}<option value={t}>{t * 45}°</option>{/each}
						</select>
						<select value={look.speed} disabled={!look.animate} onchange={(e) => change(path, { speed: Number((e.target as HTMLSelectElement).value) })} title="How fast it scrolls" aria-label="Speed">
							{#each TURNS as s (s)}<option value={s}>speed {s}</option>{/each}
						</select>
						<label class="check"><input type="checkbox" checked={look.overbright} onchange={(e) => change(path, { overbright: (e.target as HTMLInputElement).checked })} /> Overbright</label>
					</span>
				{:else}
					<span></span>
				{/if}
			{/each}
		</div>
	{/if}
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
	.rows {
		display: grid;
		grid-template-columns: minmax(120px, 1fr) auto 2fr;
		gap: 6px 8px;
		align-items: center;
		max-height: 420px;
		overflow-y: auto;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opts {
		display: flex;
		gap: 6px;
		align-items: center;
	}
</style>
