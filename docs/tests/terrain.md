# Terrain, water and map data

Sculpting, holes, areas, paint, liquids, shadows and the map as a whole. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Growing a region (the Map panel's plus)

Checks: `extendRegion` (`io/mapio.ts`) and `grownBlock` (`io/regionGrow.ts`, unit tests in
`tests/regionGrow.test.ts`). In the dev page, with a region open and `editor.svelte.ts` as `ed`:

```js
const m = await import('<the loaded mapio.ts URL>')
ed.editor.regionBlock                         // e.g. {x: 32, y: 48, size: 1}
await m.extendRegion(window.__engine, 'e')    // opens 2×2 at the same origin, closes the 1×1 tab
ed.editor.regionBlock, ed.docs.tabs.length    // {x: 32, y: 48, size: 2}, the tab count unchanged
```

- A dirty region is refused with a status message (save first). The buttons are `.plus` in the Map
  panel; they are missing on a side where the map ends or when the region is 16 tiles.
- Opening a region takes a few seconds; `ui.busy` is true meanwhile, and the Map panel ignores a
  second plus until it is done.

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
- The fade (#249): the ribbons fade out with the camera's distance (`WALL_FADE_NEAR`/`WALL_FADE_FAR`
  in `terrain/holes.ts`, 90 to 150 yd) and show round the cursor's ground point at any distance
  (`revealRadius`). Unit test: `wallFade` in `tests/holeWalls.test.ts`. Probe: `hole-walls-fade`
  draws `walls.group` alone with its own square camera, near a hole and 900 yd out with the cursor
  away from it and on it, and compares each against the same view with the ribbons hidden. Trap: the
  ribbons draw with depthTest off, so with the whole scene drawn a far wall would show through the
  ground; draw the group alone, and hide the hover ribbon, glow and badges (they don't fade).

## Sculpt › Terrace (#166)

Checks: the Terrace mode (`terraceHeight`/`terraceLevel` in `tools/sculptShapes.ts`, unit tests in
`sculptShapes.test.ts`). In the dev page, drive the tool directly: `s = __engine.tools.sculpt`, set
`editor.sculptMode`, `editor.brush` and `editor.terrace` through the loaded `editor.svelte.ts`, then
`s.onDown(__engine.ctx, v, new PointerEvent('pointerdown'))`, `s.tick(ctx, 0.05, v)` a few dozen times
and `s.onUp(...)`, with `v` a Vector3 on the ground (`__engine.controller.target.clone().set(...)`).
Raise a hill (60 ticks, radius 40), then terrace it (step 6, sharpness 1, falloff 0, 80 ticks): every
vertex near the centre lands on a multiple of 6, a `helper:post` added on the slope rides the new
ground, and one undo restores the heights. With `{ shiftKey: true }` on the pointerdown, every vertex
under the brush goes to the level under the first click.

- Set `prefs.autosaveMinutes = 0` in a probe page that edits for minutes, or autosave (#177) leaves
  recovery copies in the dev session for the next start to offer.
- A probe edit that breaks a Svelte file's parse breaks the owner's own `wails dev` window too until
  it is fixed: check `curl localhost:34115/src/components/<File>.svelte` gives 200 after editing.

## Sculpt › Erode and Terrain › Erode (#165)

Checks: the Erode brush (water and thermal) and the area pass. The droplet and thermal models are
`terrain/erosion.ts` and the sliced area run `terrain/erodeArea.ts`, unit tests in `erosion.test.ts`
(same seed, same result; flat ground untouched; thermal keeps the volume and ends at the talus slope;
cancel stops at the next turn). In the live app, `pnpm probe erode`: on a Mountains map (256, seed 3)
a water and a thermal stroke at the steepest spot change only vertices inside the brush and undo and
redo exactly, and `Engine.erodeArea` over a 60-cell square changes only its inner vertices, reports
progress to 1, undoes as "Erode selection", and a cancelled run changes nothing. With `mask: true`
(#242) the mask holds texels only inside the square, a texel set far outside is cleared, `ui.maskActive`
turns on, and one undo restores the mask and the heights; `settledMask` has its own unit test (set at a
cone's foot, empty on its peak, nothing outside the rect written).

- To see it, a scratch probe can `e.controller.setView(x, y, z, 0.8, 0.7, 380)` over the highest peak
  and run `pnpm probe <file> --shot <dir>` with and without `erodeArea` (density 1, 5 passes): the peak
  comes out lower and gullied. The 256 Mountains preset is only about 60 yd high, so a stroke there is
  stronger than on a client continent.
- To see the mask, a scratch probe can draw the area's heights and `t.mask` side by side into a
  `{ w, h, px }` picture and `P.save` it (spot (68, 52) of that map): the mask lies in the low ground
  beside the ridge, about 45% of the square's texels, a sixth of them full.
- One drop a cell moves up to about 40% of a small steep cone's height (the unit test's bound is half); the dialog defaults to 0.5.

## Mask wand, Grow, Shrink and Feather (#183)

Checks: Paint › Mask's Select by (`editor.maskSelect`, `tools/maskWand.ts`; the texel arithmetic is
`terrain/maskSelect.ts`, unit tests in `maskSelect.test.ts`). In the dev page, on Northshire (Azeroth
32_48, 1x1, `splatRes` 512), set `editor.tool = 'paint'`, `editor.paintMode = 'mask'` and
`editor.maskSelect.by`, then click with `p = __engine.tools.paint`:
`p.onDown(__engine.ctx, v, new PointerEvent('pointerdown', { shiftKey }))` and `p.onUp(__engine.ctx)`,
with `v` on the ground at x 150, z 300. Count the mask's texels at 128 or more. Texture, contiguous:
about 52k texels; with `contiguous = false`, 83k; slope 30° to 90° over the whole map, added with
Shift, about 137k in 45 ms. Each click is one undo step named after the pick ("Add to mask by slope"),
and `__engine.modifyMask('grow' | 'shrink' | 'feather')` runs in under 20 ms.

- The options bar's Modify mask drop-down listens through Svelte 5's delegated `change`: a probe must
  dispatch `new Event('change', { bubbles: true })`, or nothing happens.
- A seed that doesn't match (a flat spot for slope 30° and up, dry ground for water) takes nothing with
  Contiguous on. That is right, not a bug: the status bar says "Nothing to select".
- T3 Code's preview can't take a screenshot while its pane is hidden. Read the options bar's DOM
  (`[data-ui="OptionsBar"]`; the controls that wrap under More, #254, sit more than 20 px below the top of its `.options`) instead.

## Lasso and polygon areas (#183)

Checks: free-form areas (`terrain/areaShape.ts`, `state/areaSelection.ts`; unit tests in
`areaShape.test.ts`: the raster, bounds, edge distance, a clip's cells turning with it, a liquid paste
inside a shape). In the dev page on Northshire, skip the pointer and close an outline directly:
`s = __engine.tools.select; s.outline = { pts, op: 'replace' | 'add' | 'subtract', polygon: false };
s.closeOutline(__engine.ctx)`, with `pts` a ring of world x, z pairs around (150, 300). Then
`editor.selection` is the bounds, `terrain.material.uniforms.selMode` is 3 after a frame, and
`setHoleInSelection`, `holesInSelection`, `maskFromSelection`, `selectedChunks` and
`resizeSelection(±1)` follow the cells. Copy and paste: clear the selected models first (Copy prefers
them), `copySelection()` gives `__engine.clip.cells`, and a paste at `s.pasteAt = { x: 60, z: 30 }` with
`commitPaste()` changes only vertices that touch a cell of the shape (with the default 2-cell blend,
the shape's rim keeps the map's heights). One undo restores every height.

- Shadows and water in a shape (#194): on Northshire with nothing selected, `await __engine.bakeShadows(true)`
  shadows the ground around x 267, z 132 at noon. A lasso there, then `clearShadows()`, lights every
  texel of its cells and none outside. Clear everything, close the lasso again and bake: about 25k
  texels inside, 0 outside, and one undo leaves none. A spot without ground shadow at that hour bakes
  nothing, and the stroke then drops the map's (empty) shadow layer, so `terrain.shadow` stays null.
- Trap: `performance.getEntriesByType('resource')` stops at 250 entries, so on a page that loaded a
  region it may list an old `editor.svelte.ts?t=` and a probe then imports a second copy whose `editor`
  the Engine never reads (the selection seemed set, the shader saw none). Take the URL from a module's
  own source instead: `(await (await fetch('/src/lib/engine/Engine.ts?t=…')).text()).match(/from "([^"]*editor\.svelte\.ts[^"]*)"/)`.
- Trap: a probe that awaits `requestAnimationFrame`, or moves the camera through `setSceneView` and
  then awaits timers, wedged T3 Code's hidden preview tab twice (every later evaluate timed out). Step
  with `__engine.frame()` and set `controller.target`, `pitch`, `distance` and `yaw` directly.
- Comparing two renders (`selMode` forced to 0, then back, `renderer.render` and a 2D canvas
  `drawImage`) shows the tint over exactly the shape's cells; the probe found no outline pixels for a
  plain rect either, so judge the marching ants by eye in the app.

## Check Map (#176)

Checks: File › Check Map… (`lib/check/`: pure checks in `models.ts`, `spawns.ts`, `terrainChecks.ts`,
unit tests in `mapCheck.test.ts`; `run.ts` gathers the map and the probes; `Engine.checkMap`,
`focusFinding`, `fixFinding`; the window is `CheckMapWindow.svelte`). In the dev page on Northshire
(Azeroth 32_48, 1x1, with the server's 347 spawns), wait a few seconds for the models, then
`await __engine.checkMap()`: about 55 ms, and the findings are md_spidermine buried (a dungeon WMO 91
yd under the map), two bird01 high up (info), hidden water in chunk 5, 15 and one unused palette colour.
A copy of a model added on top of itself (`e.objects.add({ ...o, id: undefined })`) shows as Duplicate
models, `fixFinding` deletes the copy and crops the water, and each fix is one undo step. Push a spawn
10 yd down (`spawn.y -= 10`) and `focusFinding` on its finding selects it and moves the camera there.
`ui.checkMap = true` opens the window, which runs the checks itself.

- The server's heights sit up to a yard or two off the editor's ground (bilinear in a cell, where the
  client uses triangles), most on slopes: wolves on 24° to 35° slopes and a guard's path point 1.1 yd
  "under" flat ground came up until the under-ground tests allowed 2 yd plus half a cell times the
  slope. Don't tighten it without checking Northshire again.
- The checks of #195, on the same Northshire block: plant a created spawn on a guid the database
  has (`e.doc.spawnLayer.add({ ...aCreature, guid: 1, entry: 299, waypoints: [] })`; guid 1 is entry
  2843) for a Spawn guids taken error; put a creature at an `elwynncliffrock02` M2's origin plus 0.3 yd
  for Spawns inside models; raise a border vertex (`e.terrain.heights[64] += 3`) for a Region edge seam
  error. Unedited, the block's border matches the client's tiles exactly and none of its 347 spawns is
  inside a model. With Preferences › Check the Map before Compile on, File › Compile Region to Client
  then stops with "Compile stopped: … 2 errors" and opens the window, before anything is written.
- The bindings alone: `await go.main.App.RegionEdges('Azeroth', 32, 48, 1)` (four 129-height rows)
  and `await go.main.App.CheckSpawnIDs({ creatureGuids: [1], objectGuids: [], creatureEntries: [999999], objectEntries: [] })`.
- A save of such a planted spawn is refused (#199): `VMANGOS_DIR=/c/WoW/vmangos go test
  ./internal/vmangos/ -run TestCreatedGUIDLive -v` checks the pre-check and that the SQL alone fails on
  the key, leaving guid 1 as it was. Don't test it by saving from the page: a dev window still running
  an older Go build would delete guid 1's creature.
- The inside test casts six rays from the creature's chest and counts back faces (`raycastModel`): a
  creature under a tree's canopy or beside a trunk meets front faces or nothing, so it isn't flagged.
- The floor and wall probes go through `ObjectLayer.raycastAmong` (each model's own bounds tree), not
  `raycastSurface`, whose instanced meshes hold only the instances in view: a check through them
  misses everything off screen.

## Fit ground to models and Stamp (#168)

Checks: Models › Fit Ground to Selected Models… (`Engine.fitGroundToSelection`, the arithmetic in
`terrain/fitGround.ts`, unit tests in `fitGround.test.ts`). In the dev page on Northshire (Azeroth
32_48, 1x1): Northshire Abbey is object 784 (its floor is 3.25 yd above the ground at its centre;
`surfaceAt(784, o.x, o.z, true, box.min.y - 1)` after `surfaceBox(784, new THREE.Box3())`, with THREE
imported from the page's `deps/three.js` URL).

- Raise it 2 yd (`o.yOff += 2; e.objects.touch(784)`), select it with `selectObjects(e.objects, [784])`
  and call `fitGroundToSelection(false, { margin: 0.2, falloff: 6, mode: 'both', holes: false, reach: 4 })`:
  ~320 vertices go up (at most ~3.75 yd) in ~30 ms, the abbey's `worldPlacement(o).pos.y` doesn't
  move, and one undo restores both. Sunk 3 yd under the ground with `holes: true`, it cuts 128 cells
  (whole 2x2 blocks). Stamp (`true` first) moves ~365 vertices.
- The Redridge stable (780) has no floor of its own: its first up-facing face is the hayloft, 6 to 10
  yd up, which is why a floor (and an underside) only counts within `reach` of the model's lowest
  one (#208; before, within `reach` of the ground under each vertex). Fitting it raises 4 vertices at
  its back by 1 to 3 yd and looks the same; nothing comes up to the hayloft.
- A floor raised on a foundation (#208): the Elwynn farmhouse
  (`wmo:World\\wmo\\Azeroth\\Buildings\\human_farm\\farm.wmo`) has its floor 4.1 yd above its origin,
  so the old per-vertex rule found almost no floor and fitted nothing. To probe a building's rays,
  `surfaceBox` then `surfaceAt(id, x, z, true|false, box.min.y - 1)` at each vertex of the box.
- Levelling (#210): its foundation is hollow, so the rays find the floor (85.1) as its underside, 4 yd
  above the stone base (80.94, its origin and `box.min.y`); only the porch steps reach lower. That is
  why the fit levels to the model's origin, not to its rays. Added with `e.objects.add` at x 300, z 200
  of Azeroth 32_48 (origin 80.94) and fitted with `fitGroundToSelection(false, { margin: 0.2, falloff: 6,
  mode: 'both', holes: false, reach: 4 })`: the 19 vertices under it go from 79.9..84.3 to 80.94 each,
  32 vertices move (up to 7.4 yd, the uphill ring), the house keeps its height, undo/redo restore the
  heights exactly, and the screenshot shows the whole stone foundation on a level pad cut into the hill.
  Sunk 2 yd first (`yOff: -2`, as the Place tool's PgDn or the Inspector would), the ground levels at
  80.94 again, 2 yd above its origin (78.94), so that much of the stone stays underground, and its
  `yOff` stays -2, so fitting it again changes nothing.
  Around the footprint's hull the ground stays level for an apron of two cells (`FIT_APRON_CELLS`),
  then the ring (the dialog's falloff, beyond the apron) eases back, smoothed by four 3x3 passes over
  the apron's outer row, the ring and a cell past it. The height above the pad along z 200 from x 300
  east reads 0.0 to x 308, then 0.7, 1.6, 2.5, 3.4, 4.4 ... a climb of about 1 yd every 2 yd with no
  step (`t.heightAt(x, 200)` for x 300..334). A screenshot from 60 yd shows little; read the profile.
- Jagged edges (#210): the owner saw spikes of ground running out from a wall. The covered vertices
  along a wall come and go (the eaves are filtered by `reach`, the chimney and steps are not), and the
  ring rose from each gap. The fit now measures the ring from the footprint's convex hull
  (`hullDistance`). To see a footprint, print each vertex's height minus the pad's in a grid around the
  model ('.' for level) after the fit; the unit test "a footprint with gaps along a wall" is the case
  in small. View the farmhouse's chimney side with `e.controller.setView(300, base, 200, Math.PI, 0.6, 30)`.
- The Place tool's Fit ground (#207, `prefs.placeFitGround`): over CDP, load Northshire with tool
  `place`, set `editor.prefab` to a building's type (the Westfall farm WMO stands in the region) and
  wait until `getAsset(type).ready`, set `prefs.placeFitGround` (both through the page's own module
  URLs), swap `e.ctx.surface` for one returning `{ point, parent: null }` at open ground (x 170, z 320)
  and call `e.placeTool.onDown(e.ctx, point, new PointerEvent('pointerdown'))`. About 15 vertices move
  (up to ~3.5 yd), `e.history.peek().label` is "Place and fit ground", and one `e.undo()` puts every
  height back and removes the building. With the pref off nothing moves and the step is "Place".
- Trap: after editing a module the page imported, Vite hot-updates it and the page then holds two
  copies of `editor.svelte.ts`: a selection made through the old one never reaches the Engine
  (nothing happens, and no status). Open a fresh tab after edits.

## Clear tool: height, liquids, holes

Checks: Clear (7) with `editor.clearMode` set to `'heights'` brings the ground under the brush to
zero by the brush weight; `'liquids'` removes every painted liquid layer's cells under it;
`'holes'` fills the holes of the cells whose centre is under it. Each stroke is one undo step
(Clear height, Clear liquids, Fill holes). In the dev page, with `at(x, z)` from "Doodad brush":

```js
ed.editor.tool = 'clear'; ed.editor.clearMode = 'heights'; ed.editor.brush.radius = 12; ed.editor.brush.falloff = 0
e.tools.clear.onDown(e.ctx, at(100, 100)); e.tools.clear.onUp(e.ctx)
e.terrain.heightAt(100, 100)                 // 0 on a hills map (was the hill's height); e.history.undo() restores it
```

- `'liquids'`: paint some water first (Water tool, Paint mode), then clear it; `e.doc.liquids.layers(c)`
  of the chunk lose the cells. `'holes'`: cut a hole with Sculpt › Hole, then clear it;
  `e.terrain.holes` has no bytes set under the brush afterwards.

- Faint layers (#41): `tests/chunkPaint.test.ts` (`dropFaintLayers`). Live: the client's own paint
  rarely has a faint layer (Durotar's chunks all peak at 255), so make one: on a new flat map set a
  chunk's slot 1 to texture 1 at weight 8 (base 247) in `e.terrain.chunkSlots`/`weights`, then stroke
  Clear with `clearMode = 'faint'`, `clearThreshold = 10`: the base goes back to 255, the step is
  "Clear faint layers", and `e.history.undo()` brings the layer back.

## Area paste: liquids and turning (chunk mover)

Checks: Ctrl+C on a selected area copies its painted liquid cells too (the status says how many),
Ctrl+V lays them in with the ground, and R (or Turn 90° in the options bar) turns the pending paste
a quarter turn: heights, holes, texels, liquids and models together, the preview rect swapping its
sides. Unit tests: `tests/clipboard.test.ts` (`rotateClip`, `copyLiquidCells`, `pasteLiquidCells`,
`rotateLiquidClip`). In the dev page: `ed.editor.selection = { x0: 20, z0: 20, x1: 36, z1: 28 }`,
`e.copySelection()`, `e.startPaste()`, `e.rotateClip()` then `e['clip'].w` is 8 and `.h` 16;
`e.commitPaste()` with `e.tools.select.pasteAt = { x: 60, z: 60 }` set first; one Ctrl+Z undoes
the ground, liquids and models together.
- Baked shadows ride along (#162, `world/clipShadows.ts`, unit tests in `tests/clipShadows.test.ts`): on
  Northshire, the same selection pasted at cell (60, 60) gives that area the source's 643 shadowed
  texels exactly, and the undo gives back what was there.
- Trap: a long `preview_evaluate` (over its 15 s limit) can leave T3 Code's preview tab wedged, so even
  `1+1` times out after; open a new tab (`preview_open` with `reuseExistingTab: false`) and keep each
  probe short (start the scene load in one call, wait for it in the next).
- Trap: node's type stripping can't load `tools/brush.ts` (a constructor with parameter properties),
  so a unit test can't import `world/clipboard.ts` or anything else that pulls it in. Put what a
  test needs in its own module (`world/clipRotate.ts` is one) and import only that.

## Clean up the tile under the camera (#45)

Checks: Terrain › "Clean up the tile under the camera" (`Engine.cleanUpTile`). In the dev page, on the
Durotar region (Kalimdor 41_33, 2x2) with `e.controller.target.set(180, 20, 300)` (tile 41, 33):
`e.cleanUpTile('models')` removes the tile's 386 root models and what hangs on them (1196 to 810,
"Clear models on tile 41, 33"), `e.cleanUpTile('height')` puts the tile's ground at 0 while the next
tile keeps its own, and `e.history.undo()` restores either. `'textureDuplicates'` reports none on the
client's paint; `tests/chunkPaint.test.ts` covers `mergeDuplicateSlots`.
- Trap: a few region models stand just outside the map (negative x or z); a count of "models with
  x and z under 533" includes them, though they are on no tile.

## Heightmap import on a tile, Auto heights and the normal map (#44)

Checks: `tests/heightmapImport.test.ts` (`importHeightsOnTile`, tiled edges leave the shared row and
column) and `tests/normalMap.test.ts` (flat is (128, 255, 128), a 45-degree ramp, base64). Live,
the import needs the native file dialog; check the rest from the dev page: `__engine.tileUnderCamera()`
names the tile under the camera target, `__engine.heightRange('tile' | 'map')` is what Auto heights
fills in, and the export can be driven without its dialog:
`window.go.main.App.WriteNormalMap('<path>.png', side, toBase64(normalMapPixels(e.outerHeights(), side, e.terrain.cellSize)))`
(from `/src/lib/io/normalMap.ts`), then `magick identify` the file (side x side, 8-bit RGB).
- Trap: after adding a Go binding, a dev page loaded before Wails regenerated `wailsjs` keeps importing
  a stale `App.js` (Vite pins its `?t=`), and the app fails to start with "does not provide an export
  named ...". Touching the file does not help; restart `make dev`.

## Water layers (the Water tool's All layers / Layer, #14)

Checks: with All layers off, the Water tool draws only layer number N of each chunk (as Noggit Red's
Current layer does); other tools always draw every layer. In the dev page, import `editor` by the
page's own URL (the import trap in `docs/TESTS.md`), put two layers in chunk 5 with `__engine.doc.liquids.set(5, [a, b])`
(each `{ id, heights: Float32Array(81), depth: Float32Array(81), cells: Uint8Array(64).fill(1) }`),
set `editor.tool = 'water'`, `editor.water.allLayers = false`, `editor.water.layer = 1`, call
`__engine.frame()` and count the cells in `__engine.doc.liquidRenderer.group`'s meshes
(`index.count / 6`): 64 rather than 128, and the mesh's `kind` attribute is the second layer's.

## Baked shadows: bake, paint, save and export (B-057, #16)

Checks: a region's client shadows become the map's, the Map data tool's Shadow mode paints them,
Terrain › Bake Shadows and Clear Shadows work with undo, the map file keeps them (version 6) and the
export sends each chunk's MCSH as the client has it.
- Go: `TestRewriteShadowReadsBack` (a synthetic tile) and, with `WOW_DIR=C:/WoW/client`,
  `TestRewriteClientShadowsUnchanged` (Northshire's 256 chunks sent their own maps back read back with
  the same bytes and flags), plus `TestReadsVersion5WithoutShadows` and `TestNoShadowsStayNone` in mapfile.
- Dev page: open Northshire with `__loadScene('Meld scene ' + JSON.stringify({v:1, map:{region:{mapName:'Azeroth',x:32,y:48,size:1}}}))`
  (`v: 1` is required) and drive `__engine.frame()` until `__engine.terrain.shadow` is set: 512911 of
  its 1048576 texels are in shadow. `e.bakeShadows()` takes about 0.7 s and leaves 296654 (only the
  ground casts; Blizzard's maps also shadow under trees), and `e.history.undo()` gives back the
  client's exactly. The brush: `editor.tool = 'mapdata'`, `editor.mapDataMode = 'shadow'`,
  `e.tools.mapdata.onDown(e.ctx, {x, y: 0, z}, {altKey: false})` then `onUp(e.ctx)`.
- Save round trip: `go.main.App.SaveMap(path, toMapData(e.snapshot()))` then `LoadMap(path)` gives
  version 6 and the same bits; `e.openDocument(fromMapData(raw), path)` opens it with the file's
  shadows (`terrain.bakedRequested` true, the client's are not read). `mapToTiles(e.exportInput())`
  headers' `shadow` matches the `RegionShadows` bits byte for byte.
- Survey (2026-10-16, every tile of Azeroth, Kalimdor, the Deadmines and Warsong Gulch): every chunk
  has a 512-byte MCSH, even an empty one; no chunk has shadow bits without flag 0x1, but many empty
  ones have the flag. So Go always writes the map and sets the flag only when a bit is set.
- Trap: an edit to a module the page imported reloads the dev page, so the open region is gone;
  load it again before the next probe.
- With models (#163): `e.bakeShadows()` casts from the placed models too (`world/shadowCasters.ts`);
  `e.bakeShadows(true)` is the ground only. Wait until `modelCasters(e.objects, size, cellSize).loading`
  is 0 first (Northshire: 784 models). Northshire then gives 825391 shadowed texels in about 9 s,
  run between turns (`bakeShadows` is async: start it in one probe, read the result in the next, as a
  probe has 15 s). The client's own map has 512911; the ground alone 296654. A stub caster in
  `tests/bakedShadowsBake.test.ts` checks the block logic.
- Trap: T3 Code's preview tab is hidden, and Chrome throttles a hidden page's `setTimeout` to once a
  second: a loop that yields with `setTimeout(0)` crawls there (the bake took over a minute). Yield
  through a `MessageChannel` instead.

## Walkable ground: the navmesh view and the path test (#175)

Checks: View › Walkable ground builds the server's navmesh around the camera's target from the
terrain and the placed models' collision, rebuilds it after an edit, and View › Test a Path finds a
creature's way round obstacles.
- Unit: `tests/navmesh.test.ts` (slope areas, the tile gatherer, a navmesh round a wall with the real
  WASM in node, a few ms a tile; #239: the span layout `navFilters.ts` reads, a 1.5 yd model fence
  gone round while the same step in the terrain is climbed, a river only a swimmer crosses beside a
  ford a walker wades, a deep ocean chunk with no navmesh, and the sea's cells). Go: `TestM2HullFaces`, and with `WOW_DIR=C:/WoW/client`
  `TestClientCollision` (three hulls wound outward by signed volume, Goldshire inn's floors facing up).
- Probe: `pnpm probe walkable` (about 45 s) on a flat map: 172 tiles, a 60 yd straight path, a path
  round an 80 yd line of holes (92 yd), Goldshire's inn bringing floors above the ground, a river 2 yd
  deep across the map drawn blue and crossed only as a swimmer (`kind: 'swim'`, #239), and the view
  off freeing every tile. It turns Follow the Ground on first: with the default flying camera the new
  map's view starts 250 yd up and Test a Path's clicks land 345 yd out, past the built tiles (#256).
- In the benchmark scene (Northshire Abbey) the 177 tiles take 3.4 ms each on average, 41 ms at worst
  (the abbey's tiles); on SwiftShader the whole build takes about 70 s of frames, so wait on
  `e.nav.counts` (`done === total`, `loading === 0`, `!settling`), never on a fixed number of frames.
- Traps: `nav.group` also holds the path test's line and markers, which have no colour attribute;
  a change (sculpt, a model loading or moving, a liquid edit) holds the build until 400 ms pass without one,
  so while models stream in after a region opens nothing builds; the roofs get navmesh too, as on the
  server (they are walkable, only unreachable).
