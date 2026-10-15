<script module lang="ts">
  /** The manual: the README of the project's repository, which Help › Manual opens in the browser. */
  export const MANUAL_URL = 'https://github.com/Coldensjo/WorldEditor#readme'
</script>

<script lang="ts">
  import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
  import Modal from './Modal.svelte'
  import GameLoginDialog from './GameLoginDialog.svelte'
  import MapPropertiesDialog from './MapPropertiesDialog.svelte'
  import GroundEffectsDialog from './GroundEffectsDialog.svelte'
  import WeaponPicker, { SLOTS } from './WeaponPicker.svelte'
  import { EquipmentFor } from '../../wailsjs/go/main/App'
  import { setStatus } from '../lib/state/editor.svelte'
  import { appLog, clearLog, docs, editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { hasBackend, openWowRegion, revertMap, saveAndPublish, saveSpawns } from '../lib/io/mapio'

  /** Keeps the Log window scrolled to its newest line while it is open. */
  function stickToEnd(el: HTMLElement) {
    const toEnd = () => (el.scrollTop = el.scrollHeight)
    toEnd()
    const obs = new MutationObserver(toEnd)
    obs.observe(el, { childList: true, subtree: true })
    return { destroy: () => obs.disconnect() }
  }

  function copyLog() {
    const text = appLog.lines.map((l) => `${l.time} ${l.text}`).join('\n')
    void navigator.clipboard?.writeText(text)
  }
  import { quitNow } from '../lib/io/session'
  import { APP_VERSION } from '../lib/version'

  const close = () => (ui.dialog = null)

  /** The spawn the weapon dialog is for, in the active map. */
  const weaponSpawn = $derived.by(() => {
    const p = ui.weaponPick
    return p ? (engineRef.current?.activeDocument().spawnLayer.get(p.key) ?? null) : null
  })

  /** Puts item `entry` (0 for none) in the dialog's slot: the equipment template with those items becomes the spawn's. */
  async function pickWeapon(entry: number) {
    const p = ui.weaponPick
    const s = weaponSpawn
    const engine = engineRef.current
    if (!p || !s || !engine) return close()
    const items = [...(s.equipItems ?? [0, 0, 0])] as number[]
    while (items.length < 3) items.push(0)
    items[p.slot] = entry
    close()
    try {
      const equipment = await EquipmentFor(items)
      await engine.editSpawn(p.key, { equipment, equipItems: items }, `${SLOTS[p.slot]} (${s.name})`)
    } catch (err) {
      setStatus(`Equipping failed: ${err}`, 8000)
    }
  }

  // The texture dialog's choices: palette indices.
  let texFrom = $state(0)
  let texTo = $state(1)
  const textureName = (p: string) => (p.startsWith('#') ? p : p.slice(p.lastIndexOf('\\') + 1).replace(/\.blp$/i, ''))

  /** The help window's sections: a title and short paragraphs each (Help › Help…, F1). */
  const HELP: Array<[string, string[]]> = [
    [
      'Getting started',
      [
        'Preferences › WoW client folder points Meld at your 1.12 client. Its doodads, buildings and tileset textures then fill the asset browser along the bottom; nothing is copied out of it.',
        'File › New World (Ctrl+N) makes a world of a few tiles from a preset, and File › Open Part of Azeroth opens a square of tiles of a continent with its ground, textures, models and water.',
        'Save (Ctrl+S) writes a .wmap file; for a map made for the client it also offers Publish, which writes the tiles into the client and builds the server\'s files. A part of Azeroth goes back into its tiles with File › Export Region to Client.',
      ],
    ],
    [
      'Tools (keys 1 to 9)',
      [
        'Select (1): click a model, Shift+click adds one, drag moves the selection; drag on the ground to select an area and the models in it. Alt+click is the pipette. I opens the Inspector with the placement numbers.',
        'Sculpt (2): raise, lower, smooth, flatten, noise, mountain, vertex and hole modes. Painting while shaping paints a texture, or rock and dirt by slope, under the brush as the ground moves.',
        'Paint (3): paints the texture picked in the browser; a chunk of 8x8 cells takes four textures, and the Layers panel shows the ones under the cursor. Mask mode marks ground to fill with one texture.',
        'Roads (4) paint a hard-edged texture and level the ground across it. Water (5) paints lakes and rivers by liquid type, or shapes the sea\'s shore; the sea level is in Map Properties.',
        'Place (6) puts down the model picked in the browser, onto the ground or onto a building. Clear (7) wipes textures or models under the brush. Doodad brush (8) scatters a brush of weighted models like paint; Edit › Doodad Brushes makes brushes. Map data (9) paints the zone each chunk belongs to, which the export writes into the tiles; Alt+click takes the zone of the chunk under the cursor.',
      ],
    ],
    [
      'Brushes and undo',
      [
        '[ and ] step the brush size, Shift+[ and ] the falloff, and Alt+right-drag sizes the brush where it stands. Ctrl+scroll also steps the size.',
        'Every edit is undoable with Ctrl+Z and Ctrl+Y, including strokes, placements, water and spawn changes.',
      ],
    ],
    [
      'Camera and view',
      [
        'Right-drag looks around, W A S D fly, Space and X go up and down, the wheel sets the speed; T follows the ground, so the camera orbits a point on it. F focuses the selection.',
        'Graphics has the time of day, shadows, fog, the grid and chunk lines, and the layers to show. Tab hides every panel but the menu bar. Hold F8 to name the part of the UI under the cursor for a bug report.',
      ],
    ],
  ]

  const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
    [
      'File',
      [
        ['Ctrl+N', 'New map'],
        ['Ctrl+O', 'Open map'],
        ['Ctrl+S', 'Save'],
        ['Ctrl+W', 'Close map tab'],
        ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous map tab'],
        ['Tab', 'Hide / show the panels (the menu bar stays)'],
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
        ['Right mouse drag', 'Look around (orbit when following the ground)'],
        ['Middle mouse drag', 'Slide sideways and up/down (pan when following the ground)'],
        ['Mouse wheel', 'Flight speed (zoom when following the ground)'],
        ['W A S D / arrows', 'Fly: W goes the way you look, A/D strafe (arrows nudge the object when one is selected)'],
        ['Space / X', 'Fly up / down'],
        ['Q / E', 'Rotate'],
        ['Shift / Ctrl+Shift', 'Fast / very fast'],
        ['T', 'Follow the ground on/off (on, the camera stays above the terrain; off, it can enter caves)'],
        ['U', 'Top-down view on/off: straight down with no perspective; the wheel zooms, Q/E or a right drag turn the map'],
        ['M', 'Minimap window: the map from above with the camera\'s spot; a click moves the camera there'],
        ['F', 'Focus selected object'],
      ],
    ],
    [
      'Tools',
      [
        ['1 – 9', 'Select, Sculpt, Paint, Roads, Water, Place, Clear, Doodad brush, Map data'],
        ['V / B', 'Select / Paint'],
        ['Alt+click', 'Pipette: pick the model under the cursor to place, or the texture to paint with'],
        ['Click, Shift+click', 'Select a model, add or remove one (Select tool)'],
        ['Drag on the ground', 'Select an area and the models in it (Select tool)'],
        ['[ / ], Ctrl+scroll', 'Brush smaller / larger (fine steps when small, coarse when big)'],
        ['Shift+[ / Shift+]', 'Brush falloff softer / harder'],
        ['Alt+right-drag', 'Size the brush where it stands: sideways for the size, up and down for the falloff'],
        ['Arrow keys', 'Move selected object (camera-relative)'],
        ['Alt+↑ / Alt+↓, PgUp / PgDn', 'Raise / lower selected object'],
        ['Alt+← / Alt+→', 'Spin selected object 5°'],
        ['R / Shift+R', 'Spin selected object 15° (or the placement preview)'],
        ['Shift + arrows', 'Bigger steps'],
        ['Ctrl+scroll', 'Rotate the placement preview (Place tool)'],
        ['PgUp / PgDn', 'Raise / lower the placement preview (Place tool, nothing selected)'],
        ['Arrow keys', 'Move the placement preview away from the cursor (Place tool, nothing selected; Shift for bigger steps)'],
        ['Shift+scroll', 'Scale the placement preview (Place tool; doodads only, the client draws buildings at full size)'],
        ['Shift+drag', 'Scatter (Place tool)'],
        ['Ctrl+scroll, R', 'Spin the preview about the brush (Doodad brush tool)'],
        ['Shift+drag', 'Stack models on top of each other, ignoring the spacing (Doodad brush tool)'],
        ['Ctrl+drag', "Erase the brush's models (Doodad brush tool)"],
        ['Delete', 'Delete the selected models'],
        ['Ctrl+C / Ctrl+V', 'Copy the selected models (or area) / paste under the cursor'],
        ['Ctrl+Shift+D', 'Duplicate the selected models in place'],
        ['Esc', 'Deselect'],
        ['G', 'Toggle grid'],
        ['I', 'Inspector: the selected model\'s placement numbers and actions (Esc closes it)'],
        ['Hold F8', 'Name the part of the UI under the cursor (for bug reports)'],
      ],
    ],
  ]
