<script lang="ts">
  import { editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { exportSpawnSql, reloadSpawns } from '../lib/io/mapio'
  import { creatureTypeName, levelText, npcRoles, objectTypeName, orientationDegrees, rankName } from '../lib/world/spawnInfo'
  import { MOVEMENT_TYPES, SHEATH_STATES, STAND_STATES, type SpawnFields } from '../lib/world/spawnEdits'
  import { spawnKey, type SpawnKind } from '../lib/world/SpawnLayer'
  import { SpawnEmotes } from '../../wailsjs/go/main/App'
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

  // The looping emotes a creature can hold (Emotes.dbc's STATE_* rows), read from the client once.
  let emotes = $state<vmangos.Emote[]>([])
  let emotesAsked = false
  $effect(() => {
    if (!editor.selectedSpawn || emotesAsked) return
    emotesAsked = true
    SpawnEmotes()
      .then((list) => (emotes = (list ?? []).filter((e) => e.name.toUpperCase().includes('STATE'))))
      .catch(() => (emotesAsked = false))
  })
  const emoteName = (n: string) =>
    n
      .replace(/^(ONESHOT|STATE)_/i, '')
      .toLowerCase()
      .replace(/_/g, ' ')

  function pick(s: vmangos.WorldSpawn) {
    editor.selectedSpawn = s
    engineRef.current?.focusSpawn(s)
  }

  /** Applies an edit to the selected spawn, as one undo step named `label`. */
  function edit(vals: SpawnFields, label: string) {
    const s = editor.selectedSpawn
    if (s) void engineRef.current?.editSpawn(spawnKey(s), vals, `${label} (${s.name})`)
  }

  /** A number field's value, or null when it isn't a number (the edit is dropped). */
  function num(e: Event): number | null {
    const v = (e.currentTarget as HTMLInputElement).valueAsNumber
    return Number.isFinite(v) ? v : null
  }
  const int = (e: Event) => {
    const v = num(e)
    return v === null ? null : Math.round(v)
  }
  const selectNum = (e: Event) => Number((e.currentTarget as HTMLSelectElement).value)
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

      <h4>Placement</h4>
      <div class="fields">
        <label>X <input type="number" step="0.5" value={s.x.toFixed(2)} onchange={(e) => { const v = num(e); if (v !== null) edit({ x: v }, 'Move') }} /></label>
        <label>Z <input type="number" step="0.5" value={s.z.toFixed(2)} onchange={(e) => { const v = num(e); if (v !== null) edit({ z: v }, 'Move') }} /></label>
        <label>Height <input type="number" step="0.25" value={s.y.toFixed(2)} onchange={(e) => { const v = num(e); if (v !== null) edit({ y: v }, 'Raise') }} /></label>
        <label
          >Facing °
          <input
            type="number"
            step="5"
            value={orientationDegrees(s.orientation)}
            onchange={(e) => {
              const v = num(e)
              if (v !== null) edit({ orientation: ((((v % 360) + 360) % 360) * Math.PI) / 180 }, 'Turn')
            }}
          /></label
        >
        <label>Respawn s <input type="number" min="0" step="10" value={s.respawnSecs} onchange={(e) => { const v = int(e); if (v !== null) edit({ respawnSecs: Math.max(0, v), respawnMaxSecs: Math.max(v, s.respawnMaxSecs) }, 'Respawn time') }} /></label>
        <label>to s <input type="number" min="0" step="10" value={s.respawnMaxSecs} onchange={(e) => { const v = int(e); if (v !== null) edit({ respawnMaxSecs: Math.max(s.respawnSecs, v) }, 'Respawn time') }} /></label>
      </div>

      {#if creature}
        <h4>Movement</h4>
        <div class="fields">
          <label
            >Moves
            <select value={s.movementType} onchange={(e) => edit({ movementType: selectNum(e) }, 'Movement')}>
              {#each MOVEMENT_TYPES as name, i (i)}<option value={i}>{name}</option>{/each}
            </select></label
          >
          <label
            >Wander yd
            <input type="number" min="0" step="1" disabled={s.movementType !== 1} value={s.wanderDistance} onchange={(e) => { const v = num(e); if (v !== null) edit({ wanderDistance: Math.max(0, v) }, 'Wander distance') }} /></label
          >
        </div>

        <h4>Look and pose</h4>
        <div class="fields">
          <label>Display <input type="number" min="0" value={s.display} onchange={(e) => { const v = int(e); if (v !== null) edit({ display: Math.max(0, v) }, 'Display') }} /></label>
          <label>Equipment <input type="number" min="0" value={s.equipment} onchange={(e) => { const v = int(e); if (v !== null) edit({ equipment: Math.max(0, v) }, 'Equipment') }} /></label>
          <label
            >Stance
            <select value={s.standState} onchange={(e) => edit({ standState: selectNum(e) }, 'Stance')}>
              {#each STAND_STATES as name, i (i)}<option value={i}>{name}</option>{/each}
            </select></label
          >
          <label
            >Weapons
            <select value={s.sheathState} onchange={(e) => edit({ sheathState: selectNum(e) }, 'Weapons')}>
              {#each SHEATH_STATES as name, i (i)}<option value={i}>{name}</option>{/each}
            </select></label
          >
          <label class="wide"
            >Emote
            <select value={s.emoteState} onchange={(e) => edit({ emoteState: selectNum(e) }, 'Emote')}>
              <option value={0}>None</option>
              {#if s.emoteState !== 0 && !emotes.some((e) => e.id === s.emoteState)}<option value={s.emoteState}>Emote {s.emoteState}</option>{/if}
              {#each emotes as e (e.id)}<option value={e.id}>{emoteName(e.name)}</option>{/each}
            </select></label
          >
        </div>
      {/if}
      <div class="row-buttons">
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
  h4 {
    margin: 4px 0 0;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 8px;
    font-size: 12px;
  }
  .fields label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-dim);
  }
  .fields .wide {
    grid-column: 1 / -1;
  }
  .fields input,
  .fields select {
    width: 100%;
    min-width: 0;
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
