<script lang="ts">
	import { ObjectDisplaySounds, SaveObjectDisplaySounds } from '../../wailsjs/go/main/App'
	import type { main, vmangos } from '../../wailsjs/go/models'
	import { playSound, soundPlayer, stopSound } from '../lib/ui/soundPlayer.svelte'
	import { loadDisplays } from './DisplayPicker.svelte'
	import SoundPicker, { loadSoundEntries } from './SoundPicker.svelte'

	// The game object editor's Sounds tab (#674): the sounds the client plays where an object stands,
	// the ten sound slots of its display's GameObjectDisplayInfo.dbc row, each a SoundEntries.dbc
	// sound. A fire's crackle is its display's Loop sound, a lamp's hum its Stand sound; the game plays
	// them only near the object. A slot is changed or given a sound from the shared sound picker, and
	// the slots are written into Meld's patch with the editor's Save (at once, or once the game has
	// closed), so the game plays them from its next start. They belong to the display, not the
	// template: every object of that display changes, which the tab says.

	interface Props {
		/** The display the template has now, saved or not (0: none). */
		display: number
		/** The tab is showing: the display's slots are read only then. */
		active: boolean
		dirty?: boolean
	}
	let { display, active, dirty = $bindable(false) }: Props = $props()

	/**
	 * The client's slot names (wowdev's SoundSlot), with what the client's own displays put in each:
	 * the looping sounds sit in Stand, Loop and Custom 0.
	 */
	const SLOTS: { name: string; hint: string }[] = [
		{ name: 'Stand', hint: "A sound while the object stands: the client's street lamps loop their hum here" },
		{ name: 'Open', hint: 'When the object is opened or used: chests, doors, books' },
		{ name: 'Loop', hint: "A sound while it is active: most of the client's fires loop their crackle here" },
		{ name: 'Close', hint: 'When the object closes' },
		{ name: 'Destroy', hint: 'When the object is destroyed or despawns' },
		{ name: 'Opened', hint: 'While the object stays open' },
		{ name: 'Custom 0', hint: "A sound of the object's own: forges and some fires and lamps loop theirs here" },
		{ name: 'Custom 1', hint: "Another sound of the object's own, as a festival bonfire has" },
		{ name: 'Custom 2', hint: "Another sound of the object's own" },
		{ name: 'Custom 3', hint: "Another sound of the object's own" },
	]

	/** Each display's slots as the client has them (read, or saved here). */
	let loaded = $state<Record<number, vmangos.ObjectDisplaySounds>>({})
	/** The unsaved slots, by display: a display changed under the tab keeps its edits for Save. */
	let edits = $state<Record<number, number[]>>({})
	let error = $state('')
	$effect(() => {
		dirty = Object.keys(edits).length > 0
	})

	$effect(() => {
		const d = display
		if (!active || d <= 0 || loaded[d]) return
		error = ''
		ObjectDisplaySounds(d)
			.then((s) => (loaded[d] = { ...s, sounds: s.sounds ?? [] }))
			.catch((err) => (error = String(err)))
	})

	const now = $derived(loaded[display])
	const slots = $derived(edits[display] ?? now?.sounds ?? [])
	/** The slot the picker is open for, or -1. */
	let picking = $state(-1)
	$effect(() => {
		// Another display: the picker closes.
		void display
		picking = -1
	})

	// The sounds by ID for the slots' names, and the objects using the display.
	let names = $state<Map<number, vmangos.SoundOption>>(new Map())
	$effect(() => {
		if (!active || names.size) return
		loadSoundEntries()
			.then((list) => (names = new Map(list.map((s) => [s.id, s]))))
			.catch((err) => (error = String(err)))
	})
	let users = $state<vmangos.DisplayEntry | null>(null)
	$effect(() => {
		const d = display
		if (!active || d <= 0) return
		loadDisplays('object')
			.then((list) => (users = list.find((e) => e.id === d) ?? null))
			.catch(() => (users = null))
	})

	$effect(() => () => stopSound())

	function setSlot(i: number, id: number) {
		const d = display
		const base = loaded[d]?.sounds
		if (!base) return
		const next = [...slots]
		next[i] = id
		const copy = { ...edits }
		if (next.every((v, j) => v === base[j])) delete copy[d]
		else copy[d] = next
		edits = copy
		picking = -1
	}

	const others = $derived(
		Object.keys(edits)
			.map(Number)
			.filter((d) => d !== display),
	)

	/** Drops the unsaved slots. */
	export function revert() {
		edits = {}
		picking = -1
	}

	/** Writes the unsaved slots into the client's patch; null when nothing needed saving. */
	export async function save(): Promise<main.SoundsSaved | null> {
		const pending = Object.entries(edits).map(([d, s]) => [Number(d), s] as const)
		if (!pending.length) return null
		let res: main.SoundsSaved = { changed: false, waiting: false }
		for (const [d, s] of pending) {
			const r = await SaveObjectDisplaySounds(d, s)
			res = { changed: res.changed || r.changed, waiting: res.waiting || r.waiting }
			if (loaded[d]) loaded[d] = { ...loaded[d], sounds: [...s] }
			const copy = { ...edits }
			delete copy[d]
			edits = copy
		}
		return res
	}
