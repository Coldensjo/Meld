<script lang="ts">
	import Modal from './Modal.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { loadChanges, type ChangesView } from '../lib/io/changes'
	import { fileLine, groupCount, groupFiles, spawnLine } from '../lib/io/changeList'
	import type { vmangos } from '../lib/wails/models'

	// The Changes window (#959): the client files and world database rows that Compile, Save Spawns or
	// Publish will write for the active map, listed before they are written. Read only: the writes stay
	// where they are, and leaving single items out is #960.

	interface Props {
		onclose: () => void
		/** The label of the close button: "Back" when a write's dialog opened the window. */
		closeLabel?: string
	}
	let { onclose, closeLabel = 'Close' }: Props = $props()

	let view = $state<ChangesView | null>(null)
	let error = $state('')
	let loading = $state(false)
	/** The rows whose SQL is shown, by key. */
	let shown = $state<Record<string, boolean>>({})

	async function load() {
		const engine = engineRef.current
		if (!engine || loading) return
		loading = true
		error = ''
		try {
			view = await loadChanges(engine)
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void load()

	const groups = $derived(view ? groupFiles(view.files) : [])
	const nothing = $derived(!!view && !view.files.length && !view.spawns.length && !view.rows.length)

	function goThere(s: vmangos.SpawnChange) {
		const at = view?.spawnAt.get(s.guid)
		const engine = engineRef.current
		if (!at || !engine) return
		engine.focusSpawn(at)
		onclose()
	}

	const toggle = (key: string) => (shown[key] = !shown[key])
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
</script>

<Modal title={view?.title ? `Changes: ${view.title}` : 'Changes'} width={640} {onclose}>
	{#if loading && !view}
		<p class="dim">Building the files and the SQL as the write would…</p>
	{:else if error}
		<p class="bad">The changes could not be listed: {error}</p>
	{:else if view}
		{#each view.notes as n (n)}<p class="dim">{n}</p>{/each}
		{#if nothing}
			<p>Nothing to write: the client's patch already holds this map as the editor has it, and no spawn edits wait for the world database.</p>
		{/if}
		{#if view.files.length}
			<h3>Client files <span class="dim">({count(view.files.length, 'file', 'files')} into Meld's patch)</span></h3>
			{#each groups as g (g.group)}
				<details open={g.files.length <= 40}>
					<summary>{g.label} <span class="dim">({groupCount(g, view.tiles)})</span></summary>
					<ul>
						{#each g.files as f (f.name)}
							<li title={f.name}><span class="tag" class:new={f.new}>{f.new ? 'new' : 'replace'}</span>{fileLine(f)}</li>
						{/each}
					</ul>
				</details>
			{/each}
		{/if}
		{#if view.waiting.length}
			<h3>Waiting for the game to close <span class="dim">({count(view.waiting.length, 'file', 'files')} written earlier)</span></h3>
			<ul>
				{#each view.waiting as f (f.name)}<li title={f.name}><span class="tag">waiting</span>{fileLine(f)}</li>{/each}
			</ul>
		{/if}
		{#if view.spawns.length || view.rows.length}
			<h3>World database</h3>
			<ul>
				{#each view.spawns as s (s.guid)}
					{@const key = `spawn:${s.guid}`}
					<li class="row">
						<span class="tag {s.action}">{s.action}</span>
						<span class="what">{spawnLine(s)}</span>
						{#if view.spawnAt.has(s.guid)}<button onclick={() => goThere(s)}>Go there</button>{/if}
						<button onclick={() => toggle(key)}>{shown[key] ? 'Hide SQL' : 'SQL'}</button>
					</li>
					{#if shown[key]}<pre>{s.sql}</pre>{/if}
				{/each}
				{#each view.rows as r (r.table + r.key)}
					{@const key = `row:${r.table}:${r.key}`}
					<li class="row">
						<span class="tag">{r.action}</span>
						<span class="what">{r.table} {r.key}: {r.reason}</span>
						<button onclick={() => toggle(key)}>{shown[key] ? 'Hide SQL' : 'SQL'}</button>
					</li>
					{#if shown[key]}<pre>{r.sql}</pre>{/if}
				{/each}
			</ul>
		{/if}
	{/if}
	{#snippet actions()}
		<button disabled={loading} onclick={load}>Refresh</button>
		<button class="active" onclick={onclose}>{closeLabel}</button>
	{/snippet}
</Modal>

<style>
	h3 {
		margin: 12px 0 4px;
		font-size: 12px;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow: auto;
	}
	li {
		padding: 2px 0;
		font-size: 12px;
	}
	li.row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.what {
		flex: 1;
		min-width: 0;
	}
	summary {
		cursor: pointer;
		font-size: 12px;
		padding: 2px 0;
	}
	details ul {
		padding-left: 14px;
	}
	.tag {
		display: inline-block;
		min-width: 48px;
		margin-right: 6px;
		color: var(--text-dim);
		font-size: 11px;
	}
	.tag.new,
	.tag.add {
		color: var(--ok);
	}
	.tag.delete {
		color: var(--danger-text);
	}
	.tag.change {
		color: var(--warn);
	}
	pre {
		margin: 2px 0 6px;
		padding: 6px;
		max-height: 200px;
		overflow: auto;
		font-family: var(--mono);
		font-size: 11px;
		white-space: pre-wrap;
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		user-select: text;
	}
	.dim {
		color: var(--text-dim);
	}
	.bad {
		color: var(--bad);
	}
</style>
