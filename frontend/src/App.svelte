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
  import DebugOverlay from './components/DebugOverlay.svelte'
  import { loadPrefs, savePrefs } from './lib/state/prefs'
  import { onMount } from 'svelte'
  import { initWow } from './lib/wow/api'
  import { defaultLayerTextures } from './lib/wow/defaults'
  import { LAYERS } from './lib/terrain/layers'
  import { MAX_BRUSH_RADIUS, editor, prefs, setStatus, stepCameraSpeed, ui, wow } from './lib/state/editor.svelte'
  import { engineRef } from './lib/state/engineRef'
  import { openMap, saveOrPublish } from './lib/io/mapio'
  import { requestClose } from './components/DocTabs.svelte'
  import { WindowSetTitle } from '../wailsjs/runtime/runtime'
  import { hasBackend } from './lib/io/mapio'

  let prefsLoaded = $state(false)
  onMount(() => {
    initWow().catch((e) => console.warn('WoW client init failed', e))
    loadPrefs().finally(() => (prefsLoaded = true))
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

  // Window title and tab label follow the active map.
  $effect(() => {
    const title = `${editor.mapName}${editor.dirty ? ' *' : ''} — Meld`
    if (hasBackend()) WindowSetTitle(title)
  })

  // The palette follows the tool: textures for painting, models otherwise.
  $effect(() => {
    const t = editor.tool
    if (t === 'paint' || t === 'road') ui.palette = 'textures'
    else if (t === 'place') ui.palette = 'models'
  })

  function onKeyDown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
    const engine = engineRef.current
    if (!engine || ui.showNewDialog || ui.dialog) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    // Over the creature editor only undo and redo reach the map (its spawn edits are undo steps).
    if (ui.creatureEditor) {
      if (mod && (key === 'z' || key === 'y')) {
        const c = key === 'y' || e.shiftKey ? engine.redo() : engine.undo()
        if (c) setStatus(`${key === 'y' || e.shiftKey ? 'Redo' : 'Undo'}: ${c.label}`)
        e.preventDefault()
      }
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
      else if (key === 'w') requestClose(engine.activeDocumentId())
      else if (e.key === 'Tab') engine.cycleDocument(e.shiftKey ? -1 : 1)
      else if (key === 'o') openMap(engine)
      else if (key === 'n') {
        ui.newMapMode = 'new'
        ui.showNewDialog = true
      }
      else if (key === 'b') engine.addBookmark()
      else return
      e.preventDefault()
      return
    }

    if (engine.handleSelectionKey(e) || engine.handleToolKey(e)) {
      e.preventDefault()
      return
    }

    const tool = TOOLS.find((t) => t.key === e.key || t.letter?.toLowerCase() === key)
    if (tool) editor.tool = tool.id
    else if (e.key === '[') editor.brush.radius = Math.max(1, editor.brush.radius / 1.15)
    else if (e.key === ']') editor.brush.radius = Math.min(MAX_BRUSH_RADIUS, editor.brush.radius * 1.15)
    else if (key === 'g') editor.grid = !editor.grid
    else if (key === 't' && editor.tool !== 'paint') {
      prefs.cameraFollowGround = !prefs.cameraFollowGround
      setStatus(prefs.cameraFollowGround ? 'Camera follows the ground (T to fly freely).' : 'Camera flies freely: W goes where you look, Space/X up and down (T to follow the ground).', 3000)
    }
    else if (key === 'h' && e.shiftKey) engine.unhideAll()
    else if (key === 'p') stepCameraSpeed(true)
    else if (key === 'o') stepCameraSpeed(false)
    else if (key === 'f') engine.focusSelected()
    else return
    e.preventDefault()
  }

  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (editor.dirty) e.preventDefault()
  }
</script>

<svelte:window onkeydown={onKeyDown} onbeforeunload={onBeforeUnload} />

<div class="app">
  <MenuBar />
  <OptionsBar />
  <div class="main">
    <Toolbar />
    <div class="centre">
      <Viewport />
      <AssetBrowser />
    </div>
    <Dock />
  </div>
  <StatusBar />
</div>

<CreatureEditor />
<AppDialogs />
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
  .main {
    display: grid;
    grid-template-columns: auto 1fr auto;
    min-height: 0;
  }
  .centre {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
</style>
