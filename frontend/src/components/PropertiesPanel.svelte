<script lang="ts">
	import PropField from './PropField.svelte'
	import { editor, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { displayName, isWowType, wowPath } from '../lib/models/assets'
	import { baseType, doodadSetOf } from '../lib/models/wmoSet'
	import { WMODoodadSets } from '../../wailsjs/go/main/App'
	import { hasBackend } from '../lib/io/backend'
	import { copyToClipboard } from '../lib/ui/clipboard'
	import type { WorldObject } from '../lib/world/ObjectLayer'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import FormationFields from './FormationFields.svelte'
	import PoolFields from './PoolFields.svelte'

	// What is selected, and everything about it: one model's placement as numbers and actions, a
	// mixed selection's models by kind, the selected ground area, a creature's or game object's pool
	// and formation (#172), or the map when nothing is.

	// Live preview while scrubbing a field; one undo step on release.
	let before: WorldObject | undefined
	const startEdit = () => {
		const s = editor.selected
		before = s ? { ...s } : undefined
	}
	const live = (patch: Partial<WorldObject>) => engineRef.current?.editSelected(patch, false)
	const commit = (patch: Partial<WorldObject>) => {
		engineRef.current?.editSelected(patch, true, before)
		before = undefined
	}
	const deg = (r: number) => (r * 180) / Math.PI
	const rad = (d: number) => (d * Math.PI) / 180
	/** A world angle shown as 0..360. */
	const turn = (r: number) => ((deg(r) % 360) + 360) % 360

	const e = $derived(engineRef.current)
	const selected = $derived(editor.selected)
	const count = $derived(editor.selectedIds.length)
	const parent = $derived(selected?.parent !== undefined ? e?.objects.objects.get(selected.parent) : undefined)
	const modelPath = $derived(selected ? (isWowType(selected.type) ? wowPath(baseType(selected.type)) : selected.type) : '')

	/** A selected WMO's doodad sets by index, read from the client when it is picked. */
	let sets = $state<string[]>([])
	let setsFor = ''
	$effect(() => {
		const path = selected?.type.startsWith('wmo:') ? modelPath : ''
		if (path === setsFor) return
		setsFor = path
		sets = []
		if (path && hasBackend()) {
			WMODoodadSets(path)
				.then((names) => {
					if (setsFor === path) sets = names ?? []
				})
				.catch(() => {})
		}
	})
	/** A doodad set's name without the client's "Set_" prefix. */
	const setName = (n: string, i: number) => (i === 0 ? 'Global only' : n.replace(/^Set_/, '') || `Set ${i}`)

	/** The selected models by kind, most numerous first, for a selection of several. */
	const breakdown = $derived.by(() => {
		const objects = e?.objects.objects
		const counts = new Map<string, number>()
		for (const id of editor.selectedIds) {
			const o = objects?.get(id)
			if (o) counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
		}
		return [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n }))
	})

	/** The selection groups the selected models are in, with their sizes; re-read after every undo step, which grouping is. */
	const groups = $derived.by(() => {
		void ui.historyVersion
		const layer = e?.objects
		const ids = new Set<number>()
		for (const id of editor.selectedIds) {
			const g = layer?.objects.get(id)?.group
			if (g) ids.add(g)
		}
		return layer ? [...ids].map((g) => layer.groupMembers(g).size) : []
	})

	const area = $derived(editor.selection)
	const holes = $derived(area ? (e?.holesInSelection() ?? 0) : 0)

	/** Makes the selected model the one the Place tool puts down. */
	function placeMore(type: string) {
		editor.prefab = type
		editor.tool = 'place'
	}

	async function copyPath() {
		try {
			await copyToClipboard(modelPath)
		} catch {
			/* no clipboard in this context */
		}
	}
</script>

