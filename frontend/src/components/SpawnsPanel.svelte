<script lang="ts">
  import { editor, prefs, setStatus, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { exportSpawnSql, reloadSpawns } from '../lib/io/mapio'
  import { creatureTypeName, levelText, npcRoles, objectTypeName, rankName } from '../lib/world/spawnInfo'
  import { selectSpawn } from '../lib/world/spawnEdits'
  import { spawnKey, type SpawnKind } from '../lib/world/SpawnLayer'
  import { SearchCreatures } from '../../wailsjs/go/main/App'
  import SpawnFields from './SpawnFields.svelte'
  import type { vmangos } from '../../wailsjs/go/models'

  // Long regions have thousands of spawns; the list shows this many matches and asks for a filter past it.
  const LIMIT = 200
  const KIND_LABEL: Record<SpawnKind, string> = { monster: 'Monster', npc: 'NPC', object: 'Object' }

  let query = $state('')
  const isSelected = (s: vmangos.WorldSpawn) =>
    editor.selectedSpawn !== null && editor.selectedSpawn.kind === s.kind && editor.selectedSpawn.guid === s.guid

  const counts = $derived.by(() => {
    const c: Record<SpawnKind, number> = { monster: 0, npc: 0, object: 0 }
    for (const s of editor.spawns) c[s.kind as SpawnKind]++
    return c
  })

  const visible = (s: vmangos.WorldSpawn) =>
    s.kind === 'monster' ? prefs.showMonsters : s.kind === 'npc' ? prefs.showNpcs : prefs.showGameObjects

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return editor.spawns.filter((s) => visible(s) && (q === '' || s.name.toLowerCase().includes(q) || String(s.entry) === q))
  })

  // Creature templates to place, searched in the world database as the author types.
  let creatureQuery = $state('')
  let creatures = $state<vmangos.CreatureTemplate[]>([])
  let searchError = $state('')
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const q = creatureQuery.trim()
    clearTimeout(searchTimer)
    if (!q) {
      creatures = []
      return
    }
    searchTimer = setTimeout(() => {
      SearchCreatures(q)
        .then((list) => {
          // A slower answer to an older query must not replace a newer one's.
          if (creatureQuery.trim() !== q) return
          creatures = list ?? []
          searchError = ''
        })
        .catch((err) => (searchError = String(err)))
    }, 250)
  })

  function startPlacing(t: vmangos.CreatureTemplate) {
    ui.placeCreature = t
    editor.tool = 'select'
    setStatus(`Click the ground to place ${t.name}. Shift+click places more; Esc stops.`, 10000)
  }

  function pick(s: vmangos.WorldSpawn) {
    const drawn = engineRef.current?.activeDocument().spawnLayer.get(spawnKey(s))
    selectSpawn(drawn ?? null)
    engineRef.current?.focusSpawn(s)
  }

</script>

