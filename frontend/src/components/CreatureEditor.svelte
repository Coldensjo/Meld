<script lang="ts">
  import { editor, setStatus, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { CreateCreature, ModelAnimations, ReadCreature, SaveCreature, SpawnLook } from '../../wailsjs/go/main/App'
  import type { vmangos } from '../../wailsjs/go/models'
  import { changedValues, fieldGroups, withBit, type CreatureField } from '../lib/world/creatureFields'
  import { creatureTemplateOf } from '../lib/world/spawnEdits'
  import { levelText, npcRoles, rankName } from '../lib/world/spawnInfo'
  import CreaturePreview from './CreaturePreview.svelte'
  import DisplayPicker from './DisplayPicker.svelte'
  import SpawnFields from './SpawnFields.svelte'

  // The creature editor: one creature full screen. The left shows it big and animated; the right
  // edits the spawn it was opened from (each change an undo step, saved with the region's spawns)
  // and its creature template, every column of creature_template, saved to the world database with
  // Save. A new creature starts here too, from scratch or as a copy.

  type Tab = 'spawn' | 'creature' | 'looks'

  const target = $derived(ui.creatureEditor)
  /** The spawn the editor was opened from, as the panel's copy of it. */
  const spawn = $derived(target?.key && editor.selectedSpawn ? editor.selectedSpawn : null)

  let tab = $state<Tab>('creature')
  let record = $state<vmangos.CreatureRecord | null>(null)
  let values = $state<Record<string, string>>({})
  let saved = $state<Record<string, string>>({})
  let error = $state('')
  let loading = $state(false)
  let saving = $state(false)
  let confirmClose = $state(false)

  const changes = $derived(changedValues(values, saved))
  const changeCount = $derived(Object.keys(changes).length)
  const groups = $derived(record ? fieldGroups(record.columns.map((c) => c.name)) : [])
  const columnKind = $derived(new Map((record?.columns ?? []).map((c) => [c.name, c])))

  // Opening another creature reads its template and picks the first tab.
  let loadedFor = ''
  $effect(() => {
    const t = target
    if (!t) return
    const id = `${t.key}|${t.entry}`
    if (id === loadedFor) return
    loadedFor = id
    tab = t.key ? 'spawn' : 'creature'
    if (t.entry > 0) copySource = null
    record = null
    error = ''
    confirmClose = false
    if (t.entry > 0) void load(t.entry)
  })

  async function load(entry: number) {
    loading = true
    try {
      const r = await ReadCreature(entry)
      record = r
      values = { ...r.values }
      saved = { ...r.values }
    } catch (err) {
      error = String(err)
    } finally {
      loading = false
    }
  }

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
    SpawnLook(d, eq, 0, 0, 1)
      .then((l) => (templateLook = l))
      .catch(() => (templateLook = null))
  })
  // The display slot (1-4) a click in the Looks picker fills, and the display under the pointer.
  let slot = $state(1)
  let hoveredDisplay = $state<vmangos.DisplayEntry | null>(null)
  const usingSpawn = $derived(tab === 'spawn' && spawn !== null)
  const preview = $derived(
    !target || target.entry === 0
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
    if (m && !m.toLowerCase().endsWith('.wmo')) ModelAnimations(m).then((a) => (anims = a ?? [])).catch(() => (anims = []))
  })

  /** What to do once unsaved changes are discarded: close, unless something else asked first. */
  let afterDiscard: (() => void) | null = null

  function close(force = false) {
    if (changeCount > 0 && !force) {
      afterDiscard = null
      confirmClose = true
      return
    }
    ui.creatureEditor = null
    loadedFor = ''
  }

  function discard() {
    values = { ...saved }
    confirmClose = false
    const then = afterDiscard
    afterDiscard = null
    if (then) then()
    else close(true)
  }

  async function save() {
    if (!record || changeCount === 0) return
    saving = true
    error = ''
    try {
      const before = { ...saved }
      await SaveCreature(record.entry, record.patch, changes)
      saved = { ...values }
      await engineRef.current?.applyCreatureTemplate(record.entry, values, before)
      setStatus(`Saved ${values.name} (entry ${record.entry}) to the world database. Restart the world server to see it in the game.`, 10000)
    } catch (err) {
      error = String(err)
    } finally {
      saving = false
    }
  }

  function place() {
    if (!record) return
    ui.placeCreature = creatureTemplateOf(record.entry, values)
    editor.tool = 'select'
    ui.creatureEditor = null
    loadedFor = ''
    setStatus(`Click the ground to place ${values.name}. Shift+click places more; Esc stops.`, 10000)
  }

  // A new creature: from scratch or as a copy of the one that was open.
  let newName = $state('')
  let copyThis = $state(true)
  let creating = $state(false)
  let copySource = $state<{ entry: number; name: string } | null>(null)
  function startNew() {
    if (target?.entry === 0) return
    copySource = record ? { entry: record.entry, name: saved.name ?? '' } : null
    const go = () => (ui.creatureEditor = { key: null, entry: 0 })
    if (changeCount > 0) {
      afterDiscard = go
      confirmClose = true
      return
    }
    go()
  }
  async function create() {
    const name = newName.trim()
    if (!name) return
    creating = true
    error = ''
    try {
      const base = copyThis && copySource ? copySource.entry : 0
      const entry = await CreateCreature(base, name)
      newName = ''
      ui.creatureEditor = { key: null, entry }
      setStatus(`Made creature ${entry}, ${name}. Edit it, save, then place it.`, 8000)
    } catch (err) {
      error = String(err)
    } finally {
      creating = false
    }
  }

  // Looks: the display picker. A click puts the display in slot `slot` (1-4); hovering a tile shows
  // it in the preview until the pointer leaves.
  function useDisplay(d: vmangos.DisplayEntry) {
    const n = slot
    values[`display_id${n}`] = String(d.id)
    if (!(Number(values[`display_scale${n}`]) > 0)) values[`display_scale${n}`] = '1'
    if (!(Number(values[`display_probability${n}`]) > 0)) values[`display_probability${n}`] = '100'
    let total = 0
    for (let i = 1; i <= 4; i++) if (Number(values[`display_id${i}`]) > 0) total += Number(values[`display_probability${i}`]) || 0
    values.display_total_probability = String(total)
  }

  function fieldValue(f: CreatureField): string {
    return values[f.col] ?? ''
  }
  function setField(f: CreatureField, v: string) {
    values[f.col] = v
  }

  function onKey(e: KeyboardEvent) {
    if (!target) return
    if (e.key === 'Escape') {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
        el.blur()
        return
      }
      e.preventDefault()
      if (confirmClose) confirmClose = false
      else close()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if target}
  <div class="editor" role="dialog" aria-modal="true" aria-label="Creature editor">
    <header>
      <div class="title">
        {#if target.entry > 0}
          <h2>{values.name || saved.name || 'Creature'}{values.subname ? ` <${values.subname}>` : ''}</h2>
          <span class="dim">
            entry {target.entry}{spawn ? ` · spawn ${spawn.guid}` : ''}
            {#if record}
              · level {levelText(Number(values.level_min), Number(values.level_max))} · {rankName(Number(values.rank))}{npcRoles(Number(values.npc_flags)) ? ` · ${npcRoles(Number(values.npc_flags))}` : ''}
            {/if}
          </span>
        {:else}
          <h2>New creature</h2>
        {/if}
      </div>
      <div class="actions">
        {#if record}
          <button disabled={!record || saving} onclick={place} title="Place this creature in the region">Place in world</button>
          <button disabled={changeCount === 0 || saving} onclick={() => (values = { ...saved })}>Revert</button>
          <button class="active" disabled={changeCount === 0 || saving} onclick={save}>
            {saving ? 'Saving…' : changeCount ? `Save creature (${changeCount})` : 'Saved'}
          </button>
        {/if}
        <button onclick={() => close()} title="Close (Esc)">Close</button>
      </div>
    </header>
    {#if confirmClose}
      <div class="bar warn">
        <span>{changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'} to the creature.</span>
        <button onclick={() => (confirmClose = false)}>Keep editing</button>
        <button class="danger" onclick={discard}>Discard them</button>
      </div>
    {/if}
    {#if error}<div class="bar error">{error}</div>{/if}

    <div class="body">
      <section class="left">
        {#if preview}
          <CreaturePreview model={preview.model} look={preview.look} anim={anim ?? preview.anim} scale={preview.scale} />
        {:else}
          <div class="empty dim">{loading ? 'Loading…' : target.entry > 0 ? 'No display to show yet: pick one under Looks.' : 'Name the new creature on the right.'}</div>
        {/if}
        <div class="under">
          <label
            >Animation
            <select value={anim ?? -1} onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); anim = v < 0 ? null : v }}>
              <option value={-1}>Its pose{usingSpawn ? ' (as placed)' : ''}</option>
              {#each anims as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select>
          </label>
          <span class="dim"
            >{tab === 'looks' && hoveredDisplay
              ? `Showing display ${hoveredDisplay.id}.`
              : usingSpawn
                ? 'Showing this spawn as placed.'
                : 'Showing the creature template: its first display and equipment.'}</span
          >
        </div>
      </section>

      <section class="right" class:wide={tab === 'looks' && !!record && target.entry !== 0}>
        <nav class="tabs">
          {#if spawn}<button class:on={tab === 'spawn'} onclick={() => (tab = 'spawn')}>This spawn</button>{/if}
          {#if record}
            <button class:on={tab === 'creature'} onclick={() => (tab = 'creature')}>Creature</button>
            <button class:on={tab === 'looks'} onclick={() => (tab = 'looks')}>Looks</button>
          {/if}
          <button class:on={target.entry === 0} onclick={startNew}>New creature</button>
        </nav>

        <div class="scroll">
          {#if target.entry === 0}
            <div class="new">
              <p>Make a creature of your own for the world database. It gets the first free entry; edit it, save it, and place it.</p>
              <label>Name <input type="text" maxlength="100" placeholder="Name" bind:value={newName} /></label>
              {#if copySource}
                <label class="check"><input type="checkbox" bind:checked={copyThis} /> Copy {copySource.name} (its looks, stats, loot and AI)</label>
              {:else}
                <p class="dim">It starts at level 1, hostile, with no display: pick one under Looks once it's made. To start from an existing creature, open that one and choose New creature there.</p>
              {/if}
              <button class="active" disabled={!newName.trim() || creating} onclick={create}>{creating ? 'Making…' : 'Make creature'}</button>
            </div>
          {:else if tab === 'spawn' && spawn}
            <SpawnFields s={spawn} />
            <p class="dim hint">Changes to this spawn are undo steps and are saved with the region's spawns (Spawns panel › Save to database). Edit the path in the world: close the editor, then Edit path.</p>
          {:else if tab === 'looks' && record}
            <div class="slot">
              <span>A click sets</span>
              <select bind:value={slot}>
                {#each [1, 2, 3, 4] as n (n)}<option value={n}>display {n}{Number(values[`display_id${n}`]) > 0 ? ` (now ${values[`display_id${n}`]})` : ''}</option>{/each}
              </select>
              <span class="dim">Hover a tile to see it big on the left.</span>
            </div>
            <DisplayPicker selected={Number(values[`display_id${slot}`]) || 0} onpick={useDisplay} onhover={(d) => (hoveredDisplay = d)} />
            <h3>Displays</h3>
            {#each groups.filter((g) => g.title === 'Looks') as g (g.title)}
              {@render group(g.fields)}
            {/each}
          {:else if record}
            {#each groups.filter((g) => g.title !== 'Looks') as g (g.title)}
              <h3>{g.title}</h3>
              {@render group(g.fields)}
            {/each}
          {:else if loading}
            <p class="dim">Loading the creature…</p>
          {/if}
        </div>
      </section>
    </div>
  </div>
{/if}

{#snippet group(fields: CreatureField[])}
  <div class="grid">
    {#each fields as f (f.col)}
      {@const c = columnKind.get(f.col)}
      {@const changed = changes[f.col] !== undefined}
      {#if f.flags}
        <fieldset class="wide" class:changed>
          <legend>{f.label}</legend>
          {#each f.flags as [bit, name] (bit)}
            <label class="check"><input type="checkbox" checked={((Number(fieldValue(f)) || 0) & bit) !== 0} onchange={(e) => setField(f, withBit(fieldValue(f), bit, (e.currentTarget as HTMLInputElement).checked))} /> {name}</label>
          {/each}
        </fieldset>
      {:else if f.bool}
        <label class="check" class:changed title={f.hint}><input type="checkbox" checked={fieldValue(f) !== '0' && fieldValue(f) !== ''} onchange={(e) => setField(f, (e.currentTarget as HTMLInputElement).checked ? '1' : '0')} /> {f.label}</label>
      {:else if f.options}
        <label class:changed title={f.hint}
          >{f.label}
          <select value={fieldValue(f)} onchange={(e) => setField(f, (e.currentTarget as HTMLSelectElement).value)}>
            {#if !f.options.some(([v]) => String(v) === fieldValue(f))}<option value={fieldValue(f)}>{fieldValue(f)}</option>{/if}
            {#each f.options as [v, name] (v)}<option value={String(v)}>{name}</option>{/each}
          </select></label
        >
      {:else}
        <label class:changed class:wide={c?.kind === 'text' && (c.maxLen === 0 || c.maxLen > 64)} title={f.hint}
          >{f.label}
          <input
            type={c?.kind === 'text' ? 'text' : 'number'}
            step={c?.kind === 'float' ? 'any' : '1'}
            min={c?.kind === 'uint' ? '0' : undefined}
            maxlength={c?.kind === 'text' && c.maxLen ? c.maxLen : undefined}
            value={fieldValue(f)}
            oninput={(e) => setField(f, (e.currentTarget as HTMLInputElement).value)}
          /></label
        >
      {/if}
    {/each}
  </div>
{/snippet}

<style>
  .editor {
    position: fixed;
    inset: 0;
    z-index: 150;
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
  .bar.error {
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
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
    width: min(560px, 45vw);
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    background: var(--panel);
  }
  .right.wide {
    width: min(860px, 62vw);
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--border);
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
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px 10px;
    font-size: 12px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-dim);
    min-width: 0;
  }
  .grid input,
  .grid select {
    width: 100%;
    min-width: 0;
  }
  .grid .wide {
    grid-column: 1 / -1;
  }
  .grid input[type='checkbox'] {
    width: auto;
    flex: none;
    margin: 0;
  }
  .grid label.check,
  .new label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  fieldset {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 10px;
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  legend {
    color: var(--text-dim);
    padding: 0 4px;
  }
  .changed,
  .changed input,
  .changed select {
    color: var(--accent);
  }
  .changed input,
  .changed select {
    border-color: var(--accent);
  }
  .new {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }
  .new label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .new p {
    margin: 0;
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
