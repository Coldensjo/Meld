<script lang="ts" module>
	import { setStatus } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { CHUNK_SIZE, CubeWorld, MAX_NEW_CHUNKS } from '../lib/cubes/world'

	/** Opens a new cube world in a tab, as File › New Cube World and the Start dialog make it. */
	export function createCubeWorld(name: string, chunksX: number, chunksZ: number, themed: boolean): boolean {
		const e = engineRef.current
		if (!e) return false
		e.openWorld(CubeWorld.create(chunksX, chunksZ, themed), name.trim() || 'World', '')
		setStatus(`New cube world ${chunksX}×${chunksZ} chunks: build with the Cubes tool (Y) and save it as a .world file.`, 8000)
		return true
	}
</script>

<script lang="ts">
	// The fields of a new cube world (#29, #62): a name, its size in chunks on every one of its 31
	// layers, and whether the layers start filled by their themes, as the game's generator starts:
	// sky above the ground layer, dirt, stone, the lava cavern, metal.

	interface Props {
		name: string
		chunksX: number
		chunksZ: number
		themed: boolean
	}
	let { name = $bindable(), chunksX = $bindable(), chunksZ = $bindable(), themed = $bindable() }: Props = $props()

	const num = (e: Event) => parseFloat((e.target as HTMLInputElement).value)
	const size = (v: number) => (Number.isFinite(v) ? Math.min(MAX_NEW_CHUNKS, Math.max(1, Math.round(v))) : 1)
	/** Metres a side, at the game's 3 m cubes. */
	const metres = (chunks: number) => chunks * CHUNK_SIZE * 3
</script>

<div class="grid">
	<label for="cw-name">Name</label>
	<span><input id="cw-name" type="text" bind:value={name} /></span>
	<label for="cw-x" title="Chunks along x (east); a chunk is 16 cubes, 48 m">Width</label>
	<span><input id="cw-x" type="number" min="1" max={MAX_NEW_CHUNKS} step="1" value={chunksX} onchange={(e) => (chunksX = size(num(e)))} /> chunks · {metres(chunksX)} m</span>
	<label for="cw-z" title="Chunks along z (south); a chunk is 16 cubes, 48 m">Depth</label>
	<span><input id="cw-z" type="number" min="1" max={MAX_NEW_CHUNKS} step="1" value={chunksZ} onchange={(e) => (chunksZ = size(num(e)))} /> chunks · {metres(chunksZ)} m</span>
	<span></span>
	<label class="check" title="Fill each layer by its theme: dirt in layers 10 to 14, stone in 15 to 20, a lava floor in 25 and metal in 26 to 30; otherwise every layer starts empty">
		<input type="checkbox" bind:checked={themed} />
		Fill the layers by their themes
	</label>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 8px;
		align-items: center;
		margin: 10px 0;
	}
	.grid input[type='number'] {
		width: 64px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
