<script lang="ts">
  import Modal from './Modal.svelte'
  import { docs, editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { openWowRegion, saveAndPublish } from '../lib/io/mapio'
  import { Quit } from '../../wailsjs/go/main/App'
  import { APP_VERSION } from '../lib/version'

  const close = () => (ui.dialog = null)

  // The open-region dialog's fields. A 1.12 map is 64x64 tiles; a region is a square block of up to 16.
  let tileMap = $state('Azeroth')
  let tileX = $state(32)
  let tileY = $state(48)
  let tileSize = $state(4)

  // The texture dialog's choices: palette indices.
  let texFrom = $state(0)
  let texTo = $state(1)
  const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))
  const tileValid = $derived(
    tileMap.trim() !== '' &&
      Number.isInteger(tileX) &&
      Number.isInteger(tileY) &&
      Number.isInteger(tileSize) &&
      tileSize >= 1 &&
      tileSize <= 16 &&
      tileX >= 0 &&
      tileY >= 0 &&
      tileX + tileSize <= 64 &&
      tileY + tileSize <= 64,
  )

  // The 64 x 64 tile map's grid lines, as one path, for the open dialog's preview.
  const TILE_GRID = Array.from({ length: 65 }, (_, i) => `M0 ${i}H64M${i} 0V64`).join('')

  const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
    [
      'File',
      [
        ['Ctrl+N', 'New map'],
        ['Ctrl+O', 'Open map'],
        ['Ctrl+S', 'Save'],
        ['Ctrl+W', 'Close map tab'],
        ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous map tab'],
        ['Ctrl+Shift+S', 'Save as'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
        ['Ctrl+C / Ctrl+V', 'Copy selection / Paste (also into another map tab)'],
        ['Ctrl+A / Ctrl+D', 'Select all / Deselect'],
        ['Enter / Esc', 'Place / cancel a paste'],
        ['PgUp / PgDn', 'Raise / lower the paste while placing'],
      ],
    ],
    [
      'Camera',
      [
        ['Right mouse drag', 'Orbit'],
        ['Middle mouse drag', 'Pan'],
        ['Mouse wheel', 'Zoom'],
        ['W A S D / arrows', 'Move (arrows nudge the object when one is selected)'],
        ['Q / E', 'Rotate'],
        ['Shift', 'Move faster'],
        ['F', 'Focus selected object'],
      ],
    ],
    [
      'Tools',
      [
        ['1 – 7', 'Select, Marquee, Sculpt, Paint, Roads, Water, Place'],
        ['V / M / B', 'Select / Marquee / Paint'],
        ['[ / ]', 'Brush smaller / larger'],
        ['Arrow keys', 'Move selected object (camera-relative)'],
        ['Alt+↑ / Alt+↓, PgUp / PgDn', 'Raise / lower selected object'],
        ['Alt+← / Alt+→', 'Spin selected object 5°'],
        ['R / Shift+R', 'Spin selected object 15° (or the placement preview)'],
        ['Shift + arrows', 'Bigger steps'],
        ['Ctrl+scroll', 'Rotate the placement preview (Place tool)'],
        ['Alt+scroll', 'Raise / lower the placement preview (Place tool)'],
        ['Shift+drag', 'Scatter (Place tool)'],
        ['Delete', 'Delete selected object'],
        ['Esc', 'Deselect'],
        ['G', 'Toggle grid'],
      ],
    ],
  ]
</script>

