<script lang="ts">
  import MapPicker from './MapPicker.svelte'
  import type { Block } from './TileMinimap.svelte'
  import { editor, ui, wow } from '../lib/state/editor.svelte'
  import { defaultLayerTextures } from '../lib/wow/defaults'
  import { LAYERS } from '../lib/terrain/layers'
  import { PRESETS, drawPresetPreview, type PresetId } from '../lib/terrain/presets'
  import { engineRef } from '../lib/state/engineRef'
  import { hasBackend, openWowRegion } from '../lib/io/mapio'
  import { MapEntries, MapZones } from '../../wailsjs/go/main/App'
  import type { vmangos } from '../../wailsjs/go/models'

  // Every map WorldEditor makes is a map for the 1.12 client and the VMaNGOS server. It starts
  // either as a new world of its own (an island, hills, mountains…), reachable from Azeroth by a
  // portal once published, or as a part of an existing continent opened from the client.

  const close = () => (ui.showNewDialog = false)
  const mode = $derived(ui.newMapMode)

  // --- a new world ------------------------------------------------------------------------------
  let name = $state('MyWorld')
  let tiles = $state(2)
  let preset = $state<PresetId>('island')
  let seed = $state(Math.floor(Math.random() * 100000))
  let mapId = $state(1900)
  let showId = $state(false)
  const nameOk = $derived(/^[A-Za-z0-9_-]+$/.test(name.trim()))
  const mapIdOk = $derived(Number.isInteger(mapId) && mapId > 0 && mapId <= 99999)
  const SIZES = [
    { tiles: 1, label: 'Tiny', note: '1 tile · 533 yd' },
    { tiles: 2, label: 'Small', note: '2×2 tiles · 1.1 km' },
    { tiles: 3, label: 'Medium', note: '3×3 tiles · 1.6 km' },
    { tiles: 4, label: 'Large', note: '4×4 tiles · 2.1 km' },
    { tiles: 6, label: 'Huge', note: '6×6 tiles · 3.2 km' },
  ]

  /** Draws a preset's picture into its card; redrawn when the seed changes. */
  function preview(canvas: HTMLCanvasElement, id: PresetId) {
    const draw = () => drawPresetPreview(canvas, id, seed, 96)
    $effect(() => {
      void seed
      draw()
    })
  }

  // --- the client's maps and zones, read once --------------------------------------------------
  let maps = $state<vmangos.MapEntry[]>([])
  let zones = $state<vmangos.Zone[]>([])
  let clientError = $state('')
  let requested = false
  $effect(() => {
    if (requested || !hasBackend() || !ui.showNewDialog) return
    requested = true
    MapEntries()
      .then((list) => {
        maps = list
        // A new map takes the first free ID from 1900 up, where custom maps usually live.
        const used = new Set(list.map((m) => m.ID))
        let id = 1900
        while (used.has(id)) id++
        mapId = id
      })
      .catch((err) => (clientError = String(err)))
    MapZones()
      .then((list) => (zones = list))
      .catch((err) => (clientError = String(err)))
  })
  const continents = $derived(maps.filter((m) => m.Type === 0 && zones.some((z) => z.MapID === m.ID)))
  let continent = $state<vmangos.MapEntry | null>(null)
  $effect(() => {
    if (!continent && continents.length) continent = continents[0]
  })
  const continentZones = $derived(continent ? zones.filter((z) => z.MapID === continent!.ID) : [])

  // --- a part of a continent ----------------------------------------------------------------------
  const MAX_TILES = 8
  let block = $state<Block | null>({ x: 31, y: 48, size: 3 })
  let focus = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  let zoneFilter = $state('')
  const shownZones = $derived(continentZones.filter((z) => z.Name.toLowerCase().includes(zoneFilter.toLowerCase())))

  /** Picks a zone: the view jumps to it and the block becomes the biggest square that fits in its middle. */
  function pickZone(z: vmangos.Zone) {
    focus = { x0: z.X0, y0: z.Y0, x1: z.X1, y1: z.Y1 }
    const size = Math.min(MAX_TILES, Math.max(1, Math.min(z.X1 - z.X0, z.Y1 - z.Y0)))
    block = {
      x: Math.min(64 - size, Math.round((z.X0 + z.X1) / 2 - size / 2)),
      y: Math.min(64 - size, Math.round((z.Y0 + z.Y1) / 2 - size / 2)),
      size,
    }
  }

  async function create() {
    if (!nameOk || !mapIdOk) return
    const palette = wow.loaded ? await defaultLayerTextures() : LAYERS.map((l) => l.swatch)
    engineRef.current?.newVmangosDocument(tiles, preset, seed, { dir: name.trim(), mapId })
    editor.palette = palette
    editor.dirty = false
    engineRef.current?.refreshTabs()
    close()
  }

  function open() {
    const e = engineRef.current
    if (!e || !continent || !block) return
    close()
    openWowRegion(e, continent.Dir, block.x, block.y, block.size)
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="nm-title">
    <header>
      <h2 id="nm-title">Start</h2>
      <div class="modes">
        <button class:active={mode === 'new'} onclick={() => (ui.newMapMode = 'new')}>New world</button>
        <button class:active={mode === 'open'} onclick={() => (ui.newMapMode = 'open')} disabled={!hasBackend()}>Part of Azeroth</button>
      </div>
      <button class="close" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if mode === 'new'}
      <div class="body new">
        <p class="dim">A world of its own for the client and server. Once published it can be reached from Azeroth through a portal.</p>
        <div class="row">
          <label class="field">
            <span>Name</span>
            <input type="text" bind:value={name} spellcheck="false" />
          </label>
          <div class="field">
            <span>Size</span>
            <div class="sizes">
              {#each SIZES as s (s.tiles)}
                <button class="size" class:active={tiles === s.tiles} onclick={() => (tiles = s.tiles)} title={s.note}>
                  <b>{s.label}</b><small>{s.note}</small>
                </button>
              {/each}
            </div>
          </div>
        </div>
        {#if !nameOk}<p class="warn">Use letters, digits, - and _ for the name: it is the map's folder in the client.</p>{/if}
        <div class="presets">
          {#each PRESETS as p (p.id)}
            <button class="preset" class:active={preset === p.id} onclick={() => (preset = p.id)} title={p.blurb}>
              <canvas use:preview={p.id} width="96" height="96"></canvas>
              <b>{p.name}</b>
              <small>{p.blurb}</small>
            </button>
          {/each}
        </div>
        <div class="row bottom">
          <label class="field seed">
            <span>Seed</span>
            <span class="seedrow">
              <input type="number" bind:value={seed} />
              <button onclick={() => (seed = Math.floor(Math.random() * 100000))} title="Another layout">🎲</button>
            </span>
          </label>
          {#if showId}
            <label class="field id">
              <span>Map ID</span>
              <input type="number" min="1" max="99999" bind:value={mapId} />
            </label>
          {:else}
            <button class="link" onclick={() => (showId = true)}>Map ID {mapId}…</button>
          {/if}
          {#if !mapIdOk}<p class="warn">A map ID is a whole number from 1 to 99999.</p>{/if}
          {#if clientError}<p class="warn">{clientError}</p>{/if}
        </div>
      </div>
      <footer>
        <button onclick={close}>Cancel</button>
        <button class="active" disabled={!nameOk || !mapIdOk} onclick={create}>Create world</button>
      </footer>
    {:else}
      <div class="body open">
        {#if !wow.loaded}
          <p class="dim">Select your WoW 1.12 folder first (Preferences › Select WoW Client Folder…) to open a part of its world.</p>
        {:else}
          <div class="side">
            <div class="continents">
              {#each continents as c (c.ID)}
                <button class:active={continent?.ID === c.ID} onclick={() => { continent = c; block = null; focus = null }}>{c.Name || c.Dir}</button>
              {/each}
            </div>
            <input type="text" placeholder="Find a zone…" bind:value={zoneFilter} />
            <div class="zones">
              {#each shownZones as z (z.Name + z.X0 + z.Y0)}
                <button class="zone" onclick={() => pickZone(z)}>{z.Name}</button>
              {/each}
              {#if !shownZones.length}<p class="dim">{clientError || 'No zones.'}</p>{/if}
            </div>
          </div>
          <div class="map">
            {#if continent}
              <MapPicker map={continent.Dir} bind:block maxSize={MAX_TILES} {focus} />
            {/if}
          </div>
        {/if}
      </div>
      <footer>
        <span class="dim grow">The ground, textures and models of those tiles open in a new tab. Saving writes them back to the client.</span>
        <button onclick={close}>Cancel</button>
        <button class="active" disabled={!block || !continent} onclick={open}>Open</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 100;
  }
  .dialog {
    width: 860px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    background: var(--header);
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  .modes {
    display: flex;
    gap: 2px;
    background: var(--bg);
    border-radius: var(--radius);
    padding: 2px;
  }
  .modes button {
    border: none;
    background: transparent;
    padding: 4px 14px;
  }
  .modes button.active {
    background: var(--panel-3);
    color: #fff;
  }
  .close {
    margin-left: auto;
    border: none;
    background: transparent;
    color: var(--text-dim);
  }
  .body {
    padding: 14px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .body.open {
    flex-direction: row;
    gap: 14px;
  }
  .dim {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .warn {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .row.bottom {
    align-items: center;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .field input[type='text'] {
    width: 200px;
  }
  .sizes {
    display: flex;
    gap: 4px;
  }
  .size {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 10px;
    line-height: 1.2;
  }
  .size small {
    font-size: 10px;
    color: var(--text-dim);
  }
  .size.active small {
    color: var(--accent-ink);
    opacity: 0.8;
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px;
    background: var(--bg);
    text-align: center;
  }
  .preset canvas {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    image-rendering: auto;
  }
  .preset small {
    font-size: 10px;
    color: var(--text-dim);
    line-height: 1.25;
  }
  .preset.active {
    background: var(--panel-3);
    border-color: var(--accent);
  }
  .preset.active small {
    color: var(--text);
  }
  .seedrow {
    display: flex;
    gap: 6px;
  }
  .seedrow input {
    width: 110px;
  }
  .id input {
    width: 90px;
  }
  .link {
    border: none;
    background: transparent;
    color: var(--text-dim);
    text-decoration: underline;
    padding: 0;
    align-self: flex-end;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }
  .grow {
    flex: 1;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 220px;
    flex: none;
  }
  .continents {
    display: flex;
    gap: 4px;
  }
  .continents button {
    flex: 1;
    padding: 4px;
  }
  .zones {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow-y: auto;
    max-height: 480px;
  }
  .zone {
    border: none;
    background: transparent;
    text-align: left;
    padding: 3px 8px;
    color: var(--text-dim);
    border-radius: var(--radius);
  }
  .zone:hover {
    background: var(--panel-2);
    color: var(--text);
  }
  .map {
    flex: 1;
    min-width: 0;
  }
</style>
