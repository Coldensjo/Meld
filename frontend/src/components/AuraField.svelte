<script lang="ts">
	import type { vmangos } from '../../wailsjs/go/models'
	import type { CreatureField } from '../lib/world/creatureFields'
	import { spellRef } from '../lib/wow/spells'
	import SpellIcon from './SpellIcon.svelte'

	// A column of spell IDs separated by spaces (a creature's auras): the text to edit, and under it
	// each spell's icon and name from the client (#255).

	interface Props {
		f: CreatureField
		value: string
		changed: boolean
		onset: (value: string) => void
	}
	let { f, value, changed, onset }: Props = $props()

	const ids = $derived([...new Set(value.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))])
	// null while a spell loads, false when the client has none.
	let spells = $state<Array<{ id: number; ref: vmangos.SpellRef | null | false }>>([])
	$effect(() => {
		const list = ids
		spells = list.map((id) => ({ id, ref: null }))
		list.forEach((id, i) => {
			void spellRef(id)
				.catch(() => null)
				.then((r) => {
					if (spells[i]?.id === id) spells[i].ref = r ?? false
				})
		})
	})
</script>

<div class="aura" class:changed>
	<label title={f.hint ? `${f.hint} (${f.col})` : f.col}>
		{f.label}
		<input type="text" {value} oninput={(e) => onset((e.currentTarget as HTMLInputElement).value)} />
	</label>
	{#if spells.length}
		<ul>
			{#each spells as s (s.id)}
				<li title={String(s.id)}>
					<SpellIcon icon={s.ref ? s.ref.icon : ''} />
					{#if s.ref}<span>{s.ref.rank ? `${s.ref.name} (${s.ref.rank})` : s.ref.name}</span>
					{:else if s.ref === false}<span class="missing">No spell {s.id}</span>
					{:else}<span class="dim">…</span>{/if}
					<span class="dim">{s.id}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.aura {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		color: var(--text-dim);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	input {
		width: 100%;
		min-width: 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--text);
	}
	.dim {
		color: var(--text-dim);
	}
	.missing {
		color: var(--danger-text);
	}
	.changed,
	.changed input {
		color: var(--accent-text);
	}
	.changed input {
		border-color: var(--accent);
	}
</style>
