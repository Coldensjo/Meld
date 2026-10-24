<script lang="ts">
	import Modal from './Modal.svelte'
	import CubeWorldFields, { createCubeWorld } from './CubeWorldFields.svelte'
	import { ui } from '../lib/state/editor.svelte'

	// The Start dialog (File › New Cube World, Ctrl+N, the tabs' +): a new cube world of the game (#62).

	const close = () => (ui.showNewDialog = false)

	let cubeName = $state('World')
	let chunksX = $state(8)
	let chunksZ = $state(8)
	let themed = $state(true)
	function createCube() {
		if (createCubeWorld(cubeName, chunksX, chunksZ, themed)) close()
	}
</script>

<Modal title="New Cube World" width={560} onclose={close}>
	<div class="body">
		<p class="dim">A world of the game: 31 layers of 3 m cubes, from the sky down through the ground, dirt, stone and the lava cavern to the metal floor. Saved as a .world file the server and client load.</p>
		<CubeWorldFields bind:name={cubeName} bind:chunksX bind:chunksZ bind:themed />
	</div>
	{#snippet actions()}
		<button onclick={close}>Cancel</button>
		<button class="active" onclick={createCube}>Create world</button>
	{/snippet}
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.dim {
		margin: 0;
		color: var(--text-dim);
		font-size: 12px;
	}
</style>
