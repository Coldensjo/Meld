<script lang="ts">
  import DockPanel from './DockPanel.svelte'
  import Palette from './Palette.svelte'
  import LayersPanel from './LayersPanel.svelte'
  import PropertiesPanel from './PropertiesPanel.svelte'
  import MinimapPanel from './MinimapPanel.svelte'
  import SpawnsPanel from './SpawnsPanel.svelte'
  import { editor, prefs, ui } from '../lib/state/editor.svelte'

  // Selecting an object reveals the Properties panel if it was collapsed.
  $effect(() => {
    if (editor.selected && prefs.collapsedPanels.includes('properties')) {
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
  <DockPanel
    id="assets"
    grow
    tabs={[
      { id: 'models', label: 'Models' },
      { id: 'textures', label: 'Textures' },
    ]}
    active={ui.palette}
    onselect={(id) => (ui.palette = id as 'models' | 'textures')}
  >
    <Palette />
  </DockPanel>
  <DockPanel id="layers" tabs={[{ id: 'layers', label: 'Layers' }]}>
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
  /* Keep Layers/Properties from eating the Assets panel on short windows. */
  .dock :global(.panel:not(.grow) .body) {
    max-height: 30vh;
    overflow-y: auto;
  }
  .dock :global(.panel.grow) {
    min-height: 260px;
  }
</style>
