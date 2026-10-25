<script lang="ts">
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { spawnKey } from '../lib/world/SpawnLayer'

	// While a creature's path is edited on the map (#138): whose path it is, what a click does, and
	// the buttons the creature editor's path section has, so the author never has to open it.

	const s = $derived(ui.pathEdit && editor.selectedSpawn?.kind !== 'object' ? editor.selectedSpawn : null)
	const count = $derived(s?.waypoints?.length ?? 0)
	const picked = $derived(editor.selectedWaypoint)

	function clearPath() {
		if (!s) return
		void engineRef.current?.editSpawn(spawnKey(s), { waypoints: [] }, `Clear path (${s.name})`)
		editor.selectedWaypoint = -1
	}
</script>

{#if s}
	<div class="pathbar">
		<div class="head">
			<strong>Path of {s.name}</strong>
			<span class="dim">{count === 1 ? '1 point' : `${count} points`}{picked >= 0 ? ` · point ${picked + 1} picked` : ''}</span>
		</div>
		<p class="dim">
			Click the ground to add a point {picked >= 0 && picked < count - 1 ? `after point ${picked + 1}` : 'at the end'}. Click a point to pick it, drag it to move it. Delete removes the picked point; Esc stops.
		</p>
		<div class="buttons">
			<button disabled={picked < 0} onclick={() => engineRef.current?.deletePathPoint()}>Delete point</button>
			<button disabled={!count} onclick={clearPath}>Clear path</button>
			<button class="done" onclick={() => (ui.pathEdit = false)}>Done</button>
		</div>
	</div>
{/if}

<style>
	.pathbar {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		width: 380px;
		padding: 8px 10px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 8px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		font-size: 12px;
		z-index: 5;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.head .dim {
		margin-left: auto;
	}
	.dim {
		color: var(--text-dim);
	}
	p {
		margin: 4px 0 8px;
		line-height: 1.35;
	}
	.buttons {
		display: flex;
		gap: 6px;
	}
	.done {
		margin-left: auto;
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
