# UI and the window

Panels, windows, the asset browser, preferences and saving. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Session restore (reopening the last tabs at start)

Checks: `lib/io/session.ts` keeps the open file and region tabs with their cameras in
`prefs.session` (every 3 s when changed, saved alone through `savePref`, and on quit) and opens them again at start.
The prefs effect in App.svelte leaves `session` out, so a camera move re-applies nothing: `bun run probe session-prefs` (#461).
In the dev page:

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
- `bun run probe autosave` (#546, #637) checks a big map's copy: none while a stroke is held, the encoding
  sliced between turns, each slice sent through its own `SaveRecoveryPart` call (about 4 MB of base64,
  10-15 ms a call), the parts joining into the one-go encoding and the copy loading back. It measures the
  second copy: a page's first tens of MB across the bridge pause it once for 300-700 ms, one whole-map
  call or parts alike. `bindingCallMs`, the longest stretch without a turn once the parts go, is printed,
  not checked: 55-760 ms across runs (most under 300) in the headless page against 290-530 ms for one `SaveRecovery` with
  the whole map before #637, and the gap is a pause of the page with no script running (a
  long-animation-frame observer lists none), not a part call. With the native `toBase64` (Chrome,
  WebView2) and the bridge warmed, parts gave 33-44 ms against 286-321 ms for one call.
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

## A long right-drag turn on Windows never stops (#724)

Checks: the Windows mouse look (`CameraController` with `lookWarp.ts`, `mouselook_windows.go`) moves
the hidden cursor back to the drag's start once it is `WARP_AT` away, however fast the spin, and the
jump back never turns the camera. The bookkeeping is unit-tested in `tests/lookWarp.test.ts`; the real
cursor only moves in the native window (the dev page uses pointer lock), so the live check drives the
built `build/bin/Meld.exe` from PowerShell as in the entry above:

- Start it, `ShowWindow(h, 3)`, tap Alt (`keybd_event(0x12, ...)` down and up) and then
  `SetForegroundWindow(h)`, and stop unless `GetForegroundWindow()` is the window: a background
  PowerShell is refused the foreground without the Alt tap, and the drag then lands in whatever window
  is in front (the first try on 2026-10-25 right-dragged a browser).
- `SetCursorPos` at the window's centre, right down (`mouse_event(0x0008)`), 300 relative moves of
  60 px (`mouse_event(0x0001, 60, 0, ...)`, 8 ms apart), right up (`0x0010`). Every 25 moves read
  `GetCursorPos`: its offset from the start stays under `WARP_AT` plus a move or two (60, 120, 0, ...
  on 2026-10-25); before the fix it ran to the monitor's edge. Screenshots of the viewport late in the
  spin differ (the map's edge moves), so the turn goes on.
- Traps: the session restore opens the owner's tabs; nothing is edited, so `CloseMainWindow` ends it
  with no prompt.

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
IntersectionObserver. `tests/thumbQueue.test.ts` covers the ordering, dedupe, prefetch set and the 512-result eviction (an evicted blob URL is revoked).

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
window instead. The `virtual-grid` probe runs this check for the scroll (Doodads, Textures and back).

## The virtualised tile grids (#578)

Checks: every tile grid renders only the rows in view through `components/VirtualGrid.svelte`,
with the row maths in `lib/ui/virtualGrid.ts` (`tests/virtualGrid.test.ts`: columns, the window
with its one-row margins, the last partial row, an empty or shrunk list). `bun run probe
virtual-grid` scrolls the asset browser's Doodads grid 40 rows down and checks the rendered rows
cover the view with at most a row or two to spare and no more tiles than those rows, and that the
scroll comes back after Textures and back. The probe dispatches a `scroll` event after `scrollTo`,
since the browser's own one may land after the frames it waits. The
brush editor (`ui.brushEditor = true`) has the same grid under `[data-ui="DoodadBrushEditor"]`.

## Names under the tiles (#655)

Checks: the asset browser header's Names checkbox (`.names input`, `prefs.browserNames`) hides the names
under every tab's tiles and in the preview, and the virtual rows pack tighter.
- In the dev page, on Doodads: a `.tile` is 110 px tall with names and 90 px without at the default size,
  and `.virtual`'s height drops with it (400 to 312 px for four rows); `.tile .label` count goes to 0.
  Hover a tile (`pointerenter`) and the preview's `.details` (name, kind, size, path) goes and comes back with the box.
- The slider, Names and the fold button (`header .view-opts`) start at the preview column's left edge
  when the browser has room, and stay in view beside the dock. Probe: `bun run probe browser-names`
  (the dock hidden and shown, three tabs, and the preview's details with Names off).
- Trap: the header is crowded at 125 % interface size or beside the dock (1017 px in the dev page): the
  search, the select and `.view-opts` shrink; check that `.chev` ends inside the browser after a header change.
- The setting is saved to the real config from the dev page: put it back.

## The same header on every tab (#651)

Checks: each asset browser tab shows the header's search box, count and tile-size slider; Ctrl+F
focuses the box; the zone select shows on Doodads, Buildings, Textures, All and Sets, the creature
order on Creatures and NPCs; no tab has a search box of its own; a creature name typed in the header
narrows the Creatures tab's count. Probe: `bun run probe browser-header` (needs the world database for
the Creatures count). Trap: the Sets tab's rename box is a text input outside the header, by design.

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
- Probe: `bun run probe layers-panel` (hover, selection, delete and undo; the panel has no timer and re-reads on `ui.historyVersion`, `editor.hoverChunk` and `editor.selection`, #585).
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

## Hide the dock (#653)

Checks: the ✕ on the dock's header hides the right dock alone (`prefs.dockHidden`, saved) and the
viewport grows by the dock's width; View › Layers panel brings it back; Tab still hides and restores
the other panels with the dock staying hidden. Hiding drops a pending Replace (`ui.replaceSlot`).
Probe: `bun run probe hide-dock` (canvas width before, hidden, with Tab and shown again).

## Toolbar on the right (#654)

Checks: Preferences › Toolbar on the right (`prefs.toolbarSide`) puts the toolbar at the window's right
edge, after the dock, and back. In the dev page, click the Preferences menu item, then the radio
"Toolbar on the right": `.toolbar`'s left is the `.dock`'s right, and its left border is set. Hover a
toolbar button (`pointerenter`, wait 450 ms): the `.tip` ends left of the toolbar. Hide panels still
fills the window. The pref saves to the real config from the dev page: set it back to the left.

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
The Sculpt bar fits the row with no More in all twelve modes, even Flatten with Lock, Angled and
paint by slope on (#715); so do every Water, Doodad and Paint mode (Water's lock, follow ground,
spray and mask by slope on, a spawn brush of any number of creatures, which is one "n creatures" chip on the bar and a chip each in the Spawns panel; #734, #735). The panel button opens the
panel of the tool's other settings below the bar, inside the window, and Esc closes it (Sculpt
Flatten and Water paint are checked).
Probe: `bun run probe options-more` (every Sculpt, Water, Doodad and Paint mode, and Place). The
More and Tab checks narrow the bar's window to 700 px, since no bar overflows at 1400 px;
`--shot <dir>` leaves that bar open in the picture.
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

## Saving bar (#343, probe `saving-bar`)

Checks: `bun run probe saving-bar` drives `lib/state/saving.ts` in the dev page: a 100 ms save never
shows `SavingBar.svelte` (`[data-ui="SavingBar"]`), a longer one shows it after 400 ms centred in the
window, an overlapping save names itself with its log line and the first shows again when it ends,
and a save that throws still clears it. For a look, a scratch probe that calls `startSaving` and
waits 600 ms, run with `--shot <dir>`. The real saves need the desktop app's dialogs and database, so
the probe checks the helper, not File › Save; in `make dev` a Compile to Client of a region shows it.

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

## Previews draw only while something moves (#589)

Checks: `AssetPreview` and `CreaturePreview` (over `lib/ui/previewRenderer.ts`) stop their frame
loop when nothing moves, and keep to Graphics › FPS limit while drawing.
- Probe: `bun run probe preview-idle` (about 30 s, no map needed). It counts each preview canvas's
  frames by wrapping its context's `drawElements` and `drawArrays` (the draws of one task are one
  frame) over 2 s windows: the asset preview spinning a hovered tile's model, settled after its 6 s
  spin (0), with the pointer over it (spinning), at `prefs.fpsLimit = 5` (at most 11), and after the
  pointer left (0); then the Preview window on `helper:cube:4` still (0), with Turn checked and
  unchecked again (0).
- Before the change the asset preview drew about 240 frames a second in the headless page with
  nothing moving, and the Preview window about 150.
- Trap: the asset preview keeps drawing a model whose textures or colours move (a waterfall,
  `materialsMove`), and the Preview window any model with bones, particles or a moving texture, so
  a "settles to 0" check needs a still model: the first palette tile (a plain doodad) or a helper.

## Moving the view up and down in the previews (#662)

Checks: a right or middle drag in `AssetPreview` and `CreaturePreview` moves the orbit target up
and down the model, held to its bounds; the left drag still turns and the wheel zooms.
- The previews don't draw in a hidden page (`document.hidden`, #589), so a headless or background tab
  can't show the pan. Its logic can be checked anywhere on a renderer of its own:
  `const { PreviewRenderer } = await import('/src/lib/ui/previewRenderer.ts')`, make one, `setPanRange(0, 8)`,
  then call `down`, `move` and `up` with `{ button: 2, clientX, clientY, pointerId, currentTarget: { setPointerCapture() {} } }`:
  `target.y` follows a drag down, stops at 0 and 8, and `yaw` stays. Without a canvas a pixel is the whole
  view's height, so any drag reaches a bound.
- A right-click on `[aria-label="Model preview"]` is cancelled (`contextmenu` handler), so no menu opens.
- By eye, in a visible window: a tall model (a Stormwind tower, a large creature) zoomed in on its
  middle; a right-drag down slides it down to show the top, the same way in both previews.

## Camera views (#750, probe `camera-views`)

Checks: Camera › Orbit View (F2, the default), Flying View (F3), Walking View (F4) and Top-down View
(U) are one radio group, read from and set through `prefs.cameraFollowGround`, `ui.walkCamera` and
`ui.topDown` (`lib/ui/cameraView.ts`); T switches Orbit and Flying, and while walking or top-down it
changes only the camera that view returns to.
- `cd frontend && bun test tests/cameraView.test.ts`: each view from every start reads back as
  itself, Orbit and Flying end a walk and the top-down view, Walking and Top-down toggle back to the
  view under them, Orbit is the default pref.
- `bun run probe camera-views` (about 20 s, a flat map): each radio item and each key sets the
  controller's `followGround` and `walk`, `ui.topDown` and the ortho camera, and the menu marks one
  view.
- Trap: the runner starts every probe in Flying View (`P.flyingStart`), not the app's default, so
  check the default in the unit test, not a probe. A radio click leaves the menu open, so a probe that
  clicks the title again closes it.

## Top-down view (U)

Checks: U (or Camera › Top-down View, one of the four views of #750) draws the map straight down with an orthographic camera
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

Checks: M (or Camera › Minimap) shows the map (`MinimapView.svelte`) attached to the dock above
Layers (`prefs.minimapDocked`, the default, #749; M shows a hidden dock too), or, detached with the
panel's ⇱, as a floating window at the top left (its ⇥ attaches it again): the heights drawn grey
by height and blue under the sea (redrawn when the terrain object, its `heightsVersion` or the sea
changes, checked at 2 Hz through `stats.view`; `MinimapDrawn` in `lib/io/minimapImage.ts`), the client's overview behind it for a part of Azeroth (cropped to the open
block), amber tile borders on a map bigger than a tile, and a white dot with a line for the camera's
target and facing. A click moves the camera there (`controller.focus`). In the dev page:
`ed.ui.minimap = true`, then `ed.stats.view` fills within half a second and
`document.querySelector('[aria-label="Minimap"] canvas').width` is the map's size in cells (the
selector finds it in the dock and in the window).
- Probe: `bun run probe minimap-dock`: attached above Layers and square at the dock's width, M shows
  a hidden dock, detach and attach, M hides it in either place, and a new Small Mountains world
  (the start map's size) drawn with its ground. Trap (#749): a new map's `Terrain` starts its own
  `heightsVersion`, so two maps of one size both stand at 1 after the first upload; a cache key of
  size and version kept the old map's picture (all water) over the new world. Trap (#757): a fresh
  canvas is 300 wide (the HTML default) until the first 2 Hz refresh draws it, so wait for
  `width === terrain.size`, not `width > 0`, or the read races the refresh (it failed after #750).
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
- The scene pass draws only what is in view (#15): a batch's `count` is its instances in the camera's
  frustum, and a shadow pass draws `packedCount(mesh)` (objects.md, the instance batch). Unit tests
  in `tests/instanceCull.test.ts`, `tests/instanceBatch.test.ts` and `tests/shadowReach.test.ts`. In
  the app: the `world-view` probe's `perf.models.calls` (1,993 before, 1,017 after, CPU 15.7 to 10.8
  ms). To split the passes, wrap `renderer.shadowMap.render` and set `env.key.shadow.needsUpdate` or
  `env.far.shadow.needsUpdate` before a frame: the shadow passes must draw the same calls and triangles
  before and after a change here (near 160 calls, far 1,920 at that view). To see that no shadow went
  missing, shoot the same views on both commits at a low sun (`prefs.dayCycle = false`,
  `prefs.timeOfDay = 17.6`, four headings, both maps forced redrawn) and compare the PNGs with
  `magick compare -metric AE -fuzz 2%`: a few pixels differ between identical runs.
- The moving casters' pass (#346, probe `shadow-poses`): with Prop animations on, a still view draws
  only the posed models and moving cut-outs into the near map, over a copy of the rest. A/B it in one
  page with `P.ab((on) => { __engine.posedShadows.enabled = on }, 6, { sections: ['Shadow', 'Render'] })`
  after `P.benchMap('objects-mixed')` (off redraws the whole near map on such frames, as before). Trap:
  a map whose models have moving cut-out textures (waterfalls, leaves) redrew the near map every frame
  until those materials were marked as movers too; count the frames whose `near.needsUpdate` is set
  (wrap `markShadows`) against `posedShadows.passes` to see which kind of redraw a map gets.
- The near map's lookup under a turning sun (#366, probe `shadow-sun-drift`): between redraws (the
  sun held within 0.1°, #324) `near.matrix` must stay the one the map was drawn with, though the key
  light follows the live sun. The probe steps `e.hour` by 0.0005 a frame with the clock frozen and
  compares the matrix after each held frame with the one after the last redraw. Trap: a pixel diff
  barely sees the slide (a few texels at the box's edge, mean 0.07 against 0.03 for the lighting's
  own turn), so compare the matrix.

## Projects (#48)

Checks: File › Project… opens a project folder with its client; the folder gets `meld-project.json`,
the config (`%APPDATA%\Meld\config.json`) gets `projectPath` and the project at the front of
`projects`, the File menu lists the other recent ones, and the Open and Save map dialogs start in the
folder. Go: `go test ./internal/config/` (the recent list and the project file). The Start dialog's
ask for a project is in the probe `instance-open`. By hand in the app: open a project on a scratch
folder, pick the folder again in the dialog (its name and client fill in), switch to another from the
File menu, and Close Project.
- Trap: opening a project changes the owner's real config (the client folder and the recent list), so
  a probe must not call `OpenProject`; set `ui.project` in the page instead, as `instance-open` does.

## Start dialog: opening an instance (#222, #271, probe `instance-open`)

Checks: with no project open the Start dialog's "Part of Azeroth" asks for one (#48; the probe then
lends the page a project in `ui.project` only, so the owner's config keeps theirs); in it, an instance's tiles come from its WDT (`/wow/tiles`),
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

## Accessibility (#354)

Checks: keyboard focus, roles and contrast, the audit's method (its findings are #369 to #375).
- `cd frontend && bun run check` reports Svelte's a11y warnings; `svelte.config.js` sets no
  `warningFilter`, so 0 warnings means none are hidden (only two `svelte-ignore a11y` lines exist).
- Focus and roles in the live app, from a probe (`P.state()` gives `ui`): open a dialog with
  `ui.dialog = 'about'`, then read `document.activeElement` and
  `document.querySelector('[role="dialog"]').contains(document.activeElement)`; click a
  `.menubar .title` and check the focus lands in `.dropdown`; count `[aria-pressed]` in `.toolbar`.
  Dispatch keys with `new KeyboardEvent('keydown', { key, bubbles: true })` on the focused element.
- Contrast: compute the WCAG ratio of each token pair in `app.css` (relative luminance, sRGB) for
  both themes; small UI text (10 to 12 px) needs 4.5:1, focus rings and borders 3:1.
  `frontend/tests/contrast.test.ts` asserts it for `--text`, `--text-dim`, `--accent-text` and
  `--danger-text` on all four panels; text uses those tokens, `--accent` and `--danger` stay for fills.
  Item names on the page use `--q0` to `--q6` (`QUALITY_VARS`, #708), darkened on the light theme and
  asserted there on bg, panel and panel-2; the tooltip keeps `QUALITY_COLORS`, the game's own.
- Trap: `el.focus()` from a script doesn't match `:focus-visible` in Chromium, so a focus ring checked
  that way reads `outline-style: none`; press Tab in a real page, or check the CSS rule itself.
- Focus ring and reduced motion (#374, probe `focus-motion`): checks `app.css` holds the `:root[data-kbd-nav] :focus-visible` ring
  (#652: `main.ts` sets the attribute on Tab, clears it on a pointer press) and the plain `:focus-visible` reset and the `prefers-reduced-motion` rule (it reads the stylesheets,
  since the probe cannot fake a Tab or the media query). Look at the ring by pressing Tab in the dev page.
- Trap: the `data-ui` attributes on component roots belong to the F8 overlay, not to accessibility.

## Dialog focus and Esc (#369, #573, probe `dialog-focus`)

Checks: a dialog takes the focus on open, keeps Tab inside it and gives the focus back on close.
- `bun run probe dialog-focus` opens About from a button and from the Help menu, checks the focus
  lands inside, that Tab from the last control and Shift+Tab from the first wrap (and are prevented),
  that Tab from outside pulls the focus back in, that closing refocuses the opener (the menu title
  for a menu item), and does the same for the quest editor. Then About over the quest editor: an Esc
  in a field of About only leaves the field, the next closes About alone (#573), and the editor
  takes the one after. Run `hotkeys` and `quest-editor` with it: the keys must still work after a
  dialog closes, and Esc in the quest editor over the creature editor closes only the quest editor.
- Trap: the first focus waits a `setTimeout(0)`, so a dialog's own `autofocus` or `searchBox.focus()`
  wins; read the focus with `P.until`, not straight after setting `ui.dialog`.
- Trap: a synthetic Tab `KeyboardEvent` doesn't move the focus by itself; the probe checks the
  wrap cases only, where the action moves it and calls `preventDefault`.

## Confirm dialog (#581, probe `confirm-dialog`)

Checks: the app's yes/no prompt (`askConfirm`, `lib/state/confirm.ts`) that replaced the native
`confirm()` in the Creatures guide, Lights, Portals, Zones, Flight paths, model sets and brush stacks.
- `bun run probe confirm-dialog` adds a probe brush stack, clicks Delete stack in the brush stack
  dialog, checks the confirm Modal ("Delete stack") is on top with the focus in it and a danger yes
  button, that Esc answers no (the stack and the stack dialog stay, the focus returns to Delete
  stack), and that the yes button (`[data-confirm="yes"]`) deletes it. It restores the stacks.
- A probe answers any of the nine prompts by clicking `[data-confirm="yes"]` or `[data-confirm="no"]`
  (or calling `answerConfirm`); a native `confirm()` returned false in headless Chrome, so those
  paths could not be scripted before.

## Menu keys (#370, probe `menu-keys`)

Checks: the menu bar and the right-click menu work from the keyboard.
- `bun run probe menu-keys` checks the roles (`menubar`, `aria-haspopup`, `aria-expanded`), that a
  click on File focuses its first item, Down/Up/Home/End and the wrap, that a tool letter (`b`)
  pressed in the menu doesn't change the tool (and does once the menu is closed), Right and Left
  between File and Edit, Escape back onto the title, Down/Up/Enter/Right on a closed title, and Tab
  closing the menu onto its title. Then it opens a right-click menu through `ui.contextMenu` with a
  separator and a disabled item, and checks the first focus, the skip and the wrap, Escape giving
  the focus back to the opener, and a pick running its item. Run `hotkeys` and `dialog-focus` with it.
- Trap: a synthetic Tab doesn't move the focus, so the probe only checks the menu closed and the
  focus sits on the title, from where the browser's own Tab moves on.

## Copy id (#681)

Checks: a right-click copies a thing's id and name.
- `cd frontend && bun test tests/copyId.test.ts tests/spawnActions.test.ts`: the labels (entry for
  items, creatures and objects, id for the rest), the menu under a row's own actions, a spawn's
  Copy creature entry, Copy spawn guid and Copy name.
- `bun run probe item-editor` right-clicks the Worn Shortsword's search result and checks Copy item
  entry 25 puts `25` on the clipboard (`window.runtime.ClipboardGetText()`).
- By hand in a probe: dispatch `contextmenu` on a RefField's `.name` (Hogger, 448, Loot gives "Copy
  creature loot id 448" and no Copy name), then Escape on `.menu[role=menu]`: the editor stays.
  Trap: an Escape dispatched on `document` reaches the menu's and the editor's window handlers
  both and closes the editor; a real Escape lands in the focused menu, which stops it.

## Shortcut table (#583, probe `shortcut-table`)

Checks: the menus, App's key handler and Help › Keyboard Shortcuts use the one table in
`lib/ui/commands.ts`.
- `cd frontend && bun test tests/shortcuts.test.ts`: unique ids, no chord bound twice, each chord
  reaching its own command (Ctrl+Shift+Z is Redo, Shift+[ the falloff, Ctrl+0 by `code` too, Ctrl+T
  nothing), the tool keys from `TOOLS`, and the sources: no `shortcut: '...'` in `MenuBar.svelte`,
  every `cmd`/`toggle`/`keysOf` id in the table, the dialog reading `shortcutSections()`.
- `bun run probe shortcut-table` (smoke): K and 0 pick Paths and Stamp, G the grid, Ctrl+A selects
  and switches to Select; every menu's shortcut text is a table row's; Edit › Undo shows the
  "Undo: ..." status Ctrl+Z shows; the Shortcuts dialog has a row for each table row. Run `hotkeys`
  and `menu-keys` with it.
- Trap: the probe's keys go to `window`, so the focus must not sit in a text field (the runner's
  page starts on the body).

## Hotkey Manager (#396, probe `hotkey-manager`)

Checks: Preferences › Hotkey Manager rebinds a command or a camera key, and everything that shows or
reads the key follows.
- `cd frontend && bun test tests/shortcuts.test.ts` ("rebinding"): the defaults are the keys bound
  before the keymap, chord text round-trips, a keymap moves a command and the camera
  (`bindKeymap`/`syncKeymap`), a key given to one row leaves the others (Shift+N vs N, `{`, camera
  codes vs letters), a row put back on its default leaves the keymap, a bad entry keeps the default,
  the refused keys, and a key press turned into a chord or a code. `tests/prefs.test.ts` checks the
  pref's shape.
- `bun run probe hotkey-manager`: the dialog's capture button takes Ctrl+K for Show grid without the
  map seeing it, Sculpt's chip moved to L, the camera's forward key to I (taken off the Inspector,
  with the note saying so), Delete refused and Esc cancelling; then Ctrl+K toggles the grid, L picks
  Sculpt and 2 no longer does, View › Show grid shows "G / Ctrl+K", the toolbar shows L, the
  Shortcuts dialog the new keys, the camera flies on I and not W, and Reset all puts every default
  back. The probe page runs with `?nosave`, so the owner's keymap is never touched; it sets
  `prefs.keymap = {}` at the start and end.
- Preferences › Q / E Fly Up and Down (#725) is only a keymap rewrite (`setFlyOnQE`, checked state `flyOnQE`): Q joins Fly up, E joins Fly down, the turns lose them; off gives them back. Tested in `tests/shortcuts.test.ts` ("Q/E fly switch"). Fly up/down only act with Follow the Ground off, as Space does.
- Not in the probe: a reload keeping the keys (the page doesn't save). In `make dev`'s window, rebind
  a key, restart, and check `%AppData%\Meld\config.json` holds `"keymap"` with only that row.
- Trap: a synthetic keydown on the capture button must be dispatched on the button itself (it
  listens there, not on `window`, and stops the event so the camera and the Modal's Esc don't see it).

## Interface size (#372, probe `ui-scale`)

Checks: Preferences › Interface size zooms the whole UI and everything still lines up.
- `bun run probe ui-scale` sets 150 % and checks the root's `zoom` and `--ui-zoom`, that the app
  fills the window without running past it, that the canvas's buffer matches its size on screen
  (sharp), that the window's own hit test finds the canvas inside its rect and a pointer at a share
  of the rect gives the engine that share, that the Preferences menu fits and lists the sizes, that
  a right-click menu opened at window px (300, 200) has its corner there, and Ctrl+= / Ctrl+- /
  Ctrl+0. Run `menu-keys`, `dialog-focus`, `zones-fit` and `hide-panels` with it.
- To look at it: a scratch probe that sets `prefs.uiScale = 1.5` and opens a dialog, run with
  `--shot <dir>`.
- Trap: the zoom also scales `vw` and `vh` (a `100vh` box is 1.5 windows tall at 150 %), which is
  why the styles use `var(--vh)`. A new `vh` or `vw` in a style overflows at a larger size.
- Not checked here: WebKitGTK (Linux). Its `zoom` may report `getBoundingClientRect` in the zoomed
  page's px rather than window px; check the viewport picking, the right-click menu and the dock's
  resizer there at 150 %.

## Selected state for assistive tech (#373, probe `aria-state`)

Checks: the toolbar's tool buttons carry `aria-pressed` (exactly one true, moving with `editor.tool`), the
asset browser's kind tabs are `role="tab"` with `aria-selected`, its facets carry `aria-pressed`, and no
`role="listbox"` holds plain tile buttons; clicking through every kind tab (models, prefabs, spawn templates) it checks the grids are `role="group"` with `aria-pressed` tiles (#379). The doodad brush editor (a dialog) is not opened by the probe. `bun run probe aria-state`.
- Trap: the tool tip opens on keyboard focus only (`:focus-visible`), which a script's `focus()` does not
  trigger in the dev page and a synthetic Tab keydown cannot fake (Tab toggles the panels). Press Tab in the
  dev page by hand to see the tip; the probe only checks that a blur hides it.

## Folder setup dialog at start (#689)

Checks: `lib/io/folderSetup.ts` opens `FolderSetupDialog` after the recovery offer when the client folder
(`wow.path`) or the server folder (`VmangosPath()`) is unset and `prefs.skipFolderSetup` is false; the pure rule is
`folderGaps` (`bun test tests/folderGaps.test.ts`). It is skipped on the probes' page (`?nosession`). In the app, back up
`%APPDATA%\Meld\config.json`, clear `wowPath` or `vmangosPath` in a copy's place, start `make dev`, and see the dialog
with Skip and "Don't ask again"; restore the config afterwards.
