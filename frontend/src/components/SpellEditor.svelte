<script lang="ts">
	import { copyItems } from '../lib/ui/copyId'
	import { CreateSpell, ExportSpells, ImportSpells, OpenSpellsDialog, PlanSpellImport, ReadSpell, ReadSpellVisual, SaveSpell, SpellStarters, SpellsWithVisual } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { askImport as planImport, copyCommand, exportRow, runImport } from '../lib/ui/templateIo'
	import { TemplateEditor, checkRefused, tabChangeCounts } from '../lib/ui/templateEditor.svelte'
	import { tabOfColumn } from '../lib/world/questFields'
	import { effectSummary, spellTabs, spellTooltip } from '../lib/world/spellFields'
	import { forgetName, forgetSpellTables, spellTables } from '../lib/wow/refNames'
	import { forgetSpell } from '../lib/wow/spells'
	import EditorFrame from './EditorFrame.svelte'
	import ItemLookPicker from './ItemLookPicker.svelte'
	import SpellIcon from './SpellIcon.svelte'
	import SpellPicker from './SpellPicker.svelte'
	import SpellVisualComposer, { STAGES, loadVisualEffects, stageEffects } from './SpellVisualComposer.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The spell editor (#294, Tools › Spells…): find a spell or make one as a copy of the open one, edit
	// every column of its spell_template row on tabs (the text, casting, levels and rules, and each of
	// its three effects), pick its icon from the client's and take its visual from another spell, and
	// see its tooltip as the game draws it, which follows every change before it is saved. Save writes
	// the row to the world database and the same spell into Spell.dbc in Meld's patch (a new icon into
	// SpellIcon.dbc) at once, or once the game has closed when it runs (#365), so the two agree. Export
	// writes the spell's spell_template rows to an SQL script, and Import reads one back into both (#357).

	const target = $derived(ui.spellEditor)

	let tab = $state('spell')
	/** An icon picked (a name under Interface\Icons), which Save turns into the spell's SpellIcon row. */
	let pendingIcon = $state('')
	/** A visual from the composer (#361), which Save turns into the spell's visual (new kits and a new visual when it is new). */
	let pendingVisual = $state<vmangos.VisualDesign | null>(null)
	/** The composer's working copy while it is open. */
	let composing = $state<vmangos.VisualDesign | null>(null)
	let changing = $state(false)
	let candidate = $state<string | null>(null)
	let hoverPick = $state<string | null>(null)

	// The client's cast times, durations, ranges and radii, read once.
	let tables = $state<vmangos.SpellTables | null>(null)
	$effect(() => {
		if (target && !tables)
			spellTables().then(
				(t) => (tables = t),
				(err) => (ed.error = String(err)),
			)
	})

	const ed = new TemplateEditor<{ entry: number }, vmangos.SpellRecord>({
		id: (t) => String(t.entry),
		entry: (t) => t.entry,
		read: ReadSpell,
		clear: () => (ui.spellEditor = null),
		dirty: () => !!pendingIcon || !!pendingVisual,
		onopen: () => {
			pendingIcon = ''
			pendingVisual = null
			composing = null
			changing = false
		},
		onrevert: () => {
			pendingIcon = ''
			pendingVisual = null
		},
	})
	ed.follow(() => target)
	const record = $derived(ed.record)
	const values = $derived(ed.values)
	const saved = $derived(ed.saved)
	const changes = $derived(ed.changes)
	/** The changed values, and the icon and visual waiting for Save. */
	const changeCount = $derived(ed.changeCount + (pendingIcon ? 1 : 0) + (pendingVisual ? 1 : 0))
	const unsaved = $derived(ed.unsaved)
	const tabs = $derived(
		record
			? spellTabs(
					record.columns.map((c) => c.name),
					tables,
					values,
				)
			: [],
	)
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))
	const tabChanges = $derived(tabChangeCounts(tabs, changes))

	function open(entry: number) {
		if (target?.entry === entry) return
		ed.leave(() => {
			ed.note = ''
			ui.spellEditor = { entry }
		})
	}

	/** Forgets what the session knows of a spell that changed, so names, icons and searches read it again. */
	function forget(entry: number) {
		forgetSpell(entry)
		forgetName('spell', entry)
		searchVersion++
	}

	function save() {
		const rec = record
		if (!rec || !unsaved) return
		void ed.save(
			'Saving the spell',
			async () => {
				const n = changeCount
				const r = checkRefused(await SaveSpell(rec.entry, rec.build, changes, pendingIcon, pendingVisual as vmangos.VisualDesign))
				pendingIcon = ''
				pendingVisual = null
				// Its icon or category may be new: the pickers read the tables again.
				forgetSpellTables()
				values.spellVisual1 = String(r.visual)
				ed.markSaved()
				forget(rec.entry)
				let added = r.iconAdded ? ` Added the icon ${r.iconAdded} to SpellIcon.dbc.` : ''
				if (r.visualAdded) added += ` Added visual ${r.visual} to SpellVisual.dbc (and its new stages to SpellVisualKit.dbc).`
				const note = `Saved ${n} ${n === 1 ? 'change' : 'changes'} to ${values.name} (spell ${rec.entry}) .${added}`
				setStatus(note, 10000)
				// Read it again for its icon's texture and that the client has it now.
				await ed.load(rec.entry)
				ed.note = note
			},
			(col) => (tab = tabOfColumn(tabs, col) ?? tab),
		)
	}

	// Export and import: SQL scripts of spell_template rows; an import writes each spell into Spell.dbc too.
	function exportSpell() {
		if (record) void exportRow(ed, { kind: 'spell', entry: record.entry, name: saved.name, unsaved, write: ExportSpells })
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.SpellImport } | null>(null)
	let importing = $state(false)

	function askImport() {
		planImport(ed, { pick: OpenSpellsDialog, plan: PlanSpellImport, set: (p) => (plan = p) })
	}

	/** One spell row of an import plan, for its summary. */
	function planRow(s: vmangos.SpellImportRow): string {
		const notes = [s.exists ? 'replaces it' : 'new', s.newer ? `build ${s.build} is newer than the client's: the server won't use it` : s.build !== 5875 ? `build ${s.build}` : '']
		return `${s.name || 'spell'} (${s.entry}, ${notes.filter(Boolean).join(', ')})`
	}

	const missingLook = $derived(plan ? plan.plan.spells.filter((s) => s.missingIcon || s.missingVisual) : [])
	// Spells whose icon or visual the script carries and this client holds under another ID, or lacks (#381).
	const movedLook = $derived(plan ? plan.plan.spells.filter((s) => s.newIcon || s.newVisual) : [])

	function confirmImport() {
		if (!plan) return
		const { path, plan: p } = plan
		const n = p.spells.length
		void runImport(ed, {
			run: () => ImportSpells(path),
			clear: () => (plan = null),
			forget: (entries) => entries.forEach(forget),
			open: target?.entry,
			openEntry: (entry) => (ui.spellEditor = { entry }),
			note: () => `Imported ${n} spell ${n === 1 ? 'row' : 'rows'} into the world database and the client's Spell.dbc.`,
			status: 10000,
			busy: (b) => (importing = b),
		})
	}

	// Find: the client's spells by category and school, narrowed by name or ID (SpellPicker, #367),
	// leftovers (tests, OLD) included, since this edits them too.
	let searchVersion = $state(0)

	// A new spell: from a starter Meld fills in (#360), or a copy of the one open.
	const COPY = 'copy'
	let newName = $state('')
	let creating = $state(false)
	let copySource = $state<{ entry: number; name: string } | null>(null)
	let starters = $state<vmangos.SpellStarter[]>([])
	/** A starter's ID, or COPY. */
	let start = $state('')
	const isNew = $derived(target?.entry === -1)

	function startNew() {
		if (isNew) return
		ed.leave(() => {
			copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
			newName = copySource ? copySource.name : ''
			start = copySource ? COPY : ''
			ed.note = ''
			ui.spellEditor = { entry: -1 }
			if (!starters.length)
				SpellStarters().then((s) => {
					starters = s ?? []
					if (!start && starters.length) start = starters[0].id
				})
			else if (!start) start = starters[0].id
		})
	}

	async function create() {
		const name = newName.trim()
		const copy = start === COPY ? copySource : null
		if (!name || !start) return
		creating = true
		ed.error = ''
		try {
			const entry = await CreateSpell(copy?.entry ?? 0, copy ? '' : start, name)
			const from = copy ? `a copy of ${copy.name}` : `from the ${starters.find((s) => s.id === start)?.name ?? start} starter`
			newName = ''
			searchVersion++
			ui.spellEditor = { entry }
			tab = 'spell'
			ed.note = `Made spell ${entry}, ${name}, ${from}. Change it and save.`
			setStatus(ed.note, 8000)
		} catch (err) {
			ed.error = String(err)
		} finally {
			creating = false
		}
	}

	// The look: the icon (the spell's, or the one picked or under the pointer) and the visual.
	const iconPath = (name: string) => `Interface\\Icons\\${name}`
	const iconShown = $derived.by(() => {
		const pick = changing ? (hoverPick ?? candidate ?? pendingIcon) : pendingIcon
		return pick ? iconPath(pick) : (record?.icon ?? '')
	})
	const iconName = $derived(iconShown.replace(/^.*\\/, ''))

	function startChange() {
		changing = true
		candidate = null
		hoverPick = null
	}

	function applyChange(v: number | string | null = candidate) {
		if (v === null) return
		pendingIcon = String(v)
		changing = false
	}

	const changeText = $derived.by(() => {
		const own = (record?.icon ?? '').replace(/^.*\\/, '')
		const now = pendingIcon ? `Now ${pendingIcon} (set on Save).` : `Now ${own || 'no icon'}.`
		if (hoverPick !== null && hoverPick !== candidate) return `${now} Showing ${hoverPick}.`
		if (candidate !== null) return `${now} Picked ${candidate}: Change icon applies it.`
		return `${now} Hover an icon below to see it, click one, then Change icon.`
	})

	// The visual: the spells that use it, and Take the visual of, a search of the client's spells.
	const visual = $derived(Number(values.spellVisual1) || 0)
	let visualUsers = $state<vmangos.SpellRef[]>([])
	$effect(() => {
		const v = visual
		visualUsers = []
		if (v > 0) SpellsWithVisual(v).then((r) => v === visual && (visualUsers = (r ?? []).filter((s) => s.id !== record?.entry)))
	})
	let takingVisual = $state(false)

	/** Opens the composer on the visual waiting for Save, else the spell's own. */
	async function compose() {
		ed.error = ''
		try {
			const d = pendingVisual ?? (await ReadSpellVisual(visual))
			composing = $state.snapshot(d) as vmangos.VisualDesign
			changing = false
		} catch (err) {
			ed.error = String(err)
		}
	}

	function applyComposed(d: vmangos.VisualDesign) {
		pendingVisual = $state.snapshot(d) as vmangos.VisualDesign
		composing = null
	}

	// Names of the effects, for the waiting visual's summary.
	let effectNames = $state(new Map<number, string>())
	$effect(() => {
		if (pendingVisual && !effectNames.size) void loadVisualEffects().then((l) => (effectNames = new Map(l.map((e) => [e.id, e.name]))))
	})
	const pendingSummary = $derived(
		pendingVisual
			? STAGES.map((s) => [s.name, stageEffects(pendingVisual!, s.key)] as const)
					.filter(([, fx]) => fx.length)
					.map(([name, fx]) => `${name}: ${fx.map((e) => effectNames.get(e) ?? e).join(', ')}`)
			: [],
	)

	function takeVisual(s: vmangos.SpellRef) {
		pendingVisual = null
		values.spellVisual1 = String(s.visual)
		takingVisual = false
	}

	const tip = $derived(record ? spellTooltip(values, tables) : null)
	const effects = $derived(record ? [1, 2, 3].map((n) => effectSummary(values, n, tables)) : [])

	// The GM commands that try a spell: .cast casts it on the target, .learn teaches it.
	function resultMenu(e: MouseEvent, s: vmangos.SpellRef) {
		e.preventDefault()
		ui.contextMenu = {
			x: e.clientX,
			y: e.clientY,
			title: s.name || `Spell ${s.id}`,
			items: [
				{ label: 'Open', run: () => open(s.id) },
				{ label: `Copy .cast ${s.id} to the clipboard`, run: () => void copyCommand(ed, `.cast ${s.id}`, "paste it in the game's chat as a GM to cast it on your target.") },
				{ label: `Copy .learn ${s.id} to the clipboard`, run: () => void copyCommand(ed, `.learn ${s.id}`, "paste it in the game's chat as a GM to learn it (or teach it to the player you have selected).") },
				{ separator: true },
				...copyItems({ ids: [{ what: 'spell id', id: s.id }], name: s.name }),
			],
		}
	}

	/** Esc closes the composer, Change icon, then the import's confirmation, before the editor's own. */
	function back(): boolean {
		if (composing) composing = null
		else if (changing) changing = false
		else if (plan) plan = null
		else return false
		return true
	}
