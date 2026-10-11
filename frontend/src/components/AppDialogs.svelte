<script lang="ts">
  import Modal from './Modal.svelte'
  import { docs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { openWowTile, saveAndPublish } from '../lib/io/mapio'
  import { Quit } from '../../wailsjs/go/main/App'
  import { APP_VERSION } from '../lib/version'

  const close = () => (ui.dialog = null)

  // The open-tile dialog's fields. A 1.12 map is 64x64 tiles, so X and Y run 0 to 63.
  let tileMap = $state('Azeroth')
  let tileX = $state(32)
  let tileY = $state(48)
  const tileValid = $derived(tileMap.trim() !== '' && Number.isInteger(tileX) && Number.isInteger(tileY) && tileX >= 0 && tileX < 64 && tileY >= 0 && tileY < 64)

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
  <Modal title="Open a WoW tile" width={360} onclose={close}>
    <p class="dim">Read from your WoW 1.12 client. A tile's ground, paint and objects open as one map of 128 × 128 cells.</p>
    <div class="fields">
      <label for="tile-map">Map</label>
      <input id="tile-map" type="text" bind:value={tileMap} />
      <label for="tile-x">X</label>
      <input id="tile-x" type="number" min="0" max="63" bind:value={tileX} />
      <label for="tile-y">Y</label>
      <input id="tile-y" type="number" min="0" max="63" bind:value={tileY} />
    </div>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="active"
        disabled={!tileValid}
        onclick={() => {
          const e = engineRef.current
          close()
          if (e) openWowTile(e, tileMap.trim(), tileX, tileY)
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
