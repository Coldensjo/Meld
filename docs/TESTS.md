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
- `TestRegionWithoutLiquids` (WOW_DIR) opens Naxxramas (map 533, folder `Stratholme Raid`) at 38_25, a
  block with no liquid, and checks the view sends `[]`, not `null` (#120). Naxxramas has tiles only at
  37..42 by 24..27; anywhere else on that map the tile read fails with "mpq: file not found".
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
  - Vite's watcher misses files replaced by rename, such as by `sed -i` and Wails' binding
    regeneration (`wails generate module`). Vite then serves the stale module and the page fails with
    "does not provide an export named …". Edit with the Edit tool or an in-place write, and re-save a
    missed file in place to fix it. Check what is served through the Wails proxy, `curl
    localhost:34115/<file>`: Vite's own port moves (5173, 5174…), and an old dead Vite can linger on
    5173. After a regeneration even an in-place re-save may not reach it (the watcher has lost the
    file): move `wailsjs/go/main/App.js` out of the folder and copy it back a second later, which
    Vite sees as a new file. The owner's own dev window is broken the same way until then.
  - `make build-windows` while `wails dev` runs is fine. Run it from Git Bash: from PowerShell, make
    can't start the wails recipe ("CreateProcess sh.exe … wails" not found).
  - After editing `lib/state/editor.svelte.ts` with the page open, HMR gives later modules a new
    instance of it, so a probe's `editor`/`prefs` and the tools' can differ (a probe read 0 for every
    texture weight). Reload the page and the scene before probing.
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
- Tufts only appear for textures the client's tiles use, or ones given an effect in World › Ground
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

## Autosave and recovery (#177)

Checks: `lib/io/recovery.ts` copies dirty tabs into `%LOCALAPPDATA%\Meld\recovery` (Linux
`~/.cache/Meld/recovery`), and the next start offers copies whose session is gone (`internal/recovery`,
Go tests cover the alive file going stale). In the dev page:

- Set `prefs.autosaveMinutes = 0.05` (from the loaded `editor.svelte.ts` URL), push an edit with a
  real change (`h[1000] += 7` plus `__engine.history.push({label, undo, redo})`), and within ~20 s
  `<session>_<doc>.wmap` and `.json` appear beside `<session>.alive`.
- A crash without killing `wails dev` (it may be the owner's): copy the pair under another session name
  (`20261016-000000-aaaaaa_7`, with `id` and `session` changed in the JSON) and open a new page. The
  Recover dialog lists only that one; Recover opens it dirty (height -5 at index 1000 of a fresh ocean
  map) and drops the copy.
- Traps: the page's session is the Go process's, so a page reload never offers its own copies, and two
  dev pages on one `wails dev` share the session (their doc ids can collide). `preview_click` on the
  dialog's buttons does nothing in a hidden preview tab; click through `preview_evaluate`. Delete the
  probe copies afterwards, or the owner's next start offers them.

## The desktop window itself (closing with unsaved maps, #188)

Checks: what only the native window does (its ✕, Alt+F4), in the built `build/bin/Meld.exe`. WebView2's
`--remote-debugging-port` through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` does not work (Wails sets
its own browser arguments), so drive the window from PowerShell with user32 (`SetForegroundWindow`,
`SetCursorPos`, `mouse_event`) and `SendKeys`, and look at screenshots (`Graphics.CopyFromScreen`):

- Start it with `Start-Process -PassThru`, wait for `MainWindowHandle` and ~12 s for the session to
  open, send `2` (Sculpt) and drag at the window's centre: the tab turns "Untitled *".
- `$p.CloseMainWindow()` is the ✕: with a dirty map the process stays and "Unsaved changes" shows;
  clicking Quit without saving (its screen position from the screenshot; the screenshot's pixels are
  the screen's) ends the process with no second prompt.
- Trap: this runs the owner's real app on their config; its session restore opens their tabs. Only
  edit an untitled map, and quit without saving.

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

## Names over spawns (#125)

Checks: `world/SpawnLabels.ts` puts names over the nearest drawn spawns (View › Names over creatures
and objects, `prefs.spawnNames`). In the dev page (GPU Chrome, as in "Minimap window (M)"), load
Azeroth 32_48, wait for the spawns (`e.doc.spawnLayer.spawns.length` is 347 with the server's
database up), then stand the camera at Deputy Willem:
`e.controller.setView(s.x, s.y, s.z, e.controller.yaw, 0.3, 28)` with
`s = e.doc.spawnLayer.spawns.find(x => x.name === 'Deputy Willem')`. After a second the visible
`.spawn-labels > div` read "Deputy Willem | Level 18", "Janos Hammerknuckle | <Weaponsmith> | Level 5"
and so on; those inside the abbey have none.
- A name the ground or a building (WMO) hides is left out (`Engine.sightBlocked`, through
  `ObjectLayer.wmoBlocks`): trees don't hide names. Wrap `e.spawnLabels.blocked` to count the tests;
  one costs about 0.04 ms, up to 96 a pick, four picks a second.
- Trap: a scene whose camera stands inside a building's wall (the abbey at `"target":[182,80,353]`,
  pitch 0.35, distance 45 does) hides every name, correctly; check the camera first.
- Setting `ed.prefs.spawnNames = false` from the page module hides them all.

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

## Asset browser tabs remember their place (#123)

Checks: each tab keeps its search, zone, category and scroll (`prefs.browserViews`, `wow/browserViews.ts`).
In headless Chrome (above): click the `.browser .tab` named Doodads, set the `.browser select` to a zone
and dispatch `change`, `grid-wrap.scrollTo(0, 400)`, wait 800 ms (the scroll is kept 300 ms after it
stops), go to Textures and Creatures and back: the zone, the count and the scrollTop come back; a
facet click then goes to the top. `tests/browserViews.test.ts` covers the stored shape. Trap: with
`?nosave` nothing reaches config.json, so a restart can't be checked in the page; reload the desktop
window instead.

## Model sets (the asset browser's Sets tab, #124)

Checks: making a set, adding models by a tile's right-click, showing it. In headless Chrome (above):
click the Sets tab, its `.setbar` New, type a name into `.setbar .setname` and dispatch `change`; on
Doodads dispatch a `contextmenu` MouseEvent (with `clientX`/`clientY`) on a `.browser .virtual .tile`
and click the `.menu .item` reading `Add to "<name>"`; back on Sets the tiles' titles are the set's
paths. The file form is `tests/modelSets.test.ts`; Import… and Export… open native dialogs, which the
headless page can't drive.

## Menu heights (#122)

Checks: every menu fits the window. In headless Chrome (above), click each `.menubar .title`, read
the `.menubar .dropdown`'s height and whether `scrollHeight > clientHeight`, and click it shut. An
item is about 31 px tall, so a menu of 20 items with headers is near 700 px: keep a menu under about
18 rows, or it passes a 768 px tall window (the dropdown then scrolls rather than running off). A
script that compares the `label:` strings of `MenuBar.svelte` before and after a move (`git show
HEAD:...`, sorted) proves no item was lost.

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
  (`[data-ui="OptionsBar"]`, its `scrollWidth`) instead.

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

## Dock panel (Layers) and the Inspector

Checks: what the Layers panel and the Inspector (the Properties fields, not a dock panel) show for a
map, a hovered chunk and a selection, without the mouse. In the dev page (`javascript_tool`), after the module imports from "Scripted brush strokes":

```js
e.newDocument(128, 'island', 3, 'Panels'); for (let i = 0; i < 5; i++) e.frame()
e.regenerateAutoPaint()
ed.hoverChunk = 8 * 16 + 8                     // the Layers panel shows that chunk's four slots (16 chunks a side at 128 cells)
const sel = await import(performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('selection.ts')))
e.addObjects([{ type: 'm2:World\Azeroth\Elwynn\PassiveDoodads\Trees\ElwynnTree01.m2', x: 120, z: 130, yOff: 0, rotY: 0.7, scale: 1 }])
ed.tool = 'select'; sel.selectObjects(e.objects, [...e.objects.objects.keys()]); for (let i = 0; i < 3; i++) e.frame()
```

- Then zoom the screenshot on the dock (x from about 1408 at a 1568-wide window); the Inspector
  floats over the viewport (`ui.inspector = true`).
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
grows to fill the window; Tab again brings them back; View › Hide panels is the same switch.
In the dev page: `ed.ui.hidePanels = true`, then `document.querySelector('canvas').clientHeight`
grows and `document.querySelector('[data-ui="Toolbar"]')` is null. A key event
(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`) does the
same unless an input has focus; Ctrl+Tab still cycles the map tabs.

