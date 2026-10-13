<script lang="ts">
  import { editor, prefs } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { creatureTypeName, levelText, npcRoles, objectTypeName, orientationDegrees, rankName } from '../lib/world/spawnInfo'
  import type { SpawnKind } from '../lib/world/SpawnLayer'
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

  function pick(s: vmangos.WorldSpawn) {
    editor.selectedSpawn = s
    engineRef.current?.focusSpawn(s)
  }
</script>

<div class="spawns">
  {#if editor.spawns.length === 0}
    <p class="dim">
      Open a part of Azeroth to see the creatures and game objects the server places in it. They come from the server's world database, so
      the VMaNGOS server folder must be set.
    </p>
  {:else}
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
      <dl class="info">
        <dt>Name</dt>
        <dd>{s.name}{s.subname ? ` <${s.subname}>` : ''}</dd>
        <dt>Kind</dt>
        <dd>{KIND_LABEL[s.kind as SpawnKind]}</dd>
        <dt>Entry</dt>
        <dd>{s.entry} <span class="dim">spawn {s.guid}</span></dd>
        {#if s.kind === 'object'}
          <dt>Type</dt>
          <dd>{objectTypeName(s.type)}</dd>
        {:else}
          <dt>Level</dt>
          <dd>{levelText(s.levelMin, s.levelMax) || '—'}</dd>
          <dt>Rank</dt>
          <dd>{rankName(s.rank)}</dd>
          <dt>Creature type</dt>
          <dd>{creatureTypeName(s.type)}</dd>
          <dt>Faction</dt>
          <dd>{s.faction}</dd>
          <dt>Role</dt>
          <dd>{npcRoles(s.npcFlags) || 'Monster (no NPC role)'}</dd>
        {/if}
        <dt>Model</dt>
        <dd class="path">{s.model || 'none (drawn as a marker)'}</dd>
        <dt>Position</dt>
        <dd>
          {s.x.toFixed(1)}, {s.z.toFixed(1)} <span class="dim">height {s.y.toFixed(1)}</span>
        </dd>
        <dt>Facing</dt>
        <dd>{orientationDegrees(s.orientation)}°</dd>
        {#if s.respawnSecs > 0}
          <dt>Respawn</dt>
          <dd>{s.respawnSecs} s</dd>
        {/if}
      </dl>
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
</style>
