<script lang="ts">
  import MenuBar from './components/MenuBar.svelte'
  import Toolbar, { TOOLS } from './components/Toolbar.svelte'
  import OptionsBar from './components/OptionsBar.svelte'
  import AssetBrowser from './components/AssetBrowser.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import Viewport from './components/Viewport.svelte'
  import NewMapDialog from './components/NewMapDialog.svelte'
  import AppDialogs from './components/AppDialogs.svelte'
  import SavingBar from './components/SavingBar.svelte'
  import HistoryWindow from './components/HistoryWindow.svelte'
  import MinimapWindow from './components/MinimapWindow.svelte'
  import DebugOverlay from './components/DebugOverlay.svelte'
  import ContextMenu from './components/ContextMenu.svelte'
  import { loadPrefs, savePrefs } from './lib/state/prefs'
  import { restoreSession, saveSession, skipRestore, startSessionSaving } from './lib/io/session'
  import { offerRecovery, startAutosave } from './lib/io/recovery'
  import { startSessionLog } from './lib/io/sessionLog'
  import { onMount, untrack } from 'svelte'
	import { stepSlice } from './lib/cubes/slice'
  import { toggleFullScreen } from './lib/engine/display'
  import { docs, editor, prefs, setStatus, stepCameraSpeed, ui } from './lib/state/editor.svelte'
  import { applyUiScale, stepUiScale } from './lib/ui/uiScale'
  import { engineRef } from './lib/state/engineRef'
  import { openMap, saveMap } from './lib/io/mapio'
  import { requestClose } from './components/DocTabs.svelte'
  import { EventsOn, WindowSetTitle } from '../wailsjs/runtime/runtime'
  import { AckClose, SetUnsaved } from '../wailsjs/go/main/App'
  import { hasBackend } from './lib/io/mapio'
  import { refreshProjects } from './lib/io/project'

  let prefsLoaded = $state(false)
  onMount(() => {
    const stopLogFile = startSessionLog()
    void refreshProjects()
    const prefsReady = loadPrefs().finally(() => (prefsLoaded = true))
    // With the preferences known, open what was open at the last close.
    let stopSaving = () => {}
    let stopAutosave = () => {}
    prefsReady.then(async () => {
      const engine = engineRef.current
      if (!engine) return
      await restoreSession(engine).catch((e) => console.warn('could not restore the session', e))
      stopSaving = startSessionSaving(engine)
      stopAutosave = startAutosave(engine)
      // The probes' page (?nosession) must not meet the owner's recovery dialog over its screenshots (#262).
      if (!skipRestore) void offerRecovery()
    })
    return () => {
      stopSaving()
      stopAutosave()
      stopLogFile()
    }
  })

  // Closing the window with unsaved worlds asks first, as File › Quit does (#188): Go stops the close
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

	// Preferences › Interface size (#372): the whole page zoomed, before the engine reads the pref for its pixel ratio.
	$effect(() => applyUiScale(prefs.uiScale))

  // Object.keys on the reactive prefs reads every key (the session too), so the keys are listed once, untracked.
  const prefKeys = untrack(() => Object.keys(prefs)).filter((k) => k !== 'session')
  // Apply preferences to the engine whenever they change, and persist them.
  $effect(() => {
    // The session changes with every camera move: it is saved on its own (savePref), so it stays out of
    // this effect, which would re-apply every preference and walk them all for a save (#461).
    const snapshot = {} as Record<string, unknown>
    for (const k of prefKeys) snapshot[k] = prefs[k as keyof typeof prefs]
    engineRef.current?.applyPrefs(snapshot as unknown as typeof prefs)
    if (prefsLoaded) savePrefs()
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

  // Window title and tab label follow the active world.
  $effect(() => {
    const title = `${editor.mapName}${editor.dirty ? ' *' : ''} — Meld`
    if (hasBackend()) WindowSetTitle(title)
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

  /**
   * Whether a focused slider, select or checkbox keeps this key for itself. Only the keys it uses are
   * its own, so Delete and the tool letters still reach the map while the focus sits on a control
   * (after a click on an options-bar checkbox it stays there, #345). Ctrl+Z and Ctrl+Y always reach the map (#127).
   */
  function controlKeepsKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) return false
    if (e.ctrlKey || e.metaKey || e.altKey) return true
    const el = e.target as HTMLElement
    if (k === 'delete' || k === 'backspace') return false
    if (el.tagName === 'SELECT') return true
    if (k === 'escape') return false
    if (k === 'enter' || k === ' ' || k === 'tab') return true
    const type = (el as HTMLInputElement).type
    if (type === 'range' || type === 'radio') return k.startsWith('arrow') || k === 'home' || k === 'end' || k === 'pageup' || k === 'pagedown'
    return false
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
    if (field === 'control' && controlKeepsKey(e)) return
    const engine = engineRef.current
    if (!engine || ui.showNewDialog || ui.dialog) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    // A window's own Esc may have closed it before this runs.
    if (e.key === 'Escape' && e.defaultPrevented) return

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
    // Tab hides the panels, so the world fills the window; Ctrl+Tab cycles the world tabs below.
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
      else if (key === 'x') engine.cutSelection()
      else if (key === 'v') engine.startPaste()
      else if (key === 'd' && !e.shiftKey) engine.deselect()
      else if (key === 's') saveMap(engine, e.shiftKey)
      else if (key === 'm' && e.shiftKey) prefs.perfOverlay = !prefs.perfOverlay
      else if (key === 'w') requestClose(engine.activeDocumentId())
      else if (e.key === 'Tab') engine.cycleDocument(e.shiftKey ? -1 : 1)
      else if (key === 'o') openMap(engine)
      else if (key === 'n') ui.showNewDialog = true
      else if (key === 'b') engine.addBookmark()
			// Interface size (#372): Ctrl+= (or Ctrl++) larger, Ctrl+- smaller, Ctrl+0 back to 100 %.
			else if (e.key === '=' || e.key === '+') prefs.uiScale = stepUiScale(prefs.uiScale, 1)
			else if (e.key === '-' || e.key === '_') prefs.uiScale = stepUiScale(prefs.uiScale, -1)
			else if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') prefs.uiScale = 1
      else return
      e.preventDefault()
      return
    }

    if (engine.handleToolKey(e)) {
      e.preventDefault()
      return
    }

    // The day cycle's keys (#20): N runs it faster, Shift+N slower, J pauses.
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
    // The layer slice (#30): , up a layer, . down.
    else if (e.key === ',' || e.key === '.') stepSlice(e.key === ',' ? -1 : 1)
    else if (key === 'u') {
      ui.topDown = !ui.topDown
      setStatus(ui.topDown ? 'Top-down view: the wheel zooms, Q/E or a right drag turn the view (U for the 3D view).' : '3D view.', 3000)
    } else if (key === 't') {
      setStatus('The camera flies freely through the layers: W goes where you look, Space/X up and down.', 3000)
    }
    else if (key === 'p') stepCameraSpeed(true)
    else if (key === 'o') stepCameraSpeed(false)
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
  <div class="main" class:toolbar-right={prefs.toolbarSide === 'right'}>
    {#if !ui.hidePanels}
      <Toolbar />
    {/if}
    <div class="centre">
      <Viewport />
      {#if !ui.hidePanels}
        <AssetBrowser />
      {/if}
    </div>
  </div>
  {#if !ui.hidePanels}
    <StatusBar />
  {/if}
</div>

<HistoryWindow />
<MinimapWindow />
<AppDialogs />
<SavingBar />
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
    grid-template-columns: auto 1fr;
    min-height: 0;
  }
  .centre {
    /* Always the second column: with the toolbar hidden it would else fall into the first (auto) one. */
    grid-column: 2;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* The toolbar at the window's right edge (#654): the columns change, not the DOM, so the tab order stays. */
  .main.toolbar-right {
    grid-template-columns: 1fr auto;
  }
  .main.toolbar-right > .centre {
    grid-column: 1;
  }
  .main.toolbar-right > :global(.toolbar) {
    grid-column: 2;
    grid-row: 1;
  }
</style>
