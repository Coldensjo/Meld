import { LoadMap, OpenMapDialog, SaveMap, SaveMapDialog } from '../../../wailsjs/go/main/App'
import { mapfile } from '../../../wailsjs/go/models'
import type { Engine, MapSnapshot } from '../engine/Engine'
import { editor, setStatus, ui } from '../state/editor.svelte'
import { base64ToBytes, bytesToBase64 } from './base64'

/** True when running inside the Wails webview (Go bindings available). */
export const hasBackend = () => typeof (window as unknown as { go?: unknown }).go !== 'undefined'

function toMapData(s: MapSnapshot): mapfile.MapData {
  return mapfile.MapData.createFrom({
    name: s.name,
    size: s.size,
    cellSize: s.cellSize,
    splatRes: s.splatRes,
    waterLevel: s.waterLevel,
    waterEnabled: s.waterEnabled,
    objects: s.objects,
    layerTextures: s.layerTextures,
    texScale: s.texScale,
    heights: bytesToBase64(s.heights),
    splatA: bytesToBase64(s.splatA),
    splatB: bytesToBase64(s.splatB),
  })
}

function fromMapData(m: mapfile.MapData): MapSnapshot {
  return {
    name: m.name,
    size: m.size,
    cellSize: m.cellSize,
    splatRes: m.splatRes,
    waterLevel: m.waterLevel,
    waterEnabled: m.waterEnabled,
    objects: (m.objects ?? []).map((o, i) => ({ ...o, id: o.id || 100000 + i, parent: o.parent || undefined })),
    layerTextures: m.layerTextures ?? [],
    texScale: m.texScale ?? 0,
    heights: base64ToBytes(m.heights),
    splatA: base64ToBytes(m.splatA),
    splatB: base64ToBytes(m.splatB),
  }
}

async function guarded(label: string, fn: () => Promise<void>) {
  if (!hasBackend()) {
    setStatus('File operations need the desktop app (run via `wails dev`).')
    return
  }
  if (ui.busy) return
  ui.busy = true
  try {
    await fn()
  } catch (err) {
    console.error(err)
    setStatus(`${label} failed: ${err}`, 8000)
  } finally {
    ui.busy = false
  }
}

export function saveMap(engine: Engine, saveAs = false) {
  return guarded('Save', async () => {
    let path = editor.filePath
    if (!path || saveAs) {
      path = await SaveMapDialog(editor.mapName)
      if (!path) return
    }
    const t0 = performance.now()
    await SaveMap(path, toMapData(engine.snapshot()))
    editor.filePath = path
    editor.dirty = false
    engine.refreshTabs()
    setStatus(`Saved ${path} (${Math.round(performance.now() - t0)} ms)`)
  })
}

export function openMap(engine: Engine) {
  return guarded('Open', async () => {
    const path = await OpenMapDialog()
    if (!path) return
    if (engine.focusPath(path)) {
      setStatus('That map is already open.')
      return
    }
    const t0 = performance.now()
    const data = await LoadMap(path)
    engine.openDocument(fromMapData(data), path)
    setStatus(`Loaded ${path} (${Math.round(performance.now() - t0)} ms)`)
  })
}