## Help window

Checks: Help › Help… (or F1 anywhere but in an input) opens the Help dialog; its Open the manual
button and Help › Manual open docs/MANUAL.md on GitHub in the system browser (`BrowserOpenURL`; the
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

Checks: View › Detail info shows, in the viewport's top right corner, the client tile, the
chunk in it, the cell, height, slope, hole and no-tuft flags, the chunk's texture layers with their
share at the cell and effect IDs, the liquid layers covering the cell and the root models in the
chunk. In the dev page: `ed.prefs.detailInfo = true`, move the mouse over the ground, then
`ed.stats.detail` (refreshed at 2 Hz with the other stats; null off the map). The readout is
`[data-ui="DetailInfo"]`.

## Measuring performance (the overlay, #179)

Checks: where a frame's time goes, before and after a performance change. View › Performance overlay
(Ctrl+Shift+M) shows, averaged over a second, the CPU time of each `Engine.frame()` section
(`CPU_SECTIONS` in `engine/perfMeter.ts`, booked by `meter.mark` after each subsystem), the GPU time of
the shadow maps, the scene and the outlines (`engine/gpuTimer.ts`, timer queries; n/a where the browser
has none), the draw counts and the five model types drawing the most triangles. Help › Copy Performance
Report puts the same numbers and the scene line on the clipboard. Use it as the measure for perf work:
the same scene, the report before and after.

- From a probe, without the pref: `let r; __engine.measurePerf().then((x) => (r = x))`, then step
  `__engine.frame()` with `MessageChannel` waits for a bit over a second of wall time until `r` is set.
  The hidden preview throttles rAF, so a probe must drive the frames itself, and the numbers are then
  the probe's frame rate, not the window's.
- Northshire (Azeroth 32_48, 1x1, the camera over the abbey) in the dev page on 2026-10-16: about
  16 ms of CPU a frame, 9 of it three's render submit and 3.5 the shadow maps; GPU 10 ms scene,
  3.5 ms shadows; 2000 draw calls, 3.6M triangles, and stormwind.wmo alone 1.3M of them.
- The shadow maps are timed by wrapping `renderer.shadowMap.render` (`Engine.timeShadowMaps`): three
  draws them inside `renderer.render`, so without the wrap they would count as the scene.

## Loading bar (#159)

Checks: `lib/wow/loadProgress.ts` (counters, unit test `loadProgress.test.ts`) fed by `fetchBinary`
in `wow/api.ts`, drawn by `LoadingBar.svelte` (`[aria-label="Loading from the client"]`, label in
`.label`) after a batch has run 400 ms. In the dev page over CDP: start `__loadScene` without awaiting
it, sample the label every 200 ms while stepping `__engine.frame()`: it reads like "Loading 96 / 236 ·
Textures · G_BARREL01.BLP", and is gone within ~200 ms of the reads ending. One `fetchImage` while
idle must never show it. Trap: on a second run the reads come from cache and each batch ends before
400 ms, so the bar rightly never shows; use a region not opened in that browser profile yet.

## Graphics › Quality presets (#203)

Checks: `lib/state/graphicsPresets.ts` (unit test `graphicsPresets.test.ts`: each preset is found
again after it is applied, one change makes it Custom). In the dev page, `applyPreset(prefs, 'Low')`
through the page's own module URLs, step a few frames, and read `__engine.prefs` (renderScale 0.5,
shadows off, particles off) and `__engine.renderer.getPixelRatio()` (0.5). Click the menu bar's
Graphics button and read the `aria-checked="true"` items: the preset's name is checked and the header
reads Quality; after one setting changes it reads "Quality (custom)" with no preset checked. Use
`?nosave`: a preset writes ten prefs at once.

