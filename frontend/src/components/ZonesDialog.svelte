<script lang="ts">
  import Modal from './Modal.svelte'
  import { AreaRows, MapEntries, NewAreaRow, SaveAreas } from '../../wailsjs/go/main/App'
  import { vmangos } from '../../wailsjs/go/models'
  import { setStatus } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { hasBackend } from '../lib/io/mapio'
  import { reloadAreas } from '../lib/wow/areas'

  // World › Zones (Noggit Red's zone editor in its Area Designator): a map's zones and subzones from
  // the client's AreaTable.dbc. Pick one to edit its row, or add a zone or a subzone; Save writes the
  // changed and new rows into the client's patch and the server's area_template. A form saved with
  // Save, like the creature editor's templates: not undo steps, since the rows aren't part of a map.

  interface Props {
    onclose: () => void
  }
  let { onclose }: Props = $props()

  let maps = $state<vmangos.MapEntry[]>([])
  let mapId = $state<number | null>(null)
  let rows = $state<vmangos.AreaRow[]>([])
  /** The IDs of rows edited or added since the last load, which Save writes. */
  let dirty = $state<number[]>([])
  let picked = $state<number | null>(null)
  let error = $state('')
  let saving = $state(false)

  const row = $derived(rows.find((r) => r.id === picked) ?? null)
  const zones = $derived(rows.filter((r) => !r.parent || !rows.some((z) => z.id === r.parent)))
  const subzones = (id: number) => rows.filter((r) => r.parent === id)

  // The map the zones are listed for: the open map's, else Azeroth.
  async function init() {
    if (!hasBackend()) {
      error = 'Zones need the desktop app and a WoW client.'
      return
    }
    try {
      maps = (await MapEntries()) ?? []
      const e = engineRef.current
      const ref = e?.activeVmangos()
      const region = e?.activeRegion()
      mapId = ref ? ref.mapId : (maps.find((m) => region && m.Dir.toLowerCase() === region.mapName.toLowerCase())?.ID ?? 0)
      await load()
    } catch (err) {
      error = String(err)
    }
  }
  void init()

  async function load() {
    if (mapId === null) return
    error = ''
    rows = (await AreaRows(mapId)) ?? []
    dirty = []
    picked = rows[0]?.id ?? null
  }

  async function changeMap(id: number) {
    if (dirty.length && !confirm('Drop the unsaved zone changes?')) return
    mapId = id
    try {
      await load()
    } catch (err) {
      error = String(err)
    }
  }

  function edit<K extends keyof vmangos.AreaRow>(key: K, value: vmangos.AreaRow[K]) {
    const r = rows.find((x) => x.id === picked)
    if (!r) return
    r[key] = value
    if (!dirty.includes(r.id)) dirty = [...dirty, r.id]
  }

  async function add(parent: number) {
    if (mapId === null) return
    try {
      const r = await NewAreaRow(mapId, parent)
      // A second new row in one session takes the next free ID and bit past the unsaved ones.
      const ids = rows.map((x) => x.id)
      const bits = rows.map((x) => x.areaBit)
      if (ids.includes(r.id)) r.id = Math.max(...ids) + 1
      if (bits.includes(r.areaBit)) r.areaBit = Math.max(...bits) + 1
      rows = [...rows, r]
      dirty = [...dirty, r.id]
      picked = r.id
    } catch (err) {
      error = String(err)
    }
  }

  async function save() {
    const changed = rows.filter((r) => dirty.includes(r.id))
    if (!changed.length) return
    saving = true
    error = ''
    try {
      const res = await SaveAreas(changed.map((r) => vmangos.AreaRow.createFrom(r)))
      dirty = []
      await reloadAreas()
      const where = [res.patch ? 'the client' : '', res.server ? "the server's area_template" : ''].filter(Boolean).join(' and ')
      setStatus(`Saved ${changed.length} zone${changed.length === 1 ? '' : 's'} to ${where || 'nowhere new (nothing differed)'}.${res.server ? '' : ' Set the VMaNGOS server folder for the server to know them.'}`, 8000)
    } catch (err) {
      error = String(err)
    } finally {
      saving = false
    }
  }

  function close() {
    if (dirty.length && !confirm('Close without saving the zone changes?')) return
    onclose()
  }

  const FACTIONS: Array<[number, string]> = [
    [0, 'Contested'],
    [2, 'Alliance'],
    [4, 'Horde'],
    [6, 'Alliance and Horde'],
  ]
  const num = (e: Event) => Number((e.target as HTMLInputElement).value) || 0
</script>

