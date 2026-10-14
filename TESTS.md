# TESTS.md

Ways to test and verify Meld that are known to work. Read this before working out how to check
a change, and add to it when you find a good way to test something (see CLAUDE.md).

Each entry says what it checks, how to run it, and the traps that cost time.

## Unit and integration tests

- `make test` runs `go test ./internal/...` and the frontend unit tests (`node --test`, Node 22.18+).
- `make check` runs go vet and svelte-check/tsc.
- WoW client integration tests: `WOW_DIR=/path/to/client go test ./internal/wow/ -v`.

## Rendering and UI in the live app (Claude in Chrome)

Checks: anything visual (shaders, shadows, lighting, models, UI) against the real client assets.

- `make dev` (`wails dev`) serves the app at http://localhost:34115. The page exposes
  `window.__engine` (the Engine), `window.__loadScene(text)` and `window.__sceneText()`.
- Open a known spot with a scene: `{map:{region:{mapName:'Azeroth',x:32,y:48,size:1}}}` opens
  Northshire (the abbey is at about world x 182, z 353; the valley is dense canopy, so most ground
  is in tree shadow).
- Traps:
  - Tabs opened by the Chrome extension are usually `document.hidden`, so the rAF loop stops (the
    frame counter is stuck and loads hang). Drive frames with `__engine.frame()` from
    `javascript_tool`, then take the screenshot.
  - `javascript_tool` results that contain shader source are blocked as "cookie/query data".
    `console.log` them and read them with `read_console_messages` and a pattern.
  - If `/wow/status` gives no response, the Go side of the user's `wails dev` has died (its Vite
    child lingers on port 5391 and blocks a new `wails dev`). Tell the user their dev session is
    gone before starting one.
  - Vite's watcher misses files replaced by rename, such as by `sed -i` (and maybe Wails' binding
    regeneration). Vite then serves the stale module and the page fails with "does not provide an
    export named …". Edit with the Edit tool or an in-place write, and re-save a missed file in
    place to fix it. Check what is served through the Wails proxy, `curl localhost:34115/<file>`:
    Vite's own port moves (5173, 5174…), and an old dead Vite can linger on 5173.
  - `make build-windows` while `wails dev` runs is fine.
  - To call app modules (e.g. `selectSpawn`, `editor`) from `javascript_tool`, import the exact
    URL the page loaded (from `performance.getEntriesByType('resource')`, with its `?t=`). A bare
    path gives a second module instance with separate state.
- Off-screen probes settle what screenshots can't: read back a depth texture, or render from the
  sun's view and draw it onto a page overlay. This is how a "shadows look broken" report was
  traced to the shadow setup rather than the pipeline.
- three r186 facts that matter when reading shader output: `PCFSoftShadowMap` is removed (falls
  back to PCF), shadow maps are depth textures, and inside `#pragma unroll_loop` only
  `UNROLLED_LOOP_INDEX` and `[ i ]` are substituted.

## Scripted brush strokes

Checks: what a sculpt mode does to the heights, without dragging the mouse. In the dev page
(`javascript_tool`), make a flat map and drive the tool directly:

```js
const e = window.__engine
const ed = (await import(performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('editor.svelte.ts')))).editor
e.newDocument(256, 'flat', 0, 'Brushes')
ed.tool = 'sculpt'; e.frame()                 // frame() activates the tool
ed.sculptMode = 'crevice'; ed.brush.radius = 14; ed.brush.strength = 1
const V3 = e.controller.target.constructor    // THREE.Vector3
const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
e.tools.sculpt.onDown(e.ctx, at(60, 300))
for (let i = 0; i < 120; i++) e.tools.sculpt.tick(e.ctx, 0.05, at(60 + i * 2, 300))
e.tools.sculpt.onUp(e.ctx)                    // pushes the undo step
e.controller.target.set(180, 0, 300); e.controller.distance = 120; for (let i = 0; i < 5; i++) e.frame()
e.terrain.heightAt(180, 300)                  // then screenshot
```

- `tick(dt)` scales by `dt`, so a fast scripted drag digs as little as a fast real one.
- `e.history.undo()` then `e.frame()` checks the stroke's undo.

## Reproducing a user's view

- A pasted `Meld scene {...}` line (Help > Copy Scene) loads with
  `await window.__loadScene(text)` in the dev page. Loading sets the view prefs, which are saved to
  the user's config.
- Hold F8 in the app to name the component under the cursor (`DebugOverlay.svelte`).

## Gizmo drags (spin ring, height arrow, scale knob) without a mouse

