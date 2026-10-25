<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs, wow } from '../lib/state/editor.svelte'
	import { chooseVmangosFolder } from '../lib/io/game'
	import { chooseWowFolder } from '../lib/wow/api'
	import { VmangosPath } from '../../wailsjs/go/main/App'
	import { onMount } from 'svelte'

	// Shown at the start while the client or the server folder is unset (#689). Skip closes it for this
	// launch; "Don't ask again" stops it for good. Settings keeps the same two choosers. A project
	// (File › Project…) names its own client folder, which this one does not change.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	let server = $state('')
	const refresh = async () => (server = await VmangosPath().catch(() => ''))
	onMount(() => void refresh())

	async function browseServer() {
		await chooseVmangosFolder()
		await refresh()
	}
</script>

<Modal title="Set up your folders" width={520} {onclose}>
	<p class="dim">Meld reads the game's models and textures from your WoW 1.12 client, and edits a VMaNGOS server's spawns and database. Both are optional; you can set them later under Settings.</p>
	<div class="row">
		<div>
			<strong>WoW client folder</strong>
			<div class="dim">Models, textures, opening Azeroth and compiling to the client.</div>
			{#if wow.path}<div class="set" title={wow.path}>Set: {wow.path}</div>{/if}
		</div>
		<button onclick={chooseWowFolder} disabled={wow.loading}>{wow.path ? 'Change…' : 'Browse…'}</button>
	</div>
	<div class="row">
		<div>
			<strong>VMaNGOS server folder</strong>
			<div class="dim">Spawns, the database editors and Launch.</div>
			{#if server}<div class="set" title={server}>Set: {server}</div>{/if}
		</div>
		<button onclick={browseServer}>{server ? 'Change…' : 'Browse…'}</button>
	</div>
	{#snippet actions()}
		<label class="check"><input type="checkbox" bind:checked={prefs.skipFolderSetup} /> Don't ask again</label>
		<button onclick={onclose}>{wow.path && server ? 'Done' : 'Skip'}</button>
	{/snippet}
</Modal>

<style>
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
	}
	.set {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 360px;
	}
	.check {
		margin-right: auto;
	}
</style>
