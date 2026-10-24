import { tick } from 'svelte'
import type { Engine } from '../engine/Engine'
import { formatReport } from '../engine/perfMeter'
import { editor, prefs, setStatus, ui } from '../state/editor.svelte'
import { engineRef } from '../state/engineRef'
import { parseScene, PREFIX, VIEW_PREFS, type Scene, type ViewPrefs } from './sceneParse'
import { hasBackend, openPath } from './mapio'
import { CubeWorld } from '../cubes/world'
import { LoadWorld, SaveSceneWorld } from '../../../wailsjs/go/main/App'
import { main } from '../../../wailsjs/go/models'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'

// A scene is the editor's state as one line of text (Help > Copy Scene), so a view can be handed to
// someone else on this machine (or to Claude, through `window.__loadScene`) and opened again exactly:
// the world, the camera, the hour, the tool and the graphics preferences. A world with unsaved
// changes is written to a .world copy in the cache dir first, which the scene names (#65).

const round = (n: number) => Math.round(n * 1000) / 1000

/** The active world, written to a cache copy first when it has unsaved changes or was never saved. */
async function mapRef(engine: Engine): Promise<Scene['map']> {
  if (!editor.dirty && editor.filePath) return { file: editor.filePath }
  return { file: await SaveSceneWorld(main.WorldData.createFrom(engine.activeDocument().world.toData())), copy: true }
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
    viewport: vp,
  }
  return PREFIX + JSON.stringify(scene)
}

/** Help > Copy Scene: puts the scene on the clipboard. */
export async function copyScene(engine: Engine) {
  if (!hasBackend()) return setStatus('Copying a scene needs the desktop app (run via `wails dev`).')
  try {
    const text = await sceneText(engine)
    await ClipboardSetText(text)
    setStatus(`Copied the scene${text.includes('"copy":true') ? ' (the unsaved world went to a copy in the cache)' : ''}. Paste it to share this exact view.`, 8000)
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

/** Opens the scene's world (or switches to its tab) and restores everything else the scene holds. */
export async function loadScene(engine: Engine, text: string) {
  // Check the whole scene before anything is opened or written, so a bad paste changes nothing.
  const scene = parseScene(text, prefs as unknown as Record<string, unknown>)

  if (!engine.focusPath(scene.map.file)) {
    // A copy opens as an untitled world, so Save asks where rather than writing to the cache.
    if (scene.map.copy) engine.openWorld(CubeWorld.fromData(await LoadWorld(scene.map.file)), 'Scene world', '')
    else await openPath(engine, scene.map.file)
  }

  for (const k of VIEW_PREFS) if (k in scene.prefs) (prefs as Record<string, unknown>)[k] = scene.prefs[k]
  // The view's hour is the time of day too: applyPrefs puts timeOfDay back on the engine whenever any
  // pref changes, so a scene without it in its prefs (the probes' P.BENCH) would show the viewer's hour.
  if (!prefs.dayCycle) prefs.timeOfDay = Math.round(scene.view.hour * 100) / 100
  editor.tool = scene.tool
  // Let the prefs effect run (it applies them to the engine) before the view is set.
  await tick()
  engine.setSceneView(scene.view)
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
