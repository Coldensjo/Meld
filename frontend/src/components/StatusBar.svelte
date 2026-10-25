<script lang="ts">
	import { onMount } from 'svelte'
	import { editor, setStatus, stats, ui } from '../lib/state/editor.svelte'
	import { hasBackend } from '../lib/io/backend'
	import { ClientFilesWaiting } from '../../wailsjs/go/main/App'
	import { EventsOn } from '../../wailsjs/runtime/runtime'
	import ToolHint from './ToolHint.svelte'

	const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))

	/** The slot is one line and cuts long hints off; hovering it gives the whole text. */
	let hintTitle = $state('')

	/** Client files that wait for the game to close (#661): Meld never closes it, so the bar says so until they are written. */
	let waiting = $state(0)
	onMount(() => {
		if (!hasBackend()) return
		void ClientFilesWaiting().then((n) => (waiting = n))
		const offPending = EventsOn('client:pending', (n: number) => (waiting = n))
		// The watcher gave up writing them (#481): said once, in the status line and the Log.
		const offFailed = EventsOn('client:pending-failed', (msg: string) => setStatus(msg, 15000))
		return () => {
			offPending()
			offFailed()
		}
	})
</script>

<footer class="status">
	<!-- A message holds the slot for its few seconds; then the current tool's hint shows (#238). -->
	<span class="msg" role="status" title={hintTitle} onmouseenter={(e) => (hintTitle = ui.status === 'Ready' ? (e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim() : '')}>
		{#if ui.status === 'Ready'}<ToolHint />{:else}{ui.status}{/if}
	</span>
	<span class="cell">
		{#if stats.cursor}
			X {stats.cursor.x.toFixed(1)} · Y {stats.cursor.y.toFixed(1)} · Z {stats.cursor.z.toFixed(1)}
		{:else}
			—
		{/if}
	</span>
	{#if editor.region}<span class="cell region">{editor.region}</span>{/if}
	{#if waiting > 0}
		<span class="cell waiting" title="Meld's patch holds them once the game is closed; the game reads them when it starts again.">Close the game to apply {waiting} client {waiting === 1 ? 'file' : 'files'}</span>
	{/if}
	{#if ui.spawnChanges > 0}
		<button class="cell changes" onclick={() => (ui.dialog = 'saveSpawns')} title="Unsaved changes to the region's creatures and game objects: File › Save Spawns to Database…">
			{ui.spawnChanges} spawn {ui.spawnChanges === 1 ? 'change' : 'changes'}
		</button>
	{/if}
	<span class="cell">{stats.objects} objects</span>
	<span class="cell">{stats.drawCalls} draws · {fmt(stats.triangles)} tris</span>
	<span class="cell fps" class:low={stats.fps < 30}>{stats.fps} FPS</span>
</footer>

<style>
	.waiting {
		color: var(--accent-text);
	}
	.changes {
		border: none;
		background: transparent;
		color: var(--accent-text);
		padding: 0;
		font: inherit;
		cursor: pointer;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 0 10px;
		height: 24px;
		background: var(--panel);
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-dim);
	}
	.msg {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.cell {
		font-family: var(--mono);
		white-space: nowrap;
	}
	.fps {
		color: var(--ok);
		min-width: 56px;
		text-align: right;
	}
	.fps.low {
		color: var(--danger-text);
	}
</style>
