<script lang="ts">
	import { onMount } from 'svelte'
	import Modal from './Modal.svelte'
	import { ui, type ProjectInfo } from '../lib/state/editor.svelte'
	import { closeProject, forgetProject, openProject, refreshProjects } from '../lib/io/project'
	import { hasBackend } from '../lib/io/mapio'
	import { BrowseProjectFolder, ProjectInFolder } from '../../wailsjs/go/main/App'

	// File › Project… (#48): a project is a folder for its worlds, which the Open and Save dialogs start in.
	let { onclose }: { onclose: () => void } = $props()

	let name = $state(ui.project?.name ?? '')
	let path = $state(ui.project?.path ?? '')
	let error = $state('')
	let busy = $state(false)

	onMount(() => void refreshProjects())

	async function browseFolder() {
		const dir = await BrowseProjectFolder()
		if (!dir) return
		path = dir
		// A folder used before says its name in its project file.
		try {
			const p = await ProjectInFolder(dir)
			name = p.name
		} catch (e) {
			error = `That folder's project file can't be read: ${e}`
		}
	}

	async function open(p: ProjectInfo) {
		busy = true
		error = await openProject(p.name, p.path)
		busy = false
		if (!error) onclose()
	}

	const same = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
	const canOpen = $derived(hasBackend() && !busy && path.trim() !== '')
</script>

<Modal title="Project" width={560} {onclose}>
	<p>A project is a folder for your cube worlds, which the Open and Save dialogs start in.</p>
	{#if ui.project}
		<p class="dim">Open now: <b>{ui.project.name}</b> ({ui.project.path})</p>
	{/if}
	<div class="fields">
		<label for="project-folder">Project folder</label>
		<div class="row">
			<input id="project-folder" type="text" bind:value={path} placeholder="Where the project's worlds go" />
			<button onclick={browseFolder} disabled={!hasBackend()}>Browse…</button>
		</div>
		<label for="project-name">Name</label>
		<input id="project-name" type="text" bind:value={name} placeholder="The folder's name" />
	</div>
	{#if error}<p class="warn">{error}</p>{/if}
	{#if ui.recentProjects.length}
		<h3>Recent projects</h3>
		<div class="recent">
			{#each ui.recentProjects as p (p.path)}
				<div class="item" class:current={!!ui.project && same(ui.project.path, p.path)}>
					<button class="pick" disabled={busy} onclick={() => open(p)} title="Open this project">
						<span class="name">{p.name}</span>
						<span class="dim">{p.path}</span>
					</button>
					<button class="forget" aria-label="Remove from the list" title="Remove from the list (the folder stays)" onclick={() => forgetProject(p.path)}>✕</button>
				</div>
			{/each}
		</div>
	{/if}
	{#snippet actions()}
		{#if ui.project}<button onclick={() => closeProject()}>Close Project</button>{/if}
		<button onclick={onclose}>Cancel</button>
		<button class="active" disabled={!canOpen} onclick={() => open({ name: name.trim(), path: path.trim() })}>Open Project</button>
	{/snippet}
</Modal>

<style>
	.fields {
		display: grid;
		grid-template-columns: 110px 1fr;
		gap: 8px;
		align-items: center;
		margin-top: 10px;
	}
	.fields input {
		width: 100%;
	}
	.row {
		display: flex;
		gap: 6px;
	}
	.row input {
		flex: 1;
		min-width: 0;
	}
	h3 {
		margin: 14px 0 6px;
		font-size: 12px;
	}
	.recent {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 220px;
		overflow-y: auto;
	}
	.item {
		display: flex;
		gap: 4px;
	}
	.item.current .pick {
		border-color: var(--accent);
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		gap: 2px;
	}
	.pick span {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		font-weight: 600;
	}
	.dim {
		color: var(--text-dim);
	}
	.warn {
		color: var(--warn, #d9a441);
	}
</style>
