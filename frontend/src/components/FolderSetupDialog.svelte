<script lang="ts">
	import Modal from './Modal.svelte'
	import { prefs, setStatus, wow } from '../lib/state/editor.svelte'
	import { chooseAzerothcoreFolder, chooseVmangosFolder } from '../lib/io/game'
	import { chooseWowFolder } from '../lib/wow/api'
	import { AzerothcorePath, VmangosPath } from '../lib/wails/App'
	import { setupServer } from '../lib/io/folderGaps'

	// Shown at the start while the client or the server folder is unset (#689). Skip closes it for this
	// launch; "Don't ask again" stops it for good. Edit › Preferences › Folders keeps the same choosers. A project
	// (File › Project…) names its own client folder, which this one does not change. With a 3.3.5a client the
	// server is AzerothCore's (#1094): the editor's database tools stay VMaNGOS, so that folder is not asked for.

	interface Props {
		onclose: () => void
	}
	let { onclose }: Props = $props()

	const core = $derived(setupServer(wow.build))
	let server = $state('')
	const refresh = async () => (server = await (core === 'azerothcore' ? AzerothcorePath() : VmangosPath()).catch(() => ''))
	// Again when the client changes here, which may change the server it calls for.
	$effect(() => {
		void core
		void refresh()
	})

	async function browseServer() {
		if (core === 'azerothcore') {
			await chooseAzerothcoreFolder()
			// File › Compile to AzerothCore Server and the spawn SQL follow Spawn SQL for, so it goes with the folder.
			if ((await AzerothcorePath().catch(() => '')) && prefs.exportCore !== 'azerothcore') {
				prefs.exportCore = 'azerothcore'
				setStatus('AzerothCore folder set, and Edit › Preferences › Compile and export › Spawn SQL for is now AzerothCore.', 8000)
			}
		} else {
			await chooseVmangosFolder()
		}
		await refresh()
	}
</script>

<Modal title="Set up your folders" width={520} {onclose}>
	{#if core === 'azerothcore'}
		<p class="dim">Meld reads the game's models and textures from your WoW 3.3.5a client, and compiles the maps you edit for an AzerothCore server. Both are optional; you can set them later in Edit › Preferences.</p>
	{:else}
		<p class="dim">Meld reads the game's models and textures from your WoW 1.12 client, and edits a VMaNGOS server's spawns and database. Both are optional; you can set them later in Edit › Preferences.</p>
	{/if}
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
			{#if core === 'azerothcore'}
				<strong>AzerothCore server folder</strong>
				<div class="dim">The install with bin and etc: File › Compile to AzerothCore Server and spawn SQL for it.</div>
			{:else}
				<strong>VMaNGOS server folder</strong>
				<div class="dim">Spawns, the database editors and Launch.</div>
			{/if}
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