<div class="spawns">
  {#if editor.spawnsError}
    <p class="error">The creatures and game objects could not be read from the server's world database.</p>
    <p class="dim detail">{editor.spawnsError}</p>
    <button class="retry" onclick={() => engineRef.current && reloadSpawns(engineRef.current)}>Try again</button>
  {:else if editor.spawns.length === 0 && ui.spawnChanges === 0}
    <p class="dim">
      Open a part of Azeroth to see the creatures and game objects the server places in it. They come from the server's world database, so
      the VMaNGOS server folder must be set.
    </p>
  {:else}
    {#if ui.spawnChanges > 0}
      <div class="pending">
        <span>{ui.spawnChanges} unsaved spawn {ui.spawnChanges === 1 ? 'change' : 'changes'}</span>
        <div class="row-buttons">
          <button class="active" disabled={ui.busy} onclick={() => (ui.dialog = 'saveSpawns')}>Save to database…</button>
          <button disabled={ui.busy} onclick={() => engineRef.current && exportSpawnSql(engineRef.current)}>Export SQL…</button>
        </div>
      </div>
    {/if}
    <details class="add" open={creatureQuery !== ''}>
      <summary>Add a creature</summary>
      <input type="search" placeholder="Search creatures by name or entry" bind:value={creatureQuery} />
      {#if searchError}<p class="error detail">{searchError}</p>{/if}
      {#if creatures.length}
        <ul class="list short">
          {#each creatures as t (t.entry)}
            <li class="template">
              <button class="row" class:active={ui.placeCreature?.entry === t.entry} onclick={() => startPlacing(t)} title="Place entry {t.entry}">
                <span class="dot {t.npcFlags ? 'npc' : 'monster'}"></span>
                <span class="name">{t.name}{t.subname ? ` <${t.subname}>` : ''}</span>
                <span class="dim">{levelText(t.levelMin, t.levelMax)}</span>
              </button>
              <button class="edit" title="Open entry {t.entry} in the creature editor" onclick={() => (ui.creatureEditor = { key: null, entry: t.entry })}>Edit</button>
            </li>
          {/each}
        </ul>
      {:else if creatureQuery.trim()}
        <p class="dim">No creature matches.</p>
      {/if}
      {#if ui.placeCreature}
        <p class="dim hint">Placing {ui.placeCreature.name}: click the ground (Shift+click for more, Esc stops).</p>
      {/if}
      <button class="new-creature" onclick={() => (ui.creatures = true)}>New creature…</button>
    </details>
    <div class="toggles">
      <label><input type="checkbox" bind:checked={prefs.showMonsters} /> Monsters <span class="count">{counts.monster}</span></label>
      <label><input type="checkbox" bind:checked={prefs.showNpcs} /> NPCs <span class="count">{counts.npc}</span></label>
      <label><input type="checkbox" bind:checked={prefs.showGameObjects} /> Objects <span class="count">{counts.object}</span></label>
    </div>
    <input class="filter" type="search" placeholder="Filter by name or entry" bind:value={query} />

    <ul class="list">
      {#each matches.slice(0, LIMIT) as s (`${s.kind}/${s.guid}`)}
        <li>
          <button class="row" class:active={isSelected(s)} onclick={() => pick(s)}>
            <span class="dot {s.kind}"></span>
            <span class="name">{s.name}</span>
            {#if s.kind !== 'object'}<span class="dim">{levelText(s.levelMin, s.levelMax)}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="dim">Nothing matches.</li>
      {/each}
    </ul>
    {#if matches.length > LIMIT}
      <p class="dim">Showing {LIMIT} of {matches.length}. Narrow the filter to see the rest.</p>
    {/if}

    {#if editor.selectedSpawn}
      {@const s = editor.selectedSpawn}
      {@const creature = s.kind !== 'object'}
      <dl class="info">
        <dt>Name</dt>
        <dd>{s.name}{s.subname ? ` <${s.subname}>` : ''}</dd>
        <dt>Kind</dt>
        <dd>{KIND_LABEL[s.kind as SpawnKind]}</dd>
        <dt>Entry</dt>
        <dd>{s.entry} <span class="dim">spawn {s.guid}</span></dd>
        {#if creature}
          <dt>Level</dt>
          <dd>{levelText(s.levelMin, s.levelMax) || '—'} <span class="dim">{rankName(s.rank)}</span></dd>
          <dt>Creature type</dt>
          <dd>{creatureTypeName(s.type)} <span class="dim">faction {s.faction}</span></dd>
          <dt>Role</dt>
          <dd>{npcRoles(s.npcFlags) || 'Monster (no NPC role)'}</dd>
        {:else}
          <dt>Type</dt>
          <dd>{objectTypeName(s.type)}</dd>
        {/if}
        <dt>Model</dt>
        <dd class="path">{s.model || 'none (drawn as a marker)'}</dd>
      </dl>

      <SpawnFields {s} />
      <div class="row-buttons">
        <button class="active" onclick={() => (creature ? (ui.creatureEditor = { key: spawnKey(s), entry: s.entry }) : (ui.objectEditor = { key: spawnKey(s), entry: s.entry }))}>Open editor…</button>
        <button onclick={() => engineRef.current?.focusSpawn(s)}>Focus</button>
        <button class="danger" onclick={() => engineRef.current?.deleteSelectedSpawn()}>Delete</button>
      </div>
      <p class="dim hint">Drag the spawn in the viewport to move it; R turns it. Changes go to the world database when saved.</p>
    {/if}
  {/if}
</div>

<style>
  .spawns {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pending {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--accent);
    font-size: 12px;
  }
  .row-buttons {
    display: flex;
    gap: 6px;
  }
  .add {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }
  .add summary {
    cursor: pointer;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .add input {
    width: 100%;
  }
  .template {
    display: flex;
  }
  .template .edit {
    flex: none;
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 0;
  }
  .new-creature {
    align-self: flex-start;
  }
  .list.short {
    max-height: 160px;
    margin-top: 4px;
  }
  .toggles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .count {
    color: var(--text-dim);
  }
  .filter {
    width: 100%;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--border);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
    padding: 4px 8px;
    font-size: 12px;
  }
  .row.active {
    background: var(--accent);
    color: #fff;
  }
  .row .name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .dot.monster {
    background: #e0533d;
  }
  .dot.npc {
    background: #4cc56b;
  }
  .dot.object {
    background: #e8c547;
  }
  .info {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 4px 8px;
    margin: 4px 0 0;
    font-size: 12px;
  }
  .info dt {
    color: var(--text-dim);
  }
  .info dd {
    margin: 0;
  }
  .info .path {
    overflow-wrap: anywhere;
    font-size: 11px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
    margin: 0;
  }
  .hint {
    font-size: 11px;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
    margin: 0;
  }
  .detail {
    overflow-wrap: anywhere;
    font-size: 11px;
  }
  .retry {
    align-self: flex-start;
  }
</style>