<div class="props">
	{#if selected && count <= 1}
		<div class="title">
			<span class="name" title={modelPath}>{displayName(selected.type)}</span>
			<span class="id">#{selected.id}</span>
		</div>
		<button class="path" onclick={copyPath} title="The model's path in the client. Click to copy it.">{modelPath}</button>
		{#if selected.parent !== undefined}
			<div class="attached">
				<span>Attached to <b>{parent ? displayName(parent.type) : '#' + selected.parent}</b>, so its position is local to it.</span>
				<button onclick={() => e?.detachSelected()} title="Keep it where it stands, but no longer move with the parent">Detach</button>
			</div>
		{/if}

		{#if groups.length}
			<div class="attached">
				<span>In a group of {groups[0]} models.</span>
				<button onclick={() => e?.ungroupSelected()} title="Break up the group (Ctrl+Shift+G)">Ungroup</button>
			</div>
		{/if}

		<div class="section">Position</div>
		<PropField label="X" value={selected.x} step={0.1} digits={2} onstart={startEdit} oninput={(v) => live({ x: v })} onchange={(v) => commit({ x: v })} title="East–west, in yards" />
		<PropField label="Z" value={selected.z} step={0.1} digits={2} onstart={startEdit} oninput={(v) => live({ z: v })} onchange={(v) => commit({ z: v })} title="North–south, in yards" />
		<PropField label="Height" value={selected.yOff} step={0.05} digits={2} onstart={startEdit} oninput={(v) => live({ yOff: v })} onchange={(v) => commit({ yOff: v })} title="Above the ground it stands on (or the parent), in yards" />

		<div class="section">Rotation</div>
		<PropField
			label="Turn"
			value={turn(selected.rotY)}
			step={1}
			digits={1}
			unit="°"
			onstart={startEdit}
			oninput={(v) => live({ rotY: rad(v) })}
			onchange={(v) => commit({ rotY: rad(v) })}
			title="Spin about the up axis (R in the viewport)"
		/>
		<PropField
			label="Tilt"
			value={deg(selected.tiltX ?? 0)}
			step={0.5}
			digits={1}
			unit="°"
			min={-180}
			max={180}
			onstart={startEdit}
			oninput={(v) => live({ tiltX: rad(v) })}
			onchange={(v) => commit({ tiltX: rad(v) })}
			title="Lean forward or back (hold Z and scroll in the viewport)"
		/>
		<PropField
			label="Roll"
			value={deg(selected.tiltZ ?? 0)}
			step={0.5}
			digits={1}
			unit="°"
			min={-180}
			max={180}
			onstart={startEdit}
			oninput={(v) => live({ tiltZ: rad(v) })}
			onchange={(v) => commit({ tiltZ: rad(v) })}
			title="Lean to a side (hold Shift+Z and scroll in the viewport)"
		/>
		{#if selected.tiltX || selected.tiltZ}
			<button
				class="link"
				onclick={() => {
					startEdit()
					commit({ tiltX: 0, tiltZ: 0 })
				}}>Stand upright</button
			>
		{/if}

		{#if selected.type.startsWith('wmo:') && sets.length > 1}
			<div class="section">Doodad set</div>
			<select
				class="set"
				value={doodadSetOf(selected.type)}
				onchange={(ev) => e?.setDoodadSet(Number(ev.currentTarget.value))}
				title="The furniture and decorations the building shows besides its global set, as the game draws this placement"
				aria-label="Doodad set"
			>
				{#each sets as n, i (i)}
					<option value={i}>{setName(n, i)}</option>
				{/each}
			</select>
		{/if}

		<div class="section">Scale</div>
		<PropField label="Scale" value={selected.scale} step={0.01} digits={2} min={0.05} max={20} unit="×" onstart={startEdit} oninput={(v) => live({ scale: v })} onchange={(v) => commit({ scale: v })} title="1 is the model's own size" />

		<div class="actions">
			<button onclick={() => e?.focusSelected()} title="Move the camera to it (F)">Focus</button>
			<button onclick={() => e?.duplicateSelected()} title="Put a copy down next to it (Ctrl+Shift+D)">Duplicate</button>
			<button onclick={() => e?.toggleHideSelected()} title="Hide it for this session (H). The Layers panel shows hidden models again.">Hide</button>
			<button onclick={() => e?.deleteSelected()} title="Remove it from the map (Delete)">Delete</button>
		</div>
		<div class="actions">
			<button onclick={() => placeMore(selected.type)} title="Place more of this model with the Place tool">Place more</button>
			<button onclick={() => e?.selectModelsOfType(selected.type)} title="Select every one of this model on the map">Select all of these</button>
		</div>
	{:else if count > 1}
		<div class="title"><span class="name">{count} models selected</span></div>
		<div class="section">By model</div>
		<ul class="list">
			{#each breakdown as b (b.type)}
				<li>
					<button class="kind" onclick={() => e?.selectModelsOfType(b.type, true)} title="Keep only these selected">
						<span class="n">{b.n}×</span>
						<span class="kname">{displayName(b.type)}</span>
					</button>
					<button class="small" onclick={() => placeMore(b.type)} title="Place more of this model">Place</button>
				</li>
			{/each}
		</ul>
		<div class="grouping">
			{#if groups.length}
				<span>{groups.length === 1 ? `One group of ${groups[0]} models` : `${groups.length} groups (${groups.join(', ')} models)`}: a click on any member selects the whole group.</span>
				<button onclick={() => e?.ungroupSelected()} title="Break up the groups (Ctrl+Shift+G)">Ungroup</button>
			{:else}
				<span class="dim">Not grouped.</span>
				<button onclick={() => e?.groupSelected()} title="Group them, so a click on one selects them all (Ctrl+G)">Group</button>
			{/if}
		</div>
		<p class="dim">Drag one to move them all. The arrow keys move them and <kbd>R</kbd> spins them. Click a model alone to edit its numbers.</p>
		<div class="actions">
			<button onclick={() => e?.focusSelected()} title="Move the camera to them (F)">Focus</button>
			<button onclick={() => e?.duplicateSelected()} title="Put copies down next to them (Ctrl+Shift+D)">Duplicate</button>
			<button onclick={() => e?.toggleHideSelected()} title="Hide them for this session (H)">Hide</button>
			<button onclick={() => e?.deleteSelected()} title="Remove them from the map (Delete)">Delete</button>
		</div>
		<div class="actions">
			<button onclick={() => e?.deselect()}>Deselect <kbd>Esc</kbd></button>
		</div>
	{:else if area}
		<div class="title"><span class="name">Selected area</span></div>
		<div class="facts">
			<span class="k">Size</span><span>{area.x1 - area.x0} × {area.z1 - area.z0} cells</span>
			<span class="k">Yards</span><span>{(area.x1 - area.x0) * 2} × {(area.z1 - area.z0) * 2}</span>
			<span class="k">Corner</span><span>{area.x0}, {area.z0}</span>
			<span class="k">Holes</span><span>{holes}</span>
		</div>
		<div class="actions">
			<button onclick={() => e?.setHoleInSelection(true)} title="Cut the ground away here, so a cave or a cellar can go below">Cut hole</button>
			<button disabled={!holes} onclick={() => e?.setHoleInSelection(false)} title="Put the ground back here">Fill hole</button>
		</div>
		<div class="actions">
			<button onclick={() => e?.copySelection()} title="Copy the area's ground, textures and models (Ctrl+C)">Copy</button>
			<button onclick={() => e?.maskFromSelection()} title="Make this area the paint mask, which texture fills apply to">Mask it</button>
			<button onclick={() => e?.deselect()}>Deselect</button>
		</div>
		<p class="dim">Drag on the ground to select another area. Models standing in it are selected too.</p>
	{:else if editor.selectedSpawn}
		{@const s = editor.selectedSpawn}
		<div class="title"><span class="name">{s.name}</span><span class="id">{s.kind === 'object' ? 'object' : 'creature'} {s.entry} · spawn {s.guid}</span></div>
		<PoolFields {s} />
		{#if s.kind !== 'object'}<FormationFields {s} />{/if}
		<div class="actions">
			<button onclick={() => (s.kind === 'object' ? (ui.objectEditor = { key: spawnKey(s), entry: s.entry }) : (ui.creatureEditor = { key: spawnKey(s), entry: s.entry }))}>Open editor…</button>
			<button onclick={() => e?.focusSpawn(s)}>Focus <kbd>F</kbd></button>
		</div>
	{:else}
		<p class="dim">Select a model with the Select tool (<kbd>V</kbd>) to see its placement here, or drag on the ground to select an area.</p>
		<p class="dim">The map's size, sea and world settings are in File › Map Properties.</p>
	{/if}
</div>

<style>
	.props {
		padding: 6px 10px 8px;
		overflow-y: auto;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 6px;
		min-width: 0;
		margin: 2px 0 2px;
	}
	.title .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 600;
	}
	.id {
		font: 11px var(--mono);
		color: var(--text-dim);
	}
	.set {
		width: 100%;
		margin-bottom: 4px;
	}
	.path {
		display: block;
		width: 100%;
		margin: 0 0 4px;
		padding: 0;
		border: none;
		background: transparent;
		text-align: left;
		font: 10px var(--mono);
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		direction: rtl;
	}
	.path:hover {
		color: var(--text);
		background: transparent;
	}
	.attached {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 4px 0;
		font-size: 11px;
		color: var(--text-dim);
	}
	.attached button {
		padding: 1px 8px;
		flex: none;
	}
	.section {
		margin: 8px 0 2px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	.link {
		margin: 2px 0 0 64px;
		padding: 0 6px;
		font-size: 11px;
	}
	.actions {
		display: flex;
		gap: 4px;
		margin-top: 8px;
	}
	.actions button {
		flex: 1;
		min-width: 0;
		padding: 2px 4px;
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions + .actions {
		margin-top: 4px;
	}
	.facts {
		display: grid;
		grid-template-columns: 60px 1fr;
		gap: 2px 8px;
		margin: 4px 0;
		font-size: 12px;
	}
	.facts span:not(.k) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.k {
		color: var(--text-dim);
		font-size: 11px;
	}
	.dim {
		color: var(--text-dim);
		font-size: 11px;
		margin: 8px 0 0;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		max-height: 220px;
		overflow-y: auto;
		font-size: 12px;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.kind {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 2px 4px;
		border: none;
		background: transparent;
		text-align: left;
	}
	.kind:hover {
		background: var(--panel-2);
	}
	.kname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		color: var(--text-dim);
		font-family: var(--mono);
		min-width: 30px;
		text-align: right;
	}
	.small {
		padding: 0 6px;
		font-size: 11px;
		line-height: 16px;
		flex: none;
	}
</style>
