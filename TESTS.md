# TESTS.md

Ways to test and verify Meld that are known to work. Read this before working out how to check
a change, and add to it when you find a good way to test something (see CLAUDE.md).

Each entry says what it checks, how to run it, and the traps that cost time.

## Compiling a shader without the app (headless Chrome)

Checks: that a `ShaderMaterial` compiles and draws what it should, when Claude in Chrome isn't there.
Get the material's sources through the real module in node (`node --import ./tests/register.mjs x.ts`
from `frontend/`; a script outside `frontend/` must import three and the module by absolute `file:///`
URLs, or 'three' doesn't resolve) and write them to JSON. In a scratch folder (not the repo), with
copies of `three.module.js` and `three.core.js`, a page builds the material, renders it with
`r.debug.onShaderError` set and puts `readPixels` of the centre into the DOM. Serve the folder
(`python -m http.server`) and run
`chrome.exe --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=8000 --dump-dom http://localhost:<port>/page.html`.
- Trap: `camera.lookAt` straight up or down with the default up vector gives a black frame; aim a
  degree off. The centre pixel of an even canvas is half a pixel off the view axis, so a gradient
  reads a few levels off its stop.
- Used for the client sky dome (B-166): each ring elevation reads its band's colour, the fog colour
  below the horizon.
- A whole module (a `Terrain`, an `Environment`) can be drawn the same way: bundle a scratch
  `entry.ts` with Vite's JS API (`build()` from `frontend/node_modules/vite/dist/node/index.js`,
  `configFile: false`, `root` the scratch folder, `resolve.alias` for `three` and `@meld` →
  `frontend/src`). Modules that pull in the runes state need a shim before the bundle in the page
  (`window.$state = Object.assign(v => v, { raw: v => v, snapshot: v => v })`, `$derived` with
  `by`, `$effect` with `root` and `pre`). `--enable-logging=stderr --v=0` prints the page's console.
  Used for the baked shadows (B-173): on dry ground (`waterEnabled` 0, or the default ocean map's
  seabed takes 88% of the deep-water colour) a shadowed texel reads 117 against 138 lit, 0.70 in
  linear light.

## Unit and integration tests

- `make test` runs `go test ./internal/...` and the frontend unit tests (`node --test`, Node 22.18+).
- `make check` runs go vet and svelte-check/tsc.
- `tests/history.test.ts` covers the undo stack (`state/historyCore.ts`: push, the step limit,
  replaceTop, goTo, clear) through a plain sink; `state/history.ts` only wires that sink to the
  runes state. Trap: `node --test` strips types only, so a module a test loads can't use TypeScript
  parameter properties (`constructor(private x: T)`) or import a `.svelte.ts` runes module.
- WoW client integration tests: `WOW_DIR=/path/to/client go test ./internal/wow/ -v`.
- The same `WOW_DIR` runs the client checks in `internal/vmangos` (region round trips, the chunk
  header write `TestRegionHeadersWritten`, `TestReadAreasFromClient`). On the owner's machine the
  client is the `wowPath` in `%APPDATA%/Meld/config.json`. Trap: a region save itself changes chunk
  flags (0x8000 on some chunks), so compare a write against the same save without your change, not
  against the client's tile.
- `TestClientMinimapIndex` (WOW_DIR) is the check for writing `md5translate.trs` (B-169, for #17): the
  client's index parsed and written back by `MinimapIndex.Bytes` must be byte-identical (8401 rows under
  235 `dir:` headers, empty headers for folders that hold only folders, everything ordered by upper-cased
  name), and a stored tile's name must be the md5 of its BLP bytes.
- `TestClientWDL` (WOW_DIR) is the check for the WDL write: Azeroth.wdl parsed and rebuilt must be
  byte-identical, and the outer horizon heights sampled from a client tile must equal the client's. Trap:
  Northshire (32,48) is a few yards off the client's WDL (the tile was edited after Blizzard built it), so
  don't use it for an exact comparison; Westfall (31,49) is exact. `BuildRegion` returns the WDL after the
  tiles, so a test that walks the files as tiles takes `files[:size*size]`.
- `TestClientAnimatedLayersKept` (WOW_DIR) finds an animated layer in the client (Burning Steppes lava,
  tile 33_44) and rewrites its chunk as a region save does: the layer must keep its MCLY look flags. It is
  the check that a paint rewrite doesn't drop the client's animation or overbright.