## Right-click near the selected creature (#205)

Checks: `Engine.openContextMenu` falls back to the selected spawn when the click hits nothing within
`CONTEXT_MARGIN` (24) px of its screen box (`world/screenBox.ts`, unit test `screenBox.test.ts`). In the
dev page on Northshire, hide every placed model first (the abbey fills the view and takes the clicks:
`for (const id of e.objects.objects.keys()) e.objects.hidden.add(id); e.objects.markAllDirty()`), take
creatures from `e.doc.spawnLayer.forEachDrawn`, project `boundsOf(s, box)`'s corners, `selectSpawn(s)`
and call `e.openContextMenu({ clientX, clientY, pointerType: 'mouse', pressure: 0 })` 15 px right of the
box: `ui.contextMenu.title` is the creature's; 200 px right: no menu.

## Preview window (#197)

Checks: the right-click menu's Preview (`ui.modelPreview`, `ModelPreviewWindow.svelte` over
`CreaturePreview` with a `type` and `hq`). In the dev page on Northshire, project a model's position to
the screen (`p.project(__engine.camera)`, then the canvas rect) and call
`__engine.openContextMenu({ clientX, clientY })`: the menu lists Preview after Focus. Its window is
`[role="dialog"][aria-label="Model preview"]` (not `aria-label` alone: the asset browser's small
preview has the same label). nsabbey.wmo reads "89.0 yd tall · 35,413 triangles" (the full model) once
loaded; a spawn's (`spawnType(s)`) shows it dressed. Esc closes it and the map's selection stays.
The canvas only takes its size in a rAF frame, so a hidden page shows 300x150.

