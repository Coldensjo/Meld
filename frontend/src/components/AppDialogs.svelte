<script module lang="ts">
  /** The manual (docs/MANUAL.md in the project's repository), which Help › Manual opens in the browser. */
  export const MANUAL_URL = 'https://github.com/Coldensjo/3dgame/blob/main/editor/docs/MANUAL.md'
</script>

<script lang="ts">
  import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
  import Modal from './Modal.svelte'
  import ProjectDialog from './ProjectDialog.svelte'
  import MapPropertiesDialog from './MapPropertiesDialog.svelte'
  import TextureIdsDialog from './TextureIdsDialog.svelte'
  import SpriteModelDialog from './SpriteModelDialog.svelte'
  import RecoveryDialog from './RecoveryDialog.svelte'
  import { appLog, clearLog, docs, editor, prefs, ui } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { hasBackend, revertMap } from '../lib/io/mapio'

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

  /** The help window's sections: a title and short paragraphs each (Help › Help…, F1). */
  const HELP: Array<[string, string[]]> = [
    [
      'Getting started',
      [
        'File › New Cube World (Ctrl+N) makes a world of the game: its size in chunks of 16 x 16 cubes on every one of its 31 layers, empty or filled by the layers\' themes. File › Open opens a .world file.',
        'Save (Ctrl+S) writes the world in the game\'s world format, a .world file the server and the client load. Game › Play World starts the game in it where the camera is.',
      ],
    ],
    [
      'Tools',
      [
        'Cubes (Y): put the cube picked in the palette below against the face clicked, remove or replace cubes, fill a box, attach doors, windows, levers, buttons, teleporters and torches, paint faces, place monsters and NPCs, and place, move and turn props (models of the game). R turns the cube, Alt+click copies one.',
        'Select (V, 1): drag from a cube to a cube to select the box between them. Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste it (into another world too), the arrows and PgUp/PgDn move it, Del empties it, J joins its cubes into one object.',
        'Every edit is undoable with Ctrl+Z and Ctrl+Y; Edit › History goes back to any step.',
      ],
    ],
    [
      'Camera and view',
      [
        'Right-drag looks around, W A S D fly, Space and X go up and down, the wheel sets the speed. U is the top-down view and M the minimap of the layer the camera is in.',
        ', and . slice the layers, to work underground (View › Layer slice). Lighting has the time of day, shadows, clouds and fog. Tab hides every panel but the menu bar. Hold F8 to name the part of the UI under the cursor for a bug report.',
      ],
    ],
  ]

  /** The keyboard shortcuts window's groups (Help › Keyboard Shortcuts). */
  const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
    [
      'File',
      [
        ['Ctrl+N', 'New cube world'],
        ['Ctrl+O', 'Open a world'],
        ['Ctrl+S', 'Save'],
        ['Ctrl+Shift+S', 'Save as'],
        ['Ctrl+W', 'Close the world\'s tab'],
        ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
        ['Tab', 'Hide / show the panels (the menu bar stays)'],
        ['F11', 'Full screen on / off'],
        ['Ctrl+= / Ctrl+- / Ctrl+0', 'Interface larger / smaller / back to 100 %'],
        ['Ctrl+Shift+M', 'Performance overlay on / off: where the frame time goes'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
        ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut the selected cubes / paste them (also into another tab)'],
        ['Ctrl+D', 'Deselect'],
        ['Ctrl+B', 'Bookmark the view'],
      ],
    ],
    [
      'Camera',
      [
        ['Right mouse drag', 'Look around'],
        ['Middle mouse drag', 'Slide sideways and up/down'],
        ['Mouse wheel', 'Flight speed'],
        ['W A S D / arrows', 'Fly: W goes the way you look, A/D strafe (the arrows move the selected cubes in the Select tool)'],
        ['Space / X', 'Fly up / down'],
        ['Q / E', 'Rotate'],
        ['Shift / Ctrl+Shift', 'Fast / very fast'],
        ['P / O', 'Camera faster / slower'],
        ['U', 'Top-down view on/off: straight down with no perspective; the wheel zooms, Q/E or a right drag turn the view'],
        [', / .', 'Slice the layers a layer up or down, showing only that layer and those below it (View › Layer slice)'],
        ['M', 'Minimap window: the camera\'s layer from above with its spot; a click moves the camera there'],
        ['N / Shift+N', 'Day cycle faster / slower (a day in 40, 20, 10, 5, 2 or 1 min; slower than 40 pauses it)'],
        ['J', 'Pause / run the day cycle'],
      ],
    ],
    [
      'Tools',
      [
        ['Y', 'Cubes'],
        ['V, 1', 'Select'],
        ['R / Shift+R', 'Turn the cube a quarter / upside down (Cubes); turn the paste (Select)'],
        ['Alt+click', 'Copy the cube under the cursor (Cubes)'],
        ['Ctrl+click', 'Remove (Cubes)'],
        ['M / Shift+M', 'Mirror the paste east to west / north to south (Select)'],
        ['Arrow keys, PgUp / PgDn', 'Move the selected cubes a column / a layer (Select)'],
        ['J / Shift+J', 'Join the selected cubes into one object / split the groups (Select)'],
        ['Delete', 'Empty the selected box (Select), remove the selected object, NPC or prop (Cubes)'],
        ['Enter / Esc', 'Place / cancel a paste'],
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
        <p>The world editor of 3dgame: build its cube worlds, their openings, objects, monsters, NPCs and props, and play them.</p>
        <p class="dim">Built with Wails (Go), Svelte 5 and Three.js, from Meld.</p>
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
    <p class="dim">The manual has every tool, menu and format in full.</p>
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
        <p class="dim">Nothing yet. Status messages appear here.</p>
      {/each}
    </div>
    {#snippet actions()}
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
          {#each rows as [key, what] (key + what)}
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
    <p>“{tab?.name ?? 'This world'}” has unsaved changes. Close it anyway?</p>
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
{:else if ui.dialog === 'mapProps'}
  <MapPropertiesDialog onclose={close} />
{:else if ui.dialog === 'textures'}
  <TextureIdsDialog onclose={close} />
{:else if ui.dialog === 'spriteModel'}
  <SpriteModelDialog onclose={close} />
{:else if ui.dialog === 'quit'}
  <Modal title="Unsaved changes" width={380} onclose={close}>
    <p>Some open worlds have unsaved changes. Quit anyway?</p>
    {#snippet actions()}
      <button onclick={close}>Cancel</button>
      <button class="danger" onclick={() => quitNow()}>Quit without saving</button>
    {/snippet}
  </Modal>
{:else if ui.dialog === 'recovery'}
  <RecoveryDialog onclose={close} />
{:else if ui.dialog === 'project'}
  <ProjectDialog onclose={close} />
{/if}

<style>
  .about {
    display: flex;
    gap: 14px;
  }
  .logo {
    font-size: 40px;
    line-height: 1;
    color: var(--accent-text);
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
    max-height: calc(60 * var(--vh));
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