- `TestClientLightsWriteBack` (WOW_DIR) is the check for the light editor's writes: Azeroth's lights and
  params written back must leave LightParams and both band tables byte-identical. Trap: the client's unused
  band key slots hold 0xcccccccc (uninitialised memory in Blizzard's tool), so a writer that zeroes them
  isn't byte-identical; `WriteLights` starts each band row from the client's own.
- `TestRegionHolesRoundTrip` (WOW_DIR) sends a Westfall block's own holes back as the editor does and
  checks every chunk keeps the client's hole bits (4 chunks there have holes); it is the check for the
  hole export's block mapping. Seeing a cut cave mouth in game is still a manual check.
- Trying SQL against the world database (`mysql -uroot -P3307 -h127.0.0.1 mangos`): its tables are
  MyISAM, so `START TRANSACTION ... ROLLBACK` does not undo an INSERT. Use an entry nothing uses and
  delete the row yourself afterwards. A template whose `unit_class` has no `creature_classlevelstats`
  rows (only classes 1, 2 and 8 have them) stops mangosd at startup (#112).

## Rendering and UI in the live app (Claude in Chrome)

Checks: anything visual (shaders, shadows, lighting, models, UI) against the real client assets.

- `make dev` (`wails dev`) serves the app at http://localhost:34115. The page exposes
  `window.__engine` (the Engine), `window.__loadScene(text)` and `window.__sceneText()`.
- **Always open the page as http://localhost:34115/?nosave.** The page and the user's desktop window
  share config.json and each writes all of its preferences on any change (a tab opened, a panel
  folded, a brush made), so a page without the flag overwrites what the user set in the window.
  With `?nosave` the page never writes the file (`lib/state/prefs.ts`).
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

## The live app without Claude in Chrome (headless Chrome over CDP)

Checks: the same as above, when the Chrome extension isn't connected (a `claude -p` loop run). Start
`make dev` in the background, wait until `curl localhost:34115/wow/status` answers, then drive a
headless Chrome over the DevTools protocol from a scratch folder (not the repo):
`uv run -q --with websocket-client python -u cdp.py "http://localhost:34115/?nosave" shot step1.js step2.js`.
The script (about 40 lines) starts `chrome.exe --headless=new --remote-debugging-port=9333
--user-data-dir=<scratch>\profile --window-size=1400,900 --use-angle=swiftshader
--enable-unsafe-swiftshader about:blank`, reads the page's websocket from
`http://127.0.0.1:9333/json`, sends `Page.navigate`, waits 4 s, and for each JS file runs
`Runtime.evaluate` on `(async () => { <file> })()` with `awaitPromise` and `returnByValue`, prints
the result and saves `Page.captureScreenshot` as `<prefix>-<n>.png`. A step loads a scene with
`__loadScene`, then steps the app with `await new Promise(r => setTimeout(r, 50)); __engine.frame()`
in a loop and returns what it wants to report as JSON. The viewport of a 1400x900 window is
`magick shot.png -crop 1068x285+47+95` (the asset browser takes the bottom).
- Traps:
  - Swiftshader renders a region in seconds a frame: a few hundred `frame()` calls take minutes, so
    run it with a long timeout, and `python -u`, or nothing prints until the end.
  - Write step files with the Write tool, not a heredoc: heredocs here halve backslashes, and client
    paths in JS strings need `\\`.
  - The camera target rides the ground (`followGround`, re-applied from prefs by the scene), so a
    point high up (a lantern, a waterfall's top) can't be centred with `setSceneView`; move the
    model instead (`yOff`), or stand the camera far back.
  - A dense spot (Northshire's village) hides what you place behind props. Clear the view for the
    session: `for (const id of e.objects.objects.keys()) e.objects.hidden.add(id); e.objects.markAllDirty()`,
    then `e.objects.add({ type: 'm2:<path>', x, z, yOff: 0, rotY: 0, scale: 1 })` on open ground
    (x 150, z 300 in Azeroth 32_48 is open grass). Nothing of this is saved with `?nosave` unless
    the map is saved.
  - Writing `__engine.prefs.x` doesn't stick: the prefs effect re-applies its own copy.
  - The point under the cursor (`__engine.hit`) is picked only while the pointer is inside the
    viewport: set `e.ndc.set(x, y); e.pointerInside = true`, then step a few frames. F9's copy
    position is `await e.teleportAtCursor()`: Northshire Abbey's courtyard at the screen centre of
    `target: [182, 80, 353], pitch: 0.9` in Azeroth 32_48 gives `.go xyz -8886.33 -182.00 80.26 0`
    (same conversion as `serverSpawn`). Calling it doesn't touch the clipboard; pressing F9 does.
  - Dialogs open through the menu bar's DOM: click the `button` whose text is the menu's name
    (`Edit`), then the item's label `span` (its `closest('button')`), then read the dialog's DOM. Used
    for the ground effect editor's Footsteps pick (B-175): it lists Dirt to None by name.
  - The user's prefs may have Prop animations off, which a probe should not take for a bug.

## Particles (M2 emitters, B-182)

Checks: `world/particles.ts` and `ParticleLayer.ts` against the client's models.
- `go test ./internal/wow -run Emitter` (and `TestClientEmitters` with `WOW_DIR`: Elwynn's tall
  waterfall has one lit alpha emitter with flags 0x2, BloodSpurt.m2 four, FlameStrike_Area.m2 four
  spline emitters, `FreestandingTorch01.m2` two additive flames on a 4x4 flipbook) and
  `tests/particles.test.ts` (kernels, ramps, integrator, quad writer, after Benilla's own tests).
- In the app (the CDP route above), place `World\Generic\PassiveDoodads\Lights\FreestandingTorch01.m2`
  and `World\Azeroth\Elwynn\PassiveDoodads\Waterfall\ElwynnTallWaterfall01.m2` (yOff -70: its emitter
  is 94 yd up) on cleared ground. `__engine.particles.live` maps `<objectId>:<emitter>` to a pool
  (`pool.count` live particles); `__engine.particles.batches` holds the draws (`floats / 36` quads).
  The torch burns with the flipbook flame and the waterfall throws a lit white spray (about 100
  particles).
- Trap: an emitter out of view or beyond `RANGE` (300 yd) is frozen, so a pool with `acc` 0 and no
  particles is usually just off screen.
- Ribbons (B-183): `TestParseRibbonRecord`, `TestClientRibbons` (Holy Smite's two slash ribbons, the
  Caverns of Time energy trail) and `tests/ribbons.test.ts`. In the app a ribbon needs a moving bone,
  so load the scene with `"prefs":{"animations":true}` (the owner's own prefs have animations off).
  `World\Dungeon\CavernsOfTime\PassiveDoodads\EnergyTrails\EnergyTrailHourglass.m2` placed on
  cleared ground sweeps two blue strips 60 to 160 yd up across the sky; from `distance: 260` both
  trails hold about 95 edges (`__engine.particles.live.get('<id>:r0').trail.count`). Its bones are
  linearly keyed, 9 keys in 16.7 s, so the strips run straight between keys, as the client draws them.
- Spawns (#110): a spawn's pools and trails are keyed `s:<kind>/<guid>:<emitter>` (`:r<n>` for a
  ribbon). The Durotar region Kalimdor 41_33 (2x2) has 50 of them; its Copper Vein `object/112723`
  has four additive glow emitters with 5 or 6 particles each once the camera is near it. A hidden
  spawn kind (the Spawns filter) drops its spawns' particles.
- Previews (#110): the tools register their ghost meshes (`previewParticles`), keyed `p:<mesh id>`.
  With the Place tool on `FreestandingTorch01.m2` and the pointer over the ground the ghost burns
  (`p:<id>:0` about 18 particles); switching tools takes its quads out of the batch at once.
- Ground snap (flag 0x2000, #110): `tests/particles.test.ts`; in the app, place
  `World\ENVIRONMENT\DOODAD\GENERALDOODADS\ElementalRifts\AirRift.m2` with `yOff: 3`: its first
  emitter (flags 0x3009, flat shockwave rings) births on the ground (ground height plus the birth
  size, about 0.5), not at the model's base. The fire and water rifts, `UndercityMonsterBirth.m2`,
  `G_GhostTrap.m2` and `G_ScourgeRuneCircleCrystal.m2` use the flag too.
- Sorting (#118): an alpha batch (`__engine.particles.batches`, key `<texture>|alpha|...`) uploads its
  quads back to front from the camera each frame. With Elwynn's tall waterfall placed as above, walk
  each batch's `data` (36 floats a quad; the centre is the mean of floats 0..2 and 18..20) and check
  the distances to `__engine.camera.position` never grow.
- Trap: a page that hot-reloads between two edits of the same feature can run one module old and
  one new; reload it by hand before checking.
- Trap: in the dev page, `await import('/src/lib/state/editor.svelte.ts')` can load a second copy of
  the module (the app's has a `?t=` hot-reload query), and writing `editor.tool` there changes
  nothing. Import the app's own URL:
  `performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/src/lib/state/editor.svelte.ts'))`.

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

## Ground effects (grass tufts)

Checks: the tables load (`groundEffectTables()` in `wow/groundEffectTables.ts`), the tufts build
around the camera (`GroundEffectLayer`) and the export carries effects. Unit tests:
`tests/groundEffects.test.ts` and `go test ./internal/adt/` (`effects_test.go`). In the dev page:

```js
const g = await import('<the loaded wow/groundEffectTables.ts URL>')
await g.loadGroundEffectTables()        // the first time for a client scans every tile: a minute or two
g.groundEffectTables().textures['tileset\elwynn\elwynngrassbase.blp']   // an effect id
// With Northshire open and the camera on the ground: a few frames, then
__engine.tuftCount()                    // thousands
__engine.exportInput().effects          // the effect per palette index
```

- The first load of a client is slow (it reads every ADT of every map); the status bar counts the
  tiles. Afterwards it comes from `<user cache>/Meld/groundeffects/`.
- Tufts only appear for textures the client's tiles use, or ones given an effect in Edit › Ground
  Effects…; a new world painted with the default tilesets grows Elwynn's grass.
- The detail models load like any other; the layer draws a model once it is ready, so the first
  build after opening shows fewer tufts for a moment.
- Which model a GroundEffectTexture slot names: `TestClientGroundEffectModels` (WOW_DIR) counts the
  effects whose models come from more than one zone (the file name's three-letter prefix). Keyed by
  GroundEffectDoodad's internal ID (field 1), as the client does, 29 do; keyed by the row ID (field 0,
  mostly one more), 264. The trap: the IDs look alike and both keyings resolve most slots, so a wrong
  one still shows plausible grass. An empty slot is 0xFFFFFFFF; 0 is ElwFlo01.
- The fade (B-178): `tests/groundEffects.test.ts` pins Benilla's landmarks (plateau to 52.64 yd, cut-out
  at 61.11, zero at 69.86). In the app (CDP route), Northshire's meadow at x 150, z 300 with the map's
  objects hidden, `yaw: 2.2, pitch: 0.1, distance: 4`: the grass thins away toward the hills instead
  of ending at a ring. `__engine.doc.groundEffects.reach` is the build radius; the headless viewport
  is 1068x285 (aspect 3.75), which makes it about 133 yd and the tuft count about four times a 70 yd
  ring's, so count tufts in a normal window when judging the cost.

## Water look (the client's combine, B-174)

Checks: `water/liquidMaterial.ts` against the client's look. Northshire's stream in Azeroth 32_48 is
river water up to depth byte 79: with the CDP route (above) load the region, then
`e.setSceneView({ target: [340, 70.2, 283], yaw: 2.4, pitch: 0.35, distance: 45, hour: 13 })`. It
should be teal with white ripple glints, as in the game; the old noggit-style shader drew it a flat
olive. `__engine.doc.liquids.layers(c)` lists a chunk's layers (id, `depth` 0 to 1 per vertex) to find
water elsewhere. For a before and after, `git stash push` the changed files, shoot, and `git stash
pop`: the dev page reloads them.

## Client clouds (B-179)

Checks: `wow/clouds.ts` and `engine/CloudDome.ts`. `tests/clouds.test.ts` ports Benilla's kernel tests
(clear at density 0, overcast mean above 200 at 1, scattered at 0.6, the glow only brightening, the
quarter-tile scroll). In the app (CDP route) load a scene with `"prefs":{"clientLighting":true,"clouds":true}`,
hide the map's objects, then `setSceneView({ target: [150, 80, 300], yaw: 2.2, pitch: 0.08, distance:
120, hour: 13 })` in Azeroth 32_48: soft cloud banks over the client sky. `__engine.clouds.kernel.tile`
is the coverage (Elwynn's light gives density 0.5, about 60% of the cells covered). The camera can't
look up (it rides the ground), so the clouds show low over the horizon, where the dome's cap is.

## Liquid types from the client

Checks: the Water tool's liquid list is the client's LiquidType.dbc (`LiquidTypes` binding,
`setLiquidTypes` in `water/liquids.ts`), so it holds the base four plus rows such as 21 "Naxxramas -
Slime". `go test ./internal/vmangos/ -run TestLoadLiquidTypesFromClient` with `WOW_DIR` set reads
the real table; `tests/liquidTypes.test.ts` covers the mapping. In the dev page the Water tool's
select lists five liquids once the client is loaded, and a layer painted with 21 exports as slime
(`liquidsToAdt` gives type 4) while the `.wmap` keeps 21.

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

## Spawn tabs of the asset browser (Creatures, NPCs, Objects)

Checks: `SpawnBrowser.svelte` and the `ListCreatureTemplates` / `ListObjectTemplates` bindings (the
world database must be up). In the dev page:

```js
[...document.querySelectorAll('[data-ui="AssetBrowser"] .tab')].find(b => b.textContent.trim() === 'Creatures').click()
// drive frames for the thumbnails; then search, e.g. 'hogger', and read the tiles
const sb = document.querySelector('[data-ui="SpawnBrowser"]'); sb.querySelector('.tile').click()   // ui.placeCreature, tool 'place'
e.tools.place.onDown(e.ctx, hit, {})      // spawns it at `hit`; e.history.peek().label is 'Add Hogger'; e.undo() removes it
const pip = await import('<PipetteTool.ts URL>'); await pip.pickSpawn(editor.spawns[0])   // the pipette on a spawn
```

- Traps: a creature tile's badge is its level; the title holds entry, level, rank and type. The
  lists are cached in Go per server and client, so a changed template needs a restart to show.

## Thumbnail loading order (asset browser grids)

Checks: `lib/wow/thumbQueue.ts` (the priority queue: tiles on screen nearest the grid's centre
first, then the rows just outside the view that `prefetchAround` asks for) and `PaletteTile`'s
IntersectionObserver. `tests/thumbQueue.test.ts` covers the ordering, dedupe and prefetch set.

- In the live app: open a tab with uncached thumbnails (Creatures after `/wow/thumb` cache is
  cleared, or a zone not browsed before), then scroll by 3 rows (one mouse-wheel tick is a row)
  and screenshot at once: the rows that came in should already be filled.
- Traps: tiles only ask for thumbnails from an IntersectionObserver, which does not fire in a
  hidden tab (`document.hidden`), so a `javascript_tool` loop counting `.tile img` in a hidden tab
  sees nothing finish however many `__engine.frame()` it drives; and `await`ing
  `requestAnimationFrame` there never returns (the eval times out after 45 s). Use the `computer`
  tool's scroll and screenshots, which keep the tab visible. Cold list timings for reference: the
  three `/wow/list` kinds about 40 ms each, `ListCreatureTemplates` about 0.3 s uncached (10k rows
  through mariadb plus dressing), `ListObjectTemplates` about 0.2 s; a screenful of 80 fresh
  creature thumbnails about 3-4 s, cached PNGs near instant.

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
- The editor window is `ui.brushEditor = true` (Edit brush… in the options bar, or Edit › Doodad
  Brushes…); a click on a tile adds the model, a ✓ badge marks the ones in the brush.
- Trap: an `$effect` that reads a `$state` it also writes (the editor once read `all.length` before
  loading `all`) re-runs after every write and hangs the app as soon as the window opens. Guard such
  loads with a revision variable (plain `let`, not state), as the asset browser does.
- Trap: a test brush made in a dev page opened without `?nosave` was saved over the user's own
  brushes once (see the note at the top). With the flag, test brushes are safe; they vanish on reload.
- A brush file is `formatBrush(brush)` from `tools/doodadBrush.ts`; paste its text into a `.toml` file
  and File › Import Doodad Brushes… adds it under a free name ("Test 2" if "Test" exists).
- Slope and prop rules (`editor.doodad.maxSlope`, `editor.doodad.onProps`): on a `'hills'` preset
  document, `ed.editor.doodad.maxSlope = 10` and a stroke as above leaves the steep flanks bare
  (`groundSlopeDeg` in `world/groundTilt.ts` is the angle; unit test in `groundTilt.test.ts`). With
  `onProps = true` and a WMO placed first (`e.addObjects([...])` as in "Attachments"), models whose
  point falls on its roof come out with `parent` set to the WMO's id and `yOff` local to it; the ray
  skips what the stroke itself placed, so a brush never piles onto its own models. `fitsOn` (spacing
  per prop) is in `doodadBrush.test.ts`.

## Selection outline colours (free, touching, buried)

Checks: `SelectionOutline` and `Engine.touchesSomething`. In the dev page, with the `editor.svelte.ts`
and `selection.ts` module URLs from "Scripted brush strokes":

```js
e.newDocument(128, 'island', 3, 'Outline'); for (let i = 0; i < 5; i++) e.frame()
const type = 'm2:World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01.m2'
e.addObjects([{ type, x: 128, z: 128, yOff: 0, rotY: 0, scale: 1 }, { type, x: 140, z: 128, yOff: 6, rotY: 0, scale: 1 }])
ed.editor.tool = 'select'; sel.selectObjects(e.objects, [...e.objects.objects.keys()])
e.controller.setView(134, e.terrain.heightAt(134, 128), 128, 0, 0.35, 40); for (let i = 0; i < 10; i++) e.frame()
```

- Screenshot and zoom on the two: the one on the ground has a green stroke (red along any part
  under the slope), the one 6 units up a yellow one. The models may still be the purple
  placeholder boxes, which is enough for the colours.

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


## Ground effects: no-doodad cells and density

Checks: tufts stay off the cells under buildings and off the client's own `noEffectDoodad` cells,
and the export writes those cells. Unit tests: `groundEffects.test.ts` (`coverCells`,
`chunkNoEffect`, `frillDensity`), `vmangosExport.test.ts` (the row bits
per chunk) and Go `TestRewriteNoEffectBitsReadBackAndKeepTheTilesOwn` (written bits read back by
`ParseTerrain`, ORed with the tile's own). In the dev page, on a region:

```js
const e = window.__engine
e.terrain.noEffect.reduce((a, b) => a + b, 0)        // the client's no-doodad cells (roads, buildings)
e.tuftCount()                                       // falls when a WMO is placed over grass
e.exportInput().noEffect.reduce((a, b) => a + b, 0) // client cells plus the cells under root WMOs
```

- A WMO whose bottom floats more than 4 yards above the ground (a bridge) bares nothing.
- The density is View › Sparse / Normal / Full tufts; the layer rebuilds within a quarter second.
- The scatter itself (`scatterChunk`, `BlizzardRandomizer`) is tested against vectors printed by
  Benilla's own Rust (`ground_effects.rs`): copy `GROUND_EFFECT_NOISE`, `BlizzardRandomizer` and the
  pass loop into a scratch `.rs` with a `main` that prints them, and build it with
  `rustc -O --edition 2021` (rustup's toolchain, `~/.cargo/bin`); no cargo project is needed. The
  JS values match Rust's f32 ones to 1e-6, not exactly, since JS works in doubles.

## Hide panels (Tab)

Checks: Tab hides the toolbar, options bar, asset browser, dock and status bar and the viewport
grows to fill the window; Tab again brings them back; Graphics › Hide panels is the same switch.
In the dev page: `ed.ui.hidePanels = true`, then `document.querySelector('canvas').clientHeight`
grows and `document.querySelector('[data-ui="Toolbar"]')` is null. A key event
(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`) does the
same unless an input has focus; Ctrl+Tab still cycles the map tabs.

## Help window

Checks: Help › Help… (or F1 anywhere but in an input) opens the Help dialog; its Open the manual
button and Help › Manual open the README on GitHub in the system browser (`BrowserOpenURL`; the
dev page uses `window.open`). In the dev page: `ed.ui.dialog = 'help'` shows it;
`document.querySelector('[role=dialog]').textContent` holds "Getting started". The URL is
`MANUAL_URL` in `AppDialogs.svelte`.

## Preferences from two windows

Checks: a save writes only the changed keys, merged into the file (`changedPrefs` in `prefsPatch.ts`,
`tests/prefs.test.ts`; `config.MergePrefs` in `internal/config/config_test.go`). By hand: open the
desktop app and a dev page without `?nosave`, add a doodad brush in the app, then turn the fog off
in the page; the app's brush is still in `config.json` (the page sent only `fog`). The page's
`baseline` is private to `prefs.ts`; a key that was never saved goes out on the first save.

## Detail info readout

Checks: Graphics › Detail info shows, in the viewport's top right corner, the client tile, the
chunk in it, the cell, height, slope, hole and no-tuft flags, the chunk's texture layers with their
share at the cell and effect IDs, the liquid layers covering the cell and the root models in the
chunk. In the dev page: `ed.prefs.detailInfo = true`, move the mouse over the ground, then
`ed.stats.detail` (refreshed at 2 Hz with the other stats; null off the map). The readout is
`[data-ui="DetailInfo"]`.

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

## Top-down view (U)

Checks: U (or Camera › Top-down View) draws the map straight down with an orthographic camera
over the controller's target; the wheel zooms, WASD and a middle drag pan, Q/E and a right drag
turn the map, and every tool picks and paints as in 3D (the ray goes straight down). Fog is off
while it is on. In the dev page: `ed.ui.topDown = true; e.frame()`, then `e.camera.isOrthographicCamera`
is true and `e.camera.position.y` is 1500 above the ground under the target; a brush stroke by
script (see "Scripted brush strokes") still lands where `at(x, z)` says. `ed.ui.topDown = false`
brings the perspective camera back. The arrow handle of the gizmo can't be dragged top-down (its
plane is edge-on), the ring and knob can.

## Log window

Checks: Help › Log… lists every status message with its time (`appLog.lines` in
`editor.svelte.ts`, the last 500), the Go side's progress lines (they arrive as status messages),
and with Preferences › Log file loading (`prefs.logFileLoading`) every client file read
(`fetchBinary` in `wow/api.ts`: kind, path, time, or the error). In the dev page:
`ed.prefs.logFileLoading = true`, place a model, then `ed.appLog.lines.slice(-3)` shows the
`model` and `texture` lines; `ed.ui.dialog = 'log'` opens the window, which stays scrolled to
the newest line. Copy puts the whole log on the clipboard.

## Minimap window (M)

Checks: M (or Camera › Minimap Window) opens a floating map at the top left: the heights drawn grey
by height and blue under the sea (redrawn when `terrain.heightsVersion` changes, checked at 2 Hz
through `stats.view`), the client's overview behind it for a part of Azeroth (cropped to the open
block), amber tile borders on a map bigger than a tile, and a white dot with a line for the camera's
target and facing. A click moves the camera there (`controller.focus`). In the dev page:
`ed.ui.minimap = true`, then `ed.stats.view` fills within half a second and
`document.querySelector('[aria-label="Minimap"] canvas').width` is the map's size in cells.

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

## Area paste: liquids and turning (chunk mover)

Checks: Ctrl+C on a selected area copies its painted liquid cells too (the status says how many),
Ctrl+V lays them in with the ground, and R (or Turn 90° in the options bar) turns the pending paste
a quarter turn: heights, holes, texels, liquids and models together, the preview rect swapping its
sides. Unit tests: `tests/clipboard.test.ts` (`rotateClip`, `copyLiquidCells`, `pasteLiquidCells`,
`rotateLiquidClip`). In the dev page: `ed.editor.selection = { x0: 20, z0: 20, x1: 36, z1: 28 }`,
`e.copySelection()`, `e.startPaste()`, `e.rotateClip()` then `e['clip'].w` is 8 and `.h` 16;
`e.commitPaste()` with `e.tools.select.pasteAt = { x: 60, z: 60 }` set first; one Ctrl+Z undoes
the ground, liquids and models together.
- Trap: node's type stripping can't load `tools/brush.ts` (a constructor with parameter properties),
  so a unit test can't import `world/clipboard.ts` or anything else that pulls it in. Put what a
  test needs in its own module (`world/clipRotate.ts` is one) and import only that.

## Launch where the camera is (character placement)

Checks: Launch puts the Game Login's character on the ground below the camera, on the open map,
facing the camera's way. Unit tests: `internal/vmangos/character_test.go` (waits for the logout,
the UPDATE it writes), `internal/game/session_test.go` (`WOW_REALM`, `WOW_CHAR`, `StopGame`),
`tests/portCoords.test.ts` (`serverSpot`: position and facing). Against the real server, read the
row before and after: `mariadb -h 127.0.0.1 -P 3307 -u root -e "select map, zone, position_x,
position_y, position_z, orientation, online from characters.characters where name = 'Sizaro'"`.
Once in the world, close the game: the server saves the character on logout, and the row then shows
where it really stood (the zone too, which only the server sets).
- Trap: a character still in the world is saved over its row when it leaves, which undoes the
  placement. So the row is only written once `online` is 0. Benilla logs out as it closes, but a
  killed client (`taskkill /F`) leaves the character in for two minutes (ForceLogoutDelay).
- Trap: without `WOW_REALM` Benilla stops at the realm list, so `WOW_CHAR` never applies.

## Benilla launcher: nothing on screen until the world (benilla-launcher)

Checks: started by Meld with a login and a character, `meld-benilla.exe` shows no console and no
window until the character is in the world, then its game window in front. Unit tests: `cargo test
--release` in `benilla-launcher` (when the window hides and shows), `internal/game/session_test.go`
(`BenillaExe` prefers the launcher; it's started through `StartLogged`, not `cmd /c start`). Live: run
the session's `StopGame`, `vmangos.PlaceCharacter` and `StartGame` from a scratch program, and sample
the launcher's windows every 50 ms with user32's `EnumWindows`, `IsWindowVisible` and `GetClassName`
(PowerShell `Add-Type`): the game's window is class `Window Class`, created hidden; `ConsoleWindowClass`
must never appear. Its log is `C:\WoW\benilla\benilla-config\meld-benilla.log`, with
`meld-benilla: in the world, showing the window` at the reveal.
- Trap: winit's `Winit Thread Event Target` counts as visible but is never on screen; leave it out.
- Trap: a launcher started from a script that isn't in front can't take the foreground, so it opens
  behind; Meld, in front when Launch is clicked, hands it the right (`AllowSetForegroundWindow`). Judge
  the foreground only from a real click.
- Trap: a running launcher locks `meld-benilla.exe`, so a rebuild fails with "access denied".

## The camera's WMO room (down-ray probe, #8)

Checks: which group of a placed WMO the camera is in (`world/wmoRoom.ts`, Benilla's `seed.rs`), shown
as "Camera in" in Detail info. Unit cases are Benilla's own (`tests/wmoRoom.test.ts`); the client data
is `TestClientWMONav` (WOW_DIR, the Goldshire inn: 12 groups, 10 portals, 2 fogs). Live, in the dev
page: `const nav = e.rooms.navs.get('<lowercased wmo path>')` once the camera has been inside the WMO's
box, take a flat face of `nav.walk[g]` (nine floats a triangle, WoW axes), lift it 1.7 yd, take it to
editor space as `(x, z, -y)` and through `e.objects.matrixOf(o, m)`, then put the camera there:
`c = e.controller; c.followGround = false; c.collision = false; c.target.copy(p)`, and step `e.frame()`.
`e.rooms.current.group` and the readout should name group g. Above the roof the probe meets the
exterior shell (MOGP 0x8) and reads outside, as the client does.
- Trap: the controller's target rides the ground, which is often under a building's floor; turn
  `followGround` off first, or the camera ends up below the floor and reads outside.
- The portal flood and room fog on top of it (`world/wmoFlood.ts`, `wmoFog.ts`, `roomGate.ts`):
  `tests/wmoFlood.test.ts` builds rooms and doorways and a three camera, and holds Benilla's fog cases.
  Live: place the Goldshire inn (`e.objects.add({ type: 'wmo:World\\wmo\\Azeroth\\Buildings\\GoldshireInn\\GoldshireInn.wmo', ... })`
  on open ground), put the camera on a floor of group g as above, step frames, then read
  `e.roomFlood.visible` / `.fog` (per group, the first `nav.groups.length`) and `e.roomFog.t` (the 4 s
  fade). In its hall (group 2) the flood draws 2, 3, 5 and 10 looking along it and fewer facing a
  wall; in a closed bedroom (9) only 9. A WMO mesh must carry the `wmoRoom` attribute (Go's
  `"rooms":true` header); a page loaded before a Go change keeps the old assets, so reload it.
- Trap: the inn placed with `yOff: 0` on rough ground can have its floor under the terrain, and the
  probe's terrain race then reads outside; pick a floor above the ground.
- The world through the windows (#116): `tests/instanceCull.test.ts` (a doorway, the exempt
  building, a sealed room). Live, after the steps above: `__engine.roomFlood.exteriorWindows` (four
  NDC numbers a window), `__engine.cullView.gate` (their frustums), the drawn instances (sum of
  `mesh.count` over `__engine.objects.batches`) and `__engine.terrain.chunks.filter(c => c.visible)`.
  In the Goldshire inn only portal 0 (group 0 to the porch, group 11) leads out: from the hall
  (group 2) no window, so only the inn draws; from group 0 facing the door, one window and a few
  chunks. Set `prefs.cameraFollowGround = false` in the app's editor module (see the `?t=` trap)
  first: `controller.followGround` alone is reset from the prefs.

## Client Lighting's ground: per-vertex light and the sheen (#111)

Checks: under View › Client Lighting the terrain shader takes the light's rows in gamma space
(`clientAmbient`, `clientDiffuse`, `clientSpecular` = rows 1, 0 and 9), sums and clamps them per
vertex, and adds the sheen times the layers' `_s` mask (`paletteArray.ts` puts each `_s` twin's alpha
in the palette layer's alpha, 0 without one). In the dev page, load a region with
`"prefs":{"clientLighting":true}` in the scene, step frames, then read
`__engine.terrain.material.uniforms.clientLit.value` (1) and the masks from `__engine.terrain.palette.data`
(layer i's alpha bytes at `i * 256 * 256 * 4 + 3`, every fourth). Durotar's textures all have masks
(Black.blp none). With Client Lighting off `clientLit` is 0 and the ground is drawn as before.
