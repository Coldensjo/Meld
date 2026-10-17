# TESTS.md

Ways to test and verify Meld that are known to work. Read this before working out how to check
a change, and add to it when you find a good way to test something (see CLAUDE.md).

This file holds the general methods. The checks for each feature are in `docs/tests/<area>.md`,
listed in the index at the end: find the feature you are changing there and read its entry. A new
entry goes in its area's file and gets a line in the index; a new general method goes here.

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
  isn't byte-identical; `WriteLights` starts each band row from the client's own. Second trap: params 8
  and 499 list some band keys out of time order (499's colour band 9: 2640, 2520, 0, 1440), which the
  client walks as a cycle in file order, so `WriteLights` passes a band whose times are unchanged through,
  writing only its changed values, instead of checking its order (#275), and the Lights dialog sorts a
  band only when a key's time changes, so recolouring a key of 499's band 9 keeps its order (#276; the
  test recolours one).
- `TestRegionHolesRoundTrip` (WOW_DIR) sends a Westfall block's own holes back as the editor does and
  checks every chunk keeps the client's hole bits (4 chunks there have holes); it is the check for the
  hole export's block mapping. Seeing a cut cave mouth in game is still a manual check.
- `TestRegionWithoutLiquids` (WOW_DIR) opens Naxxramas (map 533, folder `Stratholme Raid`) at 38_25, a
  block with no liquid, and checks the view sends `[]`, not `null` (#120). Naxxramas has tiles only at
  37..42 by 24..27; anywhere else on that map the tile read fails with "mpq: file not found".
- `TestBaseTileRootKeepsBlizzardPatches` and `TestRegionSaveKeepsBlizzardPatch` (WOW_DIR) are the
  checks that a save rebuilds a tile from the client without Meld's patch-3 only (#273): Azeroth_31_29
  is in terrain.MPQ and in Blizzard's patch-2.MPQ, which moved three of its height samples, so the tile
  read and a save with nothing edited must match patch-2's copy. Trap: the save's model count matches
  either way (models the editor doesn't show are dropped), so compare the heights, not the models.
- Trying SQL against the world database (`mysql -uroot -P3307 -h127.0.0.1 mangos`): its tables are
  MyISAM, so `START TRANSACTION ... ROLLBACK` does not undo an INSERT. Use an entry nothing uses and
  delete the row yourself afterwards. A template whose `unit_class` has no `creature_classlevelstats`
  rows (only classes 1, 2 and 8 have them) stops mangosd at startup (#112).

## Rendering and UI in the live app (Claude in Chrome)

Checks: anything visual (shaders, shadows, lighting, models, UI) against the real client assets.

- `make dev` (`wails dev`) serves the app at http://localhost:34115. The page exposes
  `window.__engine` (the Engine), `window.__loadScene(text)` and `window.__sceneText()`.
- From a script (Python especially), call the dev server at `http://127.0.0.1:34115`, not
  `localhost`: Python on Windows tries `::1` first and spends seconds on each request (a survey of
  621 tilesets hit a 10-minute timeout that `127.0.0.1` finished in under a minute, #227). curl,
  browsers and Node's fetch don't show it.
- **Always open the page as http://localhost:34115/?nosave.** The page and the user's desktop window
  share config.json and each writes all of its preferences on any change (a tab opened, a panel
  folded, a brush made), so a page without the flag overwrites what the user set in the window.
  With `?nosave` the page never writes the file (`lib/state/prefs.ts`). Add `&nosession` for a page
  that starts on a blank map instead of reopening the owner's last session (`lib/io/session.ts`);
  use it only with `nosave`, since the page would otherwise save its blank session over theirs. It also skips the Recover dialog, so `--shot` screenshots are not covered by the owner's recovery copies (#262).
  Add `&defaults` to skip loading config.json's preferences, so the page runs on the defaults (time of
  day, shadows, fog, panel sizes) and not the owner's; the probes' page has it (#253).
- Open a known spot with a scene: `{map:{region:{mapName:'Azeroth',x:32,y:48,size:1}}}` opens
  Northshire (the abbey is at about world x 182, z 353; the valley is dense canopy, so most ground
  is in tree shadow).
- The page runs on the owner's own preferences, which a scene's empty `prefs` leaves alone: the
  shadow quality, the fog, the asset browser's height (and so the viewport's shape, which changes what
  the camera sees). Loading a scene sets the time of day to its hour (#252; before, `applyPrefs` put the
  owner's `timeOfDay` back on the next pref change, and the bench showed night). A bare
  `setSceneView({ hour })` still lasts only until a pref changes; set `prefs.timeOfDay` with it.
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

## Probes (`pnpm probe`): checks in the live app you can rerun

Checks: a feature still works in the real app against the client's assets, in one command, with
a few lines of JSON as the result. **Reach for a probe first**: run the existing ones that touch your
change, and write a new probe instead of an ad-hoc CDP script when the check is worth repeating.

- `make dev` should be running. The runner checks `/wow/status` and the page itself (a dead Vite
  leaves `/wow/status` answering while the page is a 502); if either fails it starts `make dev`
  detached (log: `meld-dev.log` in the temp folder) and waits up to 10 minutes, a few minutes in
  practice. It stays up for the next run; with `MELD_URL` set it never starts one. Keep it running across items.
- `cd frontend && pnpm probe <name...>` runs those probes, `pnpm probe --all` (or `make probe`)
  runs every one, `pnpm probe --list` names them, `--shot <dir>` saves a screenshot each (of a frame the runner draws after the probe, since the loop is stopped) and
  `--profile` adds the probe's 12 functions with the most CPU time (self / total ms; it found #233's
  stalls in one run). Each probe gets a fresh page (`?nosave&nosession&defaults`: the owner's config is safe and not read,
  and the page doesn't reopen their last session) in a headless Chrome on SwiftShader. Without
  `nosession` a region from the session finished opening after the probe's `newDocument`, took the
  active tab, and its spawns, read seconds later, replaced the probe's (#250: `object-entry` and
  `object-loot` timed out once the owner's session held a region). It prints one JSON line a probe and exits 1 if any failed. A page
  error also fails the probe (the error of Wails' `ipc.js`, which a plain browser page always throws,
  is left out).
- **One-off checks**: `pnpm probe probes/scratch/<x>.js` (any argument ending in `.js` or holding a
  slash is a path, from where you typed it) runs a probe file from anywhere, with `P` in scope.
  `frontend/probes/scratch/` is git-ignored: put diagnostics and throwaway views there, so they never
  land in a commit or in `--all`.
- Trap: a probe run that outlives its shell (a background `--all` stopped at its time limit) keeps running with its Chrome and doubles SwiftShader's load, so every timing is wrong (#257: a 2 s fence that is 0.6 s alone). The runner now lists other live runs at start (`probe: warning: another probe run seems alive`, with pids). Stop one with `Stop-Process -Id <pid>` (Windows; `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -match 'probes.run.mjs'` finds it) or `kill <pid>` (Linux).
- Trap: don't run `make build-windows` (or `wails generate module`) while probes run. The build
  regenerates `wailsjs`, Vite hot-reloads the page in the middle of a probe and it fails on a page
  error from `App.svelte?t=…` at `@vite/client`. Run the build before or after.
- After a new Go binding, the page can fail on a stale `wailsjs` App.js (the trap above); the runner
  sees "does not provide an export named", moves App.js out and back so Vite reloads it, and runs the
  probe once more (`refreshedWailsjs: true` in its line).
- A probe is `frontend/probes/<name>.js`: the body of an async function run in the page, whose first
  line is a `//` comment saying what it checks (`--list` shows it). It returns an object; `ok: false`
  or a throw fails it. `P` (`probes/lib.js`) is in scope:
  - `P.e` (the Engine), `P.scene(line or object)`, `P.BENCH` (the benchmark scene), `P.settle()`
    (frames until the client reads stop), `P.frames(n)`, `P.until(fn, ms, what)`, `P.perf()`
    (`measurePerf` with frames stepped), `P.state()` (the app's own `editor`/`prefs`/`ui`),
    `P.app(path)` (any app module, the page's own instance) and `P.glError()`.
  - Pictures: `P.shot(draw?)` steps a frame (or runs `draw`) and reads the canvas back in the same
    task, `{ w, h, px, lit }` (`lit`, the share of pixels not black, so a blank read can't pass as
    "the same"); `P.diff(a, b, threshold, region)` gives the share of pixels that differ (`off`) and
    the mean difference; `P.busy(img, region)` how busy a picture is (neighbour differences: shimmer,
    noise); a region is `{ x0, x1, y0, y1 }` as shares of the picture, y0 = 0 the top.
    `P.only(object, fn)` runs `fn` with the rest of the scene hidden. For "looks the same with the
    switch on and off", take two shots with the switch unchanged as the noise floor (swaying trees,
    particles); `wmo-cull` and `terrain-dxt` do this.
  - Looking at a picture: `P.save(img, name, region?)` keeps a shot as a PNG, which `pnpm probe <probe> --shot <dir>` writes to `<dir>/<probe>-<name>.png` (the page's own `--shot` capture is `<probe>.png`; without `--shot` the saved pictures are dropped, and their pixels stay out of the printed result). `P.fullView()` hides the panels (Tab) so the viewport fills the window, about 1384 x 745 instead of 1017 x 387 under the asset browser, which matters for pixel-sized effects such as snow; call it before `P.shot`.
  - Viewport input: `P.click(x, y, opts, frames)` moves, presses and releases the pointer on the canvas and steps a frame; `P.drag([x, y], [x, y], steps, opts)` strokes; `x`, `y` are shares of the viewport, y = 0 the top, `opts` the event's `button`, `altKey`, `ctrlKey`, `shiftKey`. Setting `e.ndc` does not do this: the handlers overwrite it from the event. The status bar and tool state are read after the helper returns (its frame lets the handlers' messages land); `walkable` uses it.
  - A timeout in `P.until` or `P.settle` names the longest frame and the longest wait between frames
    during the wait (`P.stalls`), so a stall doesn't look like a broken feature.
  - `P.frames` waits after each frame until the GPU has drawn it (`P.drawn`, a WebGL2 fence). Without
    the wait, `P.until` stepped frames as fast as the page's tasks ran while a binding answered,
    SwiftShader fell tens of seconds behind, and the next call that reads from the GPU (a shader's
    info log, `toDataURL`, a uniform upload) stalled 20 to 45 s (#233). A probe that steps frames
    itself goes through `P.frames`, never a loop of `engine.frame()`. Trap: such a stall shows in
    `--profile` under whatever GL call came next, not under what queued the work.
  - `lib.js` stops the app's own frame loop (`Engine.stopLoop`) before the probe runs, since the
    probe drives the frames: on SwiftShader the loop kept about 14 cores drawing, and each probe
    frame waited behind it (a frame of the start map, 2 s with it, 0.3 to 0.6 s without). Something
    a probe waits on must come from a frame it steps (`P.frames`, `P.until`, `P.settle`), never
    from the loop. The previews' own loops (`CreaturePreview`) still run.

  A probe on a fresh flat map (`P.e.newDocument(256, 'flat', 0, 'Probe')`) takes about
  4 s; one that loads the benchmark scene about 90 s, nearly all of it SwiftShader drawing the region.
- The probes on 2026-10-17: `tool-hints` (#238, tool hints in the status bar, not the options bar), `hide-panels` (#248, Tab gives the viewport the whole window), `options-more` (#254, the options bar keeps one row and More shows the rest), `smoke` (the benchmark scene draws, no errors), `bench` (its numbers),
  `undo-sculpt` and `undo-holes` (an edit and its undo on a flat map), `wmo-cull` (#198's Stormwind
  cull, in the scene pass and the near shadow cascade, #215), `terrain-dxt` (#216's DXT3 tileset
  array draws the ground as the RGBA one does, and #225's mips smooth the distant ground), `object-entry` (#136, a game object spawn turned into
  another in the game object editor, and undone), `object-tilt` (#229, the Sunken Chest drawn tilted
  and its rotation kept by a move's SQL), `object-loot` (#220, a vein's shared loot list in the game
  object editor's Contents tab, a copy of its own, an added item, Make it a chest and the respawn time,
  nothing written), `walkable` (#175, the navmesh view's tiles, a path round holes, a WMO's floors), `erode` (#165, the Erode brush and the area pass on a Mountains map, with undo; #242, the area pass's settled mask), `weather` (#185, rain, snow and a sandstorm with the storm light, and the Zones dialog's weather sliders), `zones-fit` (#247, the Zones dialog has no horizontal scrollbar), `creature-spells` (#243, the creature editor's Spells tab: a creature's list with names, icons and text, a search and add, Revert; nothing written), `creature-spell-fields` (#255, the Creature tab names its auras and its spawn spell; nothing written), `spawn-groups` (#172, formations and pools read, built by clicks, written as SQL and undone; nothing written), `quest-editor` (#259, a quest's names, givers and refused saves, over the creature editor; nothing written), `loading-screen` (#218, Map Properties lists the client's loading screens and previews the chosen one; nothing written), `hole-walls-fade` (#249, the hole walls show near the camera and round the cursor, not from across the map), `instance-open` (#222, the Start dialog picks a block on an instance's tiles and opens it; #271, a WMO-only instance opens as its building), `world-map` (#219, World › World Map lists Elwynn's twelve exploration overlays and Generate redraws Northshire Valley's; nothing written). Port a recipe from `docs/tests/` into a probe when you next use it, and say in its entry
  that the probe exists.

## The live app without Claude in Chrome (headless Chrome over CDP)

Checks: the same as above, when the Chrome extension isn't connected (a `claude -p` loop run). The
probes above are this route packaged; use the raw route below for a one-off look (a screenshot
sequence, a question no probe asks). Start
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
- Trap: `await import('/src/lib/state/editor.svelte.ts')` can load a second copy of a module (the
  app's has a `?t=` hot-reload query), and writing to it changes nothing. Import the app's own URL:
  `performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/src/lib/state/editor.svelte.ts'))`.
  The same holds for any module a probe imports.
  `P.app(path)` does this. The page's resource buffer holds 250 entries by default, which the app's
  modules fill, so the runner raises it (`performance.setResourceTimingBufferSize`, before the page's
  scripts); without that `P.app` fell back to the bare path and a second copy (#223). In a page you
  drive by hand, call `performance.setResourceTimingBufferSize(100000)` and reload.

## Reproducing a user's view

- A pasted `Meld scene {...}` line (Help > Copy Scene) loads with
  `await window.__loadScene(text)` in the dev page. Loading sets the view prefs, which are saved to
  the user's config.
- Hold F8 in the app to name the component under the cursor (`DebugOverlay.svelte`).

## Staging only your lines of a file that holds someone else's edits (#266)

`git add -p` is interactive and not available in the agent shells. When the owner has uncommitted
edits in a file you also changed, stage only your hunks with a patch (checked in a scratch repo):

```bash
git diff -U0 -- <path> > all.patch       # every change in the file, the owner's and yours
# edit all.patch: delete the owner's @@ hunks, keep the header and your hunks
git apply --cached --unidiff-zero all.patch
git diff --cached                        # must show only your lines
```

- `-U0` makes each change its own hunk, so they can be cut apart; `--unidiff-zero` is what lets
  `git apply` take a patch without context lines.
- Do not build the blob by hand with `git hash-object -w <tmp>` + `git update-index --cacheinfo`
  unless you add `--no-filters`: the filters normalise line endings and staged the owner's change
  too (#259).
- Commit the index with plain `git commit` (`git commit <path>` would take the whole file), then
  check `git status`: the owner's hunks must still show as unstaged.

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
- **The benchmark scene.** Optimization issues and their done comments measure on this one scene, so
  their numbers compare. `cd frontend && pnpm probe bench` loads it, waits for the client reads to
  stop and prints the numbers. By hand: load it with `__loadScene`, wait until the models stop
  loading, then take `measurePerf()` as above:

  ```
  Meld scene {"v":1,"map":{"region":{"mapName":"Azeroth","x":32,"y":48,"size":1}},"view":{"target":[182,30,353],"yaw":0.5,"pitch":0.6,"distance":60,"hour":13},"prefs":{},"tool":"select","selectedIds":[],"selected":null,"area":null,"viewport":[1000,600]}
  ```

  Give the frame's CPU ms, GPU ms (where the browser has timer queries), draw calls and triangles,
  before and after. Not `frameMs` on SwiftShader: a frame takes most of the one-second window, so it
  averages one or two intervals and swung 14 to 72 ms between identical runs (#226); the probe prints
  it as null unless the window held more than 10 frames. A change that a different spot shows better (a big city, a dense forest) may use
  one, but give its scene line beside the numbers.

  Baseline, `pnpm probe bench` on 2026-10-17 after #215 (SwiftShader, so GPU n/a and CPU ms only
  compare between probe runs on this machine): 1996 draw calls, 697,402 triangles (2,052,549 before
  #215 culled Stormwind's groups in the near shadow cascade), 168 geometries, 719 textures, 325 MB
  heap; the most triangles: a Defias HumanMale (54k), Wolf (42k), nsabbey.wmo (35k), stormwind.wmo
  (33k). Since #253 the probe page runs on default prefs, so the numbers hold on any machine. Since
  #256 the scene turns Follow the Ground on (`P.BENCH`): the default flying camera took the view's
  target as the camera's own spot, down on the ground by the abbey (2001 calls, 743,861 triangles, and
  `terrain-dxt` read a flat far half). On 2026-10-17 after #256: 3015 draw calls, 2,574,488 triangles,
  185 geometries, 688 textures, 305 MB heap; the most triangles: HumanMale (54k), Wolf (44k),
  nsabbey.wmo (35k), stormwind.wmo (31k). Update this when a commit moves it on purpose.
- Trap: a scene's `view` means an orbit (target, distance) only with Follow the Ground on; with the
  default flying camera the target is where the camera stands. A hand-written scene or a probe that
  places the camera by target and distance must set `cameraFollowGround: true` (#256).

## Index of feature checks

### Rendering (`docs/tests/rendering.md`)

- Particles (M2 emitters, B-182)
- Ground effects (grass tufts)
- Water look (the client's combine, B-174)
- Client clouds (B-179)
- Liquid types from the client
- Selection outline colours (free, touching, buried)
- Ground effects: no-doodad cells and density
- Graphics › Quality presets (#203)
- The camera's WMO room (down-ray probe, #8)
- Client Lighting's ground: per-vertex light and the sheen (#111)
- Losing and restoring the viewport's WebGL context (#209)
- Losing and restoring the previews' WebGL contexts (#213)
- WMO culling by group (#198, #215)
- Compressed client textures (DXT, #178)
- The terrain's tileset array as DXT3 (#216)
- The tileset array's mips (#225)
- Preview window: particles, ribbons and texture animation (#200)
- Weather preview and zone weather (#185)

### Terrain, water and map data (`docs/tests/terrain.md`)

- Growing a region (the Map panel's plus)
- Holes per triangle (Sculpt › Hole)
- Hole walls (drag an edge, + and − badges)
- Sculpt › Terrace (#166)
- Sculpt › Erode and Terrain › Erode (#165)
- Mask wand, Grow, Shrink and Feather (#183)
- Lasso and polygon areas (#183)
- Check Map (#176)
- Fit ground to models and Stamp (#168)
- Clear tool: height, liquids, holes
- Area paste: liquids and turning (chunk mover)
- Clean up the tile under the camera (#45)
- Heightmap import on a tile, Auto heights and the normal map (#44)
- Water layers (the Water tool's All layers / Layer, #14)
- Baked shadows: bake, paint, save and export (B-057, #16)
- Walkable ground: the navmesh view and the path test (#175)

### Tools and placing models (`docs/tests/tools.md`)

- Brush size controls (Photoshop-style)
- Scripted brush strokes
- Vertex mode undo and keys on a focused control (#127)
- Gizmo drags (spin ring, height arrow, scale knob) without a mouse
- Place tool keys (preview height and offset)
- Placement tilt (the client's rotation order, #149)
- Doodad brush (scatter models by weight)
- Spawn brush (the Doodad tool's Creatures mode, #171)
- Prefabs (#170)
- Rotate around pivot point (group spins)
- Group gizmo (ring, knob and arrow on a multi-selection)
- Mouse-move snap (Follow cursor, Snap models to the ground)
- Clear tool: the models a stroke would delete (#131)

### UI and the window (`docs/tests/ui.md`)

- Session restore (reopening the last tabs at start)
- Autosave and recovery (#177)
- The desktop window itself (closing with unsaved maps, #188)
- Thumbnail loading order (asset browser grids)
- Asset browser tabs remember their place (#123)
- Model sets (the asset browser's Sets tab, #124)
- Menu heights (#122)
- Dock panel (Layers) and the Inspector
- Hide panels (Tab)
- Tool hints
- Options bar overflow (More, #254)
- Help window
- Preferences from two windows
- Detail info readout
- Loading bar (#159)
- Preview window (#197)
- Top-down view (U)
- Log window
- Minimap window (M)
- Start dialog: opening an instance (#222, #271, probe `instance-open`)

### Creatures, objects and the server database (`docs/tests/spawns.md`)

- Gear picker (a spawn's main hand, off hand and ranged items)
- Spawn tabs of the asset browser (Creatures, NPCs, Objects)
- Game object editor: turning a spawn into another object, pools (#136)
- Game object editor: Contents, Make it a chest, respawn (#220)
- Tilted game objects (#229)
- Names over spawns (#125)
- Right-click near the selected creature (#205)
- Formations and spawn pools (#172)
- Creature path editing on the map (#138)
- World event spawns (#143)
- Creature editor: Looks opens on the creature's display (#206)
- Creature editor: Shop tab (npc_vendor, #145)
- Creature editor: Spells tab (creature_spells, #243)
- Portals and area triggers (#141, #18)
- Creatures workspace and the new-creature guide (#132)
- Quest editor (#259)
- Name colours by reaction (#134)
- Shop tab: item icons and tooltips (#202)

### Export, the client and the game (`docs/tests/client.md`)

- Launch where the camera is (character placement)
- Play here: move the character in the world (#13)
- Benilla launcher: nothing on screen until the world (benilla-launcher)
- The game's template cache after an editor's Save (#234)
- Minimap tiles for the client (B-129, #17)
- Server map extraction for one map (Publish, #174)
- A map's own loading screen (Map Properties › Picture…, #218)
- World map of a zone (World › World Map, #181; exploration overlays, #219)
