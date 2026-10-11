<script lang="ts">
  import MenuBar from './components/MenuBar.svelte'
  import Toolbar, { TOOLS } from './components/Toolbar.svelte'
  import OptionsBar from './components/OptionsBar.svelte'
  import Dock from './components/Dock.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import Viewport from './components/Viewport.svelte'
  import NewMapDialog from './components/NewMapDialog.svelte'
  import AppDialogs from './components/AppDialogs.svelte'
  import { loadPrefs, savePrefs } from './lib/state/prefs'
  import { onMount } from 'svelte'
  import { initWow } from './lib/wow/api'
  import { defaultLayerTextures } from './lib/wow/defaults'
  import { editor, prefs, setStatus, ui, wow } from './lib/state/editor.svelte'
  import { engineRef } from './lib/state/engineRef'
  import { openMap, saveMap } from './lib/io/mapio'

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

  // A map without any textures assigned gets the default WoW tileset set as
  // soon as a client is available.
  $effect(() => {
    if (!wow.loaded || editor.layerTextures.some(Boolean)) return
    const wasDirty = editor.dirty
    defaultLayerTextures().then((t) => {
      if (editor.layerTextures.some(Boolean)) return
      editor.layerTextures = t
      editor.dirty = wasDirty
    })
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

    if (mod) {
      if (key === 'z' && !e.shiftKey) {
        const c = engine.undo()
        if (c) setStatus(`Undo: ${c.label}`)
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        const c = engine.redo()
        if (c) setStatus(`Redo: ${c.label}`)
      } else if (key === 's') saveMap(engine, e.shiftKey)
      else if (key === 'o') openMap(engine)
      else if (key === 'n') ui.showNewDialog = true
      else return
      e.preventDefault()
      return
    }

    if (engine.handleSelectionKey(e) || engine.handleToolKey(e)) {
      e.preventDefault()
      return
    }

    const tool = TOOLS.find((t) => t.key === e.key)
    if (tool) editor.tool = tool.id
    else if (e.key === '[') editor.brush.radius = Math.max(1, editor.brush.radius / 1.15)
    else if (e.key === ']') editor.brush.radius = Math.min(80, editor.brush.radius * 1.15)
    else if (key === 'g') editor.grid = !editor.grid
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
    <Viewport />
    <Dock />
  </div>
  <StatusBar />
</div>

<AppDialogs />
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
</style>
