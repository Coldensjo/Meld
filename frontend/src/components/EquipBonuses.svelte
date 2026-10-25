<script lang="ts" module>
	import { EquipBonuses } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'

	// The bonuses and their spells, read once a session.
	let kinds: Promise<vmangos.EquipBonusKind[]> | null = null
	function loadKinds(): Promise<vmangos.EquipBonusKind[]> {
		if (!kinds) {
			kinds = EquipBonuses().then((k) => (k ?? []).filter((x) => x.amounts?.length))
			kinds.catch(() => (kinds = null))
		}
		return kinds
	}
</script>

<script lang="ts">
	import RefIcon from './RefIcon.svelte'

	// The item editor's Equip bonuses (#353), on its Stats tab: the stats an item's ten stat slots
	// can't hold (1.12 has only mana, health and the five attributes there), such as healing, spell
	// damage, crit, hit, dodge, attack power or mana per 5. In the game each is an Equip effect, a
	// passive spell of the client that gives that bonus; here the author picks the bonus and its
	// amount and the spell goes into a free effect slot (spellid_1..5) as Equip. The item's Equip
	// effects are listed with their text, each with Remove.

	interface Props {
		values: Record<string, string>
		/** The effects' spell texts by spell ID. */
		texts: Record<number, string>
		onset: (col: string, value: string) => void
	}
	let { values, texts, onset }: Props = $props()

	let list = $state<vmangos.EquipBonusKind[]>([])
	let error = $state('')
	loadKinds().then(
		(k) => (list = k),
		(e) => (error = String(e)),
	)

	const SLOTS = [1, 2, 3, 4, 5]
	const equips = $derived(SLOTS.filter((i) => Number(values[`spellid_${i}`]) > 0 && Number(values[`spelltrigger_${i}`]) === 1))
	const free = $derived(SLOTS.find((i) => `spellid_${i}` in values && !(Number(values[`spellid_${i}`]) > 0)))
	/** The bonus each Equip spell gives, when it is one of the listed. */
	const bonusOf = $derived(new Map(list.flatMap((k) => k.amounts.map((a) => [a.spell, `${k.name} +${a.amount}${k.unit}`] as [number, string]))))

	let kindId = $state('healing')
	const kind = $derived(list.find((k) => k.id === kindId) ?? list[0])
	let spell = $state(0)
	// A new kind starts on its smallest amount.
	$effect(() => {
		if (kind && !kind.amounts.some((a) => a.spell === spell)) spell = kind.amounts[0].spell
	})

	function add() {
		// The slot is taken once: `free` moves on as soon as its spell is set.
		const slot = free
		if (!slot || !spell) return
		const set = (col: string, v: string) => `${col}_${slot}` in values && onset(`${col}_${slot}`, v)
		set('spellid', String(spell))
		set('spelltrigger', '1')
		set('spellcharges', '0')
		set('spellppmrate', '0')
		set('spellcooldown', '-1')
		set('spellcategory', '0')
		set('spellcategorycooldown', '-1')
	}

	function remove(i: number) {
		onset(`spellid_${i}`, '0')
		onset(`spelltrigger_${i}`, '0')
	}
</script>

<div class="bonuses">
	<p class="dim">
		Healing, spell damage, crit, hit, dodge, attack power, mana per 5 and the like aren't stats in 1.12: an item gives them as an Equip effect, one of the client's spells. Pick the bonus and its amount; it goes into a free effect slot
		(the Effects tab holds all five).
	</p>
	{#if error}<p class="error">{error}</p>{/if}
	<ul aria-label="Equip effects">
		{#each equips as i (i)}
			{@const id = Number(values[`spellid_${i}`])}
			<li>
				<RefIcon kind="spell" {id} />
				<span class="text">{texts[id] ?? `Spell ${id}`}</span>
				<span class="dim">{bonusOf.get(id) ?? ''} · spell {id}, effect {i}</span>
				<button onclick={() => remove(i)} title="Empty effect slot {i}">Remove</button>
			</li>
		{:else}
			<li class="dim">No Equip effects yet.</li>
		{/each}
	</ul>
	<div class="add">
		<select bind:value={kindId} aria-label="Bonus" disabled={!list.length}>
			{#each list as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
		</select>
		<select bind:value={spell} aria-label="Amount" disabled={!kind}>
			{#each kind?.amounts ?? [] as a (a.spell)}<option value={a.spell}>+{a.amount}{kind.unit}</option>{/each}
		</select>
		<button class="active" disabled={!free || !spell} onclick={add} title={free ? `Into effect slot ${free}, as Equip` : 'All five effect slots are used: empty one first'}>Add bonus</button>
	</div>
	{#if !free}<p class="dim">All five effect slots are used: remove one, or empty one on the Effects tab.</p>{/if}
	{#if !list.length && !error}<p class="dim">Reading the client's bonus spells…</p>{/if}
</div>

<style>
	.bonuses {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 12px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	li {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 8px;
		padding: 4px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	li.dim {
		display: block;
		border: none;
		padding: 0;
	}
	.text {
		color: #00ff00;
	}
	.add {
		display: flex;
		gap: 6px;
	}
	.add select:first-child {
		flex: 2;
		min-width: 0;
	}
	.add select {
		flex: 1;
		min-width: 0;
	}
	.dim {
		color: var(--text-dim);
		margin: 0;
	}
	.error {
		color: var(--danger-text);
		margin: 0;
	}
</style>