{#if ui.dialog === 'about'}
  <Modal title="About WorldEditor" onclose={close}>
    <div class="about">
      <div class="logo">⛰</div>
      <div>
        <p class="name">WorldEditor <span>v{APP_VERSION}</span></p>
        <p>A 3D world editor for building WoW-style landscapes: sculpt terrain, paint textures, shape water and roads, and place doodads and buildings.</p>
        <p class="dim">Built with Wails (Go), Svelte 5 and Three.js.</p>
        <p class="dim">
          Models and textures are read at runtime from your own World of Warcraft 1.12 client. No game assets are included with or
          distributed by this application. World of Warcraft is a trademark of Blizzard Entertainment, Inc.; this project is not affiliated
          with or endorsed by Blizzard.
        </p>
      </div>
    </div>
    {#snippet actions()}
      <button class="active" onclick={close}>Close</button>
    {/snippet}
  </Modal>
{:else if ui.dialog === 'shortcuts'}
  <Modal title="Keyboard Shortcuts" width={520} onclose={close}>
    {#each SHORTCUTS as [group, rows] (group)}
      <h3>{group}</h3>
      <table>
        <tbody>
          {#each rows as [key, what] (key)}
            <tr><td><kbd>{key}</kbd></td><td>{what}</td></tr>
          {/each}
        </tbody>
      </table>
    {/each}
    {#snippet actions()}
      <button class="active" onclick={close}>Close</button>
    {/snippet}
  </Modal>
{:else if ui.dialog === 'closeDoc'}
  {@const tab = docs.tabs.find((t) => t.id === ui.closeDocId)}
  <Modal title="Unsaved changes" width={380} onclose={close}>
    <p>“{tab?.name ?? 'This map'}” has unsaved changes. Close it anyway?</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="danger"
        onclick={() => {
          engineRef.current?.closeDocument(ui.closeDocId)
          close()
        }}>Close without saving</button
      >
    {/snippet}
  </Modal>
{:else if ui.dialog === 'openTile'}
  <Modal title="Open a WoW region" width={360} onclose={close}>
    <p class="dim">
      Read from your WoW 1.12 client. A square block of tiles opens as one map: its ground, paint and models. A block of N tiles a side is
      N × 128 cells a side, up to 16 tiles.
    </p>
    <div class="fields">
      <label for="tile-map">Map</label>
      <input id="tile-map" type="text" bind:value={tileMap} />
      <label for="tile-x">From X</label>
      <input id="tile-x" type="number" min="0" max="63" bind:value={tileX} />
      <label for="tile-y">From Y</label>
      <input id="tile-y" type="number" min="0" max="63" bind:value={tileY} />
      <label for="tile-size">Tiles</label>
      <input id="tile-size" type="number" min="1" max="16" bind:value={tileSize} />
    </div>
    <div class="map-preview">
      <svg viewBox="0 0 64 64" role="img" aria-label="The 64 by 64 tile map, with the chosen block highlighted">
        <path d={TILE_GRID} class="lines" />
        {#if tileValid}
          <rect x={tileX} y={tileY} width={tileSize} height={tileSize} class="pick" />
        {/if}
      </svg>
      <p class="dim">
        {tileValid
          ? `Tiles ${tileX}–${tileX + tileSize - 1} × ${tileY}–${tileY + tileSize - 1} of the 64 × 64 map`
          : 'The block must fit inside the 64 × 64 map.'}
      </p>
    </div>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="active"
        disabled={!tileValid}
        onclick={() => {
          const e = engineRef.current
          close()
          if (e) openWowRegion(e, tileMap.trim(), tileX, tileY, tileSize)
        }}>Open</button
      >
    {/snippet}
  </Modal>
{:else if ui.dialog === 'publish'}
  <Modal title="Publish to the server" width={400} onclose={close}>
    <p>Publishing rebuilds this map for the server and the client. It writes the map into your WoW client's patch, then stops the world server, extracts the map again (several minutes), and starts the server.</p>
    <p class="warn">Players on the server will be disconnected. Close World of Warcraft first, or it can't update its patch.</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="active"
        onclick={() => {
          const e = engineRef.current
          close()
          if (e) saveAndPublish(e)
        }}>Save and publish</button
      >
    {/snippet}
  </Modal>
{:else if ui.dialog === 'textures'}
  <Modal title="Replace textures" width={380} onclose={close}>
    <p class="dim">Replaces a texture everywhere on the map. A chunk that already uses the new texture merges the two.</p>
    <div class="fields">
      <label for="tex-from">Replace</label>
      <select id="tex-from" bind:value={texFrom}>
        {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
      </select>
      <label for="tex-to">With</label>
      <select id="tex-to" bind:value={texTo}>
        {#each editor.palette as p, i (i)}<option value={i}>{textureName(p)}</option>{/each}
      </select>
    </div>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        title="Make the whole map the texture on the right"
        onclick={() => {
          engineRef.current?.fillTextures(texTo)
          close()
        }}>Fill whole map</button
      >
      <button
        class="active"
        disabled={texFrom === texTo}
        onclick={() => {
          engineRef.current?.swapTexture(texFrom, texTo)
          close()
        }}>Replace</button
      >
    {/snippet}
  </Modal>
{:else if ui.dialog === 'quit'}
  <Modal title="Unsaved changes" width={380} onclose={close}>
    <p>Some open maps have unsaved changes. Quit anyway?</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button class="danger" onclick={() => Quit()}>Quit without saving</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .fields {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .fields input {
    width: 100%;
  }
  .map-preview {
    margin-top: 14px;
  }
  .map-preview svg {
    display: block;
    width: 100%;
    max-width: 288px;
    aspect-ratio: 1;
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .map-preview .lines {
    fill: none;
    stroke: var(--text-dim);
    stroke-opacity: 0.35;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .map-preview .pick {
    fill: var(--accent);
    fill-opacity: 0.35;
    stroke: var(--accent);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .map-preview p {
    margin: 6px 0 0;
  }
  .about {
    display: flex;
    gap: 14px;
  }
  .logo {
    font-size: 40px;
    line-height: 1;
    color: var(--accent-2);
  }
  .name {
    margin-top: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .name span {
    font-weight: 400;
    color: var(--text-dim);
    font-size: 13px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }
  h3 {
    margin-top: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 3px 0;
    vertical-align: top;
  }
  td:first-child {
    width: 46%;
  }
  .danger {
    background: var(--danger);
    border-color: var(--danger);
    color: #fff;
  }
</style>
