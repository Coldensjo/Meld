<script lang="ts" module>
	import { docs, editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'

	/** Close a map tab, asking first if it has unsaved changes. */
	export function requestClose(id: number) {
		const engine = engineRef.current
		if (!engine) return
		if (engine.isDirty(id)) {
			ui.closeDocId = id
			ui.dialog = 'closeDoc'
		} else {
			engine.closeDocument(id)
		}
	}
</script>

<div class="doctabs" role="tablist">
	{#each docs.tabs as t (t.id)}
		{@const active = t.id === docs.active}
		{@const name = active ? editor.mapName : t.name}
		{@const dirty = active ? editor.dirty : t.dirty}
		<div
			class="doctab"
			class:active
			role="tab"
			tabindex="0"
			aria-selected={active}
			title={active ? editor.filePath || 'Not saved yet' : name}
			onclick={() => engineRef.current?.switchDocument(t.id)}
			onkeydown={(e) => e.key === 'Enter' && engineRef.current?.switchDocument(t.id)}
			onauxclick={(e) => e.button === 1 && requestClose(t.id)}
		>
			<!-- A world view (#15) has no size of its own: the 0 a tab gets for one. -->
			<span>{name}{t.size ? ` @ ${t.size}²` : ''}{dirty ? ' *' : ''}</span>
			<button
				class="close"
				aria-label="Close {name}"
				onclick={(e) => {
					e.stopPropagation()
					requestClose(t.id)
				}}>✕</button
			>
		</div>
	{/each}
	<button class="add" title="New map (Ctrl+N)" aria-label="New map" onclick={() => (ui.showNewDialog = true)}>+</button>
</div>

<style>
	.doctabs {
		display: flex;
		height: 26px;
		background: var(--header);
		border-bottom: 1px solid var(--border);
		flex: none;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.doctab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 6px 0 12px;
		font-size: 11px;
		color: var(--text-dim);
		border-right: 1px solid var(--border);
		white-space: nowrap;
		cursor: default;
	}
	.doctab:hover {
		color: var(--text);
	}
	.doctab.active {
		background: var(--panel);
		color: var(--text);
		box-shadow: inset 0 2px 0 var(--accent);
	}
	.close {
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 0 3px;
		font-size: 10px;
		visibility: hidden;
	}
	.doctab.active .close,
	.doctab:hover .close {
		visibility: visible;
	}
	.close:hover {
		color: var(--text);
		background: var(--panel-3);
	}
	.add {
		border: none;
		background: transparent;
		color: var(--text-dim);
		padding: 0 10px;
	}
	.add:hover {
		color: var(--text);
	}
</style>
