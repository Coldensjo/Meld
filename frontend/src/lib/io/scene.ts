import { tick } from 'svelte'
import type { Engine } from '../engine/Engine'
import { formatReport } from '../engine/perfMeter'
import { editor, prefs, setStatus, ui, type Prefs, type ToolId } from '../state/editor.svelte'
import { engineRef } from '../state/engineRef'
import { selectObjects } from '../state/selection'
import { fromMapData, hasBackend, openWowRegion, toMapData } from './mapio'
import { LoadMap, SaveSceneMap } from '../../../wailsjs/go/main/App'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'

// A scene is the editor's state as one line of text (Help > Copy Scene), so a view can be handed to
// someone else on this machine (or to Claude, through `window.__loadScene`) and opened again exactly:
// the map, the camera, the hour, the tool, the selection and the graphics preferences. A map with
// unsaved changes is written to a copy in the cache dir first, which the scene names.

const PREFIX = 'Meld scene '
/** Scenes copied before the rename. */
const OLD_PREFIX = 'WorldEditor scene '

/** The preferences that change what the view looks like. Layout and input prefs stay the viewer's. */
const VIEW_PREFS = [
  'wireframe',
  'climbView',
  'showContours',
  'contourStep',
  'showBoxes',
  'clientLighting',
  'climbAngle',
  'showTerrain',
  'showWater',
  'showObjects',
  'showDoodads',
  'showBuildings',
  'showMonsters',
  'showNpcs',
  'showGameObjects',
  'renderScale',
  'viewDistance',
  'fog',
  'cameraFollowGround',
  'cameraCollision',
  'timeOfDay',
  'dayCycle',
  'cycleMinutes',
  'clouds',
  'shadows',
  'propEffects',
  'animations',
  'cullSmallModels',
] as const satisfies readonly (keyof Prefs)[]

type ViewPrefs = Partial<Pick<Prefs, (typeof VIEW_PREFS)[number]>>

