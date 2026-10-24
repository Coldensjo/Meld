import type { SessionTab } from '../io/session'
import type { Bookmark } from '../engine/MapDocument'
import type { PerfReport } from '../engine/perfMeter'
import type { CubeSet } from '../cubes/cubeSets'

// Reactive editor state (Svelte 5 runes). The engine reads these values each
// frame; it never stores per-frame data here (that would trigger re-renders).

/** The tools: the Select tool's boxes of cubes (#70), and the Cubes tool (#31). */
export type ToolId = 'select' | 'cube'
/** What the Cubes tool does: put a cube against the face clicked, remove cubes, replace cubes with the picked one, fill a box, attach or link objects, paint faces with a texture, or place monster spawn points, NPCs and their routes, or props, or paint mood regions. */
export type CubeMode = 'place' | 'remove' | 'replace' | 'box' | 'object' | 'link' | 'paint' | 'monster' | 'npc' | 'prop' | 'mood'

export const editor = $state({
  tool: 'cube' as ToolId,
  /** The Cubes tool (#31, lib/tools/CubeTool.ts): what a click does, and the cube it puts down (ids of lib/cubes/world.ts). */
  cubeMode: 'place' as CubeMode,
  cubeKind: 2,
  cubeShape: 0,
  cubeRotation: 0,
  /** The layers a box fill reaches above its higher corner. */
  cubeBoxExtra: 0,
  /** The object kind the Cubes tool's Object mode attaches (#32; lib/cubes/world.ts OBJECT_KINDS). */
  cubeObject: 0,
  /** The fire colour Object mode's torches burn, and the selected torch's (3dgame #137; lib/cubes/world.ts FIRE_COLOURS). */
  cubeFire: 0,
  /** The texture the Cubes tool's Paint mode paints faces with (#83; lib/cubes/world.ts TEXTURES). */
  cubeTexture: 3,
  /** Paint mode sets which edges of a face blend into the texture beside them instead of painting (#84). */
  cubeBlend: false,
  /** The monster kind the Cubes tool's Monster mode places spawn points of (#91; a name of crates/gameplay/monsters.toml, lib/cubes/monsterKinds.ts). */
  cubeMonster: 'wolf',
  /** The NPC the Cubes tool's NPC mode places (#99; a name of crates/gameplay/npcs.toml, lib/cubes/npcNames.ts). */
  cubeNpc: 'Warden Hask',
  /** The model the Cubes tool's Prop mode places (#133; its path under assets/models without .glb, lib/cubes/propModels.ts). */
  cubeProp: 'nature/pine_1',
  /** The turn (radians, counter-clockwise from above) and scale the next prop is placed with; R and the options bar change them. */
  propTurn: 0,
  propScale: 1,
  /** The grid in metres Prop mode puts a prop's place on across (x, z), 0 for none. */
  propSnap: 0.5,
  /** The mood the Cubes tool's Mood mode paints regions of (3dgame #143; a name of crates/gameplay/moods.toml, lib/engine/moods.ts). */
  cubeMood: 'graveyard',
  /** The open world's camera bookmarks. */
  bookmarks: [] as Bookmark[],
  mapName: 'Untitled',
  filePath: '',
  dirty: false,
})

export const stats = $state({
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  cursor: null as { x: number; y: number; z: number } | null,
  /**
   * Where the camera is for the Minimap window, while it is open: the target, its yaw, the world's
   * larger side in cubes and in metres, the camera's layer and the cubes' edit count (CubeLayer.version).
   */
  view: null as { x: number; z: number; yaw: number; cells: number; world: number; layer: number; cubes: number } | null,
  /** The layer of the world the camera is in (#62). */
  cameraLayer: -1,
  /** The performance overlay's numbers (#179), refreshed once a second while it is on. */
  perf: null as PerfReport | null,
})

/** Open world tabs (the active tab's live name/dirty come from `editor`). */
export const docs = $state({
  /** `world` is the world's size in chunks (#29). */
  tabs: [] as Array<{ id: number; name: string; dirty: boolean; world: string }>,
  active: 0,
})

/** User preferences, persisted in the app config (see lib/state/prefs.ts). */
/** Camera speed steps: the preference is kept between a quarter and four times its normal speed. */
export function stepCameraSpeed(faster: boolean) {
  const next = prefs.cameraSpeed * (faster ? 1.25 : 0.8)
  prefs.cameraSpeed = Math.min(4, Math.max(0.25, next))
}

