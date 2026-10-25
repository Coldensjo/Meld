<script lang="ts">
	import { editor, setStatus, ui } from '../lib/state/editor.svelte'
	import { engineRef } from '../lib/state/engineRef'
	import { CreateCreature, ModelAnimations, ReadCreature, SaveCreature, SpawnLook } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { TemplateEditor } from '../lib/ui/templateEditor.svelte'
	import { fieldGroups, withBit } from '../lib/world/creatureFields'
	import { creatureTemplateOf, selectSpawn } from '../lib/world/spawnEdits'
	import { spawnKey } from '../lib/world/SpawnLayer'
	import { levelText, npcRoles, rankName } from '../lib/world/spawnInfo'
	import CreaturePreview from './CreaturePreview.svelte'
	import DisplayPicker, { forgetCreatureDisplays } from './DisplayPicker.svelte'
	import EditorFrame from './EditorFrame.svelte'
	import MessagesTab from './MessagesTab.svelte'
	import QuestsTab from './QuestsTab.svelte'
	import ShopTab from './ShopTab.svelte'
	import SpawnFields from './SpawnFields.svelte'
	import SpellsTab from './SpellsTab.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The creature editor: one creature full screen. The left shows it big and animated; the right
	// edits the spawn it was opened from (each change an undo step, saved with the region's spawns)
	// and its creature template, every column of creature_template, saved to the world database with
	// Save. A new creature starts here too, from scratch or as a copy.

	type Tab = 'spawn' | 'creature' | 'looks' | 'spells' | 'shop' | 'quests' | 'messages'

	const target = $derived(ui.creatureEditor)
	/** The spawn the editor was opened from, as the panel's copy of it; null once another is selected. */
	const spawn = $derived(target?.key && editor.selectedSpawn && spawnKey(editor.selectedSpawn) === target.key ? editor.selectedSpawn : null)

	let tab = $state<Tab>('creature')

	/** Unsaved edits in the Spells, Shop, Quests and Messages tabs, which have their own Save. */
	let spellsDirty = $state(false)
	let shopDirty = $state(false)
	let questsDirty = $state(false)
	let messagesDirty = $state(false)
	const tabsDirty = $derived(spellsDirty || shopDirty || questsDirty || messagesDirty)
	let spellsTab = $state<SpellsTab | null>(null)
	let shopTab = $state<ShopTab | null>(null)
	let questsTab = $state<QuestsTab | null>(null)
	let messagesTab = $state<MessagesTab | null>(null)

	// Opening another creature reads its template and picks the first tab.
	const ed = new TemplateEditor<{ key: string | null; entry: number }, vmangos.TemplateRecord>({
		id: (t) => `${t.key}|${t.entry}`,
		entry: (t) => t.entry,
		read: ReadCreature,
		clear: () => (ui.creatureEditor = null),
		dirty: () => tabsDirty,
		onopen: (t) => {
			tab = t.key ? 'spawn' : 'creature'
			spellsDirty = false
			shopDirty = false
			questsDirty = false
			messagesDirty = false
			copying = false
		},
		// The tabs read their rows again, so a switch that keeps them mounted (another spawn of the same creature) shows no stale edits.
		ondiscard: () => {
			if (spellsDirty) spellsTab?.revert()
			if (shopDirty) shopTab?.revert()
			if (questsDirty) questsTab?.revert()
			if (messagesDirty) messagesTab?.revert()
		},
	})
	ed.follow(() => target)
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	const changeCount = $derived(ed.changeCount)
	const groups = $derived(record ? fieldGroups(record.columns.map((c) => c.name)) : [])
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))

	// What the preview shows: the spawn as it is placed on its tab, else the template's first display
	// with its equipment, standing.
	let templateLook = $state<vmangos.LookResult | null>(null)
	const firstDisplay = $derived.by(() => {
		for (let i = 1; i <= 4; i++) {
			const d = Number(values[`display_id${i}`]) || 0
			if (d > 0) return { display: d, scale: Number(values[`display_scale${i}`]) || 1 }
		}
		return { display: 0, scale: 1 }
	})
	$effect(() => {
		const d = firstDisplay.display
		const eq = Number(values.equipment_id) || 0
		if (!record) return
		const current = () => firstDisplay.display === d && (Number(values.equipment_id) || 0) === eq
		SpawnLook(d, eq, 0, 0, 1)
			.then((l) => current() && (templateLook = l))
			.catch(() => current() && (templateLook = null))
	})
	// The display slot (1-4, or 0 for the mount) a click in the Looks picker fills, and the display under the pointer.
	let slot = $state(1)
	let hoveredDisplay = $state<vmangos.DisplayEntry | null>(null)
	const usingSpawn = $derived(tab === 'spawn' && spawn !== null)
	const preview = $derived(
		!target || target.entry <= 0
			? null
			: tab === 'looks' && hoveredDisplay
				? { model: hoveredDisplay.model, look: hoveredDisplay.look, anim: 0, scale: hoveredDisplay.scale }
				: usingSpawn && spawn
					? { model: spawn.model, look: spawn.look, anim: spawn.anim, scale: spawn.scale }
					: templateLook
						? { model: templateLook.model, look: templateLook.look, anim: templateLook.anim, scale: firstDisplay.scale * (templateLook.displayScale || 1) }
						: null,
	)

	// The model's animations, for watching it walk, fight or die. Null plays the pose's own.
	let anims = $state<vmangos.AnimInfo[]>([])
	let anim = $state<number | null>(null)
	let animsFor = ''
	$effect(() => {
		const m = preview?.model ?? ''
		if (m === animsFor) return
		animsFor = m
		anim = null
		anims = []
		if (m && !m.toLowerCase().endsWith('.wmo')) {
			ModelAnimations(m)
				.then((a) => animsFor === m && (anims = a ?? []))
				.catch(() => animsFor === m && (anims = []))
		}
	})

	const unsavedText = $derived(
		[
			changeCount ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'} to the creature` : '',
			spellsDirty ? 'unsaved changes to the spells' : '',
			shopDirty ? 'unsaved changes to the shop' : '',
			questsDirty ? 'unsaved changes to the quests' : '',
			messagesDirty ? 'unsaved changes to the messages' : '',
		]
			.filter(Boolean)
			.join(', ') + '.',
	)

	function save() {
		const r = record
		if (!r || changeCount === 0) return
		void ed.save('Saving the creature', async () => {
			const before = { ...saved }
			await SaveCreature(r.entry, r.patch, changes)
			forgetCreatureDisplays()
			ed.markSaved()
			await engineRef.current?.applyCreatureTemplate(r.entry, values, before)
			setStatus(`Saved ${values.name} (entry ${r.entry}) to the world database. Restart the world server and the game to see it in the game.`, 10000)
		})
	}

	/** The greeting was saved: the database now has the creature's gossip menu and Gossip flag. */
	function greetingSaved(menuId: number) {
		for (const v of [values, saved]) {
			v.gossip_menu_id = String(menuId)
			v.npc_flags = withBit(v.npc_flags ?? '0', 0x1, true)
		}
	}

	/** The spells were saved: the database now has the creature's spell list (0 for none). */
	function spellsSaved(listId: number) {
		for (const v of [values, saved]) v.spell_list_id = String(listId)
	}

	function place() {
		if (!record) return
		ui.placeCreature = creatureTemplateOf(record.entry, values)
		editor.tool = 'select'
		ed.close(true)
		setStatus(`Click the ground to place ${values.name}. Shift+click places more; Esc stops.`, 10000)
	}

	// A new creature opens the guide (CreaturesWorkspace); a copy of the open creature is made here.
	function startNew() {
		ed.leave(() => {
			ed.close(true)
			ui.creatures = true
		})
	}
	/** A pool mate or formation member was picked: the editor moves to it, once unsaved changes are dealt with. */
	function switchTo(o: vmangos.WorldSpawn) {
		ed.leave(() => {
			selectSpawn(o)
			ui.creatureEditor = { key: spawnKey(o), entry: o.entry }
		})
	}
	let copying = $state(false)
	let copyName = $state('')
	let creating = $state(false)
	function startCopy() {
		copyName = `${saved.name ?? ''} (copy)`
		copying = true
	}
	async function copyCreature() {
		const name = copyName.trim()
		if (!name || !record) return
		creating = true
		ed.error = ''
		try {
			const entry = await CreateCreature(record.entry, name)
			forgetCreatureDisplays()
			copying = false
			ui.creatureEditor = { key: null, entry }
			setStatus(`Copied to creature ${entry}, ${name}. Edit it, save, then place it.`, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}

	// Looks: the display picker. A click puts the display in slot `slot` (1-4), or in mount_display_id
	// for slot 0 (#699); hovering a tile shows it in the preview until the pointer leaves.
	function useDisplay(d: vmangos.DisplayEntry) {
		const n = slot
		if (n === 0) {
			values.mount_display_id = String(d.id)
			return
		}
		values[`display_id${n}`] = String(d.id)
		if (!(Number(values[`display_scale${n}`]) > 0)) values[`display_scale${n}`] = '1'
		if (!(Number(values[`display_probability${n}`]) > 0)) values[`display_probability${n}`] = '100'
		let total = 0
		for (let i = 1; i <= 4; i++) if (Number(values[`display_id${i}`]) > 0) total += Number(values[`display_probability${i}`]) || 0
		values.display_total_probability = String(total)
	}

	function setField(col: string, v: string) {
		values[col] = v
	}
</script>

{#if target}
	<EditorFrame {ed} label="Creature editor" z={150} {unsavedText} blocked={() => !!ui.questEditor}>
		{#snippet title()}
			{#if target.entry > 0}
				<h2>{values.name || saved.name || 'Creature'}{values.subname ? ` <${values.subname}>` : ''}</h2>
				<span class="dim">
					entry {target.entry}{spawn ? ` · spawn ${spawn.guid}` : ''}
					{#if record}
						· level {levelText(Number(values.level_min), Number(values.level_max))} · {rankName(Number(values.rank))}{npcRoles(Number(values.npc_flags)) ? ` · ${npcRoles(Number(values.npc_flags))}` : ''}
					{/if}
				</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if record}
				<button disabled={!record || ed.saving} onclick={place} title="Place this creature in the region">Place in world</button>
				<button disabled={!record || ed.saving || copying} onclick={startCopy} title="Make a new creature with this one's looks, stats, loot and AI">Copy this creature</button>
				<button disabled={changeCount === 0 || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={changeCount === 0 || ed.saving} onclick={save}>
					{ed.saving ? 'Saving…' : changeCount ? `Save creature (${changeCount})` : 'Saved'}
				</button>
			{/if}
		{/snippet}
		{#snippet bars()}
			{#if copying}
				<div class="bar warn">
					<input type="text" maxlength="100" placeholder="Name of the copy" bind:value={copyName} onkeydown={(e) => e.key === 'Enter' && copyCreature()} />
					<button class="active" disabled={!copyName.trim() || creating} onclick={copyCreature}>{creating ? 'Copying…' : 'Make copy'}</button>
					<button onclick={() => (copying = false)}>Cancel</button>
				</div>
			{/if}
		{/snippet}

		<div class="body">
			<section class="left">
				{#if preview}
					<CreaturePreview model={preview.model} look={preview.look} anim={anim ?? preview.anim} scale={preview.scale} />
				{:else}
					<div class="empty dim">{ed.loading ? 'Loading…' : 'No display to show yet: pick one under Looks.'}</div>
				{/if}
				<div class="under">
					<label
						>Animation
						<select
							value={anim ?? -1}
							onchange={(e) => {
								const v = Number((e.currentTarget as HTMLSelectElement).value)
								anim = v < 0 ? null : v
							}}
						>
							<option value={-1}>Its pose{usingSpawn ? ' (as placed)' : ''}</option>
							{#each anims as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
						</select>
					</label>
					<span class="dim">{tab === 'looks' && hoveredDisplay ? `Showing display ${hoveredDisplay.id}.` : usingSpawn ? 'Showing this spawn as placed.' : 'Showing the creature template: its first display and equipment.'}</span>
				</div>
			</section>

			<section class="right">
				<nav class="tabs">
					{#if spawn}<button class:on={tab === 'spawn'} onclick={() => (tab = 'spawn')}>This spawn</button>{/if}
					{#if record}
						<button class:on={tab === 'creature'} onclick={() => (tab = 'creature')}>Creature</button>
						<button class:on={tab === 'looks'} onclick={() => (tab = 'looks')}>Looks</button>
						<button class:on={tab === 'spells'} onclick={() => (tab = 'spells')}>Spells</button>
						<button class:on={tab === 'shop'} onclick={() => (tab = 'shop')}>Shop</button>
						<button class:on={tab === 'quests'} onclick={() => (tab = 'quests')}>Quests</button>
						<button class:on={tab === 'messages'} onclick={() => (tab = 'messages')}>Messages</button>
					{/if}
					<button onclick={startNew} title="Open the creature guide">New creature</button>
				</nav>

				<div class="scroll">
					{#if tab === 'spawn' && spawn}
						<SpawnFields s={spawn} onswitch={switchTo} />
						<p class="dim hint">Changes to this spawn are undo steps and are saved with the region's spawns (File › Save Spawns to Database…). Edit the path in the world: close the editor, then Edit path.</p>
					{:else if tab === 'spells' || tab === 'shop' || tab === 'quests' || tab === 'messages'}
						<!-- The Spells, Shop, Quests and Messages tabs stay mounted below, so their unsaved edits survive a tab switch. -->
					{:else if tab === 'looks' && record}
						<div class="slot">
							<span>A click sets</span>
							<select bind:value={slot}>
								{#each [1, 2, 3, 4] as n (n)}<option value={n}>display {n}{Number(values[`display_id${n}`]) > 0 ? ` (now ${values[`display_id${n}`]})` : ''}</option>{/each}
								{#if 'mount_display_id' in values}<option value={0}>the mount{Number(values.mount_display_id) > 0 ? ` (now ${values.mount_display_id})` : ''}</option>{/if}
							</select>
							<span class="dim">Hover a tile to see it big on the left.</span>
						</div>
						<DisplayPicker selected={Number(values[slot === 0 ? 'mount_display_id' : `display_id${slot}`]) || 0} onpick={useDisplay} onhover={(d) => (hoveredDisplay = d)} />
						<h3>Displays</h3>
						{#each groups.filter((g) => g.title === 'Looks') as g (g.title)}
							<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={setField} entry={record.entry} />
						{/each}
					{:else if record}
						{#each groups.filter((g) => g.title !== 'Looks') as g (g.title)}
							<h3>{g.title}</h3>
							<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={setField} entry={record.entry} />
						{/each}
					{:else if ed.loading}
						<p class="dim">Loading the creature…</p>
					{/if}
					{#if record && target.entry > 0}
						<div hidden={tab !== 'spells'}>
							<SpellsTab bind:this={spellsTab} entry={record.entry} onsaved={spellsSaved} bind:dirty={spellsDirty} />
						</div>
						<div hidden={tab !== 'shop'}>
							<ShopTab bind:this={shopTab} entry={record.entry} npcFlags={Number(values.npc_flags) || 0} onvendorflag={() => (values.npc_flags = withBit(values.npc_flags ?? '0', 0x4, true))} bind:dirty={shopDirty} />
						</div>
						<div hidden={tab !== 'quests'}>
							<QuestsTab
								bind:this={questsTab}
								entry={record.entry}
								name={saved.name || values.name || ''}
								ready={((Number(values.npc_flags) || 0) & 0x2) !== 0}
								onquestflag={() => (values.npc_flags = withBit(values.npc_flags ?? '0', 0x2, true))}
								bind:dirty={questsDirty}
							/>
						</div>
						<div hidden={tab !== 'messages'}>
							<MessagesTab bind:this={messagesTab} entry={record.entry} onsaved={greetingSaved} bind:dirty={messagesDirty} />
						</div>
					{/if}
				</div>
			</section>
		</div>
	</EditorFrame>
{/if}

<style>
	.left {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.under {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 12px;
	}
	.under label {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.right {
		/* One width on every tab, so the preview beside it never moves. */
		flex: none;
		width: min(560px, calc(45 * var(--vw)));
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--panel);
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h3 {
		margin: 8px 0 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
	}
	.hint {
		margin: 0;
		font-size: 11px;
	}
</style>