</script>

{#if display <= 0}
	<p class="dim">The object has no display yet: pick one on the Display tab, then give it sounds here.</p>
{:else}
	<p class="dim">
		The sounds the game plays where display {display} stands, only for players near it. They belong to the display, so
		{#if users && users.uses > 1}
			<strong>all {users.uses} objects of display {display}</strong> ({[...new Set(users.names ?? [])].slice(0, 3).join(', ')}{new Set(users.names ?? []).size > 3 ? ', …' : ''}) change.
		{:else}
			every object of that display changes.
		{/if}
		Saved with Save object into Meld's patch; the game plays them from its next start.
	</p>
	{#if error}<p class="error">{error}</p>{/if}
	{#if !now}
		<p class="dim">{error ? '' : 'Reading the sounds…'}</p>
	{:else}
		<ul class="slots" aria-label="Sound slots">
			{#each SLOTS as slot, i (slot.name)}
				{@const id = slots[i] ?? 0}
				{@const s = names.get(id)}
				<li class:changed={id !== (now.sounds[i] ?? 0)} class:picking={picking === i}>
					<span class="slot" title={slot.hint}>{slot.name}</span>
					<span class="sound" title={s?.file ?? ''}>{id ? s?.name || `Sound ${id}` : 'None'}{id ? ` (${id})` : ''}</span>
					<button class="play" disabled={!s?.file} title={s?.file ? `Play ${s.file}` : 'Nothing to play'} onclick={() => playSound(s?.file ?? '', (m) => (error = m))}
						>{soundPlayer.playing && soundPlayer.playing === s?.file ? '■' : '▶'}</button
					>
					<button onclick={() => (picking = picking === i ? -1 : i)}>{picking === i ? 'Done' : id ? 'Change' : 'Add'}</button>
					<button disabled={!id} title="No sound in this slot" onclick={() => setSlot(i, 0)}>Clear</button>
				</li>
				{#if picking === i}
					<li class="pick">
						<span class="dim">{slot.hint}. Pick its sound:</span>
						<SoundPicker selected={id} start={i === 0 || i === 2 || i === 6 ? 'loop' : ''} onpick={(o) => setSlot(i, o.id)} />
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
	{#if others.length}
		<p class="dim">Also unsaved: the sounds of display {others.join(', ')}, which Save object writes too.</p>
	{/if}
{/if}

<style>
	.slots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slots li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		padding: 2px 4px;
		border-radius: 3px;
	}
	.slots li.changed .sound {
		color: var(--accent-text);
	}
	.slots li.picking {
		background: var(--panel-2);
	}
	.slots li.pick {
		flex-direction: column;
		align-items: stretch;
		padding: 4px 4px 10px;
	}
	.slot {
		flex: none;
		width: 64px;
		color: var(--text-dim);
	}
	.sound {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.play {
		padding: 2px 8px;
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