Checks: the selected prop's gizmo (`TransformGizmo`), its sweep arc and the viewport badge, in the
dev page with `javascript_tool`. A drag through the Chrome extension releases the button at once,
so drive the Engine's private drag methods instead:

```js
const e = window.__engine
const sel = await import('<the loaded selection.ts URL>')
const o = e.objects.add({ type: 'm2:<any model path>', x: e.controller.target.x, z: e.controller.target.z, yOff: 14, rotY: 0, scale: 1 })
sel.selectObjects(e.objects, [o.id]); for (let i = 0; i < 5; i++) e.frame()
// Aim the pointer at the ring's +x point (the arrow: e.gizmo.arrow.position, the scale knob:
// e.gizmo.knob.position, dragged along e.gizmo.right), start, move, frame.
const p = e.gizmo.ring.position.clone(); p.x += e.gizmo.ring.scale.x; p.project(e.camera)
e.ndc.set(p.x, p.y); e.raycaster.setFromCamera(e.ndc, e.camera); e.startGizmoDrag()
const q = e.gizmo.ring.position.clone(); q.z -= e.gizmo.ring.scale.x; q.project(e.camera)
e.ndc.set(q.x, q.y); e.updateGizmoDrag(true); for (let i = 0; i < 3; i++) e.frame()   // then screenshot
await new Promise((r) => setTimeout(r, 60)); document.querySelector('.viewport .hint')?.textContent // the badge
e.endGizmoDrag()
```

- Traps: the gizmo only shows in the Select or Place tool (`editor.tool = 'select'` first). The
  badge is Svelte state, so query it after a short wait, and use `.viewport .hint`,
  since the asset preview has a `.hint` of its own. A fresh ocean map has its ground at -12, so
  give the object a `yOff` above the water or it sits under the sea.

## Session restore (reopening the last tabs at start)

Checks: `lib/io/session.ts` keeps the open file and region tabs with their cameras in
`prefs.session` (every 3 s when changed, and on quit) and opens them again at start. In the dev page:

```js
await window.__loadScene('Meld scene {"v":1,"map":{"region":{"mapName":"Azeroth","x":32,"y":48,"size":1}},"view":{"target":[182,30,353],"yaw":0.5,"pitch":0.6,"distance":60,"hour":13},"prefs":{},"tool":"select","selectedIds":[],"selected":null,"area":null,"viewport":[1000,600]}')
await new Promise((r) => setTimeout(r, 4000))      // the periodic save
JSON.stringify(prefs.session)                      // prefs from the loaded editor.svelte.ts URL
location.reload()                                  // then, after ~6 s: editor.regionMap, __engine.sceneView()
```

- The dev page writes the real config.json, so the user's own app will also open that region next.
  The target's y differs a little after a restore because the camera target rides on the ground.

## Gear picker (a spawn's main hand, off hand and ranged items)

Checks: `WeaponPicker.svelte` and the `ListWeapons` / `EquipmentFor` / `EquipmentItems` bindings. The
world database must be up (the picker reads item_template and writes creature_equip_template).

```js
const ed = await import('<editor.svelte.ts URL>'), se = await import('<spawnEdits.ts URL>')
const layer = __engine.activeDocument().spawnLayer; const s = layer.get('monster/106001')   // a Southsea Pirate
ed.editor.tool = 'select'; se.selectSpawn(s)
ed.ui.weaponPick = { key: 'monster/106001', slot: 1 }; ed.ui.dialog = 'weapon'   // 0 main hand, 1 off hand, 2 ranged
// then click a tile (or document.querySelector('[data-ui="WeaponPicker"] .tile').click())
layer.get('monster/106001').equipment, .equipItems, decodeURIComponent(look).match(/att=1:[^&]*/)
await window.go.main.App.EquipmentFor([14643, 1897, 0])   // finds or makes a template; run twice, same id
```

- Traps: thumbnails only render while frames run (`__engine.frame()` in a loop with short
  waits). `EquipmentFor` writes a creature_equip_template row for a new item combination, after
  the highest entry (987002 on this database): delete it again after a test, with its items in
  the WHERE clause. `editor.spawns` is a snapshot; read the layer's spawn for the edited state.

## Holes per triangle (Sculpt › Hole)

Checks: `holes.ts` (cell values 0 none, 1 whole cell, 2 first triangle, 3 second) and the Sculpt
tool's Hole mode. Unit tests: `tests/holes.test.ts`. In the dev page, without a mouse:

