<script lang="ts">
	import { editor, ui } from '../lib/state/editor.svelte'
	import { followersOf } from '../lib/world/formations'
	import { poolMates } from '../lib/world/pools'

	// While a formation or pool is built on the map (#172, `ui.spawnPick`): whose it is, what a click on
	// a spawn does, and Done, as the path bar does for a path.

	const s = $derived(ui.spawnPick && editor.selectedSpawn ? editor.selectedSpawn : null)
	const mode = $derived(ui.spawnPick?.mode)
	const count = $derived(!s ? 0 : mode === 'lead' ? followersOf(editor.spawns, s.guid).length : mode === 'pool' ? poolMates(editor.spawns, s).length + 1 : 0)
	const title = $derived(
		!s
			? ''
			: mode === 'lead'
				? `Formation of ${s.name}`
				: mode === 'follow'
					? `${s.name} follows…`
					: mode === 'pool'
						? `Pool ${s.pool} of ${s.name}`
						: mode === 'joinMother'
							? `Pool ${s.pool} joins a master pool…`
							: `${s.name} joins a pool…`,
	)
	const what = $derived(
		mode === 'lead'
			? 'Click a creature to make it follow, in a slot where it stands; click a follower to take it out.'
			: mode === 'follow'
				? 'Click the creature to follow, or any creature of its formation.'
				: mode === 'pool'
					? `Click a ${s?.kind === 'object' ? 'game object' : 'creature'} to put it into the pool; click a member to take it out.`
					: mode === 'joinMother'
						? 'Click a spawn whose pool is in the master pool to join, such as another vein of the zone.'
						: 'Click a spawn of the pool to join.',
	)
	const tally = $derived(mode === 'lead' ? (count === 1 ? '1 follower' : `${count} followers`) : mode === 'pool' ? `${count} in this region` : '')
</script>

{#if s}
	<div class="pickbar">
		<div class="head">
			<strong>{title}</strong>
			{#if tally}<span class="dim">{tally}</span>{/if}
		</div>
		<p class="dim">{what} Each click is an undo step; Esc stops.</p>
		<div class="buttons">
			<button class="done" onclick={() => (ui.spawnPick = null)}>{mode === 'follow' || mode === 'joinPool' || mode === 'joinMother' ? 'Cancel' : 'Done'}</button>
		</div>
	</div>
{/if}

<style>
	.pickbar {
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
