<script lang="ts">
	import { dialogFocus } from '../lib/ui/dialogFocus'
	import { CreateSpell, ExportSpells, ImportSpells, OpenSpellsDialog, PlanSpellImport, ReadSpell, ReadSpellVisual, SaveSpell, SearchSpells, SpellStarters, SpellsWithVisual, SpellTables } from '../../wailsjs/go/main/App'
	import type { vmangos } from '../../wailsjs/go/models'
	import { ClipboardSetText } from '../../wailsjs/runtime/runtime'
	import { hasBackend } from '../lib/io/mapio'
	import { setStatus, ui } from '../lib/state/editor.svelte'
	import { changedValues } from '../lib/world/creatureFields'
	import { tabOfColumn } from '../lib/world/questFields'
	import { effectSummary, spellTabs, spellTooltip } from '../lib/world/spellFields'
	import { forgetName } from '../lib/wow/refNames'
	import { forgetSpell, rememberSpells } from '../lib/wow/spells'
	import ItemLookPicker from './ItemLookPicker.svelte'
	import SpellIcon from './SpellIcon.svelte'
	import SpellVisualComposer, { STAGES, loadVisualEffects, stageEffects } from './SpellVisualComposer.svelte'
	import TemplateFields from './TemplateFields.svelte'

	// The spell editor (#294, Tools › Spells…): find a spell or make one as a copy of the open one, edit
	// every column of its spell_template row on tabs (the text, casting, levels and rules, and each of
	// its three effects), pick its icon from the client's and take its visual from another spell, and
	// see its tooltip as the game draws it, which follows every change before it is saved. Save writes
	// the row to the world database and the same spell into Spell.dbc in Meld's patch (a new icon into
	// SpellIcon.dbc), closing the game and servers around the patch on Windows, so the two agree. Export
	// writes the spell's spell_template rows to an SQL script, and Import reads one back into both (#357).

	const target = $derived(ui.spellEditor)

	let tab = $state('spell')
	let record = $state<vmangos.SpellRecord | null>(null)
	let values = $state<Record<string, string>>({})
	let saved = $state<Record<string, string>>({})
	let error = $state('')
	let note = $state('')
	let loading = $state(false)
	let saving = $state(false)
	let confirmClose = $state(false)
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
		if (target && !tables) SpellTables().then((t) => (tables = t), (err) => (error = String(err)))
	})

	const changes = $derived(changedValues(values, saved))
	const changeCount = $derived(Object.keys(changes).length + (pendingIcon ? 1 : 0) + (pendingVisual ? 1 : 0))
	const unsaved = $derived(changeCount > 0)
	const tabs = $derived(record ? spellTabs(record.columns.map((c) => c.name), tables) : [])
	const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))
	const tabChanges = $derived(new Map(tabs.map((t) => [t.id, t.groups.reduce((n, g) => n + g.fields.filter((f) => changes[f.col] !== undefined).length, 0)])))

	// Opening another spell reads it.
	let loadedFor = 0
	$effect(() => {
		const t = target
		if (!t) {
			loadedFor = 0
			return
		}
		if (t.entry === loadedFor) return
		loadedFor = t.entry
		record = null
		values = {}
		saved = {}
		pendingIcon = ''
		pendingVisual = null
		composing = null
		changing = false
		error = ''
		confirmClose = false
		if (t.entry > 0) void load(t.entry)
	})

	async function load(entry: number) {
		loading = true
		try {
			const r = await ReadSpell(entry)
			if (ui.spellEditor?.entry !== entry) return
			record = r
			values = { ...r.values }
			saved = { ...r.values }
		} catch (err) {
			error = String(err)
		} finally {
			loading = false
		}
	}

	let afterDiscard: (() => void) | null = null

	/** Runs `go` now, or once the unsaved changes are kept or discarded. */
	function leave(go: () => void) {
		if (!unsaved) {
			go()
			return
		}
		afterDiscard = go
		confirmClose = true
	}

	function close(force = false) {
		if (unsaved && !force) {
			afterDiscard = null
			confirmClose = true
			return
		}
		ui.spellEditor = null
		loadedFor = 0
		note = ''
	}

	function discard() {
		revert()
		confirmClose = false
		const then = afterDiscard
		afterDiscard = null
		if (then) then()
		else close(true)
	}

	function revert() {
		values = { ...saved }
		pendingIcon = ''
		pendingVisual = null
	}

	function open(entry: number) {
		if (target?.entry === entry) return
		leave(() => {
			note = ''
			ui.spellEditor = { entry }
		})
	}

	/** Forgets what the session knows of a spell that changed, so names, icons and searches read it again. */
	function forget(entry: number) {
		forgetSpell(entry)
		forgetName('spell', entry)
		searchVersion++
	}


	async function save() {
		if (!record || !unsaved) return
		saving = true
		error = ''
		note = ''
		try {
			const n = changeCount
			const r = await SaveSpell(record.entry, record.build, changes, pendingIcon, pendingVisual as vmangos.VisualDesign)
			pendingIcon = ''
			pendingVisual = null
			values.spellVisual1 = String(r.visual)
			saved = { ...values }
			forget(record.entry)
			let added = r.iconAdded ? ` Added the icon ${r.iconAdded} to SpellIcon.dbc.` : ''
			if (r.visualAdded) added += ` Added visual ${r.visual} to SpellVisual.dbc (and its new stages to SpellVisualKit.dbc).`
			note = `Saved ${n} ${n === 1 ? 'change' : 'changes'} to ${values.name} (spell ${record.entry}) .${added}`
			setStatus(note, 10000)
			// Read it again for its icon's texture and that the client has it now.
			loadedFor = 0
			await load(record.entry)
			loadedFor = record?.entry ?? 0
		} catch (err) {
			error = String(err)
			const col = error.replace(/^Error:\s*/, '').split(/\s/)[0]
			const t = tabOfColumn(tabs, col)
			if (t) tab = t
		} finally {
			saving = false
		}
	}

	// Export and import: SQL scripts of spell_template rows; an import writes each spell into Spell.dbc too.
	async function exportSpell() {
		if (!record) return
		error = ''
		try {
			const file = (saved.name || `spell-${record.entry}`).replace(/[^\w\- ]+/g, '').trim() || `spell-${record.entry}`
			const path = await ExportSpells([record.entry], file)
			if (!path) return
			note = `Exported ${saved.name} (spell ${record.entry}) to ${path}${unsaved ? ', as saved: the unsaved changes are not in it' : ''}.`
			setStatus(note, 8000)
		} catch (err) {
			error = String(err)
		}
	}

	/** An import being confirmed: the script's path and what it writes. */
	let plan = $state<{ path: string; plan: vmangos.SpellImport } | null>(null)
	let importing = $state(false)

	function askImport() {
		leave(async () => {
			error = ''
			note = ''
			try {
				const path = await OpenSpellsDialog()
				if (!path) return
				plan = { path, plan: await PlanSpellImport(path) }
			} catch (err) {
				error = String(err)
			}
		})
	}

	/** One spell row of an import plan, for its summary. */
	function planRow(s: vmangos.SpellImportRow): string {
		const notes = [s.exists ? 'replaces it' : 'new', s.newer ? `build ${s.build} is newer than the client's: the server won't use it` : s.build !== 5875 ? `build ${s.build}` : '']
		return `${s.name || 'spell'} (${s.entry}, ${notes.filter(Boolean).join(', ')})`
	}

	const missingLook = $derived(plan ? plan.plan.spells.filter((s) => s.missingIcon || s.missingVisual) : [])
	// Spells whose icon or visual the script carries and this client holds under another ID, or lacks (#381).
	const movedLook = $derived(plan ? plan.plan.spells.filter((s) => s.newIcon || s.newVisual) : [])

	async function confirmImport() {
		if (!plan) return
		importing = true
		error = ''
		try {
			const { path, plan: p } = plan
			const n = p.spells.length
			const entries = (await ImportSpells(path)) ?? []
			plan = null
			for (const e of entries) forget(e)
			// The open spell is read again when the import wrote it.
			if (target && entries.includes(target.entry)) {
				loadedFor = 0
				ui.spellEditor = { entry: target.entry }
			} else if (entries.length) ui.spellEditor = { entry: entries[0] }
			note = `Imported ${n} spell ${n === 1 ? 'row' : 'rows'} into the world database and the client's Spell.dbc.`
			setStatus(note, 10000)
		} catch (err) {
			error = String(err)
		} finally {
			importing = false
		}
	}

	// Find: the client's spells by name or ID.
	let query = $state('')
	let found = $state<vmangos.SpellRef[]>([])
	let searching = $state(false)
	let searchVersion = $state(0)
	let timer = 0
	$effect(() => {
		const q = query.trim()
		void searchVersion
		clearTimeout(timer)
		if (!q) {
			found = []
			return
		}
		timer = window.setTimeout(async () => {
			searching = true
			try {
				const r = (await SearchSpells(q)) ?? []
				rememberSpells(r)
				if (q === query.trim()) found = r
			} catch (err) {
				error = String(err)
			} finally {
				searching = false
			}
		}, 250)
	})

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
		leave(() => {
			copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
			newName = copySource ? copySource.name : ''
			start = copySource ? COPY : ''
			note = ''
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
		error = ''
		try {
			const entry = await CreateSpell(copy?.entry ?? 0, copy ? '' : start, name)
			const from = copy ? `a copy of ${copy.name}` : `from the ${starters.find((s) => s.id === start)?.name ?? start} starter`
			newName = ''
			searchVersion++
			ui.spellEditor = { entry }
			tab = 'spell'
			note = `Made spell ${entry}, ${name}, ${from}. Change it and save.`
			setStatus(note, 8000)
		} catch (err) {
			error = String(err)
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
	let visualQuery = $state('')
	let visualHits = $state<vmangos.SpellRef[]>([])
	let visualTimer = 0
	$effect(() => {
		const q = visualQuery.trim()
		clearTimeout(visualTimer)
		if (!q) {
			visualHits = []
			return
		}
		visualTimer = window.setTimeout(async () => {
			const r = (await SearchSpells(q).catch(() => [])) ?? []
			if (q === visualQuery.trim()) visualHits = r.filter((s) => s.visual > 0).slice(0, 12)
		}, 250)
	})

	/** Opens the composer on the visual waiting for Save, else the spell's own. */
	async function compose() {
		error = ''
		try {
			const d = pendingVisual ?? (await ReadSpellVisual(visual))
			composing = $state.snapshot(d) as vmangos.VisualDesign
			changing = false
		} catch (err) {
			error = String(err)
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
		visualQuery = ''
	}

	const tip = $derived(record ? spellTooltip(values, tables) : null)
	const effects = $derived(record ? [1, 2, 3].map((n) => effectSummary(values, n, tables)) : [])

	// The GM commands that try a spell: .cast casts it on the target, .learn teaches it.
	async function copyCommand(command: string, what: string) {
		error = ''
		try {
			if (hasBackend()) await ClipboardSetText(command)
			else await navigator.clipboard.writeText(command)
			note = `Copied ${command}: paste it in the game's chat as a GM to ${what}.`
			setStatus(`Copied ${command}.`, 6000)
		} catch (err) {
			error = `Copying the command failed: ${err}`
		}
	}

	function resultMenu(e: MouseEvent, s: vmangos.SpellRef) {
		e.preventDefault()
		ui.contextMenu = {
			x: e.clientX,
			y: e.clientY,
			title: s.name || `Spell ${s.id}`,
			items: [
				{ label: 'Open', run: () => open(s.id) },
				{ label: `Copy .cast ${s.id} to the clipboard`, run: () => void copyCommand(`.cast ${s.id}`, 'cast it on your target') },
				{ label: `Copy .learn ${s.id} to the clipboard`, run: () => void copyCommand(`.learn ${s.id}`, 'learn it (or teach it to the player you have selected)') },
			],
		}
	}

	function onKey(e: KeyboardEvent) {
		if (!target || e.key !== 'Escape' || ui.contextMenu) return
		const el = e.target as HTMLElement | null
		if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
			el.blur()
			return
		}
		e.preventDefault()
		if (composing) composing = null
		else if (changing) changing = false
		else if (plan) plan = null
		else if (confirmClose && unsaved) confirmClose = false
		else close()
	}
</script>

<svelte:window onkeydown={onKey} />

{#if target}
	<div class="editor" role="dialog" aria-modal="true" aria-label="Spell editor" use:dialogFocus>
		<header>
			<div class="title">
				{#if target.entry > 0}
					<h2>{values.name || saved.name || 'Spell'}{#if values.nameSubtext}<span class="rank">{values.nameSubtext}</span>{/if}</h2>
					<span class="dim">spell {target.entry}{record ? ` · build ${record.build}` : ''}</span>
				{:else if target.entry === -1}
					<h2>New spell</h2>
				{:else}
					<h2>Spells</h2>
					<span class="dim">Find a spell to edit, or open one and make a new spell from it.</span>
				{/if}
			</div>
			<div class="actions">
				<button onclick={askImport} title="Read spells from an SQL script into the world database and the client's Spell.dbc">Import…</button>
				{#if record}
					<button onclick={exportSpell} title="Write this spell to an SQL script">Export…</button>
					<button disabled={!unsaved || saving} onclick={revert}>Revert</button>
					<button class="active" disabled={!unsaved || saving} onclick={save} title="Write it to the world database and the client's Spell.dbc">
						{saving ? 'Saving…' : unsaved ? `Save spell (${changeCount})` : 'Saved'}
					</button>
				{/if}
				<button onclick={() => close()} title="Close (Esc)">Close</button>
			</div>
		</header>
		{#if plan}
			<div class="bar warn plan">
				<div class="what">
					<strong>Import {plan.plan.spells.length} spell {plan.plan.spells.length === 1 ? 'row' : 'rows'} into the world database and the client's Spell.dbc?</strong>
					<span>
						{plan.plan.spells
							.slice(0, 12)
							.map(planRow)
							.join('; ')}{plan.plan.spells.length > 12 ? `; and ${plan.plan.spells.length - 12} more` : ''}.
					</span>
					{#if plan.plan.skipped}<span>{plan.plan.skipped} other {plan.plan.skipped === 1 ? 'statement is' : 'statements are'} left out: only spell_template rows are imported.</span>{/if}
					{#if plan.plan.unknown?.length}<span>Columns this server's spell_template lacks are left out: {plan.plan.unknown.join(', ')}.</span>{/if}
					{#if movedLook.length}
						<span
							>The script carries the look of {movedLook
								.slice(0, 6)
								.map((s) => `${s.name || s.entry} (${[s.newIcon ? `icon ${s.newIcon}` : '', s.newVisual ? `visual ${s.newVisual}` : ''].filter(Boolean).join(', ')})`)
								.join(', ')}{movedLook.length > 6 ? ` and ${movedLook.length - 6} more` : ''}: this client has it under another ID{plan.plan.adds?.length ? ` or gets it in ${plan.plan.adds.map((f) => f.replace(/^.*\\/, '')).join(', ')}` : ''}, and the import uses that.</span
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
		{#if confirmClose && unsaved}
			<div class="bar warn">
				<span>{changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'} to the spell.</span>
				<button onclick={() => (confirmClose = false)}>Keep editing</button>
				<button class="danger" onclick={discard}>Discard them</button>
			</div>
		{/if}
		{#if error}<div class="bar error">{error}</div>{/if}
		{#if note && !error}<div class="bar ok">{note}</div>{/if}

		<div class="body">
			<aside>
				<button class="new" class:active={isNew} onclick={startNew}>New spell…</button>
				<input type="search" placeholder="Spell name or ID" bind:value={query} aria-label="Find a spell" />
				<ul class="found" aria-label="Spells found">
					{#each found as s (s.id)}
						<li>
							<button class:on={s.id === target.entry} onclick={() => open(s.id)} oncontextmenu={(e) => resultMenu(e, s)} title={`${s.text || s.name}\nRight-click for the commands that try it in the game`}>
								<SpellIcon icon={s.icon} />
								<span class="name">{s.name || '(no name)'}{#if s.rank}<span class="dim"> {s.rank}</span>{/if}</span>
								<span class="dim">{s.id}</span>
							</button>
						</li>
					{:else}
						<li class="dim">{searching ? 'Searching…' : query.trim() ? 'No spell matches.' : "Type a name to search the client's spells."}</li>
					{/each}
				</ul>
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
							<p class="dim">{loading ? 'Loading the spell…' : ''}</p>
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
					<input type="search" placeholder="Take the visual of a spell: Fireball, Frost Nova…" bind:value={visualQuery} aria-label="Take the visual of a spell" />
					{#if visualHits.length}
						<ul class="found hits">
							{#each visualHits as s (s.id)}
								<li>
									<button onclick={() => takeVisual(s)} title="Use visual {s.visual}">
										<SpellIcon icon={s.icon} />
										<span class="name">{s.name}{#if s.rank}<span class="dim"> {s.rank}</span>{/if}</span>
										<span class="dim">visual {s.visual}</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<h3>In the game</h3>
					{#if !record.inClient}<p class="warn-text">The client's Spell.dbc has no spell {record.entry} yet: Save writes it there.</p>{/if}
					<div class="commands">
						<button onclick={() => copyCommand(`.cast ${record?.entry}`, 'cast it on your target')} title="Copy the GM command that casts it on your target">Copy .cast {record.entry}</button>
						<button onclick={() => copyCommand(`.learn ${record?.entry}`, 'learn it (or teach it to the player you have selected)')} title="Copy the GM command that teaches it">Copy .learn {record.entry}</button>
					</div>
				</section>
			{/if}
		</div>
	</div>
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
	.editor {
		position: fixed;
		inset: 0;
		z-index: 165;
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
	.title {
		flex: 1;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
	}
	.rank {
		margin-left: 6px;
		font-size: 13px;
		font-weight: 400;
		color: var(--text-dim);
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		font-size: 12px;
		border-bottom: 1px solid var(--border);
	}
	.bar.warn span {
		flex: 1;
	}
	.bar.plan .what {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bar.error {
		color: var(--danger-text);
		overflow-wrap: anywhere;
		white-space: pre-line;
	}
	.bar.ok {
		color: #6fdc6f;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
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
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		flex: 1;
		font-size: 12px;
	}
	.found.hits {
		flex: none;
		max-height: 220px;
	}
	.found button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 3px 6px;
		text-align: left;
	}
	.found button:hover {
		background: var(--panel-2);
	}
	.found button.on {
		background: var(--accent);
		color: #fff;
	}
	.found .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		padding: 8px 12px 0;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	.tabs button {
		border-radius: 4px 4px 0 0;
		border-bottom: none;
	}
	.tabs button.on {
		background: var(--accent);
		color: #fff;
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
		color: #ffd100;
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
		color: #e0b050;
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
		background: #1a1d24;
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