interface Scene {
  v: 1
  /** The map: a file (saved, or the cache copy of unsaved changes) or a block of the client's tiles. */
  map: { file: string; copy?: boolean } | { region: { mapName: string; x: number; y: number; size: number } }
  view: ReturnType<Engine['sceneView']>
  prefs: ViewPrefs
  tool: ToolId
  selectedIds: number[]
  selected: number | null
  area: typeof editor.selection
  /** The viewport's size in CSS pixels, so the same framing can be had. */
  viewport: [number, number]
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** The active map, written to a cache copy first when it has unsaved changes or was never saved. */
async function mapRef(engine: Engine): Promise<Scene['map']> {
  if (!editor.dirty && editor.filePath) return { file: editor.filePath }
  const r = editor.regionBlock
  if (!editor.dirty && r && editor.regionMap) return { region: { mapName: editor.regionMap, x: r.x, y: r.y, size: r.size } }
  return { file: await SaveSceneMap(toMapData(engine.snapshot())), copy: true }
}

export async function sceneText(engine: Engine): Promise<string> {
  const view = engine.sceneView()
  const p: ViewPrefs = {}
  for (const k of VIEW_PREFS) (p as Record<string, unknown>)[k] = prefs[k]
  const vp = engine.viewportSize()
  const scene: Scene = {
    v: 1,
    map: await mapRef(engine),
    view: { target: view.target.map(round) as [number, number, number], yaw: round(view.yaw), pitch: round(view.pitch), distance: round(view.distance), hour: round(view.hour) },
    prefs: p,
    tool: editor.tool,
    selectedIds: [...editor.selectedIds],
    selected: editor.selected?.id ?? null,
    area: editor.selection,
    viewport: vp,
  }
  return PREFIX + JSON.stringify(scene)
}

/** F9 (Import/Export › Copy Position as Teleport Command): the GM command to the point under the cursor, onto the clipboard. */
export async function copyTeleport(engine: Engine) {
  const r = await engine.teleportAtCursor()
  if ('error' in r) return setStatus(r.error, 6000)
  try {
    if (hasBackend()) await ClipboardSetText(r.command)
    else await navigator.clipboard.writeText(r.command)
    setStatus(`Copied ${r.command}: paste it in the game's chat as a GM.`, 6000)
  } catch (err) {
    setStatus(`Copying the position failed: ${err}`, 8000)
  }
}

/** Help > Copy Scene: puts the scene on the clipboard. */
export async function copyScene(engine: Engine) {
  if (!hasBackend()) return setStatus('Copying a scene needs the desktop app (run via `wails dev`).')
  try {
    const text = await sceneText(engine)
    await ClipboardSetText(text)
    setStatus(`Copied the scene${text.includes('"copy":true') ? ' (the unsaved map went to a copy in the cache)' : ''}. Paste it to share this exact view.`, 8000)
  } catch (err) {
    console.error(err)
    setStatus(`Copy scene failed: ${err}`, 8000)
  }
}

/**
 * Help › Copy Performance Report (#179): the next second's numbers of the performance overlay, measured
 * even with it off, and the scene line, so a slow spot can be pasted into an issue and opened again.
 */
export async function copyPerfReport(engine: Engine) {
  setStatus('Measuring the frame for a second…')
  try {
    const report = formatReport(await engine.measurePerf())
    let scene = ''
    if (hasBackend()) scene = await sceneText(engine).catch(() => '')
    const text = scene ? `${report}\n\n${scene}` : report
    if (hasBackend()) await ClipboardSetText(text)
    else await navigator.clipboard.writeText(text)
    setStatus('Copied the performance report' + (scene ? ' and the scene.' : '.'), 6000)
  } catch (err) {
    setStatus(`Copying the performance report failed: ${err}`, 8000)
  }
}

/** Opens the scene's map (or switches to its tab) and restores everything else the scene holds. */
export async function loadScene(engine: Engine, text: string) {
  const at = text.indexOf('{')
  const head = text.trim()
  if (!(head.startsWith(PREFIX.trim()) || head.startsWith(OLD_PREFIX.trim())) || at < 0) throw new Error('not a Meld scene')
  const scene = JSON.parse(text.slice(at)) as Scene
  if (scene.v !== 1) throw new Error(`unknown scene version ${scene.v}`)

  if ('region' in scene.map) {
    const r = scene.map.region
    await openWowRegion(engine, r.mapName, r.x, r.y, r.size)
  } else if (!engine.focusPath(scene.map.file)) {
    engine.openDocument(fromMapData(await LoadMap(scene.map.file)), scene.map.copy ? '' : scene.map.file)
  }

  for (const k of VIEW_PREFS) if (k in scene.prefs) (prefs as Record<string, unknown>)[k] = scene.prefs[k]
  editor.tool = scene.tool
  // Let the prefs effect run (it applies them to the engine, follow-ground included) before the view is set.
  await tick()
  engine.setSceneView(scene.view)
  const ids = scene.selectedIds.filter((id) => engine.objects.objects.has(id))
  selectObjects(engine.objects, ids, scene.selected ?? undefined)
  editor.selection = scene.area
  const [w, h] = scene.viewport
  setStatus(`Loaded the scene (it was framed in a ${w}×${h} viewport).`, 8000)
}

/** Help > Load Scene from Clipboard. */
export async function pasteScene(engine: Engine) {
  if (!hasBackend()) return setStatus('Loading a scene needs the desktop app (run via `wails dev`).')
  if (ui.busy) return
  try {
    await loadScene(engine, await ClipboardGetText())
  } catch (err) {
    console.error(err)
    setStatus(`Load scene failed: ${err}`, 8000)
  }
}

// For Claude and the browser console (wails dev): window.__loadScene(text) opens a pasted scene and
// window.__sceneText() returns the current one, without the clipboard.
if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>
  w.__loadScene = (text: string) => engineRef.current && loadScene(engineRef.current, text)
  w.__sceneText = () => engineRef.current && sceneText(engineRef.current)
}
