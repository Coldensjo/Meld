<script lang="ts">
	import { idMenu, idOf } from '../lib/ui/copyId'
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { leaveField, takeEscape } from '../lib/state/escape'
	import { ClassLevelStats, CreateCreature, EquipmentFor, Factions, ReadCreature, SaveCreature, SearchCreatures, SpawnLook } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { untrack } from 'svelte'
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { askConfirm } from '../lib/state/confirm'
	import { creatureTemplateOf } from '../lib/world/spawnEdits'
	import { CREATURE_TYPES, levelText, NPC_FLAGS, RANKS } from '../lib/world/spawnInfo'
	import ClassIcon from './ClassIcon.svelte'
	import CreaturePreview from './CreaturePreview.svelte'
	import DisplayPicker, { forgetCreatureDisplays } from './DisplayPicker.svelte'
	import ItemIcon from './ItemIcon.svelte'
	import WeaponPicker, { loadWeapons, SLOTS } from './WeaponPicker.svelte'

	// The Creatures workspace (#132, World › Creatures…): the world database's creatures to find and
	// open in the creature editor, and a guide that makes a new one step by step: who it is, whom it
	// fights, how it looks, how strong it is. The guide writes the creature_template row at the end
	// (CreateCreature, then SaveCreature with the choices), so nothing is written until Make creature.

	type Reaction = 'friendly' | 'neutral' | 'hostile'
	type Draft = {
		name: string
		subname: string
		npcFlags: number
		type: number
		levelMin: number
		levelMax: number
		rank: number
		faction: number
		display: number
		scale: number
		items: [number, number, number]
		unitClass: number
		healthMul: number
		damageMul: number
		armorMul: number
	}

	const STEPS = ['Who it is', 'Whom it fights', 'How it looks', 'How strong it is', 'Make it']
	/** The roles the guide offers (npc_flags), the common ones of NPC_FLAGS. */
	const ROLES = NPC_FLAGS.filter(([bit]) => [0x1, 0x2, 0x4, 0x8, 0x10, 0x80, 0x100, 0x1000, 0x2000, 0x4000].includes(bit))
	const CLASSES: Array<[number, string, string]> = [
		[1, 'Warrior', 'no mana; the most health and armour'],
		[2, 'Paladin', 'health and some mana'],
		[4, 'Rogue', 'less armour'],
		[8, 'Mage', 'mana, the least health'],
	]
	/** Suggested multipliers by rank (health, damage, armour), set when the rank changes. */
	const RANK_MULS: Record<number, [number, number, number]> = { 0: [1, 1, 1], 1: [3, 2, 1], 2: [3, 2, 1], 3: [10, 4, 1.5], 4: [1.5, 1.2, 1] }
	/** Whom it fights: each choice is a pair of reactions to an Alliance and a Horde player. */
	const SIDES: Array<{ label: string; alliance: Reaction; horde: Reaction }> = [
		{ label: 'Friendly to both sides', alliance: 'friendly', horde: 'friendly' },
		{ label: 'Alliance (attacks the Horde)', alliance: 'friendly', horde: 'hostile' },
		{ label: 'Horde (attacks the Alliance)', alliance: 'hostile', horde: 'friendly' },
		{ label: 'Neutral (fights back when attacked)', alliance: 'neutral', horde: 'neutral' },
		{ label: 'Hostile to everyone', alliance: 'hostile', horde: 'hostile' },
	]

	const fresh = (): Draft => ({ name: '', subname: '', npcFlags: 0, type: 7, levelMin: 1, levelMax: 1, rank: 0, faction: 35, display: 0, scale: 1, items: [0, 0, 0], unitClass: 1, healthMul: 1, damageMul: 1, armorMul: 1 })

	let draft = $state<Draft>(fresh())
	let step = $state(0)
	let error = $state('')
	let making = $state(false)
	let made = $state<{ entry: number; values: Record<string, string> } | null>(null)

	async function close() {
		if (step > 0 && !made && draft.name && !(await askConfirm('Leave the guide? The creature is not made yet.', { title: 'Leave the guide', ok: 'Leave' }))) return
		ui.creatures = false
	}

	// Opening the guide after a creature was made starts a new one on step 1; a draft still in progress is kept.
	$effect(() => {
		if (ui.creatures && untrack(() => made)) untrack(restart)
	})

	function restart() {
		draft = fresh()
		step = 0
		made = null
		error = ''
	}

	// Finding a creature: by name or entry, opened in the creature editor.
	let query = $state('')
	let found = $state<vmangos.CreatureTemplate[]>([])
	let timer = 0
	$effect(() => {
		const q = query.trim()
		clearTimeout(timer)
		if (!q) {
			found = []
			return
		}
		timer = window.setTimeout(() => {
			SearchCreatures(q)
				.then((r) => q === query.trim() && (found = r ?? []))
				.catch((err) => (error = String(err)))
		}, 250)
	})
	function open(entry: number) {
		ui.creatures = false
		ui.creatureEditor = { key: null, entry }
	}

	// Step 2: the factions, read once.
	let factions = $state<vmangos.FactionInfo[]>([])
	let side = $state(0)
	let factionQuery = $state('')
	let factionsAsked = false
	$effect(() => {
		if (!ui.creatures || factionsAsked) return
		factionsAsked = true
		Factions()
			.then((f) => (factions = f ?? []))
			.catch((err) => (error = String(err)))
	})
	const sideFactions = $derived(factions.filter((f) => offered(f) && f.alliance === SIDES[side].alliance && f.horde === SIDES[side].horde && (!factionQuery.trim() || f.name.toLowerCase().includes(factionQuery.trim().toLowerCase()))))
	/** A faction a creature can take: named, and not one of the players' own (PLAYER, Human …). */
	const offered = (f: vmangos.FactionInfo) => f.name !== '' && !f.name.startsWith('PLAYER')
	const pickedFaction = $derived(factions.find((f) => f.id === draft.faction) ?? null)
	function chooseSide(i: number) {
		side = i
		const first = factions.find((f) => offered(f) && f.alliance === SIDES[i].alliance && f.horde === SIDES[i].horde)
		if (first && !(pickedFaction && pickedFaction.alliance === SIDES[i].alliance && pickedFaction.horde === SIDES[i].horde)) draft.faction = first.id
	}

	// Step 3: the look shown, the picked display dressed in the picked gear.
	let hovered = $state<vmangos.DisplayEntry | null>(null)
	let slot = $state(0)
	// The names and displays of the holdable items, for the gear's names and icons (read once).
	let weaponNames = $state<Map<number, string>>(new Map())
	let weaponDisplays = $state<Map<number, number>>(new Map())
	loadWeapons()
		.then((list) => {
			weaponNames = new Map(list.map((w) => [w.entry, w.name]))
			weaponDisplays = new Map(list.map((w) => [w.entry, w.display]))
		})
		.catch(() => {})
	const itemName = (entry: number) => (weaponNames.get(entry) ?? `Item ${entry}`).replace(/^monster\s*-\s*/i, '')

	let equipment = $state(0)
	let look = $state<vmangos.LookResult | null>(null)
	$effect(() => {
		const items = draft.items
		if (!items.some((i) => i > 0)) {
			equipment = 0
			return
		}
		EquipmentFor([...items])
			.then((id) => (equipment = id))
			.catch(() => (equipment = 0))
	})
	$effect(() => {
		const d = draft.display
		const eq = equipment
		if (!d) {
			look = null
			return
		}
		SpawnLook(d, eq, 0, 0, 1)
			.then((l) => (look = l))
			.catch(() => (look = null))
	})
	const preview = $derived(hovered ? { model: hovered.model, look: hovered.look, scale: hovered.scale * draft.scale } : look ? { model: look.model, look: look.look, scale: draft.scale * (look.displayScale || 1) } : null)

	// Step 4: what the server gives the class at the level range, times the multipliers.
	let stats = $state<vmangos.ClassLevelStats[]>([])
	$effect(() => {
		if (!ui.creatures) return
		const c = draft.unitClass,
			a = draft.levelMin,
			b = Math.max(draft.levelMin, draft.levelMax)
		ClassLevelStats(c, a, b)
			.then((s) => (stats = s ?? []))
			.catch(() => (stats = []))
	})
	const statRows = $derived(stats.length ? [stats[0], stats[stats.length - 1]].filter((s, i, all) => i === 0 || s.level !== all[0].level) : [])
	function setRank(r: number) {
		draft.rank = r
		;[draft.healthMul, draft.damageMul, draft.armorMul] = RANK_MULS[r] ?? [1, 1, 1]
	}

	const stepOk = $derived([
		draft.name.trim() !== '' && draft.levelMin >= 1 && draft.levelMax >= draft.levelMin && draft.levelMax <= 63,
		draft.faction > 0,
		draft.display > 0,
		draft.healthMul > 0 && draft.damageMul >= 0 && draft.armorMul >= 0,
		true,
	])

	/** The creature_template values the guide's choices come to. */
	function values(): Record<string, string> {
		const d = draft
		return {
			name: d.name.trim(),
			subname: d.subname.trim(),
			npc_flags: String(d.npcFlags),
			type: String(d.type),
			level_min: String(d.levelMin),
			level_max: String(Math.max(d.levelMin, d.levelMax)),
			rank: String(d.rank),
			faction: String(d.faction),
			display_id1: String(d.display),
			display_scale1: String(d.scale),
			display_probability1: '100',
			display_total_probability: '100',
			unit_class: String(d.unitClass),
			health_multiplier: String(d.healthMul),
			damage_multiplier: String(d.damageMul),
			armor_multiplier: String(d.armorMul),
			equipment_id: String(equipment),
		}
	}

	async function make() {
		making = true
		error = ''
		try {
			const v = values()
			const entry = await CreateCreature(0, v.name)
			const rec = await ReadCreature(entry)
			await SaveCreature(entry, rec.patch, v)
			forgetCreatureDisplays()
			made = { entry, values: { ...rec.values, ...v } }
			setStatus(`Made creature ${entry}, ${v.name}. Restart the world server to see it in the game.`, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			making = false
		}
	}

	function place() {
		if (!made) return
		ui.placeCreature = creatureTemplateOf(made.entry, made.values)
		editor.tool = 'select'
		ui.creatures = false
		setStatus(`Click the ground to place ${made.values.name}. Shift+click places more; Esc stops.`, 10000)
	}

	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value) || 0
	const toggleRole = (bit: number, on: boolean) => (draft.npcFlags = on ? draft.npcFlags | bit : draft.npcFlags & ~bit)
	const chip = (r: string) => (r === 'friendly' ? 'ok' : r === 'hostile' ? 'bad' : 'mid')

	let root = $state<HTMLElement>()

	function onKey(e: KeyboardEvent) {
		if (!ui.creatures || e.key !== 'Escape' || !takeEscape(e, root)) return
		if (leaveField(e)) return
		e.preventDefault()
		void close()
	}
