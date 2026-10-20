# UI and the window

Panels, windows, the asset browser, preferences and saving. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

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

## Hover previews in tile grids (no gap between tiles)

Checks: in every grid whose hovered tile drives a preview (the asset browser, Doodad Brushes, the
prefab browser, the spawn tabs, the creature editor's displays and gear, the item editor's looks), a
tile only *sets* the hover and the grid clears it on `pointerleave`, so moving slowly from one tile
to the next never flashes the selected item in the gap between them (`PaletteTile`'s `onhover(false)`
is ignored). Probe `item-editor` checks it on the item looks: after a tile's `pointerleave` the bar
still reads "Showing display 8690", and only the grid's `pointerleave` clears it. A new grid with a
hover preview should do the same.

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
In headless Chrome (`docs/TESTS.md`): click the `.browser .tab` named Doodads, set the `.browser select` to a zone
and dispatch `change`, `grid-wrap.scrollTo(0, 400)`, wait 800 ms (the scroll is kept 300 ms after it
stops), go to Textures and Creatures and back: the zone, the count and the scrollTop come back; a
facet click then goes to the top. `tests/browserViews.test.ts` covers the stored shape. Trap: with
`?nosave` nothing reaches config.json, so a restart can't be checked in the page; reload the desktop
window instead.

## Model sets (the asset browser's Sets tab, #124)

Checks: making a set, adding models by a tile's right-click, showing it. In headless Chrome (`docs/TESTS.md`):
click the Sets tab, its `.setbar` New, type a name into `.setbar .setname` and dispatch `change`; on
Doodads dispatch a `contextmenu` MouseEvent (with `clientX`/`clientY`) on a `.browser .virtual .tile`
and click the `.menu .item` reading `Add to "<name>"`; back on Sets the tiles' titles are the set's
paths. The file form is `tests/modelSets.test.ts`; Import… and Export… open native dialogs, which the
headless page can't drive.

## Menu heights (#122)

Checks: every menu fits the window. In headless Chrome (`docs/TESTS.md`), click each `.menubar .title`, read
the `.menubar .dropdown`'s height and whether `scrollHeight > clientHeight`, and click it shut. An
item is about 31 px tall, so a menu of 20 items with headers is near 700 px: keep a menu under about
18 rows, or it passes a 768 px tall window (the dropdown then scrolls rather than running off). A
script that compares the `label:` strings of `MenuBar.svelte` before and after a move (`git show
HEAD:...`, sorted) proves no item was lost.

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

## Hide panels (Tab)

