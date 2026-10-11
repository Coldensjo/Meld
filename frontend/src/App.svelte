<script lang="ts">
  import MenuBar from './components/MenuBar.svelte'
  import Toolbar, { TOOLS } from './components/Toolbar.svelte'
  import ToolPanel from './components/ToolPanel.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import Viewport from './components/Viewport.svelte'
  import NewMapDialog from './components/NewMapDialog.svelte'
  import { editor, setStatus, ui } from './lib/state/editor.svelte'
  import { engineRef } from './lib/state/engineRef'
  import { openMap, saveMap } from './lib/io/mapio'

  function onKeyDown(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
    const engine = engineRef.current
    if (!engine || ui.showNewDialog) return
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

    if (engine.handleToolKey(e)) {
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
  <div class="main">
    <Toolbar />
    <Viewport />
    <ToolPanel />
  </div>
  <StatusBar />
</div>

{#if ui.showNewDialog}
  <NewMapDialog />
{/if}

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
  }
  .main {
    display: grid;
    grid-template-columns: auto 1fr 300px;
    min-height: 0;
  }
</style>
