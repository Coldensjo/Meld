<script lang="ts">
  import Modal from './Modal.svelte'
  import GameLoginDialog from './GameLoginDialog.svelte'
  import MapPropertiesDialog from './MapPropertiesDialog.svelte'
  import GroundEffectsDialog from './GroundEffectsDialog.svelte'
  import WeaponPicker, { SLOTS } from './WeaponPicker.svelte'
  import { EquipmentFor } from '../../wailsjs/go/main/App'
  import { setStatus } from '../lib/state/editor.svelte'
  import { docs, editor, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { openWowRegion, revertMap, saveAndPublish, saveSpawns } from '../lib/io/mapio'
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
        ['Right mouse drag', 'Look around (orbit when following the ground)'],
        ['Middle mouse drag', 'Slide sideways and up/down (pan when following the ground)'],
        ['Mouse wheel', 'Flight speed (zoom when following the ground)'],
        ['W A S D / arrows', 'Fly: W goes the way you look, A/D strafe (arrows nudge the object when one is selected)'],
        ['Space / X', 'Fly up / down'],
        ['Q / E', 'Rotate'],
        ['Shift / Ctrl+Shift', 'Fast / very fast'],
        ['T', 'Follow the ground on/off (on, the camera stays above the terrain; off, it can enter caves)'],
        ['F', 'Focus selected object'],
      ],
    ],
    [
      'Tools',
      [
        ['1 – 8', 'Select, Sculpt, Paint, Roads, Water, Place, Clear, Doodad brush'],
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