export const prefs = $state({
  /** Graphics › FPS limit (#24): frames a second at most, 0 for the screen's rate. */
  fpsLimit: 0,
  /** Preferences › Autosave (#177): minutes between recovery copies of the worlds with unsaved changes, 0 for none. */
  autosaveMinutes: 3,
  /** Preferences › Theme (#49): the editor's colours, or the desktop's light or dark setting. */
  theme: 'dark' as 'dark' | 'light' | 'system',
  /** Graphics › Anti-aliasing (#24), mirrored to localStorage by display.ts and applied at the next start. */
  antialias: true,
  renderScale: 1,
  viewDistance: 1,
  fog: true,
  /** Graphics › Smooth Textures (3dgame #123): the cube textures linear with mipmaps, or off, crisp nearest texels, as the game's --crisp-textures and F9. */
  smoothTextures: true,
  cameraSpeed: 1,
  mouseSensitivity: 1,
  invertY: false,
  /** Hour of day 0-24 (sun/moon position, lighting, sky). */
  timeOfDay: 13,
  /** Animate a full day/night cycle (one day ≈ cycleMinutes). */
  dayCycle: false,
  cycleMinutes: 10,
  clouds: true,
  /** Lighting › Look (3dgame #142): the game's mood (crates/gameplay/moods.toml: its sky, fog, light and grade) or the plain work light. */
  look: 'mood' as 'mood' | 'work',
  /** Lighting › Mood: a surface mood's name, or '' to follow the time of day as the game's day and night does. */
  mood: '',
  shadows: 'medium' as 'off' | 'medium' | 'high',
  /** View › Performance Overlay (#179): where the frame's time goes, by subsystem and GPU pass, in the viewport's corner. */
  perfOverlay: false,
  /** The palette along the bottom: its height in px, whether it is folded away, and its tile size. */
  browserHeight: 300,
  browserCollapsed: false,
  browserTile: 112,
  /** The names under the palette's tiles (#655); off, the tiles are only pictures. */
  browserNames: true,
  /** The toolbar's icon size in px (Preferences › Toolbar), from TOOLBAR_ICON_MIN to TOOLBAR_ICON_MAX (#128). */
  toolbarIcon: 22,
  /** Preferences › Toolbar on the left or the right of the window (#654). */
  toolbarSide: 'left' as 'left' | 'right',
  /** Preferences › Interface size (#372): the whole UI scaled by this factor (CSS zoom, lib/ui/uiScale.ts), 1 to 2. */
  uiScale: 1,
  /** The cube palette along the bottom (#63, components/CubePalette.svelte): its recent picks (cubes/palette.ts keys, newest first) and its category ('' for all). */
  cubeRecent: [] as string[],
  cubeCategory: '',
  /** The cube palette's tab (3dgame #73): the palette, the author's sets of tiles, or the prefabs of cubes. */
  cubeTab: 'cubes' as 'cubes' | 'sets' | 'prefabs' | 'props',
  /** The author's sets of palette tiles (cubes/cubeSets.ts), shared by every world, and the name of the one shown. */
  cubeSets: [] as CubeSet[],
  cubeSet: '',
  /** The folder the author's prefabs are kept in (#170), listed by the cube palette's Prefabs tab. */
  prefabDir: '',
	/** Tools › Sprite to 3D Model: the folder of sprites it lists, and how it reads them (internal/spritemodel). */
	spriteFolder: '',
	spriteProjection: 'tibia' as 'tibia' | 'iso',
	spriteReading: 'auto' as 'auto' | 'box' | 'round' | 'wall' | 'cutout' | 'hull' | 'outfit',
	spriteOutline: false,
	/** Only the sprites bigger than a tile (things standing up), not the grounds. */
	spriteBigOnly: true,
  /** The tabs open at the last close, reopened at the next start (io/session.ts). */
  session: { tabs: [] as SessionTab[], active: 0 },
})
export type Prefs = typeof prefs

/** An entry of a right-click menu: an action, or a separator. */
export interface ContextItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  run?: () => void
}

/** A project (#48): its name and its folder. */
export interface ProjectInfo {
  name: string
  path: string
}

