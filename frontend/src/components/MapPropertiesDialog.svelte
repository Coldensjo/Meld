<script lang="ts">
  import Modal from './Modal.svelte'
  import Slider from './Slider.svelte'
  import { editor, stats } from '../lib/state/editor.svelte'
  import { NO_ROLE } from '../lib/terrain/roles'
  import { engineRef } from '../lib/state/engineRef'
  import { defaultMapInfo, type MapInfo } from '../lib/engine/MapDocument'
  import { loadAreas } from '../lib/wow/areas'
  import { LoadingScreens } from '../../wailsjs/go/main/App'
  import type { vmangos } from '../../wailsjs/go/models'
  import { hasBackend } from '../lib/io/mapio'

  const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

  // The map's facts and its world settings (File > Map Properties). The sea is one level for the
  // whole map, so it is set here and nowhere else; a part of Azeroth keeps the client's ocean.

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  /** The map's size: in client tiles for a region, else in cells. */
  const tiles = $derived(editor.regionBlock ? `${editor.regionBlock.size}×${editor.regionBlock.size} tiles` : `${editor.mapSize} × ${editor.mapSize} cells`)
  const azeroth = $derived(!!editor.region)

  // A map made for the client also says what it is to the client and the server (written on publish).
  const ref = engineRef.current?.activeVmangos() ?? null
  let info = $state<MapInfo>(ref?.info ? { ...ref.info } : defaultMapInfo())
  let areas = $state<vmangos.Area[]>([])
  let screens = $state<vmangos.LoadingScreen[]>([])
  if (ref && hasBackend()) {
    void loadAreas().then((a) => (areas = a.filter((x) => x.mapId === ref.mapId && !x.parent)))
    void LoadingScreens()
      .then((s) => (screens = s ?? []))
      .catch(() => {})
  }
  function setInfo(patch: Partial<MapInfo>) {
    info = { ...info, ...patch }
    engineRef.current?.setMapInfo(info)
  }
  const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
  const TYPES: Array<[number, string]> = [
    [0, 'World map'],
    [1, 'Dungeon'],
    [2, 'Raid'],
    [3, 'Battleground'],
  ]
</script>

<Modal title="Map Properties" width={460} {onclose}>
  <div class="facts">
    <span class="k">Name</span><span title={editor.mapName}>{editor.mapName}</span>
    <span class="k">Size</span><span>{tiles}</span>
    {#if editor.region}<span class="k">Region</span><span title={editor.region}>{editor.region}</span>{/if}
    {#if editor.filePath}<span class="k">File</span><span title={editor.filePath}>{editor.filePath}</span>{/if}
    <span class="k">Models</span><span>{stats.objects}</span>
    <span class="k">Textures</span><span>{editor.palette.length}</span>
    {#if editor.spawns.length}<span class="k">Spawns</span><span>{editor.spawns.length}</span>{/if}
  </div>
  {#if ref}
    <div class="section">Client map ({ref.dir}, ID {ref.mapId})</div>
    <div class="facts">
      <label class="k" for="mi-name">Shown name</label>
      <input id="mi-name" value={info.name} placeholder={ref.dir} onchange={(e) => setInfo({ name: (e.target as HTMLInputElement).value })} />
      <label class="k" for="mi-type">Kind</label>
      <select id="mi-type" value={info.type} onchange={(e) => setInfo({ type: Number((e.target as HTMLSelectElement).value) })}>
        {#each TYPES as [v, label] (v)}<option value={v}>{label}</option>{/each}
      </select>
      <label class="k" for="mi-area">Zone</label>
      <select id="mi-area" value={info.areaId} onchange={(e) => setInfo({ areaId: Number((e.target as HTMLSelectElement).value) })} title="The map's zone (Edit › Zones makes one)">
        <option value={0}>None</option>
        {#each areas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        {#if info.areaId && !areas.some((a) => a.id === info.areaId)}<option value={info.areaId}>Area {info.areaId}</option>{/if}
      </select>
      <label class="k" for="mi-screen">Loading screen</label>
      <select id="mi-screen" value={info.loadingScreen} onchange={(e) => setInfo({ loadingScreen: Number((e.target as HTMLSelectElement).value) })}>
        <option value={0}>The continent's</option>
        {#each screens as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
      <label class="k" for="mi-players">Player limit</label>
      <input id="mi-players" type="number" min="0" value={info.maxPlayers} onchange={(e) => setInfo({ maxPlayers: Math.max(0, num(e)) })} title="0 for no limit" />
      <span class="k">Ghost goes to</span>
      <span class="row">
        <input type="number" value={info.ghostMap} onchange={(e) => setInfo({ ghostMap: Math.round(num(e)) })} title="The map a dead player's ghost goes back to its corpse from (-1 for this map)" aria-label="Ghost entrance map" />
        <input type="number" step="any" value={info.ghostX} onchange={(e) => setInfo({ ghostX: num(e) })} aria-label="Ghost entrance x" />
        <input type="number" step="any" value={info.ghostY} onchange={(e) => setInfo({ ghostY: num(e) })} aria-label="Ghost entrance y" />
      </span>
    </div>
    <p class="dim">Written on publish: the kind, name, zone and loading screen into the client's Map.dbc, and the kind, zone, player limit and ghost entrance into the server's map_template.</p>
  {/if}
  <div class="section">World</div>
  <label class="check" title="Ocean at the sea level wherever the ground lies below it. Lakes and rivers are painted with the Water tool."
    ><input type="checkbox" bind:checked={editor.waterEnabled} /> Sea</label
  >
  {#if editor.waterEnabled}
    {#if azeroth}
      <div class="facts">
        <span class="k">Sea level</span><span>{editor.waterLevel.toFixed(1)}</span>
      </div>
      <p class="dim">A part of Azeroth keeps the client's sea level.</p>
    {:else}
      <Slider label="Sea level" bind:value={editor.waterLevel} min={-30} max={60} step={0.1} digits={1} />
      <p class="dim">One level for the whole map. Dig lake, Raise shore and Auto-paint shape the coast around it.</p>
    {/if}
  {/if}
  <label class="check" title="Steep slopes are drawn as rock in the editor's view only. Nothing is painted, so the client will not show it: paint the rock with Sculpt's by-slope painting instead."
    ><input type="checkbox" bind:checked={editor.autoCliff} /> Show steep slopes as rock (preview only)</label
  >
  <div class="section">Texture roles</div>
  <p class="dim">The textures Sculpt paints by slope while it shapes the ground: rock on the steep, dirt rimming its foot. Pick them from the map's palette (the asset browser adds textures to it).</p>
  <div class="facts">
    <label class="k" for="role-rock">Rock</label>
    <select id="role-rock" bind:value={editor.roles.rock}>
      <option value={NO_ROLE}>none</option>
      {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
    </select>
    <label class="k" for="role-dirt">Dirt</label>
    <select id="role-dirt" bind:value={editor.roles.dirt}>
      <option value={NO_ROLE}>none</option>
      {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
    </select>
  </div>
  {#snippet actions()}
    <button class="active" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .row {
    display: flex;
    gap: 4px;
  }
  .row input {
    width: 70px;
    min-width: 0;
  }
  .facts {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 3px 8px;
    margin: 4px 0;
    font-size: 12px;
  }
  .facts span:not(.k) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .k {
    color: var(--text-dim);
    font-size: 11px;
  }
  .section {
    margin: 12px 0 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
    cursor: pointer;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
    margin: 2px 0 6px;
  }
</style>
