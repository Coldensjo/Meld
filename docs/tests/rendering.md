# Rendering

Shaders, lighting, particles, culling, textures and how things look. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Particles (M2 emitters, B-182)

Checks: `world/particles.ts` and `ParticleLayer.ts` against the client's models.
- `go test ./internal/wow -run Emitter` (and `TestClientEmitters` with `WOW_DIR`: Elwynn's tall
  waterfall has one lit alpha emitter with flags 0x2, BloodSpurt.m2 four, FlameStrike_Area.m2 four
  spline emitters, `FreestandingTorch01.m2` two additive flames on a 4x4 flipbook) and
  `tests/particles.test.ts` (kernels, ramps, integrator, quad writer, after Benilla's own tests).
- In the app (the CDP route in `docs/TESTS.md`), place `World\Generic\PassiveDoodads\Lights\FreestandingTorch01.m2`
  and `World\Azeroth\Elwynn\PassiveDoodads\Waterfall\ElwynnTallWaterfall01.m2` (yOff -70: its emitter
  is 94 yd up) on cleared ground. `__engine.particles.live` maps `<objectId>:<emitter>` to a pool
  (`pool.count` live particles); `__engine.particles.batches` holds the draws (`floats / 36` quads).
  The torch burns with the flipbook flame and the waterfall throws a lit white spray (about 100
  particles).
- Trap: an emitter out of view or beyond `RANGE` (300 yd) is frozen, so a pool with `acc` 0 and no
  particles is usually just off screen.
- The far-emitter pre-test (#330): `bun run probe particles-reach` checks that skipping an emitter on
  its object's origin (beyond `RANGE` plus `reach`) runs the same pools and trails as the exact test
  alone (every `reach` set to `Infinity`), on the benchmark scene from four views;
  `PROBE_MAP=lights` or `PROBE_MAP=everything PROBE_SCALE=4 PROBE_TIMEOUT=900` runs it on a benchmark
  map. On the 4x everything map 665 of 5919 emitters pass the pre-test and 453 stand within range.
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
river water up to depth byte 79: with the CDP route (`docs/TESTS.md`) load the region, then
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
(`liquidsToAdt` gives type 4) while the `.wmap` keeps 21, and its header's `liquidKinds` keeps
`{"21": "slime"}`, so the layer still draws and exports as slime when the file is opened before the
table is read or against a client without row 21 (#540; `tests/mapData.test.ts`, "a liquid layer's
kind", with row 30 as the missing one). Probe `liquid-kinds` saves a layer of row 30 through Go
(`SaveSceneMap`, `LoadMap`) and checks the header, the reopened layer and its export as magma; it
needs `make dev` rebuilt after a change to `mapfile.Header`, or Go drops the field.

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
- Probe `selection-visuals` (#551) checks the colours and the warn boxes without a screenshot: on
  objects-mixed it lifts the 16 models nearest the middle 30 yd, selects them, and compares each
  `outlineTargets[i].touching` and a single selection's `outline.shared.boxMin`/`boxMax` with a scan
  of every object, still, after a drag, a move away, a hidden neighbour and a prop attached elsewhere
  at the model's spot (the old scan compared an attached prop's parent-relative `x` with world
  ones and missed it). It prints `updateSelectionVisuals`' ms a frame: still with 16 selected,
  dragging one of them, and one selected (2.75, 2.94 and 0.55 ms before #551 on SwiftShader; 0.02,
  0.66 and 0.02 after). The warn boxes come in the order the cells give them, so it matches them
  as a set.
- Probe `outline-heights` (#567) checks the red underground marks against the terrain's own height
  texture, which the outline shares: on a flat 1024 map a 4 yd helper cube is selected under the
  Select tool and a Sculpt stroke (driven through `P.stroke(e.tools.sculpt, ...)`, since the outline
  is built only under Select and Place) raises the ground along its edge; the outline's mask
  (`outline.maskRT`, read back) gains red pixels, and the float texels uploaded during the stroke
  (counted by wrapping `texImage2D`/`texSubImage2D`) stay far below one heightmap (740 against
  1025²; before #567 the outline's own copy uploaded the whole 4 MB every frame, 130 MB a stroke).
  Trap: raise the ground under the cube's middle and the cube re-snaps up with it, so nothing turns red.

## Hover outline (#641)

Checks: `Engine.updateHoverVisuals` and the second `SelectionOutline` it drives. Probe
`hover-outline` (about 10 s): on a flat map with two helper cubes under the Select tool, the
pointer over a cube sets `e.hovered.id` and the outline's `active`, off the cubes both clear, a
selected cube gets none while the other still does, a still pointer and camera make no
`ObjectLayer.pickHit` call in 10 frames, and View › Hover outline off (`prefs.hoverOutline`) or the
Sculpt tool draws nothing. `--shot` shows the faint white stroke round the hovered cube.
- Trap: `prefs` reach the engine through `App.svelte`'s effect, a snapshot, not the object: after
  setting a pref in a probe, step a frame before reading what the engine does with it.

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

## Graphics › Quality presets (#203)

Checks: `lib/state/graphicsPresets.ts` (unit test `graphicsPresets.test.ts`: each preset is found
again after it is applied, one change makes it Custom). In the dev page, `applyPreset(prefs, 'Low')`
through the page's own module URLs, step a few frames, and read `__engine.prefs` (renderScale 0.5,
shadows off, particles off) and `__engine.renderer.getPixelRatio()` (0.5). Click the menu bar's
Graphics button and read the `aria-checked="true"` items: the preset's name is checked and the header
reads Quality; after one setting changes it reads "Quality (custom)" with no preset checked. Use
`?nosave`: a preset writes ten prefs at once.

## The camera's WMO room (down-ray probe, #8)

Checks: which group of a placed WMO the camera is in (`world/wmoRoom.ts`, Benilla's `seed.rs`), shown
as "Camera in" in Detail info. Unit cases are Benilla's own (`tests/wmoRoom.test.ts`); the client data
is `TestClientWMONav` (WOW_DIR, the Goldshire inn: 12 groups, 10 portals, 2 fogs).
`tests/wmoRooms.test.ts` (#435) runs `WmoRooms.update` and the gate as `Engine.updateRoomGate`
composes them (flood, `roomGate.ts`'s mask, `RoomAdmit`) on a fake object layer (`RoomLayer`, with
the asset and room-data loaders handed to the constructor): a hall of three rooms and a sealed one.
It checks the room inside a room's box and its neighbours through the doorways in view, the
camera's room's spawns with no doorway in view (#156), `over` above a room's box or the building
(#300), the outside flood and the WMO-only exemption (#271), and that a hidden building or a hidden
Objects layer gates nothing (#142). The gate's uniforms are read by running a patched material's
`onBeforeCompile` on a stub shader. Live, in the dev
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
in the palette layer's alpha, 0 without one; a texture without a twin in `/wow/list?kind=sheen` is not asked for, #336, `bun run probe console-clean`). In the dev page, load a region with
`"prefs":{"clientLighting":true}` in the scene, step frames, then read
`__engine.terrain.material.uniforms.clientLit.value` (1) and the masks from `__engine.terrain.palette.levels[0]`
(level 0 of every layer, #225; with `?nodxt`, RGBA: layer i's alpha bytes at `i * 256 * 256 * 4 + 3`, every fourth; else DXT3, #216:
layer i from `i * 65536`, the first 8 bytes of each 16-byte block its 16 alphas, 4 bits each). Durotar's textures all have masks
(Black.blp none). With Client Lighting off `clientLit` is 0 and the ground is drawn as before.
- Point lights (#117): M2 lights carry `raw` (colour times intensity) in the model's effects; models
  with them include `World\Azeroth\Elwynn\PassiveDoodads\Campfire\ElwynnCampfire.m2` (raw about
  0.71, 0.2, 0), `StonePyre.m2`, `DwarvenBrazier01.m2` and the human guard towers. Torches such as
  `FreestandingTorch01.m2` have only flame anchors from their emitters, so no raw light. Under Client
  Lighting, place one and read `__engine.terrain.material.uniforms.clientPointCount` and
  `clientPointColor`. Trap: a sharp line across the ground near a light is usually two chunks'
  textures; compare with `clientPointCount` held at 0 before blaming the light sum.

## Losing and restoring the viewport's WebGL context (#209)
Checks: the viewport comes back after the browser drops its WebGL context, and nothing is drawn or
cached from a lost one (thumbnails wait, Write Minimap Tiles refuses).
- In the dev page (headless Chrome over CDP works, `docs/TESTS.md`): `const x = __engine.renderer.getContext().getExtension('WEBGL_lose_context'); x.loseContext()`,
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

## Losing and restoring the previews' WebGL contexts (#213)
Checks: the asset browser's preview (`AssetPreview.svelte`) and the Preview window
(`CreaturePreview.svelte`, which the creature and object editors use too) draw their model again after
their own context is lost and restored, with no WebGL errors, and a closed Preview's released context
(#201) stays lost.
- Probe: `bun run probe preview-context` (about 2.5 minutes: the previews' own rAF is throttled in the
  headless page, so it waits for their draws rather than stepping frames). It hovers a palette tile
  and the preview itself (a still preview draws nothing since #589, so the pointer over it keeps it
  spinning), then opens `ui.modelPreview` on a model of the scene with particles (the Northshire waterfall).
- How: `canvas.getContext('webgl2')` on the preview's canvas returns its live context; wrap its
  `drawElements` to count draws, call `getError` after each and `readPixels` in a microtask after the
  first (the same task, before the buffer is cleared) for the drawn share. Then
  `getExtension('WEBGL_lose_context')`'s `loseContext()` and `restoreContext()`.
- Trap: three restores these by itself (it rebuilds its state and re-uploads geometry and textures);
  the previews only skip their frame while lost. The probe passed before that change too. `getError`
  returns CONTEXT_LOST_WEBGL (0x9242) once after a loss, which is not a draw's error: read it off
  before counting.

## WMO culling by group (#198, #215)
Checks: a big WMO drawn once (Stormwind) draws only its groups in the camera's view or the near shadow
cascade in the scene pass and the near cascade's shadow pass, and looks the same as drawn whole.
- Probe: `bun run probe wmo-cull` (the frame's and the near shadow cascade's triangles, the cull on and off).
  Since #325 a batch joins the near cascade only with a drawn instance in its box, and at the
  benchmark view the city is outside it, so there the near map draws the same with the cull on and
  off (173,167 triangles on 2026-10-20). The probe compares the near cascade's triangles over the
  city instead (the view below): 940,398 culled against 1,331,832 whole.
- Trap (#392): count the near map on a frame that redraws it alone. The shadow maps are kept between
  frames, and the far map, which draws the city whole either way, is redrawn whenever the scene
  changes, which goes on after `P.settle` (the spawn layer's version still ticks as spawns arrive). A
  read of "the last frame's shadow triangles" then caught a far redraw on one side only (1.9M culled
  against 173k whole). The probe sets `env.key.shadow.needsUpdate` and skips any frame where
  `env.far.shadow.needsUpdate` was also set.
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
  the scene pass, through the twin's `userData.drawnIndexCount`). Its group boxes put 31k of its
  triangles in the view, 2k in the near cascade and 1.2M in the far one (redrawn only when its fit
  changes). Since #215 the near cascade draws the culled half too: the frame 697k triangles, the shadow
  maps 344k of them (1.70M with the cull off). Count the shadow maps' triangles by wrapping
  `__engine.renderer.shadowMap.render` and reading `renderer.info.render.triangles` around it.
- Trap: "Most triangles by model" (`measurePerf().models`) keeps only the top five models, so the
  culled city falls off it when few of its groups are in view and a lookup there reads 0. On
  2026-10-17 (#252) the probe's view held none of the city's groups (not the 31k above; the
  viewport's shape followed the owner's layout prefs, which the probe page has ignored since #253:
  then, with the flying camera on the ground, the frame was 743,861 triangles with the cull; since #256 the scene orbits again: 2,574,272 with the cull, 5.30M without, stormwind.wmo 31,139 in view) and the near cascade 2,336 triangles. The probe counts the batch's own
  mesh (`meshTriangles` from `engine/perfMeter.ts`) instead.
- Same picture: `setSceneView({ target: [-300, 120, 250], yaw: 4.71, pitch: 0.25, distance: 500, hour: 13 })`
  draws 55% of the city; with `enabled` off and on the shots differ in 0.14% of pixels (edges, swaying
  trees). There the near cascade holds 786k of the city's triangles and the view 767k (1.0M in the
  culled half); on 2026-10-17 (#215) the canvas read back with `toDataURL` right after `frame()`
  differed in no pixel with the cull on and off.

## A model's bounds tree, LOD and group cull built in the model workers (#507)
Checks: a loaded model's bounds tree, LOD index and WMO group cull twin are built off the main thread
(`models/modelBuild.ts`, `modelWorker.ts`), so a big model's arrival no longer stalls the page, and
what the worker built is what the main thread would have.
- Probe: `bun run probe model-worker`. It loads Stormwind's WMO (1.33M triangles) through `loadAsset`
  with a `MessageChannel` ticker running and reports the longest gap between ticks; then it builds
  the twin (`cullData`) and the LOD (`lodIndex`) on the main thread from the index the worker's tree
  reordered and compares them, and casts a ray through the tree. On 2026-10-21: the longest stall
  about 50 ms with the workers, 1,177 ms before (bounds tree 340 ms, LOD 840 ms, twin 50 ms, all in
  the frame the model arrived in).
- Trap: a stall meter must let one more task run after `await loadAsset(...)` before it reads its
  maximum. The load's last stretch runs in the same task as the promise's resolution, so reading at
  once misses that gap (it read 13 ms for the old 1.2 s stall).
- Trap: `typedArray.from(other)` of a big typed array iterates and cost about 100 ms for Stormwind's
  copies; `slice()` copies at memcpy speed.
- The built app (Windows, 2026-10-21): the worker script `/assets/modelWorker-*.js` is fetched
  through the Wails asset server (WebView2 sends a dedicated worker's requests through
  WebResourceRequested) and its results come back. Seen by logging the middleware's paths in a
  throwaway build of `main.go`. Not yet checked on Linux (WebKitGTK's `wails://` scheme); if a worker
  can't start there, `fail` logs a console warning and builds on the main thread as before.
- Unit: `frontend/tests/modelBuild.test.ts` (Bun has no `window`, so it runs the main-thread path of
  the same build and compares it with `buildBoundsTree`, `buildLod` and `WmoGroupCull.of`).

## Far WMOs' LODs merged by class, textures in a layer array (#691)
Checks: a far WMO's LOD draws a few groups (one a class: lit or unlit, blend, sides) instead of one
a texture, its textures drawn small into one shared array (`models/farLayers.ts`), and looks as the
full model does.
- Probe: `bun run probe far-wmo-lod` (about 90 s). Opens Elwynn's world view, counts the far WMO LODs
  drawn and their groups, checks every layer taken was drawn, then shoots Goldshire's two-story
  house close up with every instance forced to its LOD (`cullView.lodPx` overridden) and the
  doodads hidden (`layers.set(7)`): the LOD's picture is far closer to the full house's than the
  picture with the LOD's class materials hidden.
- Measured on 2026-10-26 (the probe's view, Elwynn 31-33 x 48-50): 4,070 render calls to 1,990, CPU
  frame 21 ms to 16 ms; the 70 far WMO LODs drawn had 2,407 groups, 334 merged.
- Trap: forcing the LOD by lowering `LOD_PX` doesn't work at run time (a constant the Engine writes
  into the cull view each frame); define a getter on `e.cullView.lodPx` and delete it after.
- Trap: the merged LOD has vertex buffers of its own, so the `model-worker` probe compares it with
  `farMerge` of the main-thread LOD (`userData.farClasses`), not with `lodIndex`'s index.
- Unit: `frontend/tests/farLayers.test.ts` (the plan's classes and tints, the merge's groups, runs and
  copied vertices).

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
- Texture previews still read RGBA pixels on the CPU, so they keep using `fetchImage`. The terrain's
  tileset array went DXT3 in #216 (next entry).

## The terrain's tileset array as DXT3 (#216)
Checks: where `compressedTexturesOn()`, `terrain/paletteArray.ts` builds the palette as a DXT3
`CompressedArrayTexture` (64 KB a layer against RGBA's 256 KB) from the BLPs' own blocks
(`paletteBlocks.ts`), and the ground looks as with the RGBA array, sheen included.
- Unit: `frontend/tests/paletteBlocks.test.ts`, against a reference decoder in the test: a 256²
  four-colour DXT1 is copied block for block; 128², 64x32 and 8² DXT1 and 128² DXT3 resample block by
  block to exactly the nearest resample of their pixels; DXT3 blocks with colour0 <= colour1 are
  flipped so DXT1 and DXT3 decodes agree; three-colour DXT1 blocks stay exact with only the ends used;
  the `_s` alpha resamples exactly.
- Probe: `bun run probe terrain-dxt` (about 100 s) loads the benchmark scene, builds an RGBA
  `PaletteArray` of the same entries beside it, and draws the ground alone with each, under the
  editor's lighting and under Client Lighting (the sheen): on 2026-10-17, 0.03% of pixels differed by
  more than 4% (mean max-channel difference 0.67 of 255), 0.5 MB against 2 MB for the 8 layers. The
  same check on Stranglethorn (`Azeroth` 32_57): 14 layers, 0% over 4%. Since the array has mips
  (#225, next entry) the probe makes this comparison with both arrays at level 0 (`LinearFilter`,
  re-uploaded), as `level0Over4pc`.
- Over the whole client, a node script with the dev server (not kept): of 621 tilesets, 616 are
  power-of-two DXT up to 256² and go by blocks; against the reference decode of their blocks the
  layers differ by 0.011 of 255 on average, worst `Tileset\Hyjal\AlphaHyjalGrassLeaf.blp` (1.7 mean;
  its three-colour blocks use black). 413 have a DXT3 256² `_s` twin, whose alpha goes over exactly.
  About 0.7 ms a layer to build. The other 5 (RGBA BLPs) are encoded from their pixels.
- Trap: `?nodxt` is how to see the RGBA array in the dev page; a probe can build one with
  `new PaletteArray(() => {}, false)` instead, as `terrain-dxt` does, to compare in one page.
- Trap: the bench probe's `frameMs` on SwiftShader averages one or two frame intervals and jumped
  between 14 and 72 ms from run to run with no code change; compare `cpuMs` and the counts. Since
  #226 the probe prints it as null on so few frames.

## The tileset array's mips (#225)
Checks: the palette array is mipmapped (trilinear, anisotropy as the models' textures), so distant
ground doesn't shimmer. The DXT3 array carries every level, 256² to 1x1 (about 85 KB a layer), from
the BLPs' own mips: level k from the source level whose larger side is 256 >> k, a smaller tileset's
level 0 filling the larger levels; encoded layers (RGBA BLPs, colour entries) get a box filter. The
RGBA array (`?nodxt`) has the GPU make its mips (`generateMipmaps`). The shader samples the palette
with `textureGrad`, the derivatives taken at the top of `main`, since `blend` and the rock read it
inside branches.
- Unit: `frontend/tests/paletteBlocks.test.ts`: a reply's levels are read (and one cut short refused);
  a 256² chain's levels are copied block for block, colour and `_s` alpha; 128², 64x32 and 128x256
  chains give each level exactly the nearest resample of the right source level (levels below 4x4
  one block); an encoded layer's levels are the box mean; a colour layer is one block at every level.
- Probe: `bun run probe terrain-dxt` also checks there are 9 levels, that the mipped DXT3 and RGBA draws
  stay close (`mippedMeanDiff` under 8), and that the far half of the view is calmer with mips than at
  level 0 (`farBusy*`, the mean difference between neighbouring pixels). On 2026-10-17: level 0 0.03%
  over 4%; mipped 10.7% over 4%, mean 5.0; far ground 4.7 mipped against 16.4 at level 0; 0.7 MB
  against 2.7 MB (the RGBA array's GPU mips included) for 8 layers.
- Trap: the mipped draws differ more than level 0 does because the mips differ: the DXT3 array has the
  BLPs' own (which the client draws), the RGBA one the GPU's box filter, which averages sRGB textures
  in linear light (its draw about 1.4 of 255 brighter). Don't chase that as a bug.
- Seeing it: a low view over open ground, e.g. the benchmark scene with
  `"target":[300,20,300],"yaw":2.4,"pitch":0.18,"distance":40`; set the palette texture's
  `minFilter = 1006` (`LinearFilter`) and `needsUpdate = true` to see the old shimmer.

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

## Weather preview and zone weather (#185); splashes, wind and doorways (#244); roofs (#315)

Checks: Lighting › Weather Preview (`world/WeatherLayer.ts`, `wow/weather.ts`, the storm blend in
`wow/clientLight.ts`) and the Zones dialog's Weather section (`vmangos/weather.go`). Unit tests:
`tests/weather.test.ts` (grades, storm blend, drop and mist counts), `tests/clientLight.test.ts` (the
storm params over the clear ones), `go test ./internal/vmangos/ -run 'Weather|ClientMapLights'`
(game_weather read and written; with `WOW_DIR` Azeroth's storm params are read).
- Probe: `bun run probe weather` (about 40 s) on a hills map, Client Lighting on, the camera low: each
  weather's part draws once its texture loads, the storm light closes the fog (Azeroth's global storm
  fog starts at -139 yd) and the drops change the picture over the storm light alone; clear hides the
  group and the fog goes back; then the Zones dialog shows Elwynn Forest's 12 sliders with the stock
  database's 20% spring and 15% summer rain, and a slider moved makes Save (1). Nothing is saved.
- Trap: the probe page's viewport is about 1068 x 260, so flakes are a third of their size (they are
  sized in pixels of an 800 px tall screen) and faint; look at snow in the real window. Mist is in the
  fog's own colour, so with the camera high over fogged ground it is invisible; the probe lowers it.
- In the game: Save a chance, `.reload game_weather` (or restart the world server), then a GM's
  `.wchange <type> <grade>` (1 rain, 2 snow, 3 storm) forces the weather to compare with the preview.
- Splashes, wind and doorways (#244): `bun run probe weather-wind` (about 40 s) on the bench scene:
  heavy rain's splashes land on open ground west of Stormwind (this frame's, all on the terrain or a
  model, none under it, and they change pixels), heavy snow's settled flakes (#316) do the same there
  (none under the ground, the splashes emptied, and none left once it rains), a camera stepped 2 yd a frame along +X leads the
  rain's box along +X and tips the streaks' tails that way, and both settle when it stops; the rain
  shows whole on the Trade District's street (group 49, 0x40) with splashes on Stormwind's models,
  and from SI:7 (group 113) only while its door is in view, where the same frame with and without
  the weather differs in the doorway and not on the wall; and (#315) from the street 6 yd outside the
  shop's way out (group 118's portal onto group 122), over 80% of the shop's cells are roofed over its
  floor and the same frames drawn with the roof grid emptied have more drops in the doorway. Unit tests:
  `tests/weather.test.ts` (the wind's window, lead and tilt, the splash and settled-flake rates),
  `tests/weatherRoof.test.ts` (the roof grid's probes, its wrap as the eye moves, and when it is
  forgotten), `tests/wmoFlood.test.ts` (a doorway onto a 0x40 street is a sky window, not an exterior
  one).
- Trap (#315): drops are sparse (heavy rain is about one a 39 cubic yards), so a shop's inside seen
  through its door holds only a few at a time and a one-frame diff can be zero; the probe sums four
  frames. The probe raises `layer.roof.budget` to fill the grid in a few frames (its frames are slow)
  and puts it back. Diffs against the weather hidden (`layer.group.visible = false`) include the mist,
  which at heavy grade fills the doorway's depth (it is clear only within 6 yd); diff against the
  roofs emptied instead.
- Trap: the probe's frames are about 0.3 s apart, longer than a splash lives, so only the frame's own
  splashes are alive (compare births as `Math.fround(clock)`, the attribute is float32). Splashes are
  tiny (1/6 yd, the shape a third of that) and faint (Mod2x on a grey atlas): at heavy rain about 0.2
  live a square yard, so a view looking down from 2 yd shows few or none; look along the ground.

## The floor plane under the map is a backdrop (#289)

Checks: `Water.floor`, the dark plane 40 yd under the sea level, fills only what nothing else covers:
a model below it (Blackrock Depths' lower halls, under a map whose sea level is 0) draws over it, and a
hole in the ground still shows its dark earth, not the sky dome.
- Probe: `bun run probe brd-pit` (about 15 s): opens Blackrock Depths from the client, looks down into
  the Ring of Law from the stands (the owner's scene), and compares the arena's centre with the same view
  with the models hidden. Before the fix the centre was the plane (0% differed, as flat as the bare
  view); after it 77% differ and the centre is ten times as busy (the arena's stones). The arena is dark
  too, so don't expect every pixel to differ.
- How it was found: toggling the gate (`e.rooms.current = null`, `e.rooms.outside = () => []`), the
  group cull (`WmoGroupCull.enabled`), double-sided and plain materials on the batch changed nothing,
  and View › Buildings off turned the whole view the disc's colour: the colour was the plane's (`(0.05,
  0.042, 0.035)`, the sea off). A flat grey area where models should be: hide `e.water.floor` first.
- Hole: a flat map with a hole cut (`setHoleInSelection`), seen from above, shows the dark earth
  through it as before. The sea (an archipelago map) looks the same before and after.

## A map with no sky shows the dark earth behind it (#339)

Checks: `Engine.noSky` and `updateEnvironment`: Uldaman (a dungeon with no WDL far terrain around its
region) shows `EARTH` (63,58,53 on screen) behind the map at every pitch and hour, with the editor's
lighting and the client's, and the sky dome is hidden; Northshire keeps its sky.
- Probe: `bun run probe sky-dungeon` (about 25 s): the owner's Uldaman view at pitch 0.32, 0.08 and
  -0.3, at hour 13 and 0, Client Lighting off and on, reading the top-middle pixel. Before the fix
  pitch 0.08 showed the dome's near-white horizon band (246,249,250).
- Why it turned white: the grey/brown was never a sky colour but `Water.floor` (40 yd below the sea
  level) seen from above; Uldaman's halls lie at about -76, so a camera pitched toward the horizon
  dropped below the plane, which is one-sided, and saw the dome.
- Trap: every client map, dungeons too, has a global light in Light.dbc, so the lights cannot tell a
  map without a sky; the WDL (`RegionHorizon`) around the region can.

## A WMO's liquids: Blackrock Depths' lava (#287)

Checks: a WMO group's MLIQ (`internal/wow/wmoliquid.go`) reaches the frontend after the mesh
(`Mesh.Liquid`, `fetchMesh`'s `liquid`) and `ObjectLayer` draws it, instanced with the WMO, with
`wmoLiquidMaterial` (the liquid shader under `WMO`, with the room gate).
- Go: `go test ./internal/wow/ -run Liquid` (synthetic group files: holes, the class and path,
  groupLiquid's override, the fill height, the encoding).
- Probe: `bun run probe wmo-liquid` (about 15 s): opens Blackrock Depths, puts the camera 10 yd over a
  vertex of the lower instance's lava (23k triangles, 6 groups, magma type 6, which scrolls) and compares
  the view with the liquids' material hidden: 99% of the lower middle differs and it is orange (about
  rgb 174, 21, 0).
- Exterior water: Stormwind's canals (22 groups, river, exterior path) are in the benchmark scene
  (`P.scene(P.BENCH)`): take a vertex of the Stormwind batch's `liquid` geometry through
  `b.matrices` and look down from 8 yd over it; the water is a translucent green over the canal floor.
- Traps: the camera exactly at the lava's height sees the surface edge on and nothing changes; a red
  surface there is the cavern's floor under the lava, not the liquid. Importing `liquidMaterial.ts`
  from `models/assets.ts` loops back through `TerrainMaterial` → `PropEffects` and the page dies on
  `TILE_YARDS before initialization`, so ObjectLayer asks for the frames (`wantLiquid`).

## A camera over a building is in none of its rooms (#300)

Checks: `WmoRooms.update` counts the eye in a room only when the down-ray's room box holds it; an eye
over the building's footprint otherwise (no room found, above the top of the room found, or above the
whole building) puts the WMO in `e.rooms.over`, which is drawn whole and left out of the outside flood.
The client keeps its camera near the player, so its flood never meets this; Meld's flying camera does.
- Probe: `bun run probe wmo-over` (about 45 s): the benchmark scene's Stormwind from 52 yd over the
  canals (the issue's view: before the fix the Command Center's floor 70 yd below claimed the eye and
  the walls had holes to the sky) and from 250 yd over the city (before, the outside flood from the
  city's one exterior shell drew almost nothing), each compared with the gate off (within the two-shot
  noise), and 2.5 yd over a floor of The Canals, still in that room (group 7). Then from a Trade
  District room (group 49), 6 yd from its two doorways and looking through them (#302): in room 49,
  matching the gate-off picture.
- Why Stormwind: 305 of its 306 groups lack MOGP 0x8; its streets are lit interiors (0x40, box tops
  only 5 to 7 yd over the street) reached from outside only through one shell (group 46, `thief01`).
  Flooding from a street group with the eye 12 yd up hid the street itself and everything round it.
- Traps: the benchmark scene turns Follow the Ground on, which orbits the camera at `distance` from
  the target; with it off the flying camera sits at the target (set it through the app's `prefs`, then
  step two frames before `setSceneView`, or the view keeps the old camera). The canal water animates,
  so the two-shot noise over it is about 1%.
- The probe's last view (#304) stands 0.47 yd from group 49's south wall, closer than the near plane
  (0.5 yd, `Engine.persp`), looking along it: `Engine.updateNear` pulls the near plane in (to about
  0.32 yd there, `wall.near`) so the wall is not clipped away, and the gated picture matches the
  gate-off one. Before, the clipped wall showed the sky gated and the street behind it ungated (55% of
  the picture off).
- Trap (#302): an eye inside a wall's thickness (on a doorway's plane beside its portal, as a view
  placed at a walking face's centroid can land; #302's face at model x = -50.1358) still looks past
  the jamb, gated or not, whatever the near plane (37% off at 0.05 yd). Keep compared views out of the
  walls. A wall that is not a collision face (`/wow/wmonav`'s walk and camera faces) is not measured
  either.

## Camera collision keeps the flying camera off a WMO's walls (#305)

Checks: with View › Camera Collision on, `WmoRooms.collide` (`wmoRoom.ts` `collideSphere`) stops the
flying camera the near plane's corner reach (about 0.9 yd at a wide window) off a WMO's collision
faces, however far it moves in a frame, and slides it along them; with it off the camera flies through.
- Probe: `bun run probe wmo-collide` (about 20 s with the scene loaded): from 3 yd inside Stormwind's
  Trade District room (group 49) the target is moved 13 yd at the room's south wall in one frame,
  through it. On, the eye ends in room 49, on the room's side, `rooms.wallDist` at least the radius
  and the near plane at 0.5 yd; off, it ends 9.5 yd past the wall in SI:7 (group 111).
- Unit test: `bun test tests/wmoRoom.test.ts` ("a sphere moved into a wall ..."): stop, slide, floor,
  push-out and a free move on a toy room, with and without the column index.
- Unit test of the order (#434): `bun test tests/cameraMove.test.ts` runs the controller's collision
  step (`cameraMove.ts` `moveStep`) on a toy street (a floor 5 yd under a flat terrain, a wall) through
  the same `collideSphere` and `walkFloorZ` the Engine's hooks use: the eye stops the radius off the wall
  and slides, stays 3 yd over the WMO floor rather than the terrain, and under a low ceiling the walls
  win over the clamp (the clamp first, then the walls); the walker stands on the floor, climbs a 1.5 yd
  step, walks under a roof and stops at the wall with Camera Collision on or off; off, the flying camera
  passes through; a jump and the orbit and top-down cameras are not collided; the near plane
  (`nearPlane`, #304) pulls in for a face within reach, to 0.05 yd at least. The radius is 0.73 yd at
  16:9 (0.5 yd times `cornerFactor`), wider at a wider window, so test against the formula, not 0.9.
- Room data that fails (#515): `bun run probe wmo-nav-fail` (about 15 s with the scene loaded) makes
  `/wow/wmonav` answer 500 once for Stormwind (it wraps `window.fetch`), and checks the failure is
  counted in `rooms.navs.failed` and logged (`Building rooms: ... didn't load`), the camera is in no
  room and the file is not fetched again each frame, then moves the cache's clock (`rooms.navs.now`)
  past `RETRY_MS` and checks the retry loads it and the camera is in room 49 again. The cache itself:
  `bun test tests/loadCache.test.ts` (a truncated body for `decodeWmoNav`, the retry, a forget mid-load).
- The clamp (#310): the probe's `low` step lowers the eye 4 yd from its start and checks it stops 3 yd
  over the Trade District street's floor (`WmoRooms.floorAt`), in room 49, below the terrain there; `on.lift`
  checks the start eye set by `setSceneView` is not lifted.
- Trap: the terrain under Stormwind runs yards above and below the streets (3 yd over the street at the
  probe's start, 7.5 yd under it 14 yd away), so a check of the camera's height there must measure from
  `rooms.floorAt`, not `terrain.heightAt`. A view set by `setSceneView`
  or `focus` is a jump and is not collided, so an eye placed inside a wall stays there until it moves.
- Camera › Walking View on the WMO floor (#312): `bun run probe walk-wmo` (about 60 s, most of it loading the
  scene) starts the walk 1 yd over the probe's start and walks 20 yd each way along the street, one
  frame a 0.5 yd step: in rooms 49, 48 and 50 the eye stays 3 yd over `rooms.floorAt` while its height
  over the terrain runs from -0.5 to 8.7 yd. On the old code (eye 3 yd over the terrain) it is 3.5 yd
  off. Then (#313) it walks 6 yd at the room's south wall from 3 yd back: it stops 0.89 yd off it, in
  room 49 (`atWall`); on the old code it ends 2.5 yd through it, in 111 SI:7. With the walls the street
  walk stays in the rooms (80 samples, 47 before). Trap: starting the walk 6 yd up lands on the top of a wall by the street, a walking face too.

## The instance batch: culling, packing and picking of placed models and spawns (#517)

- `bun test tests/instanceBatch.test.ts`: `world/instanceBatch.ts` on its own (the rows in view packed
  to the front with their items, a repack forced after rows are rewritten, a moved row written in place
  with a range or the whole buffer while a pack is pending, a ray hit naming its item) and a
  `SpawnLayer` picking a marker spawn through its packed instance, before and after a move. Marker
  spawns (no model, `model: ''`) need no client, so the test runs anywhere.
- In the live app, the probes over both layers: `perf-objects-mixed`, `perf-creatures`, `pose-drawn`,
  `shadow-redraw`, `object-move`, `attach-follow`, `spawn-drag`, `nothing-to-draw`. `object-move`
  counts `InstanceBatch.pack` calls during a drag (none), so it counts the spawn layer's packs too:
  run it on a new document without spawns, as it does.
- Probes that peek at ObjectLayer's batches read the rows as `b.rows.items`, `b.rows.matrices`,
  `b.rows.spheres` and `b.rows.packed` (not `b.all` and the rest, before #517).
