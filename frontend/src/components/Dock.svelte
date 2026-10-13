<script lang="ts">
  import DockPanel from './DockPanel.svelte'
  import LayersPanel from './LayersPanel.svelte'
  import PropertiesPanel from './PropertiesPanel.svelte'
  import MinimapPanel from './MinimapPanel.svelte'
  import SpawnsPanel from './SpawnsPanel.svelte'
  import { editor, prefs } from '../lib/state/editor.svelte'

  // Selecting a model or an area reveals the Properties panel if it was collapsed.
  $effect(() => {
    if ((editor.selectedIds.length || editor.selection) && prefs.collapsedPanels.includes('properties')) {
      prefs.collapsedPanels = prefs.collapsedPanels.filter((p) => p !== 'properties')
    }
  })

  // Drag the left edge to resize the dock, like Photoshop's panel column.
  function startResize(e: PointerEvent) {
    const startX = e.clientX
    const startW = prefs.dockWidth
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      prefs.dockWidth = Math.round(Math.min(640, Math.max(240, startW + (startX - ev.clientX))))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
</script>

<div class="dock" style:width="{prefs.dockWidth}px">
  <div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>
  <DockPanel id="layers" grow tabs={[{ id: 'layers', label: 'Layers' }]}>
    <LayersPanel />
  </DockPanel>
  <DockPanel id="minimap" tabs={[{ id: 'minimap', label: 'Map' }]}>
    <MinimapPanel />
  </DockPanel>
  <DockPanel id="spawns" tabs={[{ id: 'spawns', label: 'Spawns' }]}>
    <SpawnsPanel />
  </DockPanel>
  <DockPanel id="properties" tabs={[{ id: 'properties', label: 'Properties' }]}>
    <PropertiesPanel />
  </DockPanel>
</div>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    border-left: 1px solid var(--border);
    gap: 2px;
  }
  .resizer {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 5;
  }
  .resizer:hover {
    background: var(--accent);
    opacity: 0.5;
  }
  .dock :global(.panel:not(.grow) .body) {
    max-height: 40vh;
    overflow-y: auto;
  }
  .dock :global(.panel.grow .body) {
    overflow-y: auto;
  }
</style>