Checks: Tab hides the toolbar, options bar, asset browser, dock and status bar and the viewport
grows to fill the window; Tab again brings them back; View › Hide panels is the same switch.
In the dev page: `ed.ui.hidePanels = true`, then `document.querySelector('canvas').clientHeight`
grows and `document.querySelector('[data-ui="Toolbar"]')` is null. A key event
(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`) does the
same unless an input has focus; Ctrl+Tab still cycles the map tabs.
Probe: `bun run probe hide-panels` (canvas fills the window below the menu bar, returns on the second Tab).
Trap: `.centre` must stay in grid column 2 of `.main`; alone in the auto first column it shrank to its
content (145 px wide, #248).

## Tool hints
Checks: each tool's help sentence shows in the status bar's left slot and not in the options bar; a
status message (`setStatus`) takes the slot and the hint returns after it.
Probe: `bun run probe tool-hints` (eight tools and modes, and a message). It reports how many controls
each bar puts under More (`hidden`) without judging it.
Trap: the slot is one line with an ellipsis, so a long hint is cut off at narrow widths; hovering
it shows the whole text.

Trap: the ground effects' count ("Ground effects: N effects") lands in the slot a moment after the
page opens, so a probe that reads the hint sets `setStatus('Ready')` and looks again.

## Options bar overflow (More, #254)
Checks: at 1400 px the options bar stays one 34 px row; the brush's Size and Strength sit on it next to
the tool's modes; the controls that don't fit wrap below and are clipped, and a More (n) button at the
right opens the bar over the viewport with all of them; Esc, a click elsewhere or another tool closes
it; Tab onto a clipped control opens it.
Probe: `bun run probe options-more` (Hole, Raise, Terrace, Water, both doodad modes, Paint and Place).
`--shot <dir>` leaves the Water bar open in the picture.
Trap: a headless page has no window focus (`document.hasFocus()` is false), so `el.focus()` fires no
`focusin`; the probe dispatches it. Focus also scrolls the clipped bar to the control, which the bar
undoes (`scrollTop = 0`) before it decides the control is clipped.

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

## Loading bar (#159)

Checks: `lib/wow/loadProgress.ts` (counters, unit test `loadProgress.test.ts`) fed by `fetchBinary`
in `wow/api.ts`, drawn by `LoadingBar.svelte` (`[aria-label="Loading from the client"]`, label in
`.label`) after a batch has run 400 ms. In the dev page over CDP: start `__loadScene` without awaiting
it, sample the label every 200 ms while stepping `__engine.frame()`: it reads like "Loading 96 / 236 ·
Textures · G_BARREL01.BLP", and is gone within ~200 ms of the reads ending. One `fetchImage` while
idle must never show it. Trap: on a second run the reads come from cache and each batch ends before
400 ms, so the bar rightly never shows; use a region not opened in that browser profile yet.

## Preview window (#197)

Checks: the right-click menu's Preview (`ui.modelPreview`, `ModelPreviewWindow.svelte` over
`CreaturePreview` with a `type` and `hq`). In the dev page on Northshire, project a model's position to
the screen (`p.project(__engine.camera)`, then the canvas rect) and call
`__engine.openContextMenu({ clientX, clientY })`: the menu lists Preview after Focus. Its window is
`[role="dialog"][aria-label="Model preview"]` (not `aria-label` alone: the asset browser's small
preview has the same label). nsabbey.wmo reads "89.0 yd tall · 35,413 triangles" (the full model) once
loaded; a spawn's (`spawnType(s)`) shows it dressed. Esc closes it and the map's selection stays.
The canvas only takes its size in a rAF frame, so a hidden page shows 300x150.

The same menu ends with Unselect (#288) before Delete: it clears the selection (for a spawn, the selected spawn too).


- WebGL contexts (#201): each preview has its own renderer. Open and close it 24 times
  (`ui.modelPreview = { title: 'probe', type: 'helper:cube', scale: 1 }`, 250 ms, then `null`, 100 ms)
  and read `__engine.renderer.getContext().isContextLost()` after each: it must stay false. Without
  `forceContextLoss()` on close, the browser dropped the viewport's context on the 15th open (black
  viewport). Works in headless Chrome over CDP.

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

The same lines go to a file, one a session, in `<user cache>/Meld/logs/<start time>.log` (#319;
`internal/sessionlog`, the last 10 kept; on Windows `%LOCALAPPDATA%\Meld\logs`), batched once a
second through the `AppendLog` binding (`io/sessionLog.ts`), with the Go side's game session lines.
It is the first thing to read for a bug report, as the Log window is gone once Meld closes. Probe
`session-log` logs lines, clears the window and reads them back through `SessionLog`. The running
`make dev` must have rebuilt its Go side first (a stale binary answers `null`).

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
- The near cascade's draw calls (#325): a model or spawn batch joins the sun's near shadow pass only
  with a drawn instance in the cascade's box (`setNearCascade`, `world/shadowReach.ts`). Unit test
  `tests/shadowReach.test.ts`; in the app, `bun run probe perf-everything` (about 830 fewer calls than
  before, 2725 to 1895). To A/B it in one page, wrap every scene InstancedMesh that has its own
  `intersectsFrustum` as `(f) => f === __engine.env.key.shadow.getFrustum() ? true : old(f)` (the old
  behaviour) and alternate with the original, `P.frames(3)` and `P.perf(1)` each. Look at the near
  shadows (Help › Benchmark maps) for casters missing at the near box's edge.
- The moving casters' pass (#346, probe `shadow-poses`): with Prop animations on, a still view draws
  only the posed models and moving cut-outs into the near map, over a copy of the rest. A/B it in one
  page with `P.ab((on) => { __engine.posedShadows.enabled = on }, 6, { sections: ['Shadow', 'Render'] })`
  after `P.benchMap('objects-mixed')` (off redraws the whole near map on such frames, as before). Trap:
  a map whose models have moving cut-out textures (waterfalls, leaves) redrew the near map every frame
  until those materials were marked as movers too; count the frames whose `near.needsUpdate` is set
  (wrap `markShadows`) against `posedShadows.passes` to see which kind of redraw a map gets.

## Start dialog: opening an instance (#222, #271, probe `instance-open`)

Checks: in the Start dialog's "Part of Azeroth", an instance's tiles come from its WDT (`/wow/tiles`),
the picker selects the biggest square wholly on them and Open is enabled; a WMO-only instance (Molten
Core) says it is a single building and enables Open; the block opens; the Stockade opens as a single
building (#271): one model, the ground hidden, the building drawn from outside (a picture against
the same view with the objects hidden) and its creatures inside its box. Run `bun run probe
instance-open` (about 5 s). By hand: `curl "localhost:34115/wow/tiles?map=AhnQiraj"` lists tiles with
`"File":""` (no minimap image, column 26), which `/wow/overview` draws shaded from their heights.
Go: `WOW_DIR=C:/WoW/client go test ./internal/wow/ -run RealInstanceTiles` and
`WOW_DIR=C:/WoW/client go test ./internal/vmangos/ -run WMOOnly` (the Stockade read and saved back:
nothing written unchanged, a doodad set written, a move refused).
- Trap: the probe opens 2x2 tiles, not the picked 6x6 block, which SwiftShader takes minutes to draw.
- Trap: opening a region replaces the page's untouched start map, so the tab count stays 1; wait on
  `editor.regionMap` instead.
- Trap: in this client every instance with ADT tiles also has minimap images except Ahn'Qiraj's
  column 26; most dungeons and raids are WMO-only, which is why the owner saw "No minimap" (#222).
- Trap: the probe opens the Stockade, not Molten Core, whose building SwiftShader draws slowly.
- Trap: the runner steps one frame before its `--shot` capture (#274), but a model still loading may
  be missing from it; look at a building with `P.save(await P.shot(), name)` after `P.settle()`.
- Trap: a dungeon's WMO groups are all interior, so before #271 the outside flood drew none of the
  building from outside (only its doodads' flames); inside a room it draws as usual.
