<script lang="ts">
  import Modal from './Modal.svelte'
  import { ui } from '../lib/state/editor.svelte'
  import { Quit } from '../../wailsjs/go/main/App'
  import { APP_VERSION } from '../lib/version'

  const close = () => (ui.dialog = null)

  const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
    [
      'File',
      [
        ['Ctrl+N', 'New map'],
        ['Ctrl+O', 'Open map'],
        ['Ctrl+S', 'Save'],
        ['Ctrl+Shift+S', 'Save as'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
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
        ['1 – 6', 'Select, Sculpt, Paint, Roads, Water, Place'],
        ['[ / ]', 'Brush smaller / larger'],
        ['Arrow keys', 'Move selected object (camera-relative)'],
        ['Alt+↑ / Alt+↓, PgUp / PgDn', 'Raise / lower selected object'],
        ['Alt+← / Alt+→', 'Spin selected object 5°'],
        ['R / Shift+R', 'Spin selected object 15° (or the placement preview)'],
        ['Shift + arrows', 'Bigger steps'],
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
{:else if ui.dialog === 'quit'}
  <Modal title="Unsaved changes" width={380} onclose={close}>
    <p>The current map has unsaved changes. Quit anyway?</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button class="danger" onclick={() => Quit()}>Quit without saving</button>
    {/snippet}
  </Modal>
{/if}

<style>
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