```js
const ed = await import('<editor.svelte.ts URL>'); const e = __engine; const t = e.terrain; const cs = t.cellSize
const cx = Math.floor(326 / cs), cz = Math.floor(720 / cs)       // a region's cells are 4.17 units, a new map's 2
ed.editor.tool = 'select'; ed.editor.selection = { x0: cx - 2, z0: cz - 2, x1: cx + 3, z1: cz + 3 }; e.setHoleInSelection(true)
ed.editor.selection = null; ed.editor.tool = 'sculpt'; ed.editor.sculptMode = 'hole'; ed.editor.holeFill = true
const hit = e.controller.target.clone().set((cx + 0.2) * cs, 0, (cz + 0.2) * cs)
e.tools.sculpt.onDown(e.ctx, hit, { shiftKey: false }); e.tools.sculpt.onUp(e.ctx)   // one triangle back
t.holes[cz * t.size + cx]                                          // 2 or 3; e.history.peek().label is 'Fill hole'
```

- Traps: on the default ocean map the hole is under the sea; set `prefs.showWater = false` and look
  down at it to see the floor through it. A point exactly on a cell's diagonal (0.8, 0.8 of an even
  cell) can land in either triangle, so probe away from it.

## Hole walls (drag an edge, + and − badges)

Checks: `lib/tools/HoleWalls.ts` (the Select tool and Sculpt › Hole show them). Unit tests of the
wall finder and the band maths: `tests/holeWalls.test.ts`. In the dev page, driving the Select
tool with the engine's raycaster (set its camera, which `setFromCamera` normally does):

```js
const e = __engine, t = e.terrain, cs = t.cellSize, walls = e.tools.select.walls, tool = e.tools.select
e.raycaster.camera = e.camera; const ray = e.raycaster.ray; ray.direction.set(0, -1, 0)
ray.origin.set(44 * cs + 0.1, 60, 41.5 * cs); walls.frame(e.ctx)      // hover the wall on line x = 44
tool.onDown(e.ctx, null, {}); ray.origin.x = 46 * cs; walls.frame(e.ctx); tool.onMove(e.ctx, null); tool.onUp(e.ctx, null, {})
const m = walls.minus.position; ray.origin.set(m.x, m.y + 30, m.z); walls.frame(e.ctx); tool.onDown(e.ctx, null, {}); tool.onUp(e.ctx, null, {})
```

- Traps: a badge click changes the walls, so re-hover before the next one (the wall may have moved
  a cell). The session restore opens the user's own map: undo every test edit (`e.undo()`) before
  leaving.

## Dock panels (Layers, Properties)

Checks: what the right-hand panels show for a map, a hovered chunk and a selection, without the
mouse. In the dev page (`javascript_tool`), after the module imports from "Scripted brush strokes":

```js
e.newDocument(128, 'island', 3, 'Panels'); for (let i = 0; i < 5; i++) e.frame()
e.regenerateAutoPaint()
ed.hoverChunk = 8 * 16 + 8                     // the Layers panel shows that chunk's four slots (16 chunks a side at 128 cells)
const sel = await import(performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('selection.ts')))
e.addObjects([{ type: 'm2:World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01.m2', x: 120, z: 130, yOff: 0, rotY: 0.7, scale: 1 }])
ed.tool = 'select'; sel.selectObjects(e.objects, [...e.objects.objects.keys()]); for (let i = 0; i < 3; i++) e.frame()
```

- Then zoom the screenshot on the dock (x from about 1408 at a 1568-wide window).
- The Layers panel's selection mode: `ed.selection = { x0: 20, z0: 8, x1: 44, z1: 24 }` (cells,
  so 8 chunks at 8 cells each); `e.selectedChunks()` lists them, and the panel's `.del` buttons and
  "Delete all" can be clicked from script. `e.chunkContents(c).length === 0` is an emptied chunk.
- A `PropField` label scrub can be driven with synthetic `PointerEvent`s (`pointerdown`, a few
  `pointermove`s, `pointerup`, `pointerId: 1`, `button: 0`) on the `.label` span; the value moves
  by pixels × step and `ui.canUndo` turns true on release.
- Trap: texture thumbnails stay blank in a hidden extension tab, since they render on the main
  renderer's rAF loop. The rows, names and coverage still show.
- The map's facts and world settings are not in the dock: `ui.dialog = 'mapProps'` opens the
  Map Properties dialog (File > Map Properties…). With a region open (`ed.region` set) the sea
  level is shown read-only; on a new world it is a slider bound to `ed.waterLevel`.

