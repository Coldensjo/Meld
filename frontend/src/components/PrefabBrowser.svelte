<script lang="ts">
	import PaletteTile from './PaletteTile.svelte'
	import { editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { choosePrefabFolder, readPrefabs, saveSelectionAsPrefab, type PrefabEntry } from '../lib/io/prefabFiles'
	import { prefabClip } from '../lib/wow/prefabs'
	import { registerPrefab } from '../lib/wow/thumbs'
	import { displayName } from '../lib/models/assets'
	import { hasBackend } from '../lib/io/backend'
	// The asset browser's Prefabs tab (#170): the prefabs of the author's prefab folder, drawn as all
	// their models together. A click places one under the cursor as a model paste (R or Ctrl+scroll
	// turns it, a click puts it down), varied when Vary is on; placed, it is ordinary models.

	interface Props {
		tile: number
		/** The browser header's search (#651). */
		query: string
		/** How many prefabs the search leaves, for the header's count. */
		count?: number
	}
	let { tile, query, count = $bindable(0) }: Props = $props()

	let entries = $state<PrefabEntry[]>([])
	let problems = $state<string[]>([])
	let loading = $state(false)
	let hovered = $state<PrefabEntry | null>(null)

	async function load() {
		loading = true
		try {
			const r = await readPrefabs()
			for (const e of r.entries) registerPrefab(e.thumbKey, e.prefab)
			entries = r.entries
			problems = r.problems
		} catch (err) {
			entries = []
			problems = [String(err)]
		} finally {
			loading = false
		}
	}
	$effect(() => {
		void ui.prefabsVersion
		void prefs.prefabDir
		void load()
	})

	const shown = $derived(query.trim() ? entries.filter((e) => e.prefab.name.toLowerCase().includes(query.trim().toLowerCase())) : entries)
	$effect(() => {
		count = shown.length
	})

	function place(e: PrefabEntry) {
		const engine = engineRef.current
		if (!engine) return
		const v = prefs.prefabVary
		engine.placeObjectClip(prefabClip(e.prefab, v.on ? { turn: v.turn, scale: v.scale, drop: v.drop } : null))
		setStatus(`Placing "${e.prefab.name}": click to put it down · R or Ctrl+scroll turns it · Esc cancels`, 0)
	}

	/** The models of a prefab by name, with counts, for the side panel. */
	function contents(e: PrefabEntry): Array<[string, number]> {
		const counts = new Map<string, number>()
		for (const o of e.prefab.objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
		return [...counts].map(([t, n]) => [displayName(t), n] as [string, number]).sort((a, b) => b[1] - a[1])
	}

	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo)
</script>

<div class="body">
	<!-- A tile only sets the hover; leaving the grid clears it (no gap between two tiles). -->
	<div class="grid-wrap" role="group" aria-label="Prefabs" tabindex="-1" onpointerleave={() => (hovered = null)}>
		<div class="bar">
			<span class="dim folder" title={prefs.prefabDir}>{prefs.prefabDir || 'No prefab folder yet'}</span>
			<button onclick={() => void choosePrefabFolder()} disabled={!hasBackend()} title="The folder your prefabs are kept in">Folder…</button>
			<button onclick={() => void load()} disabled={!prefs.prefabDir} title="Read the folder again">Refresh</button>
			<button onclick={() => engineRef.current && void saveSelectionAsPrefab(engineRef.current)} disabled={!hasBackend() || !editor.selectedIds.length} title="Save the selected models as a prefab (Models › Save Selection as Prefab)"
				>Save selection…</button
			>
		</div>
		{#if !prefs.prefabDir}
			<p class="hint">A prefab is a group of models you place again as a whole: a campfire with its logs, a market stall. Pick a folder to keep them in, then select models and Save selection.</p>
		{:else if loading && !entries.length}
			<p class="hint">Reading the prefab folder…</p>
		{:else if !entries.length}
			<p class="hint">No prefabs in this folder yet. Select some models and Save selection.</p>
		{:else}
			<div class="grid" style:grid-template-columns="repeat(auto-fill, {tile}px)">
				{#each shown as e (e.file)}
					<PaletteTile
						thumbKey={e.thumbKey}
						label={e.prefab.name}
						title={`${e.file}: ${e.prefab.objects.length} models`}
						size={tile}
						badge={String(e.prefab.objects.length)}
						showLabel={prefs.browserNames}
						onclick={() => place(e)}
						onhover={(on) => on && (hovered = e)}
					/>
				{/each}
			</div>
		{/if}
		{#each problems as p (p)}<p class="hint err">{p}</p>{/each}
	</div>
	<aside class="side">
		<div class="vary">
			<label class="check" title="Each placement varies a little, so ten camps don't look the same"><input type="checkbox" bind:checked={prefs.prefabVary.on} /> Vary each placement</label>
			{#if prefs.prefabVary.on}
				<label>Turn ± <input type="number" min="0" max="180" step="5" value={prefs.prefabVary.turn} onchange={(ev) => (prefs.prefabVary.turn = clamp(num(ev), 0, 180))} />°</label>
				<label>Scale ± <input type="number" min="0" max="50" step="5" value={Math.round(prefs.prefabVary.scale * 100)} onchange={(ev) => (prefs.prefabVary.scale = clamp(num(ev), 0, 50) / 100)} />%</label>
				<label title="The chance each model (with what hangs on it) is left out; one always stays"
					>Leave out <input type="number" min="0" max="90" step="5" value={Math.round(prefs.prefabVary.drop * 100)} onchange={(ev) => (prefs.prefabVary.drop = clamp(num(ev), 0, 90) / 100)} />%</label
				>
			{/if}
		</div>
		{#if hovered && prefs.browserNames}
			<div class="name">{hovered.prefab.name}</div>
			<ul>
				{#each contents(hovered) as [name, n] (name)}<li>
						<span>{name}</span>{#if n > 1}<span class="dim"> ×{n}</span>{/if}
					</li>{/each}
			</ul>
		{/if}
	</aside>
</div>

<style>
	.body {
		display: grid;
		grid-template-columns: 1fr 260px;
		flex: 1;
		min-height: 0;
	}
	.grid-wrap {
		overflow-y: auto;
		padding: 6px;
		min-height: 0;
	}
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 6px;
		background: var(--panel);
	}
	.folder {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.grid {
		display: grid;
		align-content: start;
		gap: 6px;
	}
	.side {
		border-left: 1px solid var(--border);
		padding: 8px;
		min-height: 0;
		overflow-y: auto;
		font-size: 12px;
	}
	.vary {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
	}
	.vary input[type='number'] {
		width: 52px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.name {
		font-weight: 600;
		margin-bottom: 4px;
	}
	ul {
		margin: 0;
		padding-left: 16px;
	}
	.dim,
	.hint {
		color: var(--text-dim);
		font-size: 12px;
	}
	.err {
		color: var(--danger-text);
	}
</style>
