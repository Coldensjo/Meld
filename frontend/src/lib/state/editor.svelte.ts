// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

export type ToolId = 'select' | 'sculpt' | 'paint' | 'road' | 'water' | 'place'
export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'noise' | 'mountain'
export type WaterMode = 'dig' | 'shore'

export interface SelectedInfo {
  id: number
  type: string
  x: number
  z: number
  yOff: number
  rotY: number
  scale: number
}

export const editor = $state({
  tool: 'sculpt' as ToolId,
  brush: { radius: 10, strength: 0.5, falloff: 0.6, shape: 'circle' as 'circle' | 'square', snap: true },
  sculptMode: 'raise' as SculptMode,
  paintLayer: 0,
  roadFlatten: true,
  waterMode: 'dig' as WaterMode,
  waterLevel: 0,
  waterEnabled: true,
  /** Selected model type to place ("m2:<path>" / "wmo:<path>"), or ''. */
  prefab: '',
  placeRandomRot: true,
  placeRandomScale: true,
  placeScatter: false,
  selected: null as SelectedInfo | null,
  grid: false,
  autoCliff: true,
  /** Per paint layer: WoW tileset path, or '' for the built-in texture. */
  layerTextures: ['', '', '', '', '', '', '', ''] as string[],
  texScale: 8,
  mapName: 'Untitled',
  /** Terrain cells per side of the open map. */
  mapSize: 256,
  filePath: '',
  dirty: false,
})

export const stats = $state({
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  objects: 0,
  cursor: null as { x: number; y: number; z: number } | null,
})

/** Local WoW client used as an asset source (read live from its MPQs). */
export const wow = $state({
  path: '',
  loaded: false,
  loading: false,
  error: '',
  files: 0,
  /** Bumped whenever the client changes so lists refetch. */
  revision: 0,
})

/** User preferences, persisted in the app config (see lib/state/prefs.ts). */
export const prefs = $state({
  renderScale: 1,
  viewDistance: 1,
  fog: true,
  cameraSpeed: 1,
  mouseSensitivity: 1,
  invertY: false,
  /** Right dock width in px and collapsed panel ids (Photoshop-style dock). */
  dockWidth: 320,
  collapsedPanels: ['properties'] as string[],
})
export type Prefs = typeof prefs

export const ui = $state({
  status: 'Ready',
  canUndo: false,
  canRedo: false,
  showNewDialog: false,
  dialog: null as 'about' | 'shortcuts' | 'quit' | null,
  /** Which palette the left panel shows. */
  palette: 'models' as 'models' | 'textures',
  busy: false,
})

let statusTimer: ReturnType<typeof setTimeout> | undefined
export function setStatus(msg: string, timeout = 4000) {
  ui.status = msg
  clearTimeout(statusTimer)
  if (timeout > 0) statusTimer = setTimeout(() => (ui.status = 'Ready'), timeout)
}