</script>

{#if ui.dialog === 'about'}
  <Modal title="About Meld" onclose={close}>
    <div class="about">
      <div class="logo">⛰</div>
      <div>
        <p class="name">Meld <span>v{APP_VERSION}</span></p>
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
{:else if ui.dialog === 'help'}
  <Modal title="Help" width={560} onclose={close}>
    {#each HELP as [title, paragraphs] (title)}
      <h3>{title}</h3>
      {#each paragraphs as text (text)}
        <p class="help">{text}</p>
      {/each}
    {/each}
    <p class="dim">The manual is the project's README, with every tool, menu and format in full.</p>
    {#snippet actions()}
      <button onclick={() => (hasBackend() ? BrowserOpenURL(MANUAL_URL) : window.open(MANUAL_URL, '_blank', 'noopener'))}>Open the manual</button>
      <button onclick={() => (ui.dialog = 'shortcuts')}>Keyboard shortcuts</button>
      <button class="active" onclick={close}>Close</button>
    {/snippet}
  </Modal>
{:else if ui.dialog === 'log'}
  <Modal title="Log" width={640} onclose={close}>
    <div class="log" use:stickToEnd>
      {#each appLog.lines as l, i (i)}
        <div><span class="time">{l.time}</span>{l.text}</div>
      {:else}
        <p class="dim">Nothing yet. Status messages, the progress of exports and (with Preferences › Log file loading) every file read from the client appear here.</p>
      {/each}
    </div>
    {#snippet actions()}
      <label class="check"><input type="checkbox" bind:checked={prefs.logFileLoading} /> Log file loading</label>
      <button onclick={copyLog} disabled={!appLog.lines.length}>Copy</button>
      <button onclick={clearLog} disabled={!appLog.lines.length}>Clear</button>
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
{:else if ui.dialog === 'saveSpawns'}
  <Modal title="Save spawns to the world database" width={400} onclose={close}>
    <p>
      Write {ui.spawnChanges}
      {ui.spawnChanges === 1 ? 'change' : 'changes'} to the creatures and game objects of {editor.region} into the server's world database?
    </p>
    <p class="dim">
      The world database keeps no undo. The SQL that is run is kept in the user cache folder (Meld/spawn-sql). Restart the world server
      to see the changes in the game.
    </p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button
        class="active"
        onclick={() => {
          const e = engineRef.current
          close()
          if (e) saveSpawns(e)
        }}>Save</button
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
{:else if ui.dialog === 'effects'}
  <GroundEffectsDialog onclose={close} />
{:else if ui.dialog === 'weapon' && ui.weaponPick}
  <Modal title="{SLOTS[ui.weaponPick.slot]}{weaponSpawn ? ` of ${weaponSpawn.name}` : ''}" width={980} onclose={close}>
    <WeaponPicker which={ui.weaponPick.slot} selected={weaponSpawn?.equipItems?.[ui.weaponPick.slot] ?? 0} onpick={pickWeapon} />
  </Modal>
{:else if ui.dialog === 'mapProps'}
  <MapPropertiesDialog onclose={close} />
{:else if ui.dialog === 'quit'}
  <Modal title="Unsaved changes" width={380} onclose={close}>
    <p>Some open maps have unsaved changes. Quit anyway?</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button class="danger" onclick={() => quitNow()}>Quit without saving</button>
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
  .help {
    margin: 4px 0;
    font-size: 12.5px;
    line-height: 1.45;
  }
  .log {
    max-height: 60vh;
    overflow: auto;
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log .time {
    color: var(--text-dim);
    margin-right: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: auto;
    font-size: 12px;
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
