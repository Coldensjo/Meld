<script lang="ts" module>
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { SoundEntries } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The client's SoundEntries.dbc rows, read once for the session; a sound import (#684) forgets them.
	let soundsPromise: Promise<vmangos.SoundOption[]> | null = null
	/** Every sound of the client by ID, each with a file to play. */
	export function loadSoundEntries(): Promise<vmangos.SoundOption[]> {
		if (!soundsPromise) {
			const p = SoundEntries().then((s) => s ?? [])
			p.catch(() => (soundsPromise = null))
			soundsPromise = p
		}
		return soundsPromise
	}
	/** Drops the sounds read, so the next picker reads them again. */
	export function forgetSoundEntries() {
		soundsPromise = null
	}
</script>

<script lang="ts">
	import { playSound, soundPlayer } from '../lib/ui/soundPlayer.svelte'

	// A picker of the client's sounds (#674): the SoundEntries.dbc rows a game object display's sound
	// slots, a zone's music and ambience name, searched by name, file or ID, each with Play. A click
	// picks one. Meant to be shared by every sound picker (#684).

	interface Props {
		/** The sound picked now, drawn highlighted (0: none). */
		selected: number
		onpick: (s: vmangos.SoundOption) => void
		/** A search to start with, such as "loop". */
		start?: string
	}
	let { selected, onpick, start = '' }: Props = $props()

	let all = $state<vmangos.SoundOption[]>([])
	let error = $state('')
	let loading = $state(true)
	loadSoundEntries()
		.then((s) => (all = s))
		.catch((err) => (error = String(err)))
		.finally(() => (loading = false))

	// svelte-ignore state_referenced_locally
	let query = $state(start)
	const LIMIT = 200
	// Every word must appear in the name, the file or the ID; the picked one leads.
	const matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean)
		const list = words.length ? all.filter((s) => words.every((w) => `${s.id} ${s.name} ${s.file}`.toLowerCase().includes(w))) : all
		const at = list.findIndex((s) => s.id === selected)
		return at > 0 ? [list[at], ...list.slice(0, at), ...list.slice(at + 1)] : list
	})
	const fileName = (f: string) => f.slice(f.lastIndexOf('\\') + 1)
</script>

<div class="picker">
	<input type="search" placeholder="Search sounds by name, file or ID" bind:value={query} aria-label="Search sounds" />
	{#if error}<p class="error">{error}</p>{/if}
	<ul class="list" aria-label="Sounds">
		{#each matches.slice(0, LIMIT) as s (s.id)}
			<li class:active={s.id === selected}>
				<button class="row" use:idMenu={{ ids: [idOf('sound', s.id)], name: s.name }} title="SoundEntries {s.id}{s.file ? `: ${s.file}` : ''}" onclick={() => onpick(s)}>
					<span class="name">{s.name || `Sound ${s.id}`}</span>
					<span class="dim">{s.id}{s.file ? ` · ${fileName(s.file)}` : ' · no file'}</span>
				</button>
				<button class="play" disabled={!s.file} title={s.file ? `Play ${s.file}` : 'Nothing to play'} onclick={() => playSound(s.file, (m) => (error = m))}>{soundPlayer.playing && soundPlayer.playing === s.file ? '■' : '▶'}</button>
			</li>
		{:else}
			<li class="dim">{loading ? 'Reading the sounds…' : 'Nothing matches.'}</li>
		{/each}
	</ul>
	{#if matches.length > LIMIT}<p class="dim">Showing {LIMIT} of {matches.length}. Narrow the search to see the rest.</p>{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--border);
	}
	li {
		display: flex;
		align-items: center;
	}
	li.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	li.active .dim {
		color: inherit;
	}
	.row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 4px 8px;
		font-size: 12px;
		color: inherit;
	}
	.name {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.play {
		flex: none;
		padding: 2px 8px;
		margin-right: 4px;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
		overflow-wrap: anywhere;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
</style>
