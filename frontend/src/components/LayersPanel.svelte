<script lang="ts">
  import { editor, prefs, stats, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'

  // The scene's layers, Photoshop-style: an eye per layer, with how much is on it. Hiding a layer
  // never changes the map; these are the View menu's toggles, one click away.

  // Spawn counts follow the spawn list; the model count is the throttled `stats` one.
  const spawnCounts = $derived.by(() => {
    const n = { monster: 0, npc: 0, object: 0 }
    for (const s of editor.spawns) if (s.kind in n) n[s.kind as keyof typeof n]++
    return n
  })
  const paths = $derived(editor.spawns.filter((s) => s.kind === 'monster' && (s.waypoints?.length ?? 0) > 1).length)
  const hidden = $derived(ui.hiddenModels)

  interface Row {
    id: string
    name: string
    on: boolean
    toggle: () => void
    count?: number | string
    title: string
  }
  const rows: Row[] = $derived([
    { id: 'terrain', name: 'Terrain', on: prefs.showTerrain, toggle: () => (prefs.showTerrain = !prefs.showTerrain), title: 'The ground' },
    { id: 'water', name: 'Water', on: prefs.showWater, toggle: () => (prefs.showWater = !prefs.showWater), title: 'The sea and painted liquids' },
    { id: 'objects', name: 'Models', on: prefs.showObjects, toggle: () => (prefs.showObjects = !prefs.showObjects), count: stats.objects, title: 'Placed doodads and buildings' },
    { id: 'monsters', name: 'Monsters', on: prefs.showMonsters, toggle: () => (prefs.showMonsters = !prefs.showMonsters), count: spawnCounts.monster, title: 'Creature spawns from the world database' },
    { id: 'npcs', name: 'NPCs', on: prefs.showNpcs, toggle: () => (prefs.showNpcs = !prefs.showNpcs), count: spawnCounts.npc, title: 'NPC spawns from the world database' },
    { id: 'gameobjects', name: 'Game objects', on: prefs.showGameObjects, toggle: () => (prefs.showGameObjects = !prefs.showGameObjects), count: spawnCounts.object, title: 'Game object spawns from the world database' },
    { id: 'paths', name: 'Creature paths', on: prefs.showAllPaths, toggle: () => (prefs.showAllPaths = !prefs.showAllPaths), count: paths, title: "Every creature's waypoint path (the selected creature's always shows)" },
    { id: 'grid', name: 'Grid', on: editor.grid, toggle: () => (editor.grid = !editor.grid), title: 'The terrain cell grid (G)' },
    { id: 'chunks', name: 'Chunk lines', on: editor.chunkLines, toggle: () => (editor.chunkLines = !editor.chunkLines), title: 'The 8x8-cell paint chunks, where the four-texture limit applies' },
  ])
</script>

<div class="layers">
  {#each rows as r (r.id)}
    <div class="row" class:off={!r.on} title={r.title}>
      <button class="eye" class:on={r.on} onclick={r.toggle} aria-label={r.on ? `Hide ${r.name}` : `Show ${r.name}`} aria-pressed={r.on}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
          {#if !r.on}<path d="M3 13 13 3" />{/if}
        </svg>
      </button>
      <span class="name">{r.name}</span>
      {#if r.count !== undefined}<span class="count">{r.count}</span>{/if}
    </div>
  {/each}
  {#if hidden}
    <div class="row sub" title="Models hidden with H for this session. They are still in the map.">
      <button class="eye" class:on={ui.showHiddenModels} onclick={() => (ui.showHiddenModels = !ui.showHiddenModels)} aria-label="Draw hidden models" aria-pressed={ui.showHiddenModels}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
          <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
          {#if !ui.showHiddenModels}<path d="M3 13 13 3" />{/if}
        </svg>
      </button>
      <span class="name">Hidden models</span>
      <span class="count">{hidden}</span>
      <button class="small" onclick={() => engineRef.current?.unhideAll()} title="Show every hidden model again (Shift+H)">Show all</button>
    </div>
  {/if}
</div>

<style>
  .layers {
    padding: 2px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px 0 4px;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.off .name,
  .row.off .count {
    color: var(--text-dim);
  }
  .row.sub {
    border-top: 1px solid var(--border);
  }
  .eye {
    width: 22px;
    height: 20px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-dim);
    flex: none;
  }
  .eye.on {
    color: var(--text);
  }
  .eye:hover {
    background: var(--panel-3);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font: 11px var(--mono);
    color: var(--text-dim);
  }
  .small {
    padding: 0 6px;
    font-size: 11px;
    line-height: 16px;
  }
</style>
