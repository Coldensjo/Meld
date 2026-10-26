<script lang="ts">
	import { SpawnScripts } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The scripts the world database attaches to a spawn (#137), read-only: its template's C++ script
	// and AI, a game object's use and event scripts, a creature's EventAI events and path scripts. A
	// first step toward the node editor (#30) and Lua (#28).

	interface Props {
		s: vmangos.WorldSpawn
	}
	let { s }: Props = $props()

	let scripts = $state<vmangos.SpawnScript[]>([])
	let error = $state('')
	let loading = $state(false)
	/** The spawn the list was read for: `s` is a new copy after every edit, which needs no new read. */
	let readFor = ''
	$effect(() => {
		const kind = s.kind === 'object' ? 'object' : 'creature'
		const key = `${kind}:${s.entry}:${s.guid}`
		if (key === readFor) return
		readFor = key
		loading = true
		error = ''
		SpawnScripts(kind, s.entry, s.guid)
			.then((list) => {
				if (readFor === key) scripts = list ?? []
			})
			.catch((e) => {
				if (readFor !== key) return
				scripts = []
				error = String(e)
			})
			.finally(() => {
				if (readFor === key) loading = false
			})
	})

	const commands = (n: number) => `${n} ${n === 1 ? 'command' : 'commands'}`

	/** What attaches a script, as the list shows it. */
	function label(x: vmangos.SpawnScript): string {
		switch (x.kind) {
			case 'cpp':
				return 'C++ script'
			case 'ai':
				return 'AI'
			case 'use':
				return 'On use'
			case 'event':
				return `Event ${x.id}`
			case 'eventai':
				return `AI event ${x.id}`
			case 'path':
				return `Path ${x.name.includes(',') ? 'points' : 'point'} ${x.name}`
		}
		return x.kind
	}

	/** The script's details: its name or id and how many commands it has. */
	function detail(x: vmangos.SpawnScript): string {
		switch (x.kind) {
			case 'cpp':
			case 'ai':
				return x.name
			case 'event':
				return [x.name ? `C++ ${x.name}` : '', x.commands || !x.name ? commands(x.commands) : ''].filter(Boolean).join(', ')
			case 'path':
				return `script ${x.id}, ${commands(x.commands)}`
		}
		return commands(x.commands)
	}
</script>

<div class="script-fields" data-testid="spawn-scripts">
	<h4>Scripts</h4>
	{#if error}
		<p class="dim">Couldn't read the scripts: {error}</p>
	{:else if loading && !scripts.length}
		<p class="dim">Reading…</p>
	{:else if !scripts.length}
		<p class="dim">No scripts in the world database.</p>
	{:else}
		<ul class="scripts">
			{#each scripts as x (`${x.kind}:${x.id}:${x.name}`)}
				<li title={x.comment || undefined}>
					<span class="what">{label(x)}</span>
					<span class="detail">{detail(x)}</span>
					{#if x.comment}<span class="comment">{x.comment}</span>{/if}
				</li>
			{/each}
		</ul>
		<p class="dim hint">As saved in the world database; read-only.</p>
	{/if}
</div>

<style>
	.script-fields {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h4 {
		margin: 4px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.scripts {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 180px;
		overflow-y: auto;
		border: 1px solid var(--border);
		font-size: 12px;
	}
	.scripts li {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0 8px;
		padding: 3px 8px;
	}
	.scripts li + li {
		border-top: 1px solid var(--border);
	}
	.what {
		font-weight: 600;
	}
	.detail {
		color: var(--text-dim);
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.comment {
		grid-column: 1 / -1;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
	.hint {
		font-size: 11px;
	}
</style>
