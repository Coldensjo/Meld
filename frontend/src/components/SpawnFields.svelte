<script lang="ts">
  import { editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { orientationDegrees } from '../lib/world/spawnInfo'
  import { MOVEMENT_TYPES, SHEATH_STATES, STAND_STATES, withPoint, type SpawnFields } from '../lib/world/spawnEdits'
  import { spawnKey } from '../lib/world/SpawnLayer'
  import { SpawnEmotes } from '../../wailsjs/go/main/App'
  import type { vmangos } from '../../wailsjs/go/models'

  // The fields of one spawn the editor changes: placement, respawn time, movement, path, look and
  // pose. The Spawns panel and the creature editor both show them; every change is one undo step.

  interface Props {
    s: vmangos.WorldSpawn
  }
  let { s }: Props = $props()
  const creature = $derived(s.kind !== 'object')

  // The looping emotes a creature can hold (Emotes.dbc's STATE_* rows), read from the client once.
  let emotes = $state<vmangos.Emote[]>([])
  let emotesAsked = false
  $effect(() => {
    if (emotesAsked) return
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

  /** Applies an edit to the spawn, as one undo step named `label`. */
  function edit(vals: SpawnFields, label: string) {
    void engineRef.current?.editSpawn(spawnKey(s), vals, `${label} (${s.name})`)
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

<div class="spawn-fields">
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

    {@const points = s.waypoints ?? []}
    <h4>Path</h4>
    {#if points.length}
      <p class="dim">
        {points.length}
        {points.length === 1 ? 'point' : 'points'}{s.pathFromTemplate ? ", the creature template's path (every spawn of it without its own walks it; an edit gives this spawn its own)" : ''}{s.movementType !== 2 ? '. It only walks the path when it moves by Waypoints.' : '.'}
      </p>
      <ol class="points">
        {#each points as p, i (i)}
          <li>
            <button class="row" class:active={editor.selectedWaypoint === i} onclick={() => (editor.selectedWaypoint = i)}>
              <span class="name">Point {i + 1}</span>
              {#if p.waitMs > 0}<span class="dim">waits {p.waitMs / 1000} s</span>{/if}
              {#if p.scriptId}<span class="dim">script {p.scriptId}</span>{/if}
            </button>
          </li>
        {/each}
      </ol>
      {#if editor.selectedWaypoint >= 0 && points[editor.selectedWaypoint]}
        {@const i = editor.selectedWaypoint}
        {@const p = points[i]}
        <div class="fields">
          <label
            >Wait s
            <input type="number" min="0" step="1" value={p.waitMs / 1000} onchange={(e) => { const v = num(e); if (v !== null) edit({ waypoints: withPoint(points, i, { ...p, waitMs: Math.max(0, Math.round(v * 1000)) }) }, 'Path point wait') }} /></label
          >
          <label
            >Facing °
            <input
              type="number"
              step="5"
              title="0 keeps the facing it walked in with"
              value={orientationDegrees(p.orientation)}
              onchange={(e) => {
                const v = num(e)
                if (v !== null) edit({ waypoints: withPoint(points, i, { ...p, orientation: ((((v % 360) + 360) % 360) * Math.PI) / 180 }) }, 'Path point facing')
              }}
            /></label
          >
        </div>
        <div class="row-buttons">
          <button onclick={() => { const e = engineRef.current; if (e) e.focusPoint(p.x, p.z) }}>Focus point</button>
          <button class="danger" onclick={() => { edit({ waypoints: withPoint(points, i, null) }, 'Delete path point'); editor.selectedWaypoint = Math.min(i, points.length - 2) }}>Delete point</button>
        </div>
      {/if}
    {:else}
      <p class="dim">No path. Edit the path and click the ground to give it one.</p>
    {/if}
    <div class="row-buttons">
      <button class:active={ui.pathEdit} onclick={() => (ui.pathEdit = !ui.pathEdit)}>{ui.pathEdit ? 'Done' : 'Edit path'}</button>
      <button disabled={!points.length} onclick={() => { edit({ waypoints: [] }, 'Clear path'); editor.selectedWaypoint = -1 }}>Clear path</button>
    </div>
    {#if ui.pathEdit}
      <p class="dim hint">Click the ground to add a point after the picked one. Drag a point to move it; Delete removes the picked point; Esc stops.</p>
    {/if}

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
</div>

<style>
  .spawn-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
  .points {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 160px;
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
  }
  .row-buttons {
    display: flex;
    gap: 6px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
    margin: 0;
  }
  .hint {
    font-size: 11px;
  }
</style>
