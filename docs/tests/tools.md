# Tools and placing models

Brushes, gizmos, placement and the doodad, spawn and prefab tools. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Brush size controls (Photoshop-style)

Checks: `tools/brushSize.ts` (unit tests in `tests/brushSize.test.ts`) and the engine's Alt+right-drag.
In the dev page, with a brush tool active and the `editor.svelte.ts` module as `ed`:

```js
const c = document.querySelector('canvas')
const down = new PointerEvent('pointerdown', { button: 2, buttons: 2, altKey: true, clientX: 600, clientY: 300, bubbles: true, pointerId: 1 })
c.dispatchEvent(down)                                 // needs a ground hit under (600, 300): aim the camera at the map first
c.dispatchEvent(new PointerEvent('pointermove', { buttons: 2, altKey: true, clientX: 760, clientY: 300, bubbles: true, pointerId: 1 }))
ed.editor.brush.radius                                // doubled (DRAG_DOUBLE = 160 px)
c.dispatchEvent(new PointerEvent('pointerup', { button: 2, altKey: true, clientX: 760, clientY: 300, bubbles: true, pointerId: 1 }))
```

- The engine picks the ground from the pointer position on the press, so the pointer must be over
  the terrain in the hidden tab too (`__engine.frame()` first, after aiming the camera).
- The inspector: `ui.inspector = true` (or the I key) shows `.inspector` with the Properties
  panel's fields for the selection; Esc closes it without deselecting (App.svelte's key handler
  takes that Esc before the engine's selection keys).