export const ui = $state({
  status: 'Ready',
  /** A short-lived notice drawn big over the viewport (e.g. the paste's turn); '' when none. */
  viewportHint: '',
  /** Bumped with every hint, so the view can restart its fade even when the text is unchanged. */
  viewportHintSeq: 0,
  canUndo: false,
  canRedo: false,
  showNewDialog: false,
  /** The open project (a project folder and the client it edits, #48), null for none. */
  project: null as ProjectInfo | null,
  /** The recent projects, newest first, the open one included. */
  recentProjects: [] as ProjectInfo[],
	/** Cubes were copied (#70, CubeSelectTool), to paste in any world tab. */
	hasCubeClip: false,
	/** The copied cubes follow the cursor to be put down. */
	cubePasting: false,
	/** The active world tab's selected box of cubes (CubeLayer.selection), mirrored for the menus and the options bar. */
	cubeSelection: null as { x0: number; x1: number; z0: number; z1: number; top: number; bottom: number } | null,
  dialog: null as 'about' | 'help' | 'log' | 'shortcuts' | 'quit' | 'closeDoc' | 'revert' | 'mapProps' | 'textures' | 'spriteModel' | 'recovery' | 'project' | null,
  /** Tab hides every panel but the menu bar (the toolbar, options bar, palette and status bar), as noggit's Tab does. */
  hidePanels: false,
	/** View › Layer slice (#30): a world tab shows only a layer and those above or below it (lib/cubes/CubeLayer.ts). */
	cubeSlice: { mode: 'off', layer: 10 } as { mode: 'off' | 'above' | 'below'; layer: number },
  /** U: the top-down 2D view, as noggit's tile mode: straight down, no perspective, the wheel zooms. */
  topDown: false,
  /** A right-click menu: where it opens (CSS pixels) and what it offers; null when closed. */
  contextMenu: null as { x: number; y: number; title?: string; items: ContextItem[] } | null,
  /** Tab awaiting "close with unsaved changes?" confirmation. */
  closeDocId: 0,
  busy: false,
  /** The save running now, in words ("Saving world"), for the Saving bar (#343); '' when none. Set through `lib/state/saving.ts` only. */
  saving: '',
  /** The save's latest progress line, shown under the Saving bar; '' for none. */
  savingDetail: '',
  /** Camera › Walk (#21): the FPS camera on the ground layer; off returns to the camera it started from. */
  walkCamera: false,
  /** The floating History window (components/HistoryWindow.svelte): the undo stack, a click goes to any step. */
  history: false,
  /** Bumped whenever the active world's undo stack changes or another world becomes active, so the History window re-reads it. */
  historyVersion: 0,
  /** Bumped when a prefab is saved, so the Prefabs tab reads its folder again. */
  prefabsVersion: 0,
  /** The floating Minimap window (M): the world's layer from above with the camera's spot; a click moves the camera. */
  minimap: false,
})

let hintTimer: ReturnType<typeof setTimeout> | undefined
/** Show `msg` over the viewport for `timeout` ms. Another call restarts the clock. */
export function setViewportHint(msg: string, timeout = 1500) {
  ui.viewportHint = msg
  ui.viewportHintSeq++
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (ui.viewportHint = ''), timeout)
}

let queuedHint: string | null = null
/**
 * Like `setViewportHint`, for a drag that calls it on every pointer move (#621): the text waits in a
 * plain variable and `publishViewportHint` shows it once a frame.
 */
export function queueViewportHint(msg: string) {
  queuedHint = msg
}
/** Shows the hint `queueViewportHint` left, if any. The same text again only restarts the fade timer. */
export function publishViewportHint() {
  if (queuedHint === null) return
  const msg = queuedHint
  queuedHint = null
  if (msg !== ui.viewportHint) setViewportHint(msg)
  else {
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => (ui.viewportHint = ''), 1500)
  }
}

let statusTimer:ReturnType<typeof setTimeout> | undefined
/**
 * The Log window's lines (Help › Log…): every status message, the Go side's progress lines (which
 * arrive as status messages) and, with Log file loading on, every file read from the client. The
 * newest is last; at most LOG_LINES are kept.
 */
export const appLog = $state({ lines: [] as Array<{ time: string; text: string }> })
const LOG_LINES = 500

export function logLine(text: string) {
  const d = new Date()
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  appLog.lines.push({ time, text })
  if (appLog.lines.length > LOG_LINES) appLog.lines.splice(0, appLog.lines.length - LOG_LINES)
  if (logPending) {
    logPending.push(`${time} ${text}`)
    logTimer ??= setTimeout(flushLog, LOG_FLUSH_MS)
  }
}

/** Lines waiting to go to the session's log file (#319); null until `startLogFile` gives a sink. */
let logPending: string[] | null = null
let logSink: ((lines: string[]) => Promise<void>) | null = null
let logTimer: ReturnType<typeof setTimeout> | undefined
const LOG_FLUSH_MS = 1000

/** Sends the lines logged since the last flush to the log file's sink, in one call. */
export function flushLog() {
  clearTimeout(logTimer)
  logTimer = undefined
  if (!logSink || !logPending?.length) return
  const lines = logPending
  logPending = []
  logSink(lines).catch(() => {})
}

/** Starts writing the Log window's lines to the session's log file (#319), starting with those already logged. */
export function startLogFile(sink: (lines: string[]) => Promise<void>) {
  logSink = sink
  logPending = appLog.lines.map((l) => `${l.time} ${l.text}`)
  flushLog()
}

export function clearLog() {
  appLog.lines = []
}

export function setStatus(msg: string, timeout = 4000) {
  if (msg && msg !== 'Ready' && msg !== ui.status) logLine(msg)
  ui.status = msg
  clearTimeout(statusTimer)
  if (timeout > 0) statusTimer = setTimeout(() => (ui.status = 'Ready'), timeout)
}
