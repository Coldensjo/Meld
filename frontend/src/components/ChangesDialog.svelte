<script lang="ts">
	import Modal from './Modal.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { changesSql, editOf, loadChanges, type ChangesView } from '../lib/io/changes'
	import { fileLine, groupCount, groupFiles, spawnLine } from '../lib/io/changeList'
	import { seamWarnings, spawnItem, spawnTies, tileItem } from '../lib/io/leaveOut'
	import { copyToClipboard } from '../lib/ui/clipboard'
	import { setStatus } from '../lib/state/editor.svelte'
	import type { vmangos } from '../lib/wails/models'

	// The Changes window (#959): the client files and world database rows that Compile, Save Spawns or
	// Publish will write for the active map, listed before they are written. For a region, a tick on each
	// tile and spawn edit leaves it out of the writes while unticked (#960): the keys are kept on the
	// document (`MapDocument.leftOut`), which Compile, Save Spawns and Export Spawn SQL read. Any row's
	// SQL, the ticked rows' or all of it can be copied.

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
	/** The unticked items (`MapDocument.leftOut`'s keys), mirrored for the ticks to redraw. */
	let left = $state<Record<string, boolean>>({})

	async function load() {
		const engine = engineRef.current
		if (!engine || loading) return
		loading = true
		error = ''
		try {
			view = await loadChanges(engine)
			left = Object.fromEntries([...engine.activeDocument().leftOut].map((k) => [k, true]))
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}
	void load()

	const groups = $derived(view ? groupFiles(view.files) : [])
	/** The spawn edits written or left out together (a formation, a pool), by item key. */
	const ties = $derived(view ? spawnTies(view.edits) : new Map<string, string[]>())
	const leftSet = $derived(new Set(Object.keys(left).filter((k) => left[k])))
	const seams = $derived(view?.tickable ? seamWarnings(view.files, leftSet) : new Map<string, string[]>())
	const spawnKeyOf = (s: vmangos.SpawnChange) => {
		const e = view && editOf(view, s)
		return e ? spawnItem(e) : ''
	}
	const spawnTicked = (key: string) => !(ties.get(key) ?? [key]).some((k) => left[k])
	/** Whether any listed tile or spawn is unticked. */
	const anyLeft = $derived(!!view?.tickable && (view.files.some((f) => f.group === 'tile' && !!f.tile && !!left[tileItem(f.tile)]) || view.spawns.some((s) => !!spawnKeyOf(s) && !spawnTicked(spawnKeyOf(s)))))

	/** Ticks or unticks items `keys` (a tile, or a spawn edit with the edits tied to it). */
	function setTick(keys: string[], on: boolean) {
		const doc = engineRef.current?.activeDocument()
		if (!doc) return
		for (const k of keys) {
			if (on) doc.leftOut.delete(k)
			else doc.leftOut.add(k)
			left[k] = !on
		}
	}

	async function copy(text: string, what: string) {
		try {
			await copyToClipboard(text)
			setStatus(`Copied the SQL of ${what}.`, 4000)
		} catch (err) {
			setStatus(`Copying the SQL failed: ${err}`, 6000)
		}
	}
	async function copyAll(ticked: boolean) {
		if (!view) return
		try {
			await copy(await changesSql(view, ticked ? leftSet : undefined), ticked ? 'the ticked rows' : 'every row')
		} catch (err) {
			setStatus(`The SQL could not be built: ${err}`, 6000)
		}
	}
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
		{#if view.tickable && (view.files.length || view.spawns.length)}
			<p class="dim">Untick a tile or spawn to leave it out of Compile, Save Spawns and Export Spawn SQL: it stays pending until ticked again. The map's layout and horizon are always written.</p>
		{/if}
		{#if anyLeft}<p class="warn">Some items are unticked and will be left out of the next write.</p>{/if}
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
							{@const tick = view.tickable && g.group === 'tile' && !!f.tile}
							<li title={f.name} class:out={tick && left[tileItem(f.tile)]}>
								{#if tick}<input type="checkbox" checked={!left[tileItem(f.tile)]} onchange={(e) => setTick([tileItem(f.tile)], e.currentTarget.checked)} aria-label="Write {f.tile}" />{/if}
								<span class="tag" class:new={f.new}>{f.new ? 'new' : 'replace'}</span>{fileLine(f)}
							</li>
							{#if tick && seams.has(f.tile)}
								<li class="warn seam">
									Left out beside {seams.get(f.tile)?.join(', ')}, which {seams.get(f.tile)?.length === 1 ? 'is' : 'are'} written: the seam between them steps where the edit changed the ground along it (File › Check Map › Region
									edges finds it).
								</li>
							{/if}
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
					{@const item = spawnKeyOf(s)}
					{@const tied = (ties.get(item) ?? []).length - 1}
					<li class="row" class:out={view.tickable && !!item && !spawnTicked(item)}>
						{#if view.tickable && item}
							<input
								type="checkbox"
								checked={spawnTicked(item)}
								onchange={(e) => setTick(ties.get(item) ?? [item], e.currentTarget.checked)}
								aria-label="Write guid {s.guid}"
								title={tied > 0 ? `Goes with ${tied} other ${tied === 1 ? 'edit' : 'edits'} of its formation or pool, ticked and unticked together` : ''}
							/>
						{/if}
						<span class="tag {s.action}">{s.action}</span>
						<span class="what"
							>{spawnLine(s)}{#if tied > 0}<span class="dim"> (with {tied} tied)</span>{/if}</span
						>
						{#if view.spawnAt.has(s.guid)}<button onclick={() => goThere(s)}>Go there</button>{/if}
						<button onclick={() => toggle(key)}>{shown[key] ? 'Hide SQL' : 'SQL'}</button>
						<button title="Copy this spawn's SQL" onclick={() => copy(s.sql, `guid ${s.guid}`)}>Copy</button>
					</li>
					{#if shown[key]}<pre>{s.sql}</pre>{/if}
				{/each}
				{#each view.rows as r (r.table + r.key)}
					{@const key = `row:${r.table}:${r.key}`}
					<li class="row">
						<span class="tag">{r.action}</span>
						<span class="what">{r.table} {r.key}: {r.reason}</span>
						<button onclick={() => toggle(key)}>{shown[key] ? 'Hide SQL' : 'SQL'}</button>
						<button title="Copy this row's SQL" onclick={() => copy(r.sql, `${r.table} ${r.key}`)}>Copy</button>
					</li>
					{#if shown[key]}<pre>{r.sql}</pre>{/if}
				{/each}
			</ul>
		{/if}
	{/if}
	{#snippet actions()}
		{#if view && (view.spawns.length || view.rows.length)}
			{#if view.tickable && view.spawns.length}<button title="Copy the SQL of the ticked spawns and rows as one script" onclick={() => copyAll(true)}>Copy ticked SQL</button>{/if}
			<button title="Copy the SQL of every listed spawn and row as one script" onclick={() => copyAll(false)}>Copy all SQL</button>
		{/if}
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
	.warn {
		color: var(--warn);
	}
	li.seam {
		padding-left: 24px;
		font-size: 11px;
	}
	li.out {
		opacity: 0.55;
	}
	input[type='checkbox'] {
		margin: 0 6px 0 0;
		vertical-align: middle;
	}
	.bad {
		color: var(--bad);
	}
</style>