</script>

{#if target}
	<EditorFrame {ed} label="Spell editor" z={165} unsavedText={`${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'} to the spell.`} blocked={() => !!ui.contextMenu} {back}>
		{#snippet title()}
			{#if target.entry > 0}
				<h2>
					<SpellIcon icon={iconShown} size={20} />
					{values.name || saved.name || 'Spell'}{#if values.nameSubtext}<span class="rank">{values.nameSubtext}</span>{/if}
				</h2>
				<span class="dim">spell {target.entry}{record ? ` · build ${record.build}` : ''}</span>
			{:else if target.entry === -1}
				<h2>New spell</h2>
			{:else}
				<h2>Spells</h2>
				<span class="dim">Find a spell to edit, or open one and make a new spell from it.</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			<button onclick={askImport} title="Read spells from an SQL script into the world database and the client's Spell.dbc">Import…</button>
			{#if record}
				<button onclick={exportSpell} title="Write this spell to an SQL script">Export…</button>
				<button disabled={!unsaved || ed.saving} onclick={() => ed.revert()}>Revert</button>
				<button class="active" disabled={!unsaved || ed.saving} onclick={save} title="Write it to the world database and the client's Spell.dbc">
					{ed.saving ? 'Saving…' : unsaved ? `Save spell (${changeCount})` : 'Saved'}
				</button>
			{/if}
		{/snippet}
		{#snippet bars()}
			{#if plan}
				<div class="bar warn plan">
					<div class="what">
						<strong>Import {plan.plan.spells.length} spell {plan.plan.spells.length === 1 ? 'row' : 'rows'} into the world database and the client's Spell.dbc?</strong>
						<span>
							{plan.plan.spells.slice(0, 12).map(planRow).join('; ')}{plan.plan.spells.length > 12 ? `; and ${plan.plan.spells.length - 12} more` : ''}.
						</span>
						{#if plan.plan.skipped}<span>{plan.plan.skipped} other {plan.plan.skipped === 1 ? 'statement is' : 'statements are'} left out: only spell_template rows are imported.</span>{/if}
						{#if plan.plan.unknown?.length}<span>Columns this server's spell_template lacks are left out: {plan.plan.unknown.join(', ')}.</span>{/if}
						{#if movedLook.length}
							<span
								>The script carries the look of {movedLook
									.slice(0, 6)
									.map((s) => `${s.name || s.entry} (${[s.newIcon ? `icon ${s.newIcon}` : '', s.newVisual ? `visual ${s.newVisual}` : ''].filter(Boolean).join(', ')})`)
									.join(', ')}{movedLook.length > 6 ? ` and ${movedLook.length - 6} more` : ''}: this client has it under another ID{plan.plan.adds?.length
									? ` or gets it in ${plan.plan.adds.map((f) => f.replace(/^.*\\/, '')).join(', ')}`
									: ''}, and the import uses that.</span
							>
						{/if}
						{#if missingLook.length}
							<span class="warn-text"
								>This client lacks {missingLook
									.slice(0, 6)
									.map((s) => `${s.name || s.entry}'s ${[s.missingIcon ? `icon ${s.missingIcon}` : '', s.missingVisual ? `visual ${s.missingVisual}` : ''].filter(Boolean).join(' and ')}`)
									.join(', ')}{missingLook.length > 6 ? ` and ${missingLook.length - 6} more` : ''}: the game shows no icon or draws nothing for them. Pick them again after the import.</span
							>
						{/if}
						<span>A replaced spell can't be brought back, unless you exported it first.</span>
					</div>
					<button onclick={() => (plan = null)}>Cancel</button>
					<button class="active" disabled={importing} onclick={confirmImport}>{importing ? 'Importing…' : 'Import'}</button>
				</div>
			{/if}
		{/snippet}

		<div class="body">
			<aside>
				<button class="new" class:active={isNew} onclick={startNew}>New spell…</button>
				<SpellPicker memoryKey="spell-editor" start="every" leftovers height={0} text={false} label="Find a spell" listLabel="Spells found" version={searchVersion}>
					{#snippet row(s: vmangos.SpellRef)}
						<button
							class="hit"
							class:on={s.id === target.entry}
							onclick={() => open(s.id)}
							oncontextmenu={(e) => resultMenu(e, s)}
							title={`${s.text || s.name}\nRight-click to copy its id, its name or the commands that try it in the game`}
						>
							<SpellIcon icon={s.icon} />
							<span class="name"
								>{s.name || '(no name)'}{#if s.rank}<span class="dim"> {s.rank}</span>{/if}</span
							>
							<span class="dim">{s.id}</span>
						</button>
					{/snippet}
				</SpellPicker>
			</aside>

			<section class="main">
				{#if target.entry === -1}
					<div class="new-form">
						<p>Make a spell of your own under the first free spell ID. Start from a kind of spell Meld fills in, or from a copy of the spell that was open. Change it and save.</p>
						<fieldset class="starts" aria-label="Start from">
							{#each starters as s (s.id)}
								<label class="start" class:on={start === s.id}>
									<input type="radio" name="spell-start" value={s.id} bind:group={start} />
									<span><strong>{s.name}</strong> <span class="dim">{s.text} Looks like {s.like}.</span></span>
								</label>
							{/each}
							{#if copySource}
								<label class="start" class:on={start === COPY}>
									<input type="radio" name="spell-start" value={COPY} bind:group={start} />
									<span><strong>Copy of {copySource.name}</strong> <span class="dim">Spell {copySource.entry}: its effects, look and text.</span></span>
								</label>
							{:else}
								<p class="dim">To copy an existing spell instead, open it on the left, then choose New spell there.</p>
							{/if}
						</fieldset>
						<label>Name <input type="text" maxlength="256" placeholder="Name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && create()} /></label>
						<button class="active" disabled={!newName.trim() || !start || creating} onclick={create}>{creating ? 'Making…' : 'Make spell'}</button>
					</div>
				{:else if target.entry === 0}
					<div class="empty dim">Find a spell on the left, or open one and make a new spell from it.</div>
				{:else if composing && record}
					<SpellVisualComposer bind:design={composing} onapply={applyComposed} oncancel={() => (composing = null)} />
				{:else if changing && record}
					<div class="change" aria-label="Change icon">
						<div class="change-bar">
							<div class="what">
								<strong>Change icon</strong>
								<span class="dim">{changeText}</span>
							</div>
							<button onclick={() => (changing = false)} title="Back to the spell (Esc)">Cancel</button>
							<button class="active" disabled={candidate === null} onclick={() => applyChange()}>Change icon</button>
						</div>
						<div class="stage">
							<SpellIcon icon={iconShown} size={128} />
							{#if tip}{@render tooltip(tip)}{/if}
						</div>
						<div class="grid-area">
							<ItemLookPicker
								mode="icons"
								kind=""
								iconsFirst="spells"
								selected={candidate ?? pendingIcon ?? iconName}
								onpick={(v) => (candidate = String(v))}
								onapply={applyChange}
								onhover={(v) => (hoverPick = v === null ? null : String(v))}
							/>
						</div>
					</div>
				{:else}
					<nav class="tabs">
						{#each tabs as t (t.id)}
							<button class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.title}{tabChanges.get(t.id) ? ` (${tabChanges.get(t.id)})` : ''}</button>
						{/each}
					</nav>
					<div class="scroll">
						{#if !record}
							<p class="dim">{ed.loading ? 'Loading the spell…' : ''}</p>
						{:else}
							{#each tabs as t (t.id)}
								{#if t.id === tab}
									{#if t.id.startsWith('effect')}
										<p class="summary">{effects[Number(t.id.slice(6)) - 1] || 'This effect slot is empty: pick an effect to use it.'}</p>
									{/if}
									{#each t.groups as g (g.title)}
										<h3>{g.title}</h3>
										<TemplateFields fields={g.fields} {values} columns={columnKind} {changes} onset={(col, v) => (values[col] = v)} />
									{/each}
								{/if}
							{/each}
						{/if}
					</div>
				{/if}
			</section>

			{#if record && target.entry > 0}
				<section class="look" aria-label="How the spell looks">
					<div class="icon-row" class:changed={pendingIcon !== '' || changes.spellIconId !== undefined}>
						<SpellIcon icon={iconShown} size={56} />
						<div class="icon-text">
							<span>{iconName || 'No icon'}</span>
							<span class="dim">{pendingIcon ? 'Set on Save.' : `SpellIcon ${values.spellIconId || 0}`}</span>
							<button class:active={changing} onclick={startChange} title="Pick another of the client's icons">Change icon…</button>
						</div>
					</div>
					<h3>Tooltip</h3>
					{#if tip}{@render tooltip(tip)}{/if}
					<h3>Effects</h3>
					<ul class="effects">
						{#each effects as e, i (i)}
							{#if e}<li><button class="link" onclick={() => (tab = `effect${i + 1}`)}>{i + 1}</button> {e}</li>{/if}
						{/each}
						{#if !effects.some(Boolean)}<li class="dim">No effects: it does nothing.</li>{/if}
					</ul>
					<h3>Visual</h3>
					<div class="visual" class:changed={changes.spellVisual1 !== undefined || pendingVisual !== null}>
						<label title="SpellVisual.dbc ID: the casting, missile and impact effects the game draws (spellVisual1)"
							>Visual <input
								type="number"
								min="0"
								value={values.spellVisual1 ?? ''}
								oninput={(e) => {
									values.spellVisual1 = (e.currentTarget as HTMLInputElement).value
									pendingVisual = null
								}}
							/></label
						>
						{#if pendingVisual}
							<span class="dim">composed: set on Save</span>
						{:else}
							<span class="dim">{visual ? (visualUsers.length ? `as ${visualUsers.map((s) => s.name).join(', ')}` : 'no other spell uses it') : 'none: nothing is drawn'}</span>
						{/if}
						<button class:active={composing !== null} onclick={compose} title="Put a visual together from the client's stages and effect models">Compose…</button>
					</div>
					{#if pendingVisual}
						<ul class="composed">
							{#each pendingSummary as line (line)}<li>{line}</li>{:else}<li class="dim">No stages: nothing is drawn.</li>{/each}
						</ul>
					{/if}
					<button class="take" class:active={takingVisual} onclick={() => (takingVisual = !takingVisual)} title="Browse the client's spells and use the visual of the one clicked">Take the visual of a spell…</button>
					{#if takingVisual}
						<SpellPicker memoryKey="visual" height={220} text={false} label="Take the visual of a spell" listLabel="Spells to take the visual of" focus>
							{#snippet row(s: vmangos.SpellRef)}
								<button class="hit" disabled={!s.visual} onclick={() => takeVisual(s)} title={s.visual ? `Use visual ${s.visual}` : 'It has no visual'}>
									<SpellIcon icon={s.icon} />
									<span class="name"
										>{s.name}{#if s.rank}<span class="dim"> {s.rank}</span>{/if}</span
									>
									<span class="dim">{s.visual ? `visual ${s.visual}` : 'no visual'}</span>
								</button>
							{/snippet}
						</SpellPicker>
					{/if}
					<h3>In the game</h3>
					{#if !record.inClient}<p class="warn-text">The client's Spell.dbc has no spell {record.entry} yet: Save writes it there.</p>{/if}
					<div class="commands">
						<button onclick={() => copyCommand(ed, `.cast ${record?.entry}`, "paste it in the game's chat as a GM to cast it on your target.")} title="Copy the GM command that casts it on your target"
							>Copy .cast {record.entry}</button
						>
						<button onclick={() => copyCommand(ed, `.learn ${record?.entry}`, "paste it in the game's chat as a GM to learn it (or teach it to the player you have selected).")} title="Copy the GM command that teaches it"
							>Copy .learn {record.entry}</button
						>
					</div>
				</section>
			{/if}
		</div>
	</EditorFrame>
{/if}

{#snippet tooltip(t: ReturnType<typeof spellTooltip>)}
	<div class="tip">
		<div class="line"><span class="tip-name">{t.name || '(no name)'}</span><span class="tip-rank">{t.rank}</span></div>
		{#if t.cost || t.range}<div class="line"><span>{t.cost}</span><span>{t.range}</span></div>{/if}
		<div class="line"><span>{t.cast}</span><span>{t.cooldown}</span></div>
		{#if t.text}<p class="tip-text">{t.text}</p>{/if}
	</div>
{/snippet}

<style>
	.rank {
		margin-left: 6px;
		font-size: 13px;
		font-weight: 400;
		color: var(--text-dim);
	}
	.bar.plan .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	aside {
		width: 280px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-right: 1px solid var(--border);
		background: var(--panel);
	}
	.hit {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 3px 6px;
		text-align: left;
		font-size: 12px;
	}
	.hit:hover:not(:disabled) {
		background: var(--panel-2);
	}
	.hit:disabled {
		opacity: 0.45;
	}
	.hit.on {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.hit .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.take {
		align-self: flex-start;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px;
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
	.summary {
		margin: 0;
		font-size: 13px;
		color: var(--accent-text);
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
	}
	.new-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		max-width: 560px;
		font-size: 13px;
	}
	.new-form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.new-form p {
		margin: 0;
	}
	.starts {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 0;
		border: none;
	}
	.new-form label.start {
		flex-direction: row;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 8px;
		border: 1px solid var(--border);
		border-radius: 4px;
		cursor: pointer;
	}
	.new-form label.start.on {
		border-color: var(--accent);
	}
	.look {
		flex: none;
		width: min(380px, calc(32 * var(--vw)));
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-left: 1px solid var(--border);
		background: var(--panel);
		overflow-y: auto;
	}
	.icon-row {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	.icon-text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		font-size: 12px;
		min-width: 0;
	}
	.icon-row.changed .icon-text > span:first-child {
		color: var(--accent-text);
	}
	.tip {
		max-width: 320px;
		padding: 6px 8px;
		border: 1px solid #5a5a6e;
		border-radius: 4px;
		background: rgba(8, 10, 24, 0.94);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
		color: #fff;
		font-size: 12px;
		line-height: 1.35;
	}
	.tip .line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.tip-name {
		font-size: 13px;
		font-weight: 600;
	}
	.tip-rank {
		color: #a0a0a0;
	}
	.tip-text {
		margin: 2px 0 0;
		color: var(--warn);
		white-space: pre-line;
	}
	.effects {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
	}
	.link {
		padding: 0 5px;
		font-size: 11px;
	}
	.visual {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		flex-wrap: wrap;
	}
	.visual label {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-dim);
	}
	.visual input {
		width: 80px;
	}
	.composed {
		margin: 0;
		padding-left: 16px;
		font-size: 12px;
		color: var(--accent-text);
	}
	.visual.changed input {
		color: var(--accent-text);
		border-color: var(--accent);
	}
	.commands {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.warn-text {
		margin: 0;
		font-size: 12px;
		color: var(--warn);
	}
	.change {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
	}
	.change-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.change-bar .what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stage {
		flex: 1 1 40%;
		min-height: 180px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 24px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--preview-bg);
	}
	.grid-area {
		flex: 1 1 50%;
		min-height: 180px;
		display: flex;
	}
	.dim {
		color: var(--text-dim);
		font-size: 12px;
		margin: 0;
	}
</style>
