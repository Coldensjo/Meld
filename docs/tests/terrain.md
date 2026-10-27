# Terrain, water and map data

Sculpting, holes, areas, paint, liquids, shadows and the map as a whole. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Growing a region (the Map panel's plus)

Checks: `extendRegion` (`io/region.ts`) and `grownBlock` (`io/regionGrow.ts`, unit tests in
`tests/regionGrow.test.ts`). In the dev page, with a region open and `editor.svelte.ts` as `ed`:

```js
const m = await import('<the loaded region.ts URL>')
ed.editor.regionBlock                         // e.g. {x: 32, y: 48, size: 1}
await m.extendRegion(window.__engine, 'e')    // opens 2×2 at the same origin, closes the 1×1 tab
ed.editor.regionBlock, ed.docs.tabs.length    // {x: 32, y: 48, size: 2}, the tab count unchanged
```

- A region with uncompiled edits or unsaved spawn edits is refused with a status line naming
  Compile to Client or Save Spawns to Database, and keeps its tab: the `compile-launch` probe checks
  both without compiling. The buttons are `.plus` in the Map
  panel; they are missing on a side where the map ends or when the region is 16 tiles.
- Opening a region takes a few seconds; `ui.busy` is true meanwhile, and the Map panel ignores a
  second plus until it is done.

## Opening a region: the alpha maps' handoff (#636, probe `region-alpha`)

Checks: `App.LoadRegion` (and `LoadBuildingMap`) put the block's alpha maps in `App.handoffs`
(`internal/handoff`) instead of the reply, and `openRegionView` (`io/region.ts`) fetches them from the
`alphaUrl` and hands each layer its 4096 bytes in chunk order. `bun run probe region-alpha` checks the
reply, the bytes and that the URL is served once, and prints the times (2026-10-21, Azeroth 31_49 3x3 in
the dev page: the call 375-465 ms with 36.5 MB of JSON before, 220-300 ms and 3.85 MB plus a 16-24 ms
fetch of 24.5 MB after; Go's `ReadRegion` alone is about 85 ms).

- The paint must not change: hash `tilePaint`'s weights and slots from the old decoding and the new one
  (a throwaway probe; 31_49 3x3 gave the same hash, `b46234aa`, on the owner's client that day).
- Trap: a handoff is served once and dropped after `handoff.TTL` (2 minutes) unfetched, so fetching the
  `alphaUrl` by hand after the page has read it gives 404; call `LoadRegion` again for a new one.

## Holes per triangle (Sculpt › Hole)

Checks: `holes.ts` (cell values 0 none, 1 whole cell, 2 first triangle, 3 second) and the Sculpt
tool's Hole mode. Unit tests: `tests/holes.test.ts`. In the dev page, without a mouse:

```js
const ed = await import('<editor.svelte.ts URL>'); const e = __engine; const t = e.terrain; const cs = t.cellSize
const cx = Math.floor(326 / cs), cz = Math.floor(720 / cs)       // every map's cells are CELL_SIZE, 4.17 yd
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

## Terrain › Smooth Selection (#713), with Raise, Lower, Flatten and Roughen (#721)

Checks: the area smoothing pass. The kernel, the edge falloff and the sliced run are
`terrain/smoothArea.ts`, unit tests in `smoothArea.test.ts` (a pass equals the brush's 3x3 average,
edges included; weight-0 vertices keep their height; the falloff rises from 0 to full over the band;
cancel stops at the next turn). In the live app, `bun run probe smooth-selection`: on a Mountains map
(256, seed 3) with a yard of seeded noise over a 60-cell square, `Engine.smoothArea` with a hard edge,
with the falloff and over a free-form half of the square (`setAreaCells`) changes only the area's inner
vertices, cuts the bends (second difference) to well under a third, undoes and redoes exactly as
"Smooth selection", the falloff moves the vertices next to the edge less than half as far, and a
cancelled run changes nothing. The Mountains preset alone is too smooth to measure: add the noise.

The one-pass shapes (#721, `shapePatch`) have unit tests in the same file (raise and lower by the
amount times the weight, flatten to the weighted vertices' mean or to a height, roughen within the
amplitude, in world space and by seed). The probe also runs Raise and Lower by 5 yd (the square's
middle moves exactly 5), Flatten to the average (no spread left in the middle) and to 42 yd, and
Roughen (more bend than before), each hard-edged and with the falloff, checking nothing outside the
square changes and undo and redo are exact under the mode's label; and it opens the dialog, checks
Mode lists the five and that picking Flatten shows its target and names the button.

## A new world's ground: presets in yards, erosion at creation, Canyon and the seabed (#744, probe `new-world-shape`)

Checks: the New world page's presets and sliders. `presetHeight` (`terrain/presets.ts`) and
`generateHeights` (`terrain/generate.ts`) have unit tests in `terrainGenerate.test.ts`: the presets'
heights in yards (Rolling hills 35 to 110 yd, Mountains over 150), detail keeping its size on a 6x6
map (the mean slope round the middle against a 1-tile map's), Height scaling only the land, Roughness
0 dropping the detail, Land growing the land's share (also on an L of tiles), erosion seeded and changing the ground, the open sea's floor and Sea depth, and
a Canyon no one can walk out of: a flood fill from the middle over vertices whose gradient is under
50 degrees (the server's `walkableSlopeAngle`) never reaches the map's edge, for 1 and 2 tiles, with
and without erosion, at Height 0.4 and Roughness 2. In the live app, `bun run probe new-world-shape
--shot <dir>` makes Large Mountains, Rolling hills and Canyon worlds through the dialog and saves a
view over each.

- To judge how a preset looks without the app, a Bun script can call `generateHeights` for a map
  and write a hillshade (the gradient towards the north-west, coloured by height and slope as
  `autoPaint` does) as a PPM, which `magick` turns into a PNG; a 4x4 map takes about 0.4 s with
  erosion. Look at a crop at full size too: one-vertex spikes (a checkerboard) don't show scaled down.
- Walk-out test traps: test the ground's own gradient at each vertex, not the slope between two
  vertices along the step, since along that any wall can be crossed sideways. Erosion's gullies cut
  ramps through a Canyon wall, which is why `generateHeights` lays the walls on after it.
- A probe's view over a new map: `controller.setView(x, y, z, yaw, pitch, distance)` needs Follow the
  Ground on; with it off the camera sits on the target and the distance does nothing. Keep the
  distance under 900 (`maxDistance`) and inside the fog, or the shot is the sky's colour.

## A new world from a heightmap (#745, probe `new-world-image`)

Checks: the New world page's From a heightmap… card. `imageGroundHeights` has a unit test in
`terrainGenerate.test.ts` (black and white at Min and Max, bilinear between samples, erosion moving the
ground). In the live app, `bun run probe new-world-image --shot <dir>` stubs `OpenHeightmapDialog` and
`ReadHeightmap` on `window.go.main.App` with a 64-pixel grey cone made in the page (no file, no client
sandbox), picks it, sets Black -40 and White 200 and makes a Small world: its middle near 200 yd, its
corners at -40 under a sea at 0. About 25 s.

- Stubbing a file binding: the generated `wailsjs` functions look `window.go.main.App.<Name>` up at
  call time, so assigning it in the probe (and putting it back in a `finally`) reaches the dialog's
  imports too; a stubbed `ReadHeightmap` returns `{ side, heights }` with heights from -1024 (black) to
  1024 (white), as `internal/heightmap` decodes them.

## A new world painted with a zone's textures (#733, probe `new-world-pack`)

Checks: the New world page's Ground textures. `go test ./internal/vmangos -run 'ChunkCover|ZoneAreas'`
tests the shares (a layer's alpha of what the layers above leave, cells under a liquid left out) and
the subzones; `TestRealZoneTextures` (with the client, `make test-full`) reads Tanaris and Duskwood and
logs their shares, the list `frontend/tests/texturePack.test.ts` sorts into roles (Tanaris: sand
ground, more sand as the lush patches, rock for the peaks; Duskwood: dirt ground, grass patches,
cobblestones). In the live app, `bun run probe new-world-pack --shot <dir>` picks Tanaris, waits for
the eight pictures (about 3 s), makes a Small Island and checks its palette and that the ground uses
the ground and sand roles; then Default again shows no pictures. About 35 s.

- The Go change needs `make dev` to have rebuilt the app (it watches the Go files); a probe run
  against a stale one fails on `ZoneTextures` missing from `window.go.main.App`.

## A new world with a zone's trees (#758, probe `new-world-trees`)

Checks: the New world page's Trees and rocks. `go test ./internal/vmangos -run 'PlacementCell|DoodadList'`
tests finding the chunk and cell under a placement (and not a neighbour tile's chunk) and the counts;
`TestRealZoneDoodads` (with the client, `make test-full`) logs Duskwood's, Tanaris's and Elwynn's most
placed models and their density (Duskwood about 30 models per 100x100 yd, Tanaris 6, Elwynn 20, every
kind). `frontend/tests/zoneTrees.test.ts` checks the sorting by path (trees, bushes, rocks, and the
fences, tombs and props left out) and the brushes. In the live app, `bun run probe new-world-trees
--shot <dir>` makes a Small Island with Duskwood's textures and trees: every model a tree, bush or rock,
none in the sea or on the beach, on too steep a slope or above the snow line, two undo steps; then one
with None and no models. Logs how long Create world took (about 3.5 s). About 90 s.

- `new-world-pack` also scatters Tanaris's trees now, since the trees follow the pack by default.

## A new world's sea level and lakes (#759, probe `new-world-lakes`)

Checks: the New world page's water row. `frontend/tests/lakes.test.ts` checks the basin fill
(`water/lakes.ts`): a bowl fills to its rim, a slope holds none, a basin under the sea is the sea's,
a puddle and a basin covering most of the map stay dry, the layers `fillLakes` writes, and the shore
levels. In the live app, `bun run probe new-world-lakes --shot <dir>` ticks Lakes with Magma (the
Rolling hills picture turns orange in its basins), sets Sea level to 5 and makes a Medium Rolling
hills world: the sea at 5, only magma layers, every covered cell's surface above the sea and over
ground lower than it, sand in every lake chunk, and `exportInput` sending the layers. About 40 s.

- The lakes come from the generated heights, so a change to a preset or to erosion moves them; the
  probe asks only for more than 50 covered cells (seed 4242 gives two lakes, 3787 cells).
- `findLakes` drops a basin covering more than `maxShare` (12%) of the map, so a test grid of a few
  dozen vertices needs a larger share (`tests/lakes.test.ts` uses 0.5).

## Sculpt › Erode and Terrain › Erode (#165)

Checks: the Erode brush (water and thermal) and the area pass. The droplet and thermal models are
`terrain/erosion.ts` and the sliced area run `terrain/erodeArea.ts`, unit tests in `erosion.test.ts`
(same seed, same result; flat ground untouched; thermal keeps the volume and ends at the talus slope;
cancel stops at the next turn). In the live app, `bun run probe erode`: on a Mountains map (256, seed 3)
a water and a thermal stroke at the steepest spot change only vertices inside the brush and undo and
redo exactly, and `Engine.erodeArea` over a 60-cell square changes only its inner vertices, reports
progress to 1, undoes as "Erode selection", and a cancelled run changes nothing. With `mask: true`
(#242) the mask holds texels only inside the square, a texel set far outside is cleared, `ui.maskActive`
turns on, and one undo restores the mask and the heights; `settledMask` has its own unit test (set at a
cone's foot, empty on its peak, nothing outside the rect written).

- To see it, a scratch probe can `e.controller.setView(x, y, z, 0.8, 0.7, 380)` over the highest peak
  and run `bun run probe <file> --shot <dir>` with and without `erodeArea` (density 1, 5 passes): the peak
  comes out lower and gullied. Before #744 the 256 Mountains preset was only about 60 yd high; it now
  reaches 150 yd or more, closer to a client continent.
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
- The probe `terrain-cell-tex` (#394) checks that a shape's tint covers its cells and not the rest of its
  rect, top-down on a flat map, together with the Map data tool's no-tufts overlay, which shares the
  shape's texture (`Terrain.cellTex`: red no tufts, green the shape): each drawn, and neither clobbered
  when the other changes. The no-tufts patch and a zone on a few chunks are marked by rect, as a dab
  marks them (#530), so a broken sub-rect upload fails it. It also counts the terrain program's own samplers (10, plus 5 shadow maps at
  most: under WebGL2's guaranteed 16), so a new overlay sampler that would stop the ground drawing on
  Windows fails it. SwiftShader in the probes has 32 units, so only this count shows that limit.

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
  inside a model. With Preferences › Check the Map before Compile on, File › Compile to Client
  (or Compile All) then stops with "Compile stopped: … 2 errors" and opens the window, before anything is written.
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

## Reference image (View › Reference Image, #184)

Checks: `tests/referenceImage.test.ts` (the image's frame and corners, a corner drag keeping the
opposite one, the dominant colours skipping an antialiased edge, brightness to heights, the zone vote,
the mask, textures keeping the slots other texels use and refusing a colour with no slot) and
`internal/mapfile`'s round trip (the header's `reference`). Live: probe `reference-image` (a red and
blue plan made in the page on a flat map, through `referenceFrom` instead of the file dialog: drawn
over the ground in the top-down view, the screen overlay and Lay on the ground as shown's place, a drag
with Place by dragging, zones, heights, textures and the mask each undone, the save data's record, and
Remove undone).
- Trap: the file dialog can't be driven from a probe; make the picture in the page
  (`referenceFrom(path, canvas, w, h)`, `/src/lib/io/referenceLoad.ts`) and hand it to
  `e.useReferenceImage` before `e.setReference(e.referenceFor(img), ...)`. A record whose path the
  document doesn't hold makes the Engine read that path through the binding.
- Trap: the terrain shader holds 16 samplers with the two sun and three lamp shadow maps (WebGL2's
  least guaranteed, and ANGLE's on Windows); a new overlay texture has to share one.

## Water layers (the Water tool's All layers / Layer, #14)

Checks: with All layers off, the Water tool draws only layer number N of each chunk (as Noggit Red's
Current layer does); other tools always draw every layer. In the dev page, import `editor` by the
page's own URL (the import trap in `docs/TESTS.md`), put two layers in chunk 5 with `__engine.doc.liquids.set(5, [a, b])`
(each `{ id, heights: Float32Array(81), depth: Float32Array(81), cells: Uint8Array(64).fill(1) }`),
set `editor.tool = 'water'`, `editor.water.allLayers = false`, `editor.water.layer = 1`, call
`__engine.frame()` and count the cells in `__engine.doc.liquidRenderer.group`'s meshes
(`index.count / 6`): 64 rather than 128, and the mesh's `kind` attribute is the second layer's.

The region save's side of the layers: `go test ./internal/vmangos/ -run TestRegionLiquidsRoundTrip`
(#404, no client needed) edits a made-up 2x2 block's liquids (a lake turned ocean at sloping heights
and varied depths with magma under it as a second layer, a lake removed, new slime, a magma chunk
handed back as read), saves it with `BuildRegion` and reads the MCLQ back with `adt.ParseLiquids`:
types, cells, all 81 heights and the depths must match, and no other chunk gains a liquid. It also
checks a partial save (`PartialLiquids`). Magma and slime read their depths as 255 (the file holds
texture coordinates there), so don't compare theirs.

## The coast while the camera moves (#747, probe `coast-foam`)

Checks: the line where the sea meets the land doesn't sparkle in flight. `bun run probe coast-foam
--shot <dir>` makes a Large Island on the New world page, looks at its west coast from 1200 yd, takes
four shots a sub-pixel turn apart and counts the pixels on the coast whose brightness swings by over
30, with the terrain's foam line as drawn, as it was before #747 and taken out. The thin line (0.35 yd
either side of the waterline, under a pixel far off or on a steep shore) gave 250 to 275 against 40
to 50 without foam; widened to the pixel and dimmed to match (`band` in `TerrainMaterial.ts`), about
100. Once the sea became a grid (the next entry) the whole coast held far steadier, on SwiftShader too:
17 thin, 4 widened, 4 without foam, so the probe now passes while the widened line adds under 20.

- The swing of shots a sub-pixel apart is the way to see shimmer in a still probe: a feature thinner
  than a pixel swings, a band-limited one barely does. Save the swing as a grey picture (the probe's
  `-spread` shots) and look at where it is bright.
- Hold the clock (`P.e.timer.setTimescale(0)`, as `shadow-poses` does): the sea's frame advances 24
  times a second and swings the whole sea between shots. Replacing the sea material's `oceanTex`
  uniform after it compiled freezes nothing (three keeps the uniform objects it first saw). Run
  `P.settle()` and a few frames first, so no texture arrives between two shots.
- Count only a region round the coast: on a rugged island the inland ridges outweigh it.
- The depth buffer's step is not the cause (measured on 2026-10-26: the near plane at 5 yd instead of
  0.5 gave the same swing, and for a 24-bit buffer the band where the sea and a beach are within one
  step is under a yard wide at 2000 yd). But on a real GPU the sea's own depth was: see the next entry.
  This probe runs on SwiftShader, which never showed it.

## The coast in flight on a real GPU (#747, probe `coast-flight`)

Checks: the shore doesn't swap sea and land as the camera flies. The owner saw it in the desktop
window after `coast-foam`'s fix: still, nothing; holding W, the coast flickered back and forth. The
cause was the sea drawn as one quad ten map widths across: on the GPU (D3D11 through ANGLE) its depth,
clipped round the camera, came out a little different each frame the camera moved, so along the whole
shoreline the ground and the sea took turns in front. Built as a grid of cells about a tile wide
(`Water.ts`) it holds still; even 16 cells a side did. `PROBE_GPU=1 bun run probe coast-flight
--shot <dir>` makes the Large Island of `coast-foam` (seed 4242), looks at its west coast from 1200
yd, takes six shots with the camera stepped 0.37 yd apart and counts the pixels whose brightness jumps
by over 25 at least twice, with the sea as drawn and as the old quad: 1 against 551 on an RTX 5080.

- Then the same steeply down from 2000 yd (pitch 1.2), for #767: there the beach lies within the depth
  buffer's error of the sea over yards of shore, and the two took turns along the whole coast until the
  sea faded out within that error (`depthSteps` in `liquidMaterial.ts`). It fails on the `steep` count.
  The probe sets `depthSteps` to -1000 (no fade) for `steepUnfaded` and the quad: the fade hides the
  quad's wobble too. The probes' 4x MSAA hides most of #767 (11 pixels unfaded, against 245 with
  anti-aliasing off, which the owner uses; #768 is the way to run a probe without it). From a low pitch
  the count is the sea's ripples and the trees, not the coast: look at the `--shot` flips image.
- The trees the New world page scatters are hidden (`e.objects.group.visible = false`): their edges
  flipped and drowned the coast's count (51 on SwiftShader).
- Only a real GPU shows it: on SwiftShader both counted 2 to 3. Without `PROBE_GPU=1` the probe only
  checks the coast's counts stay low.
- Hide the sea through its material (`water.material.visible = false`): the Engine sets
  `water.mesh.visible` again every frame.
- Turning the shadows pref off before a run of shots (5 frames settled) made about 14,000 pixels jump,
  the whole land, not the coast; not looked into, so leave the pref alone in such a comparison.

## The sea past the map's edge (#748, probe `sea-edge`)

Checks: the sea's colour carries on across the map's edge instead of stepping to the deep colour
there. `bun run probe sea-edge --shot <dir>` makes a flat map under 20 yd of sea, looks down at the
west edge from 600 yd, and compares 9 by 9 pixel boxes 6 yd either side of the edge (a step of about
1 now) and one 250 yd or more past the north edge (darker, about 78 against 87). It then patches the
sea shader's `past` back to a jump straight to deep, as before #748, and checks the step comes back
(about 29); the `step` shot shows the map's square as a pale rectangle in a dark sea.

- The camera needs `setFollowGround(true)` before `setView`: flying, the target is the camera's own
  position, and `project` puts the edge off the view.

## Baked shadows: bake, paint, save and export (B-057, #16)

Checks: a region's client shadows become the map's, the Map data tool's Shadow mode paints them,
Terrain › Bake Shadows and Clear Shadows work with undo, the map file keeps them (version 6) and the
export sends each chunk's MCSH as the client has it.
- Go: `TestRewriteShadowReadsBack` (a synthetic tile) and `TestRewriteClientShadowsUnchanged` (on the synthetic
  tile and, with the client, Northshire's 256 chunks sent their own maps back read back with
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

## The .wmap snapshot round trip and every readable version (#431)

`toMapData` and `fromMapData` (`io/mapData.ts`, free of the runes state) turn the document into the
`MapData` Go writes and back, where #120 (a region without liquids failed to open) and #161 (a map
with roles or a region failed to save) were.

- Unit: `bun test tests/mapData.test.ts`. "the .wmap snapshot round trip" sends a map with every
  optional field set through `toMapData` → JSON → `fromMapData` and compares it whole, checks that one
  with every optional field unset writes none of them and reads back the defaults, and covers the
  #120 and #161 cases. "every readable .wmap version opens" has one hand-written `MapData` per
  version 1 to 7, built from `internal/mapfile`'s test streams (`writeV1`, `writeOld`), with the blobs
  each version has (7, #46, adds no blob: its case is a map made for the client with `tileX`, `tileY`
  and `tiles`).
- When the format gets a version 8: add its fixture there (the previous one plus the new field), and
  the new field to `fullSnapshot`. The Go side's own fixtures are `go test ./internal/mapfile/`. The
  probe `unknown-flags` checks the version a save reads back as: bump it there too.
- Go (#545): `go test ./internal/mapfile/ -run TestFixtures` reads the committed
  `internal/mapfile/testdata/v1.wmap` to `v7.wmap` (a 16-cell map written once by each version's
  layout, `writeVersion` in `version_test.go`) and checks each opens with its header and exactly the
  blobs that version had, saves again at `Version` with the same blobs, and that `Write` still lays out
  the current fixture byte for byte (the JSON header aside). So a reader that drops or reorders a tail
  blob fails even when `Write` and `Read` change together. For a version 8: add its case to
  `writeVersion` and `fixtureMap`, bump `Version`, then `go test ./internal/mapfile/ -run TestFixtures
  -update`, which writes only the missing `v8.wmap` (a version that changes only the header, as 7 did,
  needs only the bump in `writeVersion`'s range: its layout is the one before). Never regenerate an existing fixture (delete and
  `-update`): a fixture made by the code it tests checks nothing.
- Trap: `toEqual` treats a key set to `undefined` as missing, so a field `fromMapData` forgets to read
  but whose snapshot value is `undefined` passes; give every optional field in `fullSnapshot` a value.

## The unknown state of holes, liquids and chunk data across a save (#525, #663)

A region `.wmap` saved before version 3 (holes), 4 (liquids) or 5 (area IDs, chunk flags, no-tuft
cells) opens with `MapDocument.holesKnown` / `liquidsKnown` / `chunkDataKnown` false, and Compile
then leaves the client's own alone (the holes cut since are added to the client's). The header's
`holesUnknown` / `liquidsUnknown` / `chunkDataUnknown` keep that across a save.

- Unit: `bun test tests/mapData.test.ts` (`toMapData` → JSON → `fromMapData` keeps the flags, a
  known map writes none, version 2, 3 and 4 files open without them) and `go test ./internal/mapfile/
  -run TestUnknownFlagsRoundTrip` (the header round trip).
- Probe `unknown-flags`: Northshire saved through Go (`SaveSceneMap`, `LoadMap`) and opened again,
  first as opened from the client (no flag written), then with the three flags set false and saved
  twice: they stay false, the export sends no chunk data and partial liquids, and Map Properties lists
  them under "The client's". A hole cut there still reaches `mapToTiles`'s chunk header, with area
  ID 0 and no `impassable` or `noEffect`, which keep the client's (#644), and with `holesAdd`, while
  a chunk without a hole sends none (#663).
- Unit: `bun test tests/chunkFlags.test.ts` (a map without chunk data sends holes and shadows only;
  one without holes sends them added, only for the chunks that have one), `go test ./internal/adt/
  -run TestRewriteHolesReadBack` (added holes join the chunk's, replaced ones don't)
  and `go test ./internal/vmangos/ -run 'TestHeaderSpecImpassableOptional|TestRegionHolesRoundTrip'`
  (the second needs `WOW_DIR`: holes-only headers leave every chunk's zone, flags and no-tuft cells
  as a save without headers has them; compare with that save, not with `ReadTile`, which reads
  Meld's patch while a region save starts from the unpatched tile).
- Trap: `Engine.regionKey` hashes the flags, so a region whose flag is false has another compile
  fingerprint than the same region with it true (decision #82); that is wanted, as Compile writes
  differently.

## Walkable ground: the navmesh view and the path test (#175), and the server's mmaps (#240)

Checks: View › Walkable ground builds the server's navmesh around the camera's target from the
terrain and the placed models' collision, rebuilds it after an edit, and View › Test a Path finds a
creature's way round obstacles.
- Unit: `tests/navmesh.test.ts` (slope areas, the tile gatherer, a navmesh round a wall with the real
  WASM in node, a few ms a tile; #239: the span layout `navFilters.ts` reads, a 1.5 yd model fence
  gone round while the same step in the terrain is climbed, a river only a swimmer crosses beside a
  ford a walker wades, a deep ocean chunk with no navmesh, and the sea's cells; #281: a WMO's pool
  over its floor crossed only as a swimmer, and its type's low bits picking the area). Go:
  `TestM2HullFaces`, `TestServerLiquidType`, `TestCollisionLiquidGrid`, and with `WOW_DIR=C:/WoW/client`
  `TestClientCollision` (three hulls wound outward by signed volume, Goldshire inn's floors facing up,
  its groups' triangle counts adding up to its faces, Ironforge's lava of type 3 and Stormwind's
  canals of type 1).
- WMO liquids (#281): `bun run probe walkable-wmo-liquid` (about 30 s) opens Ironforge (Azeroth
  33_41) with the target on the Great Forge and measures the slime-coloured navmesh within 60 yd in
  the browser's build and in the server's mmaps: 3475 and 3357 yd² when written, none before #281.
  It is slime, not magma, in both: the mmap builder reads the vmaps' LiquidType ID by its low two
  bits (`liquidTypeArea`), and the server's tiles show the same (a count of polygon areas over
  `data/mmaps` finds slime in Ironforge's tiles 33_41 and 34_41, files `0004133.mmtile` and `0004134.mmtile`, where no slime
  is). Needs the VMaNGOS folder's `data/mmaps`. The lava's centroid in that block is about
  (478, 431, 56); the WMO reaches into tile 34_41.
- Probe: `bun run probe walkable` (about 45 s) on a flat map: 172 tiles, a 60 yd straight path, a path
  round an 80 yd line of holes (92 yd), Goldshire's inn bringing floors above the ground, the inn moved 3 yd building again
  only the tiles it meets (12 of 172, `counts.builds`) with the same surface as building them all (#509), a 2 yd bump and a
  hole cell in the inn's client tile building again only the tiles they touch (9 of 172) with the same
  surface as all of them (#620; a bump that raises the client tile's height span, as one in a tile
  with no model does on the flat map, marks its every tile, 51), a river 2 yd
  deep across the map drawn blue and crossed only as a swimmer (`kind: 'swim'`, #239), and the view
  off freeing every tile. It turns Follow the Ground on first: with the default flying camera the new
  map's view starts 250 yd up and Test a Path's clicks land 345 yd out, past the built tiles (#256).
- In the benchmark scene (Northshire Abbey) the 177 tiles take 3.4 ms each on average, 41 ms at worst
  (the abbey's tiles); cutting the ground under models (#282) took the average from 2.7 to 3.9 ms in
  one headless run (`nav.buildTile` over `nav.tiles` in a probe times them alone); on SwiftShader the whole build takes about 70 s of frames, so wait on
  `e.nav.counts` (`done === total`, `loading === 0`, `!settling`), never on a fixed number of frames.
- Workers (#508): `bun run probe walkable-worker` (about 60 s) builds the benchmark scene's 177 tiles
  in the workers and again on the main thread (`useNavWorkers(false)` from `navJobs.ts`), and checks
  the surfaces and a path round the abbey match and the longest frame's `NavPreview.update` is
  shorter in the workers (33 against 54 ms when written; the main thread's share of the whole build
  192 against 709 ms). What stays on the main thread is the gathering (0.84 ms a tile on average,
  14.5 ms for the abbey's worst) and `refreshModels`. Unit: `tests/navmesh.test.ts` (a job's copies
  and `runTileJob` against a main-thread build, byte for byte). Trap: Bun has no `window`, so the
  unit tests always take the main-thread path; only the probe runs the workers.
- Server mode (#240, View › Server's mmaps): `bun run probe walkable-server` (about 45 s) in the
  benchmark scene reads the server's tile 32_48 (one tile within 160 yd of the target, about 39k
  triangles, 2 s), checks the drawn vertices lie on the ground (within 1.5 yd, 0.8 at the probe's spot: a wrong
  transform puts them a mirror away), walks four paths round and through the abbey over it and over
  the browser's build, which must come out within 12% (server 67.1, 75.4, 183.2 and 44.8 yd; the
  browser's 72.7, 82.5, 186.9 and 44.7 after #282, 72.6, 82.5, 186.8 and 44.7 with the client's inner
  heights, #284), and the
  view off frees it. It needs the VMaNGOS folder set and its `data/mmaps` built for map 0 (470 tiles
  on this machine). Unit: `tests/navServer.test.ts` (the frame round trip against `serverSpot`, the
  flags' colours, a built tile's surface read back from its bytes and a copy of them pathing in a
  navmesh). Go: `TestDetourTile32ShrinksTheLinks`, `TestNavTileReadsTheFiles`, and with
  `VMANGOS_DIR=C:/WoW/vmangos` `TestServerNavTiles` (every map 0 tile converts). Check one tile by
  hand with `curl -s -o t.bin -w "%{http_code} %{size_download}" "localhost:34115/wow/navtile?map=0&x=32&y=48"`
  (200, about 2 MB; 404 where the server has none).
- Comparing the two builds at a spot (#282): `nav.query.findNearestPoly(nav.toNav(p), { halfExtents })`
  in each mode tells which surface a point snaps to (the server's frame back to the editor's through
  `nav.serverGroup.matrix`): a point at ground height under a floor snapping 2 yd lower in one build
  is ground the other doesn't have. To see under roofs, set `e.renderer.localClippingEnabled` and a
  clipping plane (`{ normal: new Vector3(0, -1, 0), constant: <height> }`) on the materials in
  `nav.group`, then shoot with `P.only(nav.group, ...)` from straight above (`pitch: 1.5`). The
  server's tile header holds its height span (`bmin`/`bmax` at bytes 72 to 96 of the Detour data,
  after `/wow/navtile`'s 20-byte prefix), which `NavPreview`'s `spans` should match: 28.846 for
  32_48. A gap a hair over 1.5 yd flips with the voxels' origin, so check that first.
- Inner heights (#284, #380): Go `TestInnerLifts` and `TestPatchSculptedCellsTakeTheMean` (a
  synthetic tile: an unedited tile stays byte-identical, the four cells about a lowered corner get
  their corners' mean, the rest keep the tile's middles), and with `WOW_DIR=C:/WoW/client`
  `TestClientRegionInner` (each lift of Azeroth 32_48 puts its cell's corners' mean back on the
  client's inner sample, the largest is about 4 yd, and `Base` is the tile's corners) and
  `TestPatchMovesInnerSamples` (a uniform +4 raise leaves every middle at its corners' mean); unit:
  `tests/navmesh.test.ts` (a lifted middle in the gathered ground and the tile's span; `cellLift` is 0
  for a cell with a corner off `innerBase`). Trap: the benchmark scene reads 32_48 with the client's
  patch-3, which held an earlier Meld export of it on 2026-10-20 (269 corners south-west of the
  abbey, up to 5.6 yd off the base tile), so its `heights` and `innerBase` differ there without any
  sculpt in the session: those cells count as sculpted, as they would in the next export. In the app, with the view on in the benchmark scene, `e.terrain.innerLift` is a float a
  cell (16384 for one tile) once `innerPending` is false; a probe that turns the view on and reads the
  ground at once must wait for that, as `NavPreview` does.
- Trap: Recast lifts the detail mesh's copy of a polygon's corners by one voxel height
  (rcBuildPolyMeshDetail), and Detour's tile keeps the unlifted ones, so a tile's surface read from
  its bytes sits up to 0.25 yd below the `BuiltTile.tris` of the same build.
- Traps: `nav.group` also holds the path test's line and markers, which have no colour attribute;
  a change (sculpt, a model loading or moving, a liquid edit) holds the build until 400 ms pass without one,
  so while models stream in after a region opens nothing builds; the roofs get navmesh too, as on the
  server (they are walkable, only unreachable).

## The world view: streamed tiles and Edit Here (#15, probe `world-view`)
Checks: File › World View (from a region) and the Start dialog's World View button open a map's world
view, which streams the client's tiles and their models around the camera and lets go of the far
ones; Edit Here opens the block around the camera in a region tab, the camera kept.
- Probe `perf-world-flight` (#742, a benchmark, left out of `--all`; about 140 s): flies 120 frames east at 8 yd a frame, 100 yd over Elwynn's ground, and prints the frame CPU (mean, p50, p90, p99, max), the far shadow redraws (`farRedraws`, `farCauses`: the `Engine.shadowKey` parts that changed since the last far redraw, `objects+textures` for models and textures landing, `fit` when none did, so the fit moved), their frame CPU against the other frames', the far pass's calls and ms, the tiles landed and `worldStats()` at the end. Each frame is followed by `P.drawn()`: skipping it only moves the stall into the GPU backlog. Run it before and after a change to the stream or the shadows; 2026-10-26 after fb785d4: 4 far redraws in 120 frames (3 for a scene change, 1 fit), far frames 22 ms against 10, far pass 2,062 calls and 5.9 ms.
- Probe `world-view` (`bun run probe world-view`, about 90 s with the models): opens Azeroth's world view at the
  Elwynn block 31-33 x 48-50, waits for the tiles within the reach to load (`engine.worldStats()`:
  loaded, loading, queued, failed and the map's tile count), checks the camera looks at the block's
  middle on the ground, that each tile is drawn at `groundStride` for its distance (`strides`, with
  `worldStats().strides` counting the tiles at 1, 2 and 4), that the WDL horizon is drawn past the
  ground and on no tile whose ground is drawn (`horizon`: its tiles, those on ground, the share of the
  view it changes; `worldStats().horizon`), that the ground is drawn (a shot with `doc.world.group` hidden differs), that
  the tiles within `PAINT_REACH` are drawn in their texture layers once those load and none past
  `PAINT_DROP` is (`paint`: painted, near ones left unpainted and far ones painted, both 0, and the
  share of the view that changes with the painted tiles put back in their minimap colour; `worldStats()`
  counts `painted`, `painting`, `paintWaiting` and `paintFailed`), that the tiles' liquids are drawn
  (`liquids`: `worldStats().wet` tiles with water and their `liquidTriangles`, and the share of the
  view that changes, looking down at a cell of the loaded lake nearest the eye, with the tiles' liquid
  meshes hidden), that
  the models are drawn (the same with `doc.objects.group`) and placed once (as many as the loaded
  tiles list unique IDs), that no doodad (M2) is drawn further across the ground than
  `doodadReach` gives for its size and some are left out for it (`doodads`: drawn, past, cut), that a
  Sculpt click makes no undo step, that the commands on the map's ground and models do nothing
  (`commandsOff`: Select All and Select Models of Type select nothing, a paste doesn't start, Clear
  Height, Remove Duplicate Models and Bake Shadows leave no undo step, no dirty tab and every model
  placed; with `Engine.refuseInWorld` off, Remove Duplicate Models takes away the client's doubled models (two here, such as the Elwynn haystack)
  and the check fails), that the scene line names `world`, that flying four tiles east loads
  the tiles there and drops the ones behind, with the models only they used (`released`: no batch
  left without objects, the types gone, and of those not used elsewhere how many the registry still
  keeps, through `isKept` in `models/assets.ts`, which must be 0; `farRedraws`: while the tiles
  there stream in and 32 frames after, the far shadow map's redraws for a scene change, none within
  30 frames of the last far redraw, `early` must be 0: with `WORLD_FAR_FRAMES` at 1 it was 10 in 41
  frames), then Edit Here (a project lent in the state) and File ›
  World View back, the camera where it was each way, and that every building of the region stands
  where the world view has it, the block's corner apart, and that on every tile of the block the
  world view painted, each chunk's textures and every texel's weights are the region's (`regionPaint`:
  slots and texels off, both 0; the region's palette is `editor.palette`, which the frame hands to
  its terrain, so `terrain.palette.entries` can still be empty right after the tab opens), and that
  each chunk's liquid layers are the region's, in order, with the same cells, heights and depths
  (`regionLiquids`: `off` 0; 414 layers over the 9 tiles at 35-37 x 49-51). It reports `perf` with the models and
  without (not checked): at the Elwynn view, reach 3, about 26,000 models, 4,500 draw calls, 3.4M
  triangles and 26 ms of CPU against 3 ms bare, on 2026-10-25; with the doodads' reach, 4,070 calls,
  3.0M triangles and 21 ms (WMO groups are most of the calls, and the shadow cascades about 60%);
  with the ground's strides, 2.45M triangles, the bare ground's 687k down to 143k; the horizon adds
  about 180k triangles and no draw call worth counting.
- Probe `world-minimap` (about 12 s): in Azeroth's world view the minimap is the overview cut to the
  map's tiles' square (`worldExtent`, `bun test tests/worldMinimap.test.ts`), the heights canvas hidden,
  the marker on the camera and Edit Here's block outlined; a click on a tile some way off moves the
  camera's look point there, on the ground once that tile loads (flying, the target is the eye: the
  probe takes the view's offset back off); Ctrl+Shift+P refuses. Trap: a synthetic click's
  `clientX` is whole pixels, a sixth of a tile on this minimap, so the probe works out the point from
  the pixel it clicked.
- Probe `world-detail` (about 30 to 60 s): View › Detail info in Azeroth's world view at a painted
  spot and at a lake's cell names the streamed ground (tile, chunk, map cell, height, zone, texture
  layers, liquids), and after Edit Here the region's readout at the same spots has the same tile,
  chunk, height, hole, zone, impassable flag, no-tufts bit (#755), layers and liquids, its cell the world's less the block's corner. The cursor is
  `P.pointer` after a `pointerenter` on the canvas; the readout is `stats.detail`, refreshed at 2 Hz.
  Trap: aim at a cell's middle, not its edge: the cursor lands a few hundredths of a yard off, which
  on an edge reads the next cell and a different blend of layers.
  `bun test tests/worldDetail.test.ts` covers `worldCellDetail` (chunk, cell, hole, zone, flags, shares, liquids). In the
  dev page the zone reads `Area 18 (18)`: without the desktop app's bindings there is no area table
  to name it, in the region's readout too.
- Probe `world-map-id` (about 5 s): a world tab's map ID (#754) is its own map's, by its folder:
  Kalimdor's world view answers `openMapId` with 1 and Client Lighting reads Kalimdor's lights
  (`clientLightsMap`), Azeroth's answers 0. Trap: every other world-view probe opens Azeroth's, where
  0 is right by luck; and `P.until` waits on a falsy answer, so the probe wraps the 0 in an array.
- Probe `world-teleport` (about 5 s): in Kalimdor's world view near Orgrimmar, Copy Teleport at the
  cursor (`teleportAtCursor`) gives `.go xyz ... 1` at the streamed ground under the cursor, and
  `playerSpot` and `spotOfDoc` stand on the streamed ground on map 1 (#756). The probe's camera flies,
  so `playerSpot` stands below the eye, not the cursor.
- `bun test tests/selectObjects.test.ts`: a look-only layer (the world view's streamed models) selects nothing.
- `bun test tests/horizonMesh.test.ts`: the world view's horizon packs the tiles it keeps, in order.
- `bun test tests/worldLiquid.test.ts` and `go test ./internal/wow/ -run EncodeLiquids`: a tile's
  liquids reply (`/wow/groundliquids`) reads back, and meshes each covered cell at its chunk's place,
  a whole block of cells as one quad at a far stride.
- `bun test tests/worldPaint.test.ts` and `go test ./internal/wow/ -run TilePaint`: a tile's paint
  reply (`/wow/groundpaint`) reads back, and the painted tiles share palette entries.
- `go test ./internal/vmangos/ -run Horizon`: the world's horizon has every WDL tile once at its own
  coordinates, Northshire's as the region's horizon has it.
- `bun test tests/instanceCull.test.ts`: the doodads' reach by size, across the ground, only for a
  doodad batch in a view that asks for it.
- `bun test tests/worldGround.test.ts`: the ground reply, the mesh (holes, normals, winding), the
  height between samples, the strides (a coarse cell a hole only when all its cells are) and the
  skirts on an edge that strays between them, the tiles wanted nearest first, the reach for the view distance, and a
  model several tiles list placed once (`TileModelShare`).
- `go test ./internal/wow/ -run TestTile`: a tile `adt.BuildTile` makes reads back as its
  heights and holes, laid out as the frontend reads them, and as its models in the map's editor
  coordinates and turn.
- By hand: `curl "localhost:34115/wow/ground?map=Azeroth&x=32&y=48"` gives 100616 bytes; a tile the
  map lacks is a 404. `/wow/groundmodels` with the same query lists the tile's models as JSON.
- The client has a few models twice at one spot under two IDs (an Elwynn haystack, 18883 and 18884):
  check that a model is placed once by its ID, not by its spot.
- Trap: wait for `queued` as well as `loading` to reach 0. Between two reads `loading` is 0 for a
  frame while tiles still wait, and a check then sees half the ring.
