<script lang="ts">
  import MenuBar from './components/MenuBar.svelte'
  import Toolbar, { TOOLS } from './components/Toolbar.svelte'
  import OptionsBar from './components/OptionsBar.svelte'
  import Dock from './components/Dock.svelte'
  import AssetBrowser from './components/AssetBrowser.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import Viewport from './components/Viewport.svelte'
  import NewMapDialog from './components/NewMapDialog.svelte'
  import AppDialogs from './components/AppDialogs.svelte'
  import CreatureEditor from './components/CreatureEditor.svelte'
  import ObjectEditor from './components/ObjectEditor.svelte'
  import ModelPreviewWindow from './components/ModelPreviewWindow.svelte'
  import CreaturesWorkspace from './components/CreaturesWorkspace.svelte'
  import QuestEditor from './components/QuestEditor.svelte'
  import DoodadBrushEditor from './components/DoodadBrushEditor.svelte'
  import Inspector from './components/Inspector.svelte'
  import HistoryWindow from './components/HistoryWindow.svelte'
  import CheckMapWindow from './components/CheckMapWindow.svelte'
  import TexturePaletteWindow from './components/TexturePaletteWindow.svelte'
  import MinimapWindow from './components/MinimapWindow.svelte'
  import DebugOverlay from './components/DebugOverlay.svelte'
  import ContextMenu from './components/ContextMenu.svelte'
  import { loadPrefs, savePrefs } from './lib/state/prefs'
  import { restoreSession, saveSession, startSessionSaving } from './lib/io/session'
  import { offerRecovery, startAutosave } from './lib/io/recovery'
  import { copyTeleport } from './lib/io/scene'
  import { onMount } from 'svelte'
  import { refreshGameClient } from './lib/io/mapio'
  import { toggleFullScreen } from './lib/engine/display'
  import { initWow } from './lib/wow/api'
  import { defaultLayerTextures } from './lib/wow/defaults'
  import { LAYERS } from './lib/terrain/layers'
  import { docs, editor, prefs, setStatus, stepCameraSpeed, ui, wow } from './lib/state/editor.svelte'
  import { stepFalloff } from './lib/tools/brushSize'
  import { engineRef } from './lib/state/engineRef'
  import { openMap, saveMinimapImage, saveOrPublish } from './lib/io/mapio'
  import { requestClose } from './components/DocTabs.svelte'
  import { EventsOn, WindowSetTitle } from '../wailsjs/runtime/runtime'
  import { AckClose, SetUnsaved } from '../wailsjs/go/main/App'
  import { hasBackend } from './lib/io/mapio'

  let prefsLoaded = $state(false)
  onMount(() => {
    void refreshGameClient()
    const wowReady = initWow().catch((e) => console.warn('WoW client init failed', e))
    const prefsReady = loadPrefs().finally(() => (prefsLoaded = true))
    // With the preferences and the client's status known, open what was open at the last close.
    let stopSaving = () => {}
    let stopAutosave = () => {}
    Promise.all([wowReady, prefsReady]).then(async () => {
      const engine = engineRef.current
      if (!engine) return
      await restoreSession(engine).catch((e) => console.warn('could not restore the session', e))
      stopSaving = startSessionSaving(engine)
      stopAutosave = startAutosave(engine)
      void offerRecovery()
    })
    return () => {
      stopSaving()
      stopAutosave()
    }
  })

  // Closing the window with unsaved maps asks first, as File › Quit does (#188): Go stops the close
  // while any tab is dirty and sends app:close, which opens the same dialog.
  const unsaved = $derived(editor.dirty || docs.tabs.some((t) => t.id !== docs.active && t.dirty))
  $effect(() => {
    if (hasBackend()) void SetUnsaved(unsaved)
  })
  onMount(() => {
    if (!hasBackend()) return
    return EventsOn('app:close', () => {
      ui.dialog = 'quit'
      void AckClose()
    })
  })

  // Apply preferences to the engine whenever they change, and persist them.
  $effect(() => {
    const snapshot = { ...prefs }
    engineRef.current?.applyPrefs(snapshot)
    if (prefsLoaded) savePrefs()
  })

  // A map still on the built-in colour palette gets the default WoW tileset set as
  // soon as a client is available.
  const isDefaultPalette = (palette: string[]) => palette.every((p) => LAYERS.some((l) => l.swatch === p))
  $effect(() => {
    if (!wow.loaded || !isDefaultPalette(editor.palette)) return
    const wasDirty = editor.dirty
    defaultLayerTextures().then((t) => {
      if (!isDefaultPalette(editor.palette)) return
      editor.palette = t
      editor.dirty = wasDirty
    })
  })

  // Preferences › Theme (#49): app.css's light tokens apply under data-theme="light"; System follows
  // the desktop and changes with it.
  $effect(() => {
    const theme = prefs.theme
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => (document.documentElement.dataset.theme = theme === 'light' || (theme === 'system' && media.matches) ? 'light' : 'dark')
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  })

  // Window title and tab label follow the active map.
  $effect(() => {
    const title = `${editor.mapName}${editor.dirty ? ' *' : ''} — Meld`
    if (hasBackend()) WindowSetTitle(title)
  })

  // The palette follows the tool: textures for painting, models otherwise.
  $effect(() => {
    const t = editor.tool
    if (t === 'paint' || t === 'road' || (t === 'sculpt' && editor.sculptPaint === 'texture')) ui.palette = 'textures'
    else if (t === 'place') ui.palette = 'models'
  })

  /**
   * A bare Alt press is swallowed on its way down and up. Otherwise Windows takes the released Alt as
   * "enter the menu loop" and moves keyboard focus out of the page, so after an Alt+click (pipette)
   * the page no longer sees Ctrl and Ctrl+scroll (spin) stops working.
   */
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'Alt') e.preventDefault()
  }

  /** Input types that take no typing: a key on them is not text editing. */
  const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'])

  /** Whether a key's target is a text field, another form control, or neither. */
  function formField(target: EventTarget | null): 'text' | 'control' | null {
    const el = target as HTMLElement | null
    if (!el || !el.tagName) return null
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return 'text'
    if (el.tagName === 'SELECT') return 'control'
    if (el.tagName === 'INPUT') return NON_TEXT_INPUTS.has((el as HTMLInputElement).type) ? 'control' : 'text'
    return null
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Alt') {
      e.preventDefault()
      return
    }
    // A text field keeps every key. A slider, select or checkbox keeps its own keys too, but
    // Ctrl+Z and Ctrl+Y reach the map: such a control has no undo of its own, and after dragging an
    // options-bar slider (Vertex mode's Slope) the focus stays on it (#127).
    const field = formField(e.target)
    if (field === 'text') return
    if (field === 'control' && !((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y'))) return
    const engine = engineRef.current
    if (!engine || ui.showNewDialog || ui.dialog) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    // Over the creature editor only undo and redo reach the map (its spawn edits are undo steps);
    // the brush editor takes every key (its own Esc closes it).
    if (ui.brushEditor) return
    // The preview window (#197) takes every key; its Esc may have closed it before this runs.
    if (ui.modelPreview || (e.key === 'Escape' && e.defaultPrevented)) return
    // Esc closes the inspector alone; the selection stays.
    if (e.key === 'Escape' && ui.inspector) {
      ui.inspector = false
      e.preventDefault()
      return
    }
    // The quest editor has no undo steps of its own (its Save writes the database), and no key reaches the map.
    if (ui.questEditor) return
    if (ui.creatureEditor || ui.objectEditor) {
      if (mod && (key === 'z' || key === 'y')) {
        const c = key === 'y' || e.shiftKey ? engine.redo() : engine.undo()
        if (c) setStatus(`${key === 'y' || e.shiftKey ? 'Redo' : 'Undo'}: ${c.label}`)
        e.preventDefault()
      }
      return
    }

    if (e.key === 'F1') {
      ui.dialog = 'help'
      e.preventDefault()
      return
    }
    if (e.key === 'F11' && !mod) {
      void toggleFullScreen()
      e.preventDefault()
      return
    }
    if (e.key === 'F9' && !mod) {
      void copyTeleport(engine)
      e.preventDefault()
      return
    }
    if (e.key === 'F2' && e.shiftKey && !mod) {
      prefs.climbView = !prefs.climbView
      setStatus(prefs.climbView ? `Climb view: ground steeper than ${prefs.climbAngle}° is tinted red (Shift+F2 to hide).` : 'Climb view off.', 3000)
      e.preventDefault()
      return
    }
    // Tab hides the panels, so the map fills the window; Ctrl+Tab cycles the map tabs below.
    if (e.key === 'Tab' && !mod) {
      ui.hidePanels = !ui.hidePanels
      e.preventDefault()
      return
    }

    if (mod) {
      if (key === 'z' && !e.shiftKey) {
        const c = engine.undo()
        if (c) setStatus(`Undo: ${c.label}`)
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        const c = engine.redo()
        if (c) setStatus(`Redo: ${c.label}`)
      } else if (key === 'c') engine.copySelection()
      else if (key === 'v') engine.startPaste()
      else if (key === 'a') engine.selectAll()
      else if (key === 'd' && e.shiftKey) engine.duplicateSelected()
      else if (key === 'd') engine.deselect()
      else if (key === 's') saveOrPublish(engine, e.shiftKey)
      else if (key === 'p' && e.shiftKey) saveMinimapImage(engine)
      else if (key === 'm' && e.shiftKey) prefs.perfOverlay = !prefs.perfOverlay
      else if (key === 'r' && !e.shiftKey) engine.resetRotation()
      else if (key === 'g') e.shiftKey ? engine.ungroupSelected() : engine.groupSelected()
      else if (key === 'w') requestClose(engine.activeDocumentId())
      else if (e.key === 'Tab') engine.cycleDocument(e.shiftKey ? -1 : 1)
      else if (key === 'o') openMap(engine)
      else if (key === 'n') {
        ui.newMapMode = 'new'
        ui.showNewDialog = true
      }
      else if (key === 'b') engine.addBookmark()
      else if (e.key === 'PageDown') engine.snapSelectedToGround()
      else return
      e.preventDefault()
      return
    }

    if (engine.handleSelectionKey(e) || engine.handleToolKey(e)) {
      e.preventDefault()
      return
    }

    // The day cycle's keys (#20), Noggit Red's N and J; its B (slower) is Paint here, so Shift+N.
    if (key === 'n' || key === 'j') {
      if (key === 'j') {
        const on = !prefs.dayCycle
        if (!on) prefs.timeOfDay = Math.round(engine.currentHour() * 100) / 100
        prefs.dayCycle = on
        setStatus(on ? `Day cycle running: a day in ${prefs.cycleMinutes} min (N faster, Shift+N slower).` : 'Day cycle paused (J runs it again).', 3000)
      } else {
        const step = stepCycle(prefs.dayCycle ? prefs.cycleMinutes : 0, !e.shiftKey)
        if (step === 0) {
          prefs.timeOfDay = Math.round(engine.currentHour() * 100) / 100
          prefs.dayCycle = false
          setStatus('Day cycle paused (N runs it again).', 3000)
        } else {
          if (!prefs.dayCycle) prefs.timeOfDay = Math.round(engine.currentHour() * 100) / 100
          prefs.cycleMinutes = step
          prefs.dayCycle = true
          setStatus(`Day cycle: a day in ${step} min (N faster, Shift+N slower, J pauses).`, 3000)
        }
      }
      e.preventDefault()
      return
    }

    const tool = TOOLS.find((t) => t.key === e.key || t.letter?.toLowerCase() === key)
    if (tool) editor.tool = tool.id
    else if (e.key === '[' || e.key === ']') engine.stepBrush(e.key === ']' ? 1 : -1)
    else if (e.key === '{' || e.key === '}') editor.brush.falloff = stepFalloff(editor.brush.falloff, e.key === '}' ? 1 : -1)
    else if (key === 'g') editor.grid = !editor.grid
    else if (key === 'u') {
      ui.topDown = !ui.topDown
      setStatus(ui.topDown ? 'Top-down view: the wheel zooms, Q/E or a right drag turn the map (U for the 3D view).' : '3D view.', 3000)
    } else if (key === 't' && editor.tool !== 'paint') {
      prefs.cameraFollowGround = !prefs.cameraFollowGround
      setStatus(prefs.cameraFollowGround ? 'Camera follows the ground (T to fly freely).' : 'Camera flies freely: W goes where you look, Space/X up and down (T to follow the ground).', 3000)
    }
    else if (key === 'h' && e.shiftKey) engine.unhideAll()
    else if (key === 'p') stepCameraSpeed(true)
    else if (key === 'o') stepCameraSpeed(false)
    else if (key === 'f') engine.focusSelected()
    else if (key === 'i') ui.inspector = !ui.inspector
    else if (key === 'm') ui.minimap = !ui.minimap
    else return
    e.preventDefault()
  }

  /** The day cycle's speeds, a day in so many minutes, slowest first; 0 is paused. */
  const CYCLE_MINUTES = [40, 20, 10, 5, 2, 1]
  /** The next speed faster or slower than a day in `minutes` (0 paused); slower than the slowest pauses. */
  function stepCycle(minutes: number, faster: boolean): number {
    if (minutes <= 0) return faster ? CYCLE_MINUTES[0] : 0
    if (faster) return CYCLE_MINUTES.find((m) => m < minutes) ?? CYCLE_MINUTES[CYCLE_MINUTES.length - 1]
    return [...CYCLE_MINUTES].reverse().find((m) => m > minutes) ?? 0
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (engineRef.current) saveSession(engineRef.current)
    if (editor.dirty) e.preventDefault()
  }
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onbeforeunload={onBeforeUnload} />

<div class="app" class:bare={ui.hidePanels}>
  <MenuBar />
  {#if !ui.hidePanels}
    <OptionsBar />
  {/if}
  <div class="main">
    {#if !ui.hidePanels}
      <Toolbar />
    {/if}
    <div class="centre">
      <Viewport />
      {#if !ui.hidePanels}
        <AssetBrowser />
      {/if}
    </div>
    {#if !ui.hidePanels}
      <Dock />
    {/if}
  </div>
  {#if !ui.hidePanels}
    <StatusBar />
  {/if}
</div>

<Inspector />
<HistoryWindow />
<CheckMapWindow />
<TexturePaletteWindow />
<MinimapWindow />
<CreaturesWorkspace />
<CreatureEditor />
<ObjectEditor />
<QuestEditor />
<ModelPreviewWindow />
<DoodadBrushEditor />
<AppDialogs />
<ContextMenu />
<DebugOverlay />
{#if ui.showNewDialog}
  <NewMapDialog />
{/if}

<style>
  .app {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100%;
  }
  /* With the panels hidden (Tab) the viewport takes the window below the menu bar. */
  .app.bare {
    grid-template-rows: auto 1fr;
  }
  .main {
    display: grid;
    grid-template-columns: auto 1fr auto;
    min-height: 0;
  }
  .centre {
    /* Always the middle column: with the toolbar and dock hidden it would else fall into the first (auto) one. */
    grid-column: 2;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