<Modal title="Zones" width={720} onclose={close}>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="top">
    <label class="k" for="zone-map">Map</label>
    <select id="zone-map" value={mapId ?? 0} onchange={(e) => void changeMap(Number((e.target as HTMLSelectElement).value))}>
      {#each maps as m (m.ID)}
        <option value={m.ID}>{m.Name || m.Dir} ({m.ID})</option>
      {/each}
    </select>
    <button onclick={() => void add(0)} disabled={mapId === null}>New zone</button>
    <button onclick={() => row && void add(row.parent || row.id)} disabled={!row} title="A subzone of the picked zone (or of the picked subzone's zone)">New subzone</button>
  </div>
  <div class="cols">
    <ul class="list" aria-label="Zones">
      {#each zones as z (z.id)}
        <li><button class:picked={picked === z.id} class:dirty={dirty.includes(z.id)} onclick={() => (picked = z.id)}>{z.name} <span class="id">{z.id}</span></button></li>
        {#each subzones(z.id) as s (s.id)}
          <li><button class="sub" class:picked={picked === s.id} class:dirty={dirty.includes(s.id)} onclick={() => (picked = s.id)}>{s.name} <span class="id">{s.id}</span></button></li>
        {/each}
      {:else}
        <li class="dim">No zones on this map yet.</li>
      {/each}
    </ul>
    {#if row}
      <div class="form">
        <label class="k" for="zone-name">Name</label>
        <input id="zone-name" value={row.name} oninput={(e) => edit('name', (e.target as HTMLInputElement).value)} />
        <label class="k" for="zone-parent">Zone</label>
        <select id="zone-parent" value={row.parent} onchange={(e) => edit('parent', Number((e.target as HTMLSelectElement).value))}>
          <option value={0}>None (this is a zone)</option>
          {#each rows.filter((r) => !r.parent && r.id !== row.id) as z (z.id)}
            <option value={z.id}>{z.name} ({z.id})</option>
          {/each}
        </select>
        <label class="k" for="zone-level">Exploration level</label>
        <input id="zone-level" type="number" value={row.level} oninput={(e) => edit('level', num(e))} />
        <label class="k" for="zone-faction">Faction</label>
        <select id="zone-faction" value={row.faction} onchange={(e) => edit('faction', Number((e.target as HTMLSelectElement).value))}>
          {#each FACTIONS as [v, label] (v)}
            <option value={v}>{label}</option>
          {/each}
          {#if !FACTIONS.some(([v]) => v === row.faction)}<option value={row.faction}>Mask {row.faction}</option>{/if}
        </select>
        <label class="k" for="zone-flags">Flags</label>
        <input id="zone-flags" type="number" min="0" value={row.flags} oninput={(e) => edit('flags', num(e))} />
        <label class="k" for="zone-liquid">Liquid type</label>
        <input id="zone-liquid" type="number" min="0" value={row.liquid} oninput={(e) => edit('liquid', num(e))} title="A LiquidType.dbc ID; 0 for the default" />
        <label class="k" for="zone-music">Zone music</label>
        <input id="zone-music" type="number" min="0" value={row.music} oninput={(e) => edit('music', num(e))} title="A ZoneMusic.dbc ID" />
        <label class="k" for="zone-intro">Intro music</label>
        <input id="zone-intro" type="number" min="0" value={row.introMusic} oninput={(e) => edit('introMusic', num(e))} title="A ZoneIntroMusicTable.dbc ID" />
        <label class="k" for="zone-ambience">Ambience</label>
        <input id="zone-ambience" type="number" min="0" value={row.ambience} oninput={(e) => edit('ambience', num(e))} title="A SoundAmbience.dbc ID (day and night sounds)" />
        <label class="k" for="zone-sound">Sound preferences</label>
        <span class="pair">
          <input id="zone-sound" type="number" min="0" value={row.soundPref} oninput={(e) => edit('soundPref', num(e))} title="SoundProviderPreferences.dbc ID" />
          <input type="number" min="0" value={row.soundSwim} oninput={(e) => edit('soundSwim', num(e))} title="Underwater: SoundProviderPreferences.dbc ID" aria-label="Underwater sound preferences" />
        </span>
        <label class="k" for="zone-elev">Min. elevation</label>
        <input id="zone-elev" type="number" step="any" value={row.minElevation} oninput={(e) => edit('minElevation', num(e))} />
        <label class="k" for="zone-ambient">Ambient multiplier</label>
        <input id="zone-ambient" type="number" step="any" value={row.ambientMul} oninput={(e) => edit('ambientMul', num(e))} />
        <label class="k" for="zone-light">Light</label>
        <input id="zone-light" type="number" min="0" value={row.light} oninput={(e) => edit('light', num(e))} title="A Light.dbc ID; 0 for the map's" />
        <span class="k">ID / exploration bit</span>
        <span class="dim">{row.id} / {row.areaBit}</span>
      </div>
    {/if}
  </div>
  <p class="dim">Save writes the changed zones into the client's AreaTable.dbc (Meld's patch; the game restarts to read it) and the server's area_template. Paint a zone onto the ground with the Map data tool.</p>
  {#snippet actions()}
    <button onclick={close}>Close</button>
    <button class="active" onclick={() => void save()} disabled={!dirty.length || saving}>{saving ? 'Saving…' : `Save${dirty.length ? ` (${dirty.length})` : ''}`}</button>
  {/snippet}
</Modal>

<style>
  .error {
    color: var(--danger);
    margin: 0 0 8px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .top {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }
  .top select {
    flex: 1;
  }
  .cols {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 12px;
    min-height: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 420px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius);
  }
  .list button {
    display: flex;
    width: 100%;
    justify-content: space-between;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 3px 8px;
    text-align: left;
    color: var(--text);
  }
  .list button.sub {
    padding-left: 22px;
  }
  .list button:hover {
    background: var(--panel-2);
  }
  .list button.picked {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .list button.dirty::after {
    content: '•';
    margin-left: 4px;
  }
  .id {
    opacity: 0.6;
    font-family: var(--mono);
    font-size: 10px;
    margin-left: auto;
  }
  .form {
    display: grid;
    grid-template-columns: 130px 1fr;
    gap: 6px 8px;
    align-items: center;
    align-content: start;
  }
  .k {
    color: var(--text-dim);
    font-size: 11px;
  }
  .pair {
    display: flex;
    gap: 6px;
  }
  .pair input {
    flex: 1;
    min-width: 0;
  }
</style>