- WebGL contexts (#201): each preview has its own renderer. Open and close it 24 times
  (`ui.modelPreview = { title: 'probe', type: 'helper:cube', scale: 1 }`, 250 ms, then `null`, 100 ms)
  and read `__engine.renderer.getContext().isContextLost()` after each: it must stay false. Without
  `forceContextLoss()` on close, the browser dropped the viewport's context on the 15th open (black
  viewport). Works in headless Chrome over CDP.

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
- The marker moves on the click itself (#129), not at the next 2 Hz refresh: dispatch a `click` with
  `clientX`/`clientY` on `.minimap .map`, wait one frame, and `.minimap circle`'s `cx`/`cy` have moved.
- A jump's cost (#129): wrap `__engine.frame` to time each call, `controller.focus(x, z)` across a
  3x3 block (`region: { mapName: 'Azeroth', x: 31, y: 48, size: 3 }`, cells 384, world 768), and read
  the next five frames. Run Chrome on the GPU for this (`--use-angle=d3d11 --enable-gpu
  --ignore-gpu-blocklist` instead of the swiftshader flags); swiftshader's times say nothing. Wrapping
  `renderer.shadowMap.render` splits the shadow pass out: a point light's cube map is about 40 ms
  there, the far cascade about 5 ms. Before #129 a jump that brought three new shadowed lights took
  one ~225 ms frame (steady ~50 ms headless); now one cube map is drawn a frame (~115, 95, 95 ms) and
  a light waits dark for its first map.
- A cube's draw calls (#133): model and spawn batches join a cube face only with a drawn instance in
  the light's reach and the face (`world/shadowReach.ts`). Force `lights[0].shadow.needsUpdate` on
  every other frame and compare `renderer.info.render.calls`: on the 3x3 block a cube adds about 43
  calls (about 1400 with the batches' `intersectsFrustum` set to `() => true`, the old behaviour) and
  about 1 ms. In T3 Code's preview tab (a real GPU, RTX 5080) the old cube was ~38 ms at the default
  spot. Trap: a probe that runs many heavy `frame()` calls inside one evaluate can wedge that tab for
  good; start it in a `setTimeout` that writes its result to `window`, then read it in a second call.

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
- Trap: with View › Layers › Objects off (the owner's prefs may have it so) the probe finds no room
  and `e.rooms.wmoIds` stays empty (#142); set `e.objects.group.visible = true` for the probe. Hiding
  it again must drop the room and the gate (`e.cullView.gate` null, terrain chunks drawn).
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
- What stands in a reached room (#156): `tests/roomAdmit.test.ts`. Live: Azeroth 32_49 (scene
  `{v:1,map:{region:{mapName:'Azeroth',x:32,y:49,size:1}}}`), the two-storey house with the children:
  set `prefs.spawnsThroughWalls = false` in the app's editor module, `followGround` and `collision`
  off, `e.setSceneView({ target: [67.3, 70.7, 306.3], distance: 2, yaw: 0, pitch: 0.1 })`, step
  frames. The camera is in group 3 of WMO 1333, a sealed room (`e.cullView.gate.length` 0), and
  `e.doc.spawnLayer.forEachDrawn` counts 10 (Cameron, John, Dana among them); with
  `e.roomAdmit.admits = () => false` it counts 0.
- Water and tufts (#119): with the inn placed in Durotar, outside it the region draws about 4400 tufts
  (sum of `mesh.count` over `__engine.doc.groundEffects.batches`) and 59 liquid blocks
  (`__engine.doc.liquidRenderer.blocks`, visible ones); in its sealed common room both drop to 0,
  and they come back on leaving.

## Client Lighting's ground: per-vertex light and the sheen (#111)

Checks: under Lighting › Client Lighting the terrain shader takes the light's rows in gamma space
(`clientAmbient`, `clientDiffuse`, `clientSpecular` = rows 1, 0 and 9), sums and clamps them per
vertex, and adds the sheen times the layers' `_s` mask (`paletteArray.ts` puts each `_s` twin's alpha
in the palette layer's alpha, 0 without one). In the dev page, load a region with
`"prefs":{"clientLighting":true}` in the scene, step frames, then read
`__engine.terrain.material.uniforms.clientLit.value` (1) and the masks from `__engine.terrain.palette.data`
(layer i's alpha bytes at `i * 256 * 256 * 4 + 3`, every fourth). Durotar's textures all have masks
(Black.blp none). With Client Lighting off `clientLit` is 0 and the ground is drawn as before.
- Point lights (#117): M2 lights carry `raw` (colour times intensity) in the model's effects; models
  with them include `World\Azeroth\Elwynn\PassiveDoodads\Campfire\ElwynnCampfire.m2` (raw about
  0.71, 0.2, 0), `StonePyre.m2`, `DwarvenBrazier01.m2` and the human guard towers. Torches such as
  `FreestandingTorch01.m2` have only flame anchors from their emitters, so no raw light. Under Client
  Lighting, place one and read `__engine.terrain.material.uniforms.clientPointCount` and
  `clientPointColor`. Trap: a sharp line across the ground near a light is usually two chunks'
  textures; compare with `clientPointCount` held at 0 before blaming the light sum.

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

## Creature path editing on the map (#138)

Checks: the right-click "Edit path" / "Give it a path" on a creature and the floating `PathEditBar`.
In the dev page: `e.editPath('npc/<guid>')` (a key from `e.doc.spawnLayer.spawns`, `kind/guid`) shows
`.pathbar`; a ground press through `e.selectTool.onDown(e.ctx, e.hit, ev)` / `onUp` after setting
`e.ndc` and `e.raycaster` adds a point, and the bar's buttons are plain DOM clicks
(`[...document.querySelectorAll('.pathbar button')]`). A second press near the first point picks
it instead of adding one (`ctx.paths.pickPoint`), so space test presses apart.

## World event spawns (#143)

Checks: spawns of a world event (`WorldSpawn.events`, from `game_event_creature`/`_gameobject`) are
left out of `SpawnLayer`'s batches unless View › World events shows their event (`prefs.shownEvents`).
- Go against the real database: Azeroth 32_49 (Goldshire) has spawns of events 2 (Winter Veil),
  4 (Darkmoon Faire Elwynn), 12 and 28; 32_48 of 28 and 78. A throwaway test calling
  `ReadSpawns("C:/WoW/vmangos", "C:/WoW/client/Data", "Azeroth", 32, 49, 1)` lists them.
- Frontend in the dev page: set `events` on a few of `e.doc.spawnLayer.spawns`, call the layer's
  `rebuild()`, then `setEvents([...])`, and count `batches[].all.length`: a positive event's spawn
  shows only with it, a negative one leaves with it.
- `wails dev` rebuilds the Go side when a Go file changes, so a new binding usually works in the
  dev page after a reload; if it doesn't, see the stale `wailsjs` trap above.

## Creature editor: Looks opens on the creature's display (#206)

Checks: `DisplayPicker.svelte` picks the selected display's type and model family and scrolls its
tile into view once the displays are read. In the dev page on Northshire, set
`ui.creatureEditor = { key: spawnKey(s), entry: s.entry }` for a drawn creature, click the Looks button
(retry until `.picker` exists: the record loads first), wait for
`[aria-label="Creature displays"] .virtual`, then read the two `.picker select`s and the `.active`
tile's rect against the grid's. A Northshire Guard opens on Humanoid / HumanMale, the wolves on
Beast / Wolf, each with its tile in view. The first read of the displays takes several seconds.

## Creature editor: Shop tab (npc_vendor, #145)

Checks: the Shop tab lists, adds, reorders and saves what a creature sells. Unit: `vendor_test.go`
(the SQL, slots, duplicates). Live, in the dev page: `ui.creatureEditor = { key: null, entry: 66 }`
(Tharynn Bouden, 17 items), click the Shop tab. To test a save without changing the user's world
database for good, use a creature with no shop (805, Cameron): add an item, Save shop, read it back
with `await window.go.main.App.ReadVendor(805)`, then remove it and save again (the table is back as
it was; `select count(*) from npc_vendor where entry=805` is 0).
- Trap: saving renumbers the slots 0..n in list order, so re-saving a real vendor's list as it was
  can still change its `slot` values. Test saves on a creature with no shop.
- Trap: the tab keeps its list while other tabs are shown (it stays mounted, hidden); its unsaved
  edits count in the editor's "unsaved changes" bar.
- The Quests tab (creature_questrelation / creature_involvedrelation) the same way: entry 197 (Marshal
  McBride) starts 10 and ends 4; test a save on 805 with Kobold Camp Cleanup (7) as start and end,
  read back with `ReadCreatureQuests(805)`, remove both and save again.
- Trap: after `wails generate module` the dev page can fail to mount (the body stays empty) because
  Vite keeps serving the old `wailsjs/go/main/App.js` without the new exports, even after an in-place
  rewrite. Deleting the file and copying it back (an add event for the watcher) fixed it; check with
  `curl localhost:34115/wailsjs/go/main/App.js | grep <NewBinding>`.
- The Messages tab (the greeting: gossip_menu, npc_text, broadcast_text): 931 reads gossip menu 6944,
  shared by 42 creatures ("Where would you like to fly to?", 2 options). A save adds rows to three
  tables and changes `creature_template`, so note `max(entry)` of broadcast_text and gossip_menu and
  `max(ID)` of npc_text first, save a greeting on 805, read it back with `ReadGossip(805)` (a new menu,
  shared by 1), then delete the rows above those maxima and set 805's `gossip_menu_id` and
  `npc_flags` back to 0.
- Gossip options (#158, `SaveGossipOptions`): 805 needs a greeting first (that makes its menu). Save
  two options on it and read them back; on 931 change option 1's text and save: it gets a copied menu
  (shared by 1), option 0 keeps broadcast text 12271 by ID and option 1 has its own text with ID 0.
  Clean up as above, plus `gossip_menu_option` rows of the new menus, and set 931's `gossip_menu_id`
  back to 6944 (931 has two patch rows). 931 also lists one AI line ("On aggro · yells Guards! Help
  me!") and warns that its quest option is hidden (it lacks the Quest giver flag).
- Trap: GossipDef.h's comments give later clients' npc flag values (vendor 128, flight 8192); 1.12's
  are in UnitDefines.h (vendor 4, flight 8), which the world database uses.

## Portals and area triggers (#141, #18)

Checks: World › Portals and Area Triggers… lists the open map's AreaTrigger.dbc volumes with the
server's names and teleports, draws them, and saves them to the client's patch and the world DB.
- Unit: `internal/vmangos/areatrigger_test.go` (edit, add and remove rows; IDs above the server's;
  the SQL). Against the client: `WOW_DIR=C:/WoW/client go test ./internal/vmangos/ -run TestClientAreaTriggers`
  writes the client's own table back byte for byte and finds trigger 78 (the Deadmines entrance)
  at about (-11208, 1675). The 1.12 layout (10 fields, 0x28 a row) is Benilla's `area_trigger.rs`.
- Live: the scene `{v:1,map:{region:{mapName:'Azeroth',x:28,y:53,size:1}}}`, camera on
  (-11208, 1675) in server coordinates (editor x = 32·533.33 − 1675 − 28·533.33, z = 32·533.33 +
  11208 − 53·533.33), then `ui.dialog = 'portals'`: "Eastern Kingdoms: 133 triggers", first
  "Deadmines - Entrance → 78", teleport to Deadmines (36) at level 10, and
  `__engine.triggerLayer.group` visible with the picked sphere's 192 points.
- Trap: a live Save writes Meld's patch-3.MPQ and closes the game and servers around it (as Zones
  does); don't run it in a check unless the owner wants that. The Go tests cover the write.

## Creatures workspace and the new-creature guide (#132)

Checks: World › Creatures… (`ui.creatures = true`): the search opens a creature in the editor, and
the guide's four steps make a working `creature_template` row. Unit: `factions_test.go` (reactions;
with `WOW_DIR`, the client's FactionTemplate.dbc: 14 hostile to both, 35 friendly to both, 12
Stormwind Alliance-only), `TestParseClassLevelStats`.
- Live: name it, level 10 to 12, rank Elite (multipliers 3, 2, 1), side Alliance (Stormwind, 11),
  click a display tile, then step 4 shows level 10 at 594 health, 30 damage, 492 armour (warrior:
  198, 15.2 and 492 from `creature_classlevelstats`). Make creature writes one row; check it with
  `ReadCreature(entry)` and delete it afterwards (`DELETE FROM creature_template WHERE entry = …`).
- Trap: held items go through `EquipmentFor`, which may add a `creature_equip_template` row; leave
  the hands empty in a check, or delete that row too.

## Name colours by reaction (#134)

Checks: a creature's name over its head is red, yellow or green by how its faction treats the side
picked under View (Alliance or Horde). Go: `TestReaction` (the two-way rule: a player's template is
hostile to the monster group, so a kobold whose own template attacks no one is still hostile).
Live on Northshire (Azeroth 32_48), `__engine.spawnLabels.nameColor(spawn)` for spawns found by name
in `doc.spawnLayer.spawns`: Alliance: Northshire Guard and Deputy Willem green, Kobold Vermin red,
Young Wolf and Rabbit yellow; Horde: the guard and Willem red too.

## Water layers (the Water tool's All layers / Layer, #14)

Checks: with All layers off, the Water tool draws only layer number N of each chunk (as Noggit Red's
Current layer does); other tools always draw every layer. In the dev page, import `editor` by the
page's own URL (see above), put two layers in chunk 5 with `__engine.doc.liquids.set(5, [a, b])`
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

## Minimap tiles for the client (B-129, #17)

Checks: Import/Export › Write Minimap Tiles to the Client draws each tile from above and writes it
into the client's minimap (BLP plus md5translate.trs in Meld's patch).
- Go: `TestEncodeMinimapBLPReadsBack`; with `WOW_DIR=C:/WoW/client`, `TestClientMinimapReencoded`
  (Northshire's own tile, decoded and written again: the header equals the client's byte for byte,
  33940 bytes, BLP2 DXT1 one mip) and `TestMinimapFilesSetTheTiles` (index rows set, every other row
  kept, identical tiles share one file, and a patch written to a temp folder reads back).
- Render: on Northshire, `__engine.renderMinimapTile(0, 0, 'buildings')` gives 256x256 RGBA, row 0
  north. Compare with the client's tile through `/wow/texture?path=textures\Minimap\ea283abc0bf9637c3fad5e840a65b38b.blp`
  (Azeroth 32_48; the reply is "RGBA", width, height, then pixels from byte 12): the abbey and the
  roads land in the same place, and the mean brightness is close (89 against 84). To look at both,
  draw them on a canvas and save it with `go.main.App.SaveThumbnail(key, pngBase64)`, then read the
  newest PNG under `%LOCALAPPDATA%\Meld\thumbs`.
- The client's tiles show the buildings (WMOs) but not the trees, hence the default; their rock is
  darker and more shaded than the editor's top-down light.
- Not run against the real client in the loop: the write replaces that map's minimap tiles in the
  owner's game.
- Traps: a render target only gets three's tone mapping and sRGB output when it is the screen or an
  XR target, so the shot's target is flagged `isXRRenderTarget`; and with `colorSpace` sRGB three
  stores it as an sRGB texture, which encodes a second time (a pale picture), so its
  `internalFormat` is `'RGBA8'`.

## Server map extraction for one map (Publish, #174)
Checks: Publish runs the VMaNGOS extractors on the published map only: MapExtractor with `-m <id>`
(and `-t x_y,...` for the tiles the export wrote, when the server was current before it), VMapExtractor
with `-m <id>`, then VMapAssembler, which rebuilds only that map's `.vmtree`/`.vmtile` files.
- Go: `TestPublishServerExtractsOnlyTheMap` (the arguments, the map's old vmtree/vmtile and tile files
  removed, other maps' kept), `TestPublishServerExtractsEveryMapWithoutWholeVmaps` (no
  `vmaps\temp_gameobject_models` means vmaps were never built whole, so every map is extracted) and
  `TestChangedTiles`.
- Extractors by hand, without touching the server: run them in an empty scratch folder (VMapExtractor
  writes `.\Buildings` in the working folder and refuses a folder that already holds `Buildings\dir_bin`):
  `MapExtractor.exe -i C:\WoW\client -o . -e 1 -m 0 -t 32_48,33_48,32_49,33_49 --silent`, then
  `VMapExtractor.exe -l -d C:\WoW\client\Data -m 0 --silent`, then `VMapAssembler.exe Buildings vmaps --silent`.
  Compare with a full run in another folder (no `-m`): the `maps` files, `000.vmtree`, every
  `000_*.vmtile` and every model file came out byte for byte the same on 2026-10-16.
- Timings then (Azeroth 2x2 around Northshire against every map): maps 0 s against 14 s, vmap extract
  19 s against 51 s, assemble 9 s against 20 s.
- The extractors' sources are on vmangos's `local` branch (`contrib/extractor/System.cpp`,
  `contrib/vmap_extractor/vmapextract/vmapexport.cpp`). Rebuild them with
  `cmake -S . -B build/extractors -G "Visual Studio 17 2022" -A x64 -DBUILD_EXTRACTORS=ON -DUSE_SCRIPTS=OFF -DBUILD_FOR_HOST_CPU=OFF -DENABLE_CPPTRACE=OFF`
  and `cmake --build build/extractors --config Release --target MapExtractor VMapExtractor`; the exes land
  in `vmangos\bin\Release`, to be copied into `run\Extractors`. The old `vmangos\build` cache points at
  the folder's former place (`C:\Servers\Software\vmangos`), so it can't be reused.
- Trap: an old extractor without `-m` stops at its usage text (exit 1), so Publish then fails with
  "map extraction".

## Losing and restoring the viewport's WebGL context (#209)
Checks: the viewport comes back after the browser drops its WebGL context, and nothing is drawn or
cached from a lost one (thumbnails wait, Write Minimap Tiles refuses).
- In the dev page (headless Chrome over CDP works, see above): `const x = __engine.renderer.getContext().getExtension('WEBGL_lose_context'); x.loseContext()`,
  wait ~500 ms: `__engine.contextLost` is true, the status bar says the graphics card dropped the
  viewport, and `__engine.renderMinimapTile(0, 0, 'none', 16)` throws. Then `x.restoreContext()`, wait
  ~1.5 s and step `__engine.frame()` a few times: the status says the viewport is back, the shot looks
  as before, and `gl.getError()` stays 0 after each frame. Compare the mean of a small
  `renderMinimapTile` before and after (78.1 against 78.5 on a Stranglethorn region, 2026-10-16).
- Trap: three rebuilds its state and re-uploads geometry and textures by itself on restore, but a
  shadow map exists on the new context only once redrawn. A point light's cube map that has none makes
  every draw sampling `pointShadowMap` fail with GL_INVALID_OPERATION (1282): the ground turns flat and
  the models vanish. `onContextRestored` sets `shadow.needsUpdate` on every casting light for that.
  Finding such an error: wrap the context's prototype methods, call `getError` after each and log the
  dozen calls before the first error; then list the program's active uniforms with their raw types
  (`0x8dc5` is `samplerCubeShadow`).

## WMO culling by group (#198)
Checks: a big WMO drawn once (Stormwind) draws only its groups in the camera's view in the scene pass,
and looks the same as drawn whole.
- Unit: `frontend/tests/wmoGroupCull.test.ts` (runs by group, the view half, the camera check, the
  group's range put back after the draw).
- Dev page, Northshire scene (Azeroth 32_48, 1x1). Stormwind loads late on SwiftShader: poll the live
  `__engine.objects.batches` (not one captured before `__loadScene` swapped the document) until the
  entry whose key matches `stormwind.wmo` has a `cull` (the batch exists first with a placeholder).
  The class is `found.cull.constructor`; set its `enabled` false to draw every WMO whole. Importing
  `/src/lib/world/wmoGroupCull.ts` from a probe gives another module instance after an edit
  (Vite's `?t=` URLs), so its switch does nothing.
- Numbers on 2026-10-17, the scene's camera over the abbey, `measurePerf()`: the frame 2.07M triangles
  with the cull, 3.43M without; stormwind.wmo 31k against 1.33M in "Most triangles" (that list counts
  the scene pass, through the twin's `userData.drawnIndexCount`). Its group boxes put 77k of its
  triangles in the view and 1.22M in the shadow cascades, which keep drawing it whole.
- Same picture: `setSceneView({ target: [-300, 120, 250], yaw: 4.71, pitch: 0.25, distance: 500, hour: 13 })`
  draws 55% of the city; with `enabled` off and on the shots differ in 0.14% of pixels (edges, swaying
  trees).

## Compressed client textures (DXT, #178)
Checks: model, liquid and particle textures go to the GPU as the BLP's own DXT blocks and mips where
the renderer has `WEBGL_compressed_texture_s3tc` and `..._s3tc_srgb`, and look as the RGBA path did.
- Go: `TestDXTOf*` in `internal/wow/blpdxt_test.go`; with `WOW_DIR=C:/WoW/client`,
  `TestClientTexturesAsDXT` samples the client's world, tileset, creature and XTextures BLPs: 965 of
  1008 go as DXT (the rest are palettized or lack a full mip chain), 46 MB of blocks against 258 MB of
  RGBA with mips, and every one's first level decodes to DecodeBLP's pixels byte for byte.
- Endpoint: `curl "localhost:34115/wow/texture?path=tileset%5Celwynn%5Celwynngrassbase.blp&fmt=dxt"`
  starts `DXT1` and is 43756 bytes against the RGBA reply's 262156.
- Frontend: `frontend/tests/textureFrom.test.ts`. In the dev page, `?nosave&nodxt` keeps every texture
  RGBA for comparison. Northshire on 2026-10-17 (headless Chrome, SwiftShader has both extensions):
  618 model textures, 20.9 MB compressed (564 of them) against 123.4 MB all RGBA; the two shots differ
  in 0.47% of pixels by more than 4%, in fine detail where the BLP's own mips replace the GPU's.
  Sum a material's `map`: `mipmaps[i].data.length` for a `CompressedTexture`, w·h·4·4/3 for RGBA.
- The terrain's tileset array (`terrain/paletteArray.ts`) and texture previews still read RGBA pixels
  on the CPU (they resample), so they keep using `fetchImage`.

## Shop tab: item icons and tooltips (#202)
Checks: every item in the creature editor's Shop tab (the shop's list, the search results, the shared
vendor list) has its inventory icon, and hovering one shows the game-style tooltip.
- Go: `TestParseVendorItems`, `TestParseItemRow`; with `WOW_DIR=C:/WoW/client`,
  `TestItemIconsFromClient` (display 8690, the Battleworn Hammer, is `INV_Hammer_15`).
- Frontend: `frontend/tests/itemTooltip.test.ts` (lines for a weapon, armour with stats, a bag; money).
- Dev page: `const ed = await import(<the editor.svelte.ts resource URL>); ed.ui.creatureEditor = { key: null, entry: 152 }`
  (Brother Danil, Northshire's general supplies), click the button whose text is `Shop`, wait for
  `td.item` (6 rows, 6 `img`). Hover: dispatch `new PointerEvent('pointerenter', { clientX, clientY })`
  on a `td.item` or a `.results button`, then read `.tip`'s text. Searching: set `input.search`'s value
  and dispatch `input` (bubbling); 100 results for "hammer", each with an icon.
- Effects show as "Use: spell 433": the spell's own text needs Spell.dbc (#217).

## Preview window: particles, ribbons and texture animation (#200)
Checks: the preview window and the creature editor's preview (`CreaturePreview.svelte`) run the model's
particles and ribbons in a `ParticleLayer` of their own (`new ParticleLayer(new PreviewSet())`, so the
main layer never draws that model), and its texture and colour animation (run for every material by
the Engine's loop).
- Dev page: `ed.prefs.particles = true; ed.prefs.animations = true` (the owner's config has both off,
  and `?nosave` keeps it so), then `ed.ui.modelPreview = { title: 'probe', type: 'm2:World\\Generic\\Human\\Passive Doodads\\Braziers\\StormwindBrazier01.m2', scale: 1 }`
  and wait ~12 s: flames and sparks over the coals; `ed.prefs.particles = false` takes them away.
  `ElwynnMediumWaterfall01.m2` shot twice a second apart differs in about 2% of pixels (the scrolling
  texture), with its spray at the top. Write the step file with the Write tool (backslashes).
- Trap: the preview's canvas is transparent (`alpha: true`). three's AdditiveBlending adds the
  particle's alpha too, which composited the spark texture's black as opaque squares there; additive
  batches now keep the target's alpha (CustomBlending, same colour factors).

## World map of a zone (World › World Map, #181)
Checks: a zone's map for the game's World Map (M): the WorldMapArea.dbc row and the twelve 256x256
tiles of the 1002x668 picture at `Interface\WorldMap\<Name>\<Name>1..12.blp`.
- Go: `TestSetWorldMapRowAddsAndReplaces`, `TestSetWorldMapRowRefusesBadRows`; with
  `WOW_DIR=C:/WoW/client`, `TestWorldMapFromClient` reads Elwynn (row 30, map 0, area 12, Left 1535.4,
  Right -1935.4, Top -7939.6, Bottom -10254.2; its art DXT1 256x256), writes it again through
  `WorldMapFiles` (tiles within 0.04 a channel of the picture) and finds the row unchanged.
- Frontend: `frontend/tests/worldMap.test.ts` (Elwynn's extent on its tiles 29.1..35.6 by 46.9..51.2
  and back through a region's first tile; zone bounds and the 3:2 fit; pixel boxes; the look; feather).
- Dev page, Northshire (Azeroth 32_48): wait for the models, then `ed.ui.dialog = 'worldMap'`. The zone
  list is Elwynn Forest (12), "3471 × 2315 yd · the client's (row 30)", the canvas shows the client's
  base art (mostly parchment: the explored areas are WorldMapOverlay pieces the game draws over it).
  Click the dialog's `Generate` button: the open tile is drawn just north of the map's middle, where
  Northshire Valley is, feathered into the art. Write to Client is not run from the loop (it writes
  the owner's patch); `TestWorldMapFromClient` covers the files it writes.
- In the game: not checked by the loop. A zone of a new map needs its AreaTable row (World › Zones)
  painted on its chunks; whether 1.12's World Map opens a zone of a map that isn't a continent
  (WorldMapContinent.dbc lists only Kalimdor and Azeroth) is for the owner to check.