- `setPointerCapture` throws on a synthetic event without a real pointer; the engine ignores that
  (it is wrapped), so the drag still works from a script.

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
- Sculpt's painting while shaping: `ed.sculptPaint = 'texture'; ed.sculptPaintLayer = 1` before the
  stroke, then `e.terrain.chunkSlots` holds texture 1 in the chunks under it and `e.terrain.weights`
  leans to it where the ground rose; one `e.history.undo()` takes both the heights and the paint
  back. `ed.sculptPaint = 'slope'` with `ed.roles = { rock: 3, dirt: 2 }` (a new world's defaults)
  paints a Mountain stroke's steep sides with texture 3 and the band at its foot with texture 2,
  while the flat ground outside keeps its paint: compare the dominant texture at the peak's flank,
  at its foot and on the plain.
- `e.history.undo()` then `e.frame()` checks the stroke's undo.
- Pen pressure on the radius (#42): set `prefs.tabletSupport = prefs.tabletRadius = true` (the app's
  module, see the `?t=` trap), then `e.penPressure = 0.3` before a stroke: a Raise stroke at radius 20
  touches 9 vertices instead of 69, `editor.brush.radius` stays 20 and the ring's
  `terrain.material.uniforms.brushRadius` reads 6.

## Vertex mode undo and keys on a focused control (#127)

Checks: Sculpt's Vertex edits undo, and Ctrl+Z reaches the map while an options-bar slider has the
focus. On a flat new world (as in "Scripted brush strokes"), `ed.sculptMode = 'vertex'`, pick points
with `onDown(e.ctx, at(100, 100), {})`, one `tick`, `onUp`; then `ed.vertexAngle = 30; e.frame()` tilts
them (`heightAt(108, 100)` rises). Find the Slope slider
(`[...document.querySelectorAll('label.opt input[type=range]')].find(r => r.closest('label').textContent.includes('Slope'))`),
`focus()` it and dispatch `new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })` on
it: the height goes back and `e.history.position` drops by one. The same event on a focused text
input must leave the history alone. A Shift move is `onDown(..., { shiftKey: true })`, then
`onMove(e.ctx, null, { movementY: -10 })` a few times and `onUp`.
- Trap: `e.history.peek()` is null whenever there are steps to redo, so after an undo read
  `e.history.position`, not `peek()`.
- Before #127 the App's key handler dropped every key aimed at an `INPUT` or `SELECT`, so after
  dragging Slope or Direction (the mode's only edit besides Flatten) Ctrl+Z did nothing.
- Until #345 the same drop also swallowed Delete, R and the tool letters after a click left the focus on an
  options-bar checkbox, slider or select. `bun run probe hotkeys` presses Delete on a selected model with
  each kind of control focused and after each editor opened and closed, and checks a text field and a
  slider keep their own keys. A control now keeps only the keys it uses (`controlKeepsKey` in `App.svelte`).

## Every tool's stroke is one undo step (#438, `tests/toolUndo.test.ts`)

Checks: the hard rule that every edit is undoable, and that a stroke is one step, for each tool and
mode without the app: `cd frontend && bun test tests/toolUndo.test.ts`. Each row drives a tool as the
Engine does (`onDown`, then `onMove` and `tick` each frame, `onUp`) on a real 64-cell `Terrain` with
paint, a hole block, a pond and three cubes in a real `ObjectLayer`, then asserts that the map changed,
that the History holds exactly one new step, that Undo gives back every array (heights, holes, paint,
mask, chunk data, shadows, liquids, objects, paths) and that Redo gives back the stroke's result.

- A new tool or mode gets a row in `rows`: its settings in `setup` (the editor and prefs are reset to
  their defaults before each row), and a `from`/`to`/`ticks` or an `act` when it is a click or a key.
  "The stroke changed the map" failing means the row's settings or the map don't give the tool
  anything to do (Erode thermal needed a lower talus than the map's slopes).
- The Select tool (#694) is built by `selectTool(w)`, its paste hooks doing what `Engine.commitPaste`
  does with the clip a row puts in `paste`. Its rows drag a model, three models, a creature and a path
  point, add a path point, paste models and an area, and drag a hole wall or click its + and − badge.
  The stroke draws the models first (`draw`: `ObjectLayer.update` and `cull`, as the Engine's frame
  does), since a pick finds only drawn instances, and points the pick ray straight down at each hit;
  the pointer's `clientX` moves 8 px a frame, past the tool's 4 px drag threshold. A spawn's pick needs
  its drawn model, so the creature row stands `pickHit` in on the layer. The hole wall rows hover the
  wall through `frame` with a camera's ray (`look`), as a sprite badge's raycast needs one.
- The spawn brush rows run the Doodad tool in Creatures mode with a `SpawnBrushTool` whose
  `newCreature` hook hands out guids; the snapshot holds the `SpawnLayer`'s spawns.
- A selection is no edit: the `selections` tests (a rectangle, a lasso, the selection brush, a click
  on a model) check that it selects with no History step and the map unchanged.
- Adding to and taking from an area (#712): `tests/toolUndo.test.ts`, "Shift adds to the area and Ctrl
  takes from it", drags a rect, a Shift rect beside it (one plain rect, all three cubes) and a Ctrl rect
  inside (a hole, its cube dropped), then Shift and plain clicks; `combineArea` itself is in
  `tests/areaShape.test.ts`. By hand in the dev page: the Shift or Ctrl rect is drawn as a yellow outline
  over the area while dragged, the area itself staying on show.
- The gizmo's handles are `engine/GizmoDrag.ts` (#555), so they are `tests/gizmoDrag.test.ts`
  (`bun test tests/gizmoDrag.test.ts`, well under a second): on a flat map through a fake `GizmoHost`
  with a real `TransformGizmo` and camera, one model's ring, arrow, knob and move arrow, a group's
  ring, arrow and knob, and a selected spawn's ring and arrow, each one step that Undo and Redo
  restore, with the snap and angle maths. The test puts the handles itself (`place`), as
  `Engine.updateSelectionVisuals` would, so a spawn needs no drawn model there. The probe `gizmo-undo`
  (`bun run probe gizmo-undo`, about 7 s) runs the model, group and spawn drags through the Engine in the
  live app; the spawn is a creature of the world database (so it needs the database), its cone standing in
  for a model not yet loaded, which is enough for `SpawnLayer.boundsOf` to show the gizmo.
- Trap: the hole walls draw on a canvas when made, so the test's `ctx.holeWalls` is made on first use
  inside `withCanvas`, which stands a `document` in and takes it away again (`uiScale.test.ts` checks the
  code without one).

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

## Place tool keys (preview height and offset)

Checks: `PlaceTool.onKey` (PgUp / PgDn set `editor.placeHeight`, the arrows `editor.placeOffset`,
camera-relative) and that Alt+scroll no longer touches the height. In the dev page, with the
`editor.svelte.ts` and `selection.ts` module URLs from "Scripted brush strokes":

```js
ed.editor.tool = 'place'; ed.editor.prefab = 'm2:World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01.m2'
sel.selectObjects(e.objects, [])          // with a selection the engine's nudge keys take the arrows instead
const key = (k, shift = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, shiftKey: shift }))
key('ArrowRight'); key('PageUp', true)    // placeOffset about 0.5 along the camera's right, placeHeight 1
document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, altKey: true, bubbles: true }))   // height unchanged
```

- The Options bar shows an Offset chip with Reset while the offset is not zero.

## Tilting by hand (Z+scroll, #344)

Checks: holding Z turns the wheel into tilt (Shift: roll), 5° a notch, on the selected models or, in
the Place tool with nothing selected, on the preview, and the camera does not zoom meanwhile. Probe
`hand-tilt` (`bun run probe hand-tilt`) sends the Z key and wheel events to the canvas and checks the
preview's next placement, the selection's `tiltX`/`tiltZ`, one undo step for a burst, and that
scrolling back to 0 hands the tilt back to Random tilt. `tests/placement.test.ts` pins `stepTilt`.
- Trap: the key is tracked by `e.code === 'KeyZ'`, so a synthetic keydown needs `code: 'KeyZ'`, and a
  keyup (or a window blur) to release it, or later wheel events keep tilting.

## Undoing a placement with the cursor over it (#719, probe `place-undo`)

Checks: with the Place tool and Fit ground on, a click on bumpy ground places a helper cube with the
ground fitted under it as one step (`Place and fit ground`), and Ctrl+Z takes both away with the next
frames running: no throw, no model left, every height back, and the undo with its first frame under
100 ms of script. Probe `place-undo` (`bun run probe place-undo`).
- Trap: a removed object stays in its instance batch, with its id in the mesh's `userData.ids`, until
  `ObjectLayer.update` repacks it, and the tool's `frame` (the Place preview's surface raycast) runs
  before that update in `Engine.simulate`. A pick that looks the hit id up with `objects.get(id)!`
  threw there every frame, so `update` never ran and the view froze until the cursor left the
  model's footprint (the owner's 500 to 1000 ms "lag" on a large building). Skip ids that are no
  longer in `objects`.
- Measure the script time with `e.undo(); e.frame()` between `performance.now()` calls: `P.frames`
  waits for SwiftShader to draw, 200 to 350 ms a frame on the dev page, which hides the script cost.

## Placing a creature or game object: the preview's size (#672)

Checks: with a template from the browser's Creatures, NPCs or Objects tab, the Place tool's preview is
drawn at the size the spawn takes (`placingSpawnScale` in `ObjectTools.ts`: the template's scale times
its display's, an object's `size`), not at 1, Shift+scroll leaves it be, and the clicked spawn's
`scale` matches. Probe `place-spawn-size` (`bun run probe place-spawn-size`) picks the first object
and creature templates sized away from 1 on the benchmark scene; needs the world database. The spawn
brush's ghosts take the same size through its `ghostScale` hook.
- The clicked spawn also faces the preview's rotation (`tool.rot`, turned by R, Ctrl+scroll or Random
  rotation; #673): the probe sets `tool.rot` and compares the spawn's `orientation` with
  `spawnOrientation(rot)`. The Select tool's template click still faces the camera.
- Trap: a template made in the creature editor (`creatureTemplateOf`) has `displayScale` 1 until its
  look is read, so its preview misses the display's own scale; the browser's templates carry it.

## Placement tilt (the client's rotation order, #149)

Checks: a placed model's tilt and roll match the client's. `world/placement.ts` (`placementEuler`) is the
one place the rotation is built; `tests/placement.test.ts` pins it to the client's order, heading, then
Rz(-first angle), then Rx(third angle), in the editor's frame. The references that agree: wowdev.wiki's
ADT `createPlacementMatrix`, Noggit Red's `SceneObject::updateTransformMatrix` and VMaNGOS's vmap
`ModelInstance` (`fromEulerAnglesZYX(y, x, z)` in WoW's z-up frame).
- Trap: how well models sit on the terrain does not tell the conventions apart. Over the 898 tilted
  models of Azeroth (37,25) 3x3, the mean gap between a model's base and the ground was the same for
  both orders (Blizzard's tilts don't follow the slope), so judge a change here against the references,
  or a screenshot from the game.

## Doodad brush (scatter models by weight)

Checks: `DoodadBrushTool` places the brush's models under the brush in their weights' proportions,
keeps them apart by the spacing, erases them with Ctrl, and undoes as one step. The brush logic alone
(`pickEntry`, `candidate`, `fits`, the TOML round trip) is `tests/doodadBrush.test.ts`. In the dev
page, with the `editor.svelte.ts` module URL from "Scripted brush strokes" (it exports `prefs`):

```js
const e = window.__engine
e.newDocument(256, 'flat', 0, 'Doodads')
ed.prefs.doodadBrushes = [{ name: 'Test', spacing: 1, entries: [
  { type: 'm2:World\Azeroth\Elwynn\PassiveDoodads\Bush\ElwynnBush01.m2', weight: 30, scaleMin: 0.9, scaleMax: 1.1, sink: 0, tilt: 0 },
  { type: 'm2:World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01.m2', weight: 10, scaleMin: 0.9, scaleMax: 1.1, sink: 0, tilt: 0 },
]}]
ed.prefs.doodadBrush = 'Test'
ed.editor.tool = 'doodad'; e.frame()
ed.editor.brush.radius = 20; ed.editor.brush.strength = 1; ed.editor.brush.falloff = 0.5
const V3 = e.controller.target.constructor
const at = (x, z) => new V3(x, e.terrain.heightAt(x, z), z)
e.tools.doodad.onDown(e.ctx, at(200, 200), new PointerEvent('pointerdown'))
for (let i = 0; i < 120; i++) e.tools.doodad.tick(e.ctx, 0.05, at(200, 200))
e.tools.doodad.onUp(e.ctx)
e.objects.objects.size                              // settles at a few dozen: the spacing fills the circle up
e.history.undo(); e.objects.objects.size            // 0
```

- Models load async; before the mesh arrives the placeholder's box sets the footprint, so the first
  stroke on a fresh page spaces by the placeholder. Place once, wait, undo, place again to compare.
- Hovering shows the next placements as ghosts: `e.tools.doodad.frame(e.ctx, at(200, 200))`, then
  `e.tools.doodad.ghostGroup.children.filter((g) => g.visible).length` is the plan's size (about a
  quarter second of the brush, at most 32); a press places those first, so a click puts down what
  was shown.
- An erase is `onDown` with `new PointerEvent('pointerdown', { ctrlKey: true })`; `shiftKey: true`
  stacks (no spacing), so the count keeps growing with every tick instead of settling.
- The editor window is `ui.brushEditor = true` (Edit brush… in the options bar, or World › Doodad
  Brushes…); a click on a tile adds the model, a ✓ badge marks the ones in the brush.
- Trap: an `$effect` that reads a `$state` it also writes (the editor once read `all.length` before
  loading `all`) re-runs after every write and hangs the app as soon as the window opens. Guard such
  loads with a revision variable (plain `let`, not state), as the asset browser does.
- Trap: a test brush made in a dev page opened without `?nosave` was saved over the user's own
  brushes once (see the note at the top). With the flag, test brushes are safe; they vanish on reload.
- A brush file is `formatBrush(brush)` from `tools/doodadBrush.ts`; paste its text into a `.toml` file
  and Import/Export › Import Doodad Brushes… adds it under a free name ("Test 2" if "Test" exists).
- Slope and prop rules (`editor.doodad.maxSlope`, `editor.doodad.onProps`): on a `'hills'` preset
  document, `ed.editor.doodad.maxSlope = 10` and a stroke as above leaves the steep flanks bare
  (`groundSlopeDeg` in `world/groundTilt.ts` is the angle; unit test in `groundTilt.test.ts`). With
  `onProps = true` and a WMO placed first (`e.addObjects([...])` as in "Attachments"), models whose
  point falls on its roof come out with `parent` set to the WMO's id and `yOff` local to it; the ray
  skips what the stroke itself placed, so a brush never piles onto its own models. `fitsOn` (spacing
  per prop) is in `doodadBrush.test.ts`.
- Placement rules and Fill (#169): `doodadBrush.test.ts` covers `rulesAllow`, the `[rules]` TOML,
  `SpacingGrid` against `fits`, `textureWeightTexel` and `LiquidMap.covers`. In the dev page, on
  Northshire (Azeroth 32_48, 1x1, which is 128 cells a side, so keep a selection under 128): set
  `prefs.doodadBrushes` to a brush of `m2:world\azeroth\elwynn\passivedoodads\bush\elwynnbush09.mdx`
  with `rules.onTextures = ['Tileset\Elwynn\ElwynnGrassBase.blp']` and
  `offTextures = ['Tileset\Elwynn\ElwynnCobbleStoneBase.blp']`, `editor.selection = {x0: 20, z0: 20,
  x1: 100, z1: 100}`, then `__engine.fillWithDoodadBrush(false)`: about 85 bushes in ~250 ms, every
  one where `textureWeightAt` gives grass ≥ 0.5 and cobblestone < 0.5, and one undo ("Fill with doodad
  brush") takes them all. A hand stroke still works through `__engine.doodadTool`'s `onDown`, `tick`
  and `onUp` with `__engine.ctx`.
- Trap: an edit to a module the page imported reloads the page, so the region is gone; load the scene again.

## Spawn brush (the Doodad tool's Creatures mode, #171)

Checks: `tools/SpawnBrushTool.ts` (unit tests of the arithmetic in `spawnBrush.test.ts`). In the dev page
on Northshire (its 347 spawns come from the world database), set `prefs.spawnBrush` to
`{ ...newSpawnBrush(), entries: [entryFrom(<Young Wolf's template>)], density: 20, spacing: 8 }` (the
module URL from `SpawnBrushTool.ts`'s source), `editor.doodadMode = 'creatures'`, radius 40, and drive
`__engine.tools.doodad` (`onDown`, `tick`, `onUp`) at x 300, z 300. The first stroke places nothing:
it asks Go for the look and the next guid. Wait a couple of seconds and stroke again: 10 wolves (the
target for 20 per 100×100 yd in a 40 yd circle), all at least 8 yd apart, each with its own guid, the
template's levels, wander 5 and respawn 300, and 10 spawn edits. One undo removes them, and
Ctrl+drag erases them as one step. `spawns.frame(ctx, point)` shows the planned ghosts; Models mode hides them.

Undo speed (#193): undoing a stroke must not redraw the spawn layer once a creature (`SpawnLayer.redraw` walks every spawn), so the stroke's undo and redo run in `spawnsBatch`. The probe `undo-spawns` pushes such a step on Elwynn's 1.3k spawns and counts `layer.version` bumps (2, not 60). Timings of `Engine.undo` for sculpt, paint, water and the Doodad brush on Northshire (8k models) were under 1 ms each in Chromium, with no frame spike after, so a slow Ctrl+Z is not in those.

- Placement rules (#196, the options bar's Rules…, `SpawnRulesDialog.svelte` over the shared
  `PlacementRulesForm.svelte`): probe `__engine.tools.doodad.spawns.groundAllows(__engine.ctx, x, z)`
  over x 120 to 240, z 290 to 410 (step 3) and read each point's weights from `spawns.ground`
  (`ToolGround`, after `ground.at(ctx, x, z)`). Without rules all 340 cobblestone points around the abbey
  are allowed; with `prefs.spawnBrush.rules.onTextures = ['Tileset\\Elwynn\\ElwynnGrassBase.blp']` none
  are, and all 594 grass points still are.

- Trap: T3 Code's hidden preview throttles timers (once a second, slower after a while), so a probe
  that awaits many `setTimeout`s runs for minutes and every later evaluate queues behind it. Wait with
  `MessageChannel` turns that check `performance.now()` instead.

## Prefabs (#170)

Checks: `wow/prefabs.ts` (TOML, variation; `prefabs.test.ts`), `world/clipTurn.ts`, the Prefabs tab
(`PrefabBrowser.svelte`) and the multi-model thumbnail (`thumbs.ts` `renderPrefab`). In the dev page on
Northshire: select a few models (`selectObjects(e.objects, ids)`), write `formatPrefab({ name, objects:
e.selectionClip().objects })` into a scratch folder with `window.go.main.App.WriteTextFile`, set
`prefs.prefabDir` to it and `prefs.browserKind = 'prefabs'`, bump `ui.prefabsVersion`: the tab lists it
with its model count. The tile asks for its thumbnail only when on screen, which a hidden preview tab
may not report: call `requestThumb(key, ...)` from `wow/thumbs.ts` after `registerPrefab`, then
`curl "localhost:34115/wow/thumb?key=v2%7C<key, url-encoded>"` gives the PNG. Placing:
`e.placeObjectClip(prefabClip(p, null))`, `e.turnPastedModels(-Math.PI / 2)`, set
`e.selectTool.pasteWorld` to a Vector3 and `e.commitPaste()`: the models land turned about their
middle, one undo step ("Paste 2 models").

Pasting onto a building (#191): Northshire Abbey is object 784 (x 179, z 364); a down-ray there
(`e.objects.raycastAmong(new Ray(new V3(179, 10000, 364), new V3(0, -1, 0)), [784], 1)`, `Ray` from
`e.ctx.raycaster.ray.constructor`) meets its roof at y 135, over ground at 80. Copy crate 285 and pine
288 (`copyObjects` from the `world/clipboard.ts` URL the Engine imports), `e.placeObjectClip(clip)`,
set `pasteWorld` to the roof point and `e.selectTool.pasteOnModel = true`, then `e.commitPaste()`:
both come out with `parent` 784, at the roof's height under each (130.5 and 122.1, it slopes).
`s.updateGhosts(e.ctx, clip, point)` with `pasteOnModel` on puts the ghosts' matrices (element 13) at
the same heights. Probes that step 30 frames with 200 ms waits on Northshire take longer than the
preview's 15 s limit; keep each evaluate short.

## Rotate around pivot point (group spins)

Checks: with two or more models selected, R (and Alt+arrows) turn the group about the mean of its
positions when `editor.rotatePivot` is on (the Select tool's checkbox, shown for a multi-selection),
and each about its own origin when off. Unit test: `tests/pivot.test.ts` (`meanPivot`, `turnAbout`
against three's rotation). In the dev page, after the "Selection outline colours" set-up with the
two trees at x 128 and 140:

```js
e.nudgeSelected(0, 0, 0, Math.PI / 2)        // rotatePivot on: the trees swap to z 134 ± 6, both rotY π/2
e.history.undo()
ed.editor.rotatePivot = false; e.nudgeSelected(0, 0, 0, Math.PI / 2)   // they stay put and only turn
```

- `e.selectionPivot()` gives the pivot. A ground model is re-seated on the terrain where it lands;
  an attached one keeps its height on its parent.

## Group gizmo (ring, knob and arrow on a multi-selection)

Checks: with two or more models selected in the Select or Place tool, the ring, scale knob and
arrow stand at the selection's pivot (`e.selectionPivot()`), sized round the whole group; the ring
turns the group (about the pivot with Rotate around pivot point, else each in place), the knob
scales the models and their spread, and the arrow lifts them all. A drag is one undo step ("Turn N
objects"). The knob is hidden when a WMO is in the group. In the dev page, after the "Selection
outline colours" set-up: `e.frame()` then `e.gizmo.visible` is true with both trees selected
(`e.gizmo` is private; read it through `e['gizmo']` in the console). Drags need the mouse: hover
the ring (the cursor becomes a grab hand), drag sideways and watch the hint "Rotation N° (2 objects)".

## Mouse-move snap (Follow cursor, Snap models to the ground)

Checks: in the Select tool, a dragged single model follows the surface under the cursor with
`editor.moveFollowCursor` on (default) and slides across a level plane at its starting height with
it off; a dragged group lands on the ground with `editor.moveSnapGroup` on and keeps every model's
height with it off (default). Both are checkboxes in the options bar next to the selection chip.
In the dev page the drag needs the mouse: select a tree, untick Follow cursor, drag it up a slope
and watch `ed.editor.selected.yOff` go negative (it keeps its world height). A test by script:
`e.tools.select.onDown` / `onMove` with `e.ctx` and a hit (see "Doodad brush" for `at(x, z)`) after
`e.raycaster.setFromCamera(e.ndc, e.camera)`; `onMove` reads `ctx.raycaster.ray` for the plane.

## Clear tool: the models a stroke would delete (#131)

Checks: in Models mode the Clear tool marks, while it hovers, exactly the models a stroke there
removes, with a red outline and a red tint (`Engine.doomOutline`, a `SelectionOutline` with one
colour and `fill`). In the dev page (GPU Chrome, as in "Minimap window (M)"), load Azeroth 32_48 with
`"tool":"clear"`, set `ed.clearMode = 'models'; ed.brush.radius = 18`, put `e.controller.target` on
a root model (the nearest to x 150, z 300 is an Elwynn tree), then `e.ndc.set(0, 0);
e.pointerInside = true` and step a few frames: `e.tools.clear.doomed` lists the tree and a bush.
`onDown(e.ctx, e.hit.clone()); onUp(e.ctx)` removes those two and no other, `doomed` is empty after,
and `e.undo()` brings them and their marks back.
- The marks are found again only when the brush moves, its radius changes or a model is added or
  removed (`ObjectLayer.version`); a model moved under a still brush is picked up on the next move.
- The tint is drawn over the frame, so it shows through what stands in front of a marked model.

## Tools reuse their plans and brushes per frame (#452, probe `tool-reuse`)

Checks: the hover and tick paths don't rebuild what their inputs haven't changed, and still rebuild
when they do. `bun run probe tool-reuse` (a flat map, no world database needed): the Doodad brush's
`plan` stays the same array while `ensurePlan` sees the same brush and settings, and is drawn again
after a radius change or a new entry; the Spawn brush's plan stays for a move under a quarter radius
and is drawn again after a long one; the Select tool's paste `landings` stay for the same anchor (to
the hundredth of a yard) and are worked out again when it moves; a Place scatter stroke's props keep
the spacing (0.8 yd for a 1 yd cube); the Water tool's paint and Clear › Liquids work through their
reused `LiquidBrush` (`newLiquidBrush`), and both undo.
- The plan and landing checks compare their inputs through `tools/inputsKey.ts` (`InputsKey`), not a
  joined string. A new input to a plan goes in as another `.add(...)`, or a change to it won't
  redraw the plan.
- The probe calls the tools' private methods (`ensurePlan`, `updateGhosts`) by name; a rename breaks it.

## Paths: roads along a curve (#167, probe `path-road`)

Checks: the Path tool's clicks drop a road's points on the ground, a click on a dot picks it rather
than adding one, Shift+drag raises it, Apply levels the ground to the curve's height and paints the
road's texture across its width (one undo step), and applying again after deleting the raised point
takes the first apply back (the hump goes), with both applies undoing in order.
`bun run probe path-road` on a fresh flat map; `--shot <dir>` saves `path-road-applied.png`, the road
seen from above with its dots and width lines.
- `frontend/tests/paths.test.ts` covers the curve sampling, the grade limit, the cross profile, the
  distance field, reading paths from a file and a road's heights and paint through `applyPath`
  (`tools/pathApply.ts`) with their undo, on a plain object standing in for `Terrain`.
- The probe aims the clicks by projecting world points through `e.camera` (`Vector3.project`), and
  passes `movementY` in the drag's event options, which a synthetic `PointerEvent` otherwise leaves 0.

## Paths: rivers (#167, probe `path-river`)

Checks: a River path's Apply carves the bed under the curve, fills the cells within half its width
with the liquid, the surface higher at the raised upstream end than downstream (it only runs
downhill), leaves the ground beyond the falloff alone, and one undo takes the liquid and the bed
back. `bun run probe path-river`; `--shot <dir>` saves `path-river-applied.png`, the river seen at an
angle. `frontend/tests/paths.test.ts` covers `downhill`, `riverBed` and a river's apply and undo.
- The probe adds the points through `PathTool.onDown` with hits it makes, aiming the raycaster away
  from the dots first (the press picks a dot it hits rather than adding a point).

## Paths: fences (#167, probe `path-fence`)

Checks: a Fence path with Duskwood's fence segment stands the model end to end along the curve
(25 over about 112 yd, 4.48 yd apart, the model's own length), each turned along the run, a wider
spacing applied again replaces them (6 at 20 yd) rather than adding, and undo brings the first set
back and then removes it. `bun run probe path-fence` (needs the client); `--shot <dir>` saves
`path-fence-applied.png`. `frontend/tests/paths.test.ts` covers `fencePieces` (spans, the turn, a
model long in Z) and a fence's apply and undo on stand-in layers.
- The model is measured from its loaded bounds (`loadAsset`) before the apply, so `PathTool.apply`
  is async for a fence; the probe awaits `e.path((t, c) => t.apply(c))`.
