<script lang="ts">
	import Modal from './Modal.svelte'
	import { editor } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { CUBE_SIZE } from '../lib/cubes/shapes'
	import { GROUND_LAYER, LAYER_COUNT, type SpawnPoint } from '../lib/cubes/world'

	// The open world's facts and its spawn point (File › World Properties, #62).

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const world = engineRef.current?.activeDocument().world
	// The spawn point (the cube a player starts in) of a world tab, kept here so the fields follow it.
	let spawn = $state<SpawnPoint | null>(world?.spawn ? { ...world.spawn } : null)
	function setSpawn(next: SpawnPoint | null) {
		if (next && world && !world.spawnInside(next)) return
		engineRef.current?.setWorldSpawn(next)
		spawn = world?.spawn ? { ...world.spawn } : null
	}
	/** The middle of the world on the surface, one layer above the ground layer. */
	const middleSpawn = (): SpawnPoint => ({ x: Math.floor(world!.sizeX / 2), z: Math.floor(world!.sizeZ / 2), layer: GROUND_LAYER - 1 })
	const metres = (cubes: number) => `${cubes * CUBE_SIZE} m`
	/** The world's monster spawn points (#91) by kind, e.g. "3: wolf ×3". */
	/** The world's NPCs (#99) by name, with the cubes of their routes, e.g. "2: Warden Hask (route of 3), Old Marta". */
	const npcSummary = (() => {
		const list = world?.npcs ?? []
		if (!list.length) return 'none (the Cubes tool’s NPC mode places them)'
		return `${list.length}: ${list.map((n) => (n.route.length ? `${n.name} (route of ${n.route.length})` : n.name)).join(', ')}`
	})()
	const monsterSummary = (() => {
		const list = world?.monsters ?? []
		if (!list.length) return 'none (the Cubes tool’s Monster mode places them)'
		const by = new Map<string, number>()
		for (const m of list) by.set(m.kind, (by.get(m.kind) ?? 0) + 1)
		return `${list.length}: ${[...by].map(([k, n]) => `${k} ×${n}`).join(', ')}`
	})()
	/** The world's props (#133): how many, of how many models. */
	const propSummary = (() => {
		const list = world?.props ?? []
		if (!list.length) return 'none (the Cubes tool’s Prop mode places them)'
		return `${list.length}, of ${new Set(list.map((p) => p.model)).size} models`
	})()
	/** The world's mood regions (3dgame #143): how many, by mood. */
	const moodSummary = (() => {
		const list = world?.moods ?? []
		if (!list.length) return 'none (the Cubes tool’s Mood mode paints them)'
		const by = new Map<string, number>()
		for (const r of list) by.set(r.mood, (by.get(r.mood) ?? 0) + 1)
		return `${list.length}: ${[...by].map(([k, n]) => `${k} ×${n}`).join(', ')}`
	})()
	const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
</script>

<Modal title="World Properties" width={460} {onclose}>
	{#if world}
	<div class="facts">
		<span class="k">Name</span><span title={editor.mapName}>{editor.mapName}</span>
		<span class="k">Size</span><span>{world.chunksX} × {world.chunksZ} chunks · {world.sizeX} × {world.sizeZ} cubes · {metres(world.sizeX)} × {metres(world.sizeZ)}</span>
		<span class="k">Layers</span><span>{LAYER_COUNT}: sky 0 to 9, the ground 10, dirt to 14, stone to 20, the lava cavern to 25, metal 26 to 30</span>
		<span class="k">Chunks with cubes</span><span>{world.chunkCount}</span>
		{#if editor.filePath}<span class="k">File</span><span title={editor.filePath}>{editor.filePath}</span>{:else}<span class="k">File</span><span>not saved yet</span>{/if}
		<span class="k">Spawn</span>
		{#if spawn}
			<span class="row">
				<input type="number" min="0" max={world.sizeX - 1} value={spawn.x} onchange={(e) => setSpawn({ ...spawn!, x: Math.round(num(e)) })} aria-label="Spawn x" />
				<input type="number" min="0" max={world.sizeZ - 1} value={spawn.z} onchange={(e) => setSpawn({ ...spawn!, z: Math.round(num(e)) })} aria-label="Spawn z" />
				<input type="number" min="0" max={LAYER_COUNT - 1} value={spawn.layer} onchange={(e) => setSpawn({ ...spawn!, layer: Math.round(num(e)) })} aria-label="Spawn layer" />
				<button onclick={() => setSpawn(null)} title="Remove the spawn point: the server then starts players in the middle of the world">Clear</button>
			</span>
		{:else}
			<span class="row">none (the middle of the world) <button onclick={() => setSpawn(middleSpawn())}>Set</button></span>
		{/if}
		<span class="k">Monsters</span><span title="The Cubes tool's Monster mode places, moves and removes them">{monsterSummary}</span>
		<span class="k">NPCs</span><span title="The Cubes tool's NPC mode places, moves and removes them and edits their routes">{npcSummary}</span>
		<span class="k">Props</span><span title="The Cubes tool's Prop mode places, moves, turns and removes them">{propSummary}</span>
		<span class="k">Mood regions</span><span title="The Cubes tool's Mood mode paints, changes and removes them">{moodSummary}</span>
	</div>
	<p class="dim">The name is the file's: Save As renames it. The spawn point is the cube (x, z, layer) a player starts in, standing on its bottom; the surface is layer {GROUND_LAYER - 1}.</p>
	{/if}
	{#snippet actions()}
		<button class="active" onclick={onclose}>Close</button>
	{/snippet}
</Modal>

<style>
	.row {
		display: flex;
		gap: 4px;
	}
	.row input {
		width: 70px;
		min-width: 0;
	}
	.facts {
		display: grid;
		grid-template-columns: 70px 1fr;
		gap: 3px 8px;
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
		margin: 2px 0 6px;
	}
</style>
