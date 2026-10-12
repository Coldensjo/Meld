<script lang="ts">
  import Modal from './Modal.svelte'
  import TileMinimap, { type Block } from './TileMinimap.svelte'
  import GameLoginDialog from './GameLoginDialog.svelte'
  import { docs, editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { openWowRegion, revertMap, saveAndPublish } from '../lib/io/mapio'
  import { Quit } from '../../wailsjs/go/main/App'
  import { APP_VERSION } from '../lib/version'
  import { SvelteSet } from 'svelte/reactivity'

  const close = () => (ui.dialog = null)

  // The open-region dialog: the map's name, and the tiles picked on the minimap ("x,y" keys). A
  // region is a square block of tiles up to 16 a side, so the editor opens the smallest square that
  // covers the picks.
  const MAX_REGION = 16
  const MAP_TILES = 64
  let tileMap = $state('Azeroth')
  const picked = new SvelteSet<string>(Array.from({ length: 16 }, (_, i) => `${32 + (i % 4)},${48 + Math.floor(i / 4)}`))
  const block = $derived.by((): Block | null => {
    if (picked.size === 0) return null
    let minX = MAP_TILES
    let minY = MAP_TILES
    let maxX = -1
    let maxY = -1
    for (const key of picked) {
      const [x, y] = key.split(',').map(Number)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const size = Math.max(maxX - minX + 1, maxY - minY + 1)
    if (size > MAX_REGION) return null
    // Shift the square back onto the map if it runs off the far edge; it still covers every pick.
    return { x: Math.min(minX, MAP_TILES - size), y: Math.min(minY, MAP_TILES - size), size }
  })
  const blockText = $derived(
    block
      ? `Opens tiles ${block.x}–${block.x + block.size - 1} × ${block.y}–${block.y + block.size - 1} (${block.size}×${block.size})`
      : picked.size === 0
        ? 'Click tiles on the map to select them.'
        : `The selection spans more than ${MAX_REGION} tiles across. Narrow it down.`,
  )

  // The texture dialog's choices: palette indices.
  let texFrom = $state(0)
  let texTo = $state(1)
  const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

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
{:else if ui.dialog === 'revert'}
  <Modal title="Revert to saved" width={380} onclose={close}>
    <p>Discard the unsaved changes to “{editor.mapName}” and reload it from {editor.filePath}? This can't be undone.</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="danger"
        onclick={() => {
          const engine = engineRef.current
          close()
          if (engine) revertMap(engine)
        }}>Revert</button
      >
    {/snippet}
  </Modal>
{:else if ui.dialog === 'openTile'}
  <Modal title="Open a WoW region" width={380} onclose={close}>
    <p class="dim">
      Read from your WoW 1.12 client. Click tiles to select them; click again to deselect. The editor opens the smallest square that
      covers your selection, outlined in orange, with its ground, paint and models.
    </p>
    <div class="fields">
      <label for="tile-map">Map</label>
      <input id="tile-map" type="text" bind:value={tileMap} />
    </div>
    <div class="pick">
      <TileMinimap {picked} open={block} interactive />
    </div>
    <p class="dim status">{blockText}</p>
    {#snippet actions()}
      <button disabled={picked.size === 0} onclick={() => picked.clear()}>Clear selection</button>
      <button onclick={close}>Cancel</button>
      <button
        class="active"
        disabled={!block || tileMap.trim() === ''}
        onclick={() => {
          const e = engineRef.current
          close()
          if (e && block) openWowRegion(e, tileMap.trim(), block.x, block.y, block.size)
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
{:else if ui.dialog === 'gameLogin'}
  <GameLoginDialog />
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
  .pick {
    margin-top: 12px;
  }
  .status {
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
