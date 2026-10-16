<script lang="ts">
	import Modal from './Modal.svelte'
	import { recovery } from '../../wailsjs/go/models'
	import { setStatus } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { discard, recover, recoveryCopies } from '../lib/io/recovery'

	// Shown at the start when an earlier session left autosaved copies of maps with unsaved changes
	// (#177): Recover opens one as a map with unsaved changes, Discard throws it away, and Keep for later
	// closes the dialog, leaving them for the next start.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	let copies = $state<recovery.Info[]>([])
	let working = $state(false)

	async function load() {
		copies = await recoveryCopies().catch(() => [])
		if (!copies.length) onclose()
	}
	void load()

	const minutes = (ms: number) => {
		const m = Math.round(ms / 60_000)
		return m < 1 ? 'less than a minute' : m === 1 ? 'a minute' : m < 120 ? `${m} minutes` : `${Math.round(m / 60)} hours`
	}

	/** Where the copy stands against the map's own file. */
	function note(c: recovery.Info) {
		const ago = `autosaved ${minutes(Date.now() - c.saved)} ago`
		if (!c.file) return c.region ? `${c.region}, ${ago}` : `never saved, ${ago}`
		if (!c.fileTime) return `${ago}; its file is gone`
		if (c.saved <= c.fileTime) return `${ago}, older than the saved file`
		return `${ago}, ${minutes(c.saved - c.fileTime)} newer than the saved file`
	}

	async function run(c: recovery.Info, fn: () => Promise<void>) {
		if (working) return
		working = true
		try {
			await fn()
			copies = copies.filter((x) => x.id !== c.id)
			if (!copies.length) onclose()
		} catch (err) {
			setStatus(`${c.name}: ${err}`, 8000)
		} finally {
			working = false
		}
	}

	const recoverOne = (c: recovery.Info) =>
		run(c, async () => {
			const engine = engineRef.current
			if (engine) await recover(engine, c)
		})
	const discardOne = (c: recovery.Info) => run(c, () => discard(c))
</script>

<Modal title="Recover unsaved maps" width={520} {onclose}>
	<p>Meld didn't quit cleanly last time. These maps had changes that were not saved:</p>
	<ul>
		{#each copies as c (c.id)}
			<li>
				<div class="what">
					<strong>{c.name}</strong>
					<span class="dim">{c.file || ''}</span>
					<span class="dim">{note(c)}</span>
				</div>
				<button disabled={working} onclick={() => recoverOne(c)}>Recover</button>
				<button class="danger" disabled={working} onclick={() => discardOne(c)}>Discard</button>
			</li>
		{/each}
	</ul>
	{#snippet actions()}
		<button onclick={onclose}>Keep for later</button>
	{/snippet}
</Modal>

<style>
	ul {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.what span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
	}
</style>
