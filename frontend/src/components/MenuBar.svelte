<script lang="ts">
  import { editor, prefs, setStatus, ui, wow } from '../lib/state/editor.svelte'
  import { engineRef } from '../lib/state/engineRef'
  import { hasBackend, openMap, saveMap } from '../lib/io/mapio'
  import { chooseWowFolder } from '../lib/wow/api'
  import { ClearThumbnailCache, Quit } from '../../wailsjs/go/main/App'
  import { requestClose } from './DocTabs.svelte'

  type Item =
    | { kind: 'action'; label: string; shortcut?: string; disabled?: boolean; run: () => unknown }
    | { kind: 'check'; label: string; shortcut?: string; checked: boolean; toggle: () => void }
    | { kind: 'radio'; label: string; checked: boolean; select: () => void }
    | { kind: 'header'; label: string }
    | { kind: 'sep' }

  const withEngine = (fn: (e: NonNullable<typeof engineRef.current>) => unknown) => () => {
    if (engineRef.current) fn(engineRef.current)
  }

  function exit() {
    if (engineRef.current?.anyDirty()) ui.dialog = 'quit'
    else if (hasBackend()) Quit()
  }

  async function clearThumbs() {
    try {
      await ClearThumbnailCache()
      setStatus('Thumbnail cache cleared. Thumbnails will re-render as you browse (after restart for ones already shown).')
    } catch (e) {
      setStatus(`Could not clear cache: ${e}`)
    }
  }

  const radios = <T,>(options: Array<[string, T]>, get: () => T, set: (v: T) => void): Item[] =>
    options.map(([label, v]) => ({ kind: 'radio', label, checked: get() === v, select: () => set(v) }))

  // Rebuilt reactively so checkmarks and enabled states stay current.
  const menus = $derived<Array<{ name: string; items: Item[] }>>([
    {
      name: 'File',
      items: [
        { kind: 'action', label: 'New Map…', shortcut: 'Ctrl+N', run: () => (ui.showNewDialog = true) },
        { kind: 'action', label: 'Open…', shortcut: 'Ctrl+O', disabled: ui.busy, run: withEngine(openMap) },
        { kind: 'sep' },
        { kind: 'action', label: 'Save', shortcut: 'Ctrl+S', disabled: ui.busy, run: withEngine((e) => saveMap(e)) },
        { kind: 'action', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: ui.busy, run: withEngine((e) => saveMap(e, true)) },
        { kind: 'action', label: 'Close Map', shortcut: 'Ctrl+W', run: withEngine((e) => requestClose(e.activeDocumentId())) },
        { kind: 'sep' },
        { kind: 'action', label: 'Exit', run: exit },
      ],
    },
    {
      name: 'Edit',
      items: [
        { kind: 'action', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !ui.canUndo, run: withEngine((e) => e.undo()) },
        { kind: 'action', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !ui.canRedo, run: withEngine((e) => e.redo()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Copy', shortcut: 'Ctrl+C', disabled: !editor.selection, run: withEngine((e) => e.copySelection()) },
        { kind: 'action', label: 'Paste', shortcut: 'Ctrl+V', disabled: !ui.hasClip, run: withEngine((e) => e.startPaste()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Select All', shortcut: 'Ctrl+A', run: withEngine((e) => { e.selectAll(); editor.tool = 'marquee' }) },
        { kind: 'action', label: 'Deselect', shortcut: 'Ctrl+D', disabled: !editor.selection, run: withEngine((e) => e.deselect()) },
      ],
    },
    {
      name: 'Graphics',
      items: [
        { kind: 'header', label: 'Render scale' },
        ...radios(
          [
            ['50% (fastest)', 0.5],
            ['75%', 0.75],
            ['100%', 1],
            ['150% (sharper)', 1.5],
          ],
          () => prefs.renderScale,
          (v) => (prefs.renderScale = v),
        ),
        { kind: 'sep' },
        { kind: 'header', label: 'View distance' },
        ...radios(
          [
            ['Near', 0.6],
            ['Normal', 1],
            ['Far', 1.8],
          ],
          () => prefs.viewDistance,
          (v) => (prefs.viewDistance = v),
        ),
        { kind: 'sep' },
        { kind: 'check', label: 'Fog', checked: prefs.fog, toggle: () => (prefs.fog = !prefs.fog) },
        { kind: 'check', label: 'Water', checked: editor.waterEnabled, toggle: () => (editor.waterEnabled = !editor.waterEnabled) },
        { kind: 'check', label: 'Automatic cliff rock', checked: editor.autoCliff, toggle: () => (editor.autoCliff = !editor.autoCliff) },
        { kind: 'check', label: 'Show grid', shortcut: 'G', checked: editor.grid, toggle: () => (editor.grid = !editor.grid) },
      ],
    },
    {
      name: 'Preferences',
      items: [
        { kind: 'action', label: wow.loaded ? 'Change WoW Client Folder…' : 'Select WoW Client Folder…', disabled: !hasBackend(), run: chooseWowFolder },
        { kind: 'action', label: 'Clear Thumbnail Cache', disabled: !wow.loaded, run: clearThumbs },
        { kind: 'sep' },
        { kind: 'header', label: 'Camera speed' },
        ...radios(
          [
            ['Slow', 0.5],
            ['Normal', 1],
            ['Fast', 2],
          ],
          () => prefs.cameraSpeed,
          (v) => (prefs.cameraSpeed = v),
        ),
        { kind: 'sep' },
        { kind: 'header', label: 'Mouse sensitivity' },
        ...radios(
          [
            ['Low', 0.6],
            ['Normal', 1],
            ['High', 1.6],
          ],
          () => prefs.mouseSensitivity,
          (v) => (prefs.mouseSensitivity = v),
        ),
        { kind: 'sep' },
        { kind: 'check', label: 'Invert camera Y', checked: prefs.invertY, toggle: () => (prefs.invertY = !prefs.invertY) },
      ],
    },
    {
      name: 'About',
      items: [
        { kind: 'action', label: 'Keyboard Shortcuts…', run: () => (ui.dialog = 'shortcuts') },
        { kind: 'sep' },
        { kind: 'action', label: 'About WorldEditor…', run: () => (ui.dialog = 'about') },
      ],
    },
  ])

  // Classic menubar behaviour: click opens, hovering another title while
  // open switches menus, click outside / Esc closes.
  let open = $state<string | null>(null)
  let bar: HTMLElement

  function activate(item: Item) {
    if (item.kind === 'action') {
      if (item.disabled) return
      open = null
      item.run()
    } else if (item.kind === 'check') {
      item.toggle()
    } else if (item.kind === 'radio') {
      item.select()
    }
  }

  function onWindowPointer(e: PointerEvent) {
    if (open && !bar.contains(e.target as Node)) open = null
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(e) => open && e.key === 'Escape' && (open = null)} onblur={() => (open = null)} />

<header class="menubar" bind:this={bar}>
  <span class="brand">⛰ WorldEditor</span>
  <nav class="menus">
    {#each menus as m (m.name)}
      <div class="menu">
        <button
          class="title"
          class:open={open === m.name}
          onclick={() => (open = open === m.name ? null : m.name)}
          onpointerenter={() => open && (open = m.name)}
        >
          {m.name}
        </button>
        {#if open === m.name}
          <div class="dropdown" role="menu">
            {#each m.items as item, i (i)}
              {#if item.kind === 'sep'}
                <div class="sep"></div>
              {:else if item.kind === 'header'}
                <div class="header">{item.label}</div>
              {:else}
                <button
                  class="item"
                  role={item.kind === 'action' ? 'menuitem' : item.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={item.kind === 'action' ? undefined : item.checked}
                  disabled={item.kind === 'action' && item.disabled}
                  onclick={() => activate(item)}
                >
                  <span class="mark">
                    {#if item.kind === 'check' && item.checked}✓{:else if item.kind === 'radio' && item.checked}●{/if}
                  </span>
                  <span class="label">{item.label}</span>
                  {#if 'shortcut' in item && item.shortcut}<span class="sc">{item.shortcut}</span>{/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>
  <div class="quick">
    <button onclick={withEngine((e) => e.undo())} disabled={!ui.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
    <button onclick={withEngine((e) => e.redo())} disabled={!ui.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
  </div>
  <div class="spacer"></div>

</header>

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 50;
  }
  .brand {
    font-weight: 700;
    color: var(--accent-2);
    letter-spacing: 0.02em;
    margin-right: 6px;
  }
  .menus {
    display: flex;
  }
  .menu {
    position: relative;
  }
  .title {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 4px;
  }
  .title:hover,
  .title.open {
    background: var(--panel-3);
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    padding: 4px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 6px;
    border: none;
    background: transparent;
    padding: 5px 8px;
    border-radius: 4px;
    text-align: left;
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .item:hover:not(:disabled) .sc {
    color: var(--accent-ink);
  }
  .mark {
    width: 14px;
    flex: none;
    text-align: center;
    font-size: 11px;
  }
  .label {
    flex: 1;
  }
  .sc {
    font: 11px var(--mono);
    color: var(--text-dim);
    margin-left: 16px;
  }
  .header {
    padding: 6px 8px 2px 28px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  .quick {
    display: flex;
    gap: 2px;
    margin-left: 4px;
  }
  .quick button {
    border: none;
    background: transparent;
    padding: 2px 8px;
    font-size: 15px;
  }
  .quick button:hover:not(:disabled) {
    background: var(--panel-3);
  }
  .spacer {
    flex: 1;
  }

</style>