</script>

<svelte:window onkeydown={onKey} />

{#if ui.creatures}
	<div class="ws" role="dialog" aria-modal="true" aria-label="Creatures" bind:this={root} use:dialogFocus>
		<header>
			<h2>Creatures</h2>
			<span class="dim">Find a creature to edit, or make a new one step by step.</span>
			<button onclick={close} title="Close (Esc)">Close</button>
		</header>
		{#if error}<div class="bar error">{error}</div>{/if}
		<div class="body">
			<aside>
				<h3>Find</h3>
				<input type="search" placeholder="Name or entry" bind:value={query} />
				<ul class="found">
					{#each found as c (c.entry)}
						<li>
							<button onclick={() => open(c.entry)} use:idMenu={{ ids: [idOf('creature', c.entry)], name: c.name }} title="Open in the creature editor">
								<span>{c.name}{c.subname ? ` <${c.subname}>` : ''}</span>
								<span class="dim">{c.entry} · level {levelText(c.levelMin, c.levelMax)}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{query.trim() ? 'No creature matches.' : 'Type a name to search the world database.'}</li>
					{/each}
				</ul>
			</aside>

			<section class="guide">
				<ol class="steps">
					{#each STEPS as s, i (s)}
						<li class:on={i === step} class:done={i < step || made}>
							<button disabled={!!made || (i > step && !stepOk.slice(0, i).every(Boolean))} onclick={() => (step = i)}>{i + 1}. {s}</button>
						</li>
					{/each}
				</ol>

				<div class="page">
					{#if step === 0}
						<p class="dim">Its name over its head, the line under it, what it does for players, and how strong it is.</p>
						<div class="form">
							<label>Name <input maxlength="100" bind:value={draft.name} placeholder="Gregor the Smith" /></label>
							<label>Title under the name <input maxlength="100" bind:value={draft.subname} placeholder="Blacksmith (optional)" /></label>
							<fieldset>
								<legend>What it does for players</legend>
								{#each ROLES as [bit, name] (bit)}
									<label class="check"><input type="checkbox" checked={(draft.npcFlags & bit) !== 0} onchange={(e) => toggleRole(bit, e.currentTarget.checked)} /> {name[0].toUpperCase() + name.slice(1)}</label>
								{/each}
							</fieldset>
							<label
								>Kind of creature
								<select bind:value={draft.type}>
									{#each CREATURE_TYPES as t, i (i)}{#if i > 0 && t}<option value={i}>{t}</option>{/if}{/each}
								</select></label
							>
							<span class="row">
								<label>Level from <input type="number" min="1" max="63" value={draft.levelMin} oninput={(e) => (draft.levelMin = num(e))} /></label>
								<label>to <input type="number" min="1" max="63" value={draft.levelMax} oninput={(e) => (draft.levelMax = num(e))} /></label>
							</span>
							<label
								>Rank
								<select value={draft.rank} onchange={(e) => setRank(Number(e.currentTarget.value))}>
									{#each RANKS as r, i (i)}<option value={i}>{r}</option>{/each}
								</select></label
							>
						</div>
					{:else if step === 1}
						<p class="dim">How it treats players of each side. The faction also decides which guards help it.</p>
						<div class="sides">
							{#each SIDES as s, i (s.label)}
								<label class="check"><input type="radio" name="side" checked={side === i} onchange={() => chooseSide(i)} /> {s.label}</label>
							{/each}
						</div>
						<input type="search" placeholder="Filter factions by name" bind:value={factionQuery} />
						<ul class="factions">
							{#each sideFactions as f (f.id)}
								<li>
									<label class="check"><input type="radio" name="faction" checked={draft.faction === f.id} onchange={() => (draft.faction = f.id)} /> {f.name} <span class="dim">{f.id}</span></label>
								</li>
							{:else}
								<li class="dim">{factions.length ? 'No faction of that side matches.' : 'Reading the factions…'}</li>
							{/each}
						</ul>
						{#if pickedFaction}
							<p>
								{pickedFaction.name} ({pickedFaction.id}): <span class={chip(pickedFaction.alliance)}>{pickedFaction.alliance} to the Alliance</span>,
								<span class={chip(pickedFaction.horde)}>{pickedFaction.horde} to the Horde</span>.
							</p>
						{/if}
					{:else if step === 2}
						<div class="looks">
							<div class="pick">
								<p class="dim">Pick its body (a display); hover a tile to see it on the right.</p>
								<DisplayPicker selected={draft.display} onpick={(d) => (draft.display = d.id)} onhover={(d) => (hovered = d)} />
								<h3>Held items</h3>
								<span class="row">
									<select bind:value={slot}>
										{#each SLOTS as s, i (s)}<option value={i}>{s}{draft.items[i] ? ` (${itemName(draft.items[i])})` : ''}</option>{/each}
									</select>
									{#if draft.items[slot]}<ItemIcon displayId={weaponDisplays.get(draft.items[slot]) ?? 0} size={14} />{/if}
									<button disabled={!draft.items[slot]} onclick={() => (draft.items[slot] = 0)}>Empty hand</button>
								</span>
								<WeaponPicker which={slot} selected={draft.items[slot]} onpick={(e) => (draft.items[slot] = e)} />
							</div>
							<div class="show">
								{#if preview}
									<CreaturePreview model={preview.model} look={preview.look} anim={0} scale={preview.scale} />
								{:else}
									<div class="empty dim">No display picked yet.</div>
								{/if}
								<label>Size <input type="number" min="0.1" max="10" step="0.1" value={draft.scale} oninput={(e) => (draft.scale = Math.max(0.1, num(e)))} /></label>
							</div>
						</div>
					{:else if step === 3}
						<p class="dim">The server gives a creature its health, damage and armour from its class and level; the multipliers make it tougher or weaker. The rank set them; change them as you like.</p>
						<div class="sides">
							{#each CLASSES as [v, name, what] (v)}
								<label class="check"><input type="radio" name="class" checked={draft.unitClass === v} onchange={() => (draft.unitClass = v)} /><ClassIcon id={v} /> {name} <span class="dim">({what})</span></label>
							{/each}
						</div>
						<span class="row">
							<label>Health × <input type="number" min="0.01" step="0.1" value={draft.healthMul} oninput={(e) => (draft.healthMul = num(e))} /></label>
							<label>Damage × <input type="number" min="0" step="0.1" value={draft.damageMul} oninput={(e) => (draft.damageMul = num(e))} /></label>
							<label>Armour × <input type="number" min="0" step="0.1" value={draft.armorMul} oninput={(e) => (draft.armorMul = num(e))} /></label>
						</span>
						<table>
							<thead><tr><th>Level</th><th>Health</th><th>Mana</th><th>Damage a hit</th><th>Armour</th></tr></thead>
							<tbody>
								{#each statRows as s (s.level)}
									<tr>
										<td>{s.level}</td>
										<td>{Math.round(s.health * draft.healthMul)}</td>
										<td>{s.mana}</td>
										<td>{Math.round(s.meleeDamage * draft.damageMul)}</td>
										<td>{Math.round(s.armor * draft.armorMul)}</td>
									</tr>
								{:else}
									<tr><td colspan="5" class="dim">The server has no stats for this class and level.</td></tr>
								{/each}
							</tbody>
						</table>
					{:else}
						{#if made}
							<p>Made <b>{draft.name}</b>, entry {made.entry}. It is in the world database; restart the world server for the game to know it.</p>
							<span class="row">
								<button class="active" onclick={place}>Place in world</button>
								<button onclick={() => made && open(made.entry)}>Open in the creature editor</button>
								<button onclick={restart}>Make another</button>
							</span>
						{:else}
							<p class="dim">Check it over, then make it. It gets the first free entry.</p>
							<dl>
								<dt>Name</dt>
								<dd>{draft.name}{draft.subname ? ` <${draft.subname}>` : ''}</dd>
								<dt>Does</dt>
								<dd>
									{ROLES.filter(([b]) => draft.npcFlags & b)
										.map(([, n]) => n)
										.join(', ') || 'nothing for players'}
								</dd>
								<dt>Level</dt>
								<dd>{levelText(draft.levelMin, Math.max(draft.levelMin, draft.levelMax))}, {RANKS[draft.rank]}, {CREATURE_TYPES[draft.type]}</dd>
								<dt>Faction</dt>
								<dd>{pickedFaction ? `${pickedFaction.name} (${pickedFaction.id}): ${pickedFaction.alliance} to the Alliance, ${pickedFaction.horde} to the Horde` : draft.faction}</dd>
								<dt>Looks</dt>
								<dd>
									display {draft.display}, size {draft.scale}{#if draft.items.some((i) => i)}, holding
										{#each draft.items.filter((i) => i) as it, n (n)}{n ? ', ' : ''}<ItemIcon displayId={weaponDisplays.get(it) ?? 0} size={14} /> {itemName(it)}{/each}{/if}
								</dd>
								<dt>Strength</dt>
								<dd>{CLASSES.find(([v]) => v === draft.unitClass)?.[1]}, health ×{draft.healthMul}, damage ×{draft.damageMul}, armour ×{draft.armorMul}</dd>
							</dl>
						{/if}
					{/if}
				</div>

				{#if !made}
					<footer>
						<button disabled={step === 0} onclick={() => step--}>Back</button>
						{#if step < STEPS.length - 1}
							<button class="active" disabled={!stepOk[step]} onclick={() => step++}>Next</button>
						{:else}
							<button class="active" disabled={making || !stepOk.every(Boolean)} onclick={make}>{making ? 'Making…' : 'Make creature'}</button>
						{/if}
					</footer>
				{/if}
			</section>
		</div>
	</div>
{/if}

<style>
	.ws {
		position: fixed;
		inset: 0;
		z-index: 140;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	header .dim {
		flex: 1;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	h3 {
		margin: 8px 0 4px;
		font-size: 13px;
	}
	.dim {
		color: var(--text-dim);
	}
	.bar.error {
		padding: 8px 16px;
		color: var(--danger-text);
		border-bottom: 1px solid var(--border);
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	aside {
		width: 300px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-right: 1px solid var(--border);
		background: var(--panel);
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		flex: 1;
	}
	.found button {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		background: transparent;
		border: none;
		padding: 4px 6px;
		text-align: left;
	}
	.found button:hover {
		background: var(--panel-2);
	}
	.found .dim {
		font-size: 11px;
	}
	.guide {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.steps {
		display: flex;
		gap: 4px;
		list-style: none;
		margin: 0;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
	}
	.steps button {
		background: transparent;
		border: none;
		color: var(--text-dim);
	}
	.steps li.done button {
		color: var(--text);
	}
	.steps li.on button {
		color: var(--text-strong);
		background: var(--panel-3);
	}
	.page {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	p {
		margin: 0;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 520px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	fieldset {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.row {
		display: flex;
		gap: 10px;
		align-items: flex-end;
	}
	.row input {
		width: 90px;
	}
	.sides {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.factions {
		list-style: none;
		margin: 0;
		padding: 4px;
		max-height: 260px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.ok {
		color: var(--ok);
	}
	.mid {
		color: var(--warn);
	}
	.bad {
		color: var(--bad);
	}
	.looks {
		display: flex;
		gap: 16px;
		min-height: 520px;
		/* The page is a scrolling flex column: without this the row shrank to 520px and the pickers spilled over what follows. */
		flex: none;
		align-items: flex-start;
	}
	.pick {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.show {
		width: 360px;
		height: 520px;
		flex: none;
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg, transparent);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	table {
		border-collapse: collapse;
		max-width: 560px;
	}
	th,
	td {
		padding: 4px 10px;
		border-bottom: 1px solid var(--border);
		text-align: right;
	}
	th:first-child,
	td:first-child {
		text-align: left;
	}
	dl {
		display: grid;
		grid-template-columns: 90px 1fr;
		gap: 4px 12px;
		margin: 0;
	}
	dt {
		color: var(--text-dim);
	}
	dd {
		margin: 0;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 10px 16px;
		border-top: 1px solid var(--border);
	}
</style>
