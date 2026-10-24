# TESTS.md

Ways to test and verify the editor that are known to work. Read this before working out how to check
a change, and add to it when you find a good way to test something (see CLAUDE.md). While 3dgame is a
prototype the issue loop runs no tests and writes none (`../../.claude/issue-loop.md`): it builds the
change and looks at it; the methods below are for when a check is worth more than that.

This file holds the general methods. The checks for each feature are in `docs/tests/<area>.md`,
listed in the index at the end, and the cube worlds' checks in `docs/architecture/cubes.md`, Checks:
find the feature you are changing there and read its entry. A new entry goes in its area's file and
gets a line in the index; a new general method goes here.

Each entry says what it checks, how to run it, and the traps that cost time.

## Compiling a shader without the app (headless Chrome)

Checks: that a `ShaderMaterial` compiles and draws what it should, when Claude in Chrome isn't there.
Get the material's sources through the real module in Bun (`bun x.ts`
from `frontend/`; a script outside `frontend/` must import three and the module by absolute `file:///`
URLs, or 'three' doesn't resolve) and write them to JSON. In a scratch folder (not the repo), with
copies of `three.module.js` and `three.core.js`, a page builds the material, renders it with
`r.debug.onShaderError` set and puts `readPixels` of the centre into the DOM. Serve the folder
(`python -m http.server`) and run
`chrome.exe --headless=new --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=8000 --dump-dom http://localhost:<port>/page.html`.
- Trap: `camera.lookAt` straight up or down with the default up vector gives a black frame; aim a
  degree off. The centre pixel of an even canvas is half a pixel off the view axis, so a gradient
  reads a few levels off its stop.
- A whole module (an `Environment`, a `CubeLayer`) can be drawn the same way: bundle a scratch
  `entry.ts` with Vite's JS API (`build()` from `frontend/node_modules/vite/dist/node/index.js`,
  `configFile: false`, `root` the scratch folder, `resolve.alias` for `three` and `@meld` →
  `frontend/src`). Modules that pull in the runes state need a shim before the bundle in the page
  (`window.$state = Object.assign(v => v, { raw: v => v, snapshot: v => v })`, `$derived` with
  `by`, `$effect` with `root` and `pre`). `--enable-logging=stderr --v=0` prints the page's console.

## Unit and integration tests

- `make test` runs `go test ./internal/...`, `go test .` (the root package, only when `frontend/dist` exists, since it is `//go:embed`ed; otherwise it prints a skip line) and the frontend unit tests (`bun test ./tests`).
- `make check` runs gofmt, go vet (`./internal/...`, and `.` when `frontend/dist` exists), the shape table's `--check` (`docs/architecture/cubes.md`, Drawing) and svelte-check/tsc. svelte-check runs twice: on `tsconfig.app.json` (`src`) and on `tsconfig.tests.json` (`frontend/tests`, which Bun runs with types erased, so a fixture that drifts from its type fails `make check`, not `make test`).
- `tests/history.test.ts` covers the undo stack (`state/historyCore.ts`: push, the step limit and
  the byte budget, replaceTop, goTo, clear) through a plain sink; `state/history.ts` only wires that sink to the
  runes state. Trap: a test can't import a `.svelte.ts` runes module, since Bun doesn't run the Svelte compiler on it.
- The cube worlds' tests (`cubeWorld`, `cubeMesher`, `cubeEdit`, `cubeClip`, `cubePalette`,
  `cubePrefabs`, `cubeBatches`, `cubeLayerMap`, `objectKinds`, `playSpot`) and the Go ones
  (`internal/worldfile`, `internal/play`, `app_world_test.go`) are listed in `docs/architecture/cubes.md`, Checks.
  `internal/worldfile`'s tests read the Rust side's fixtures, so the two readers cannot drift.

## Rendering and UI in the live app (Claude in Chrome)

Checks: anything visual (the cubes, shadows, sky, UI).

- `make dev` (`wails dev`) serves the app at http://localhost:34125. The page exposes
  `window.__engine` (the Engine), `window.__loadScene(text)` and `window.__sceneText()`.
  `__loadScene` checks the whole line first (`parseScene`, tests/scene.test.ts): a scene must be complete
  (`v`, `map`, `view`, `prefs`, `tool`, `viewport`), or it throws naming the field and changes nothing.
  A scene of a Meld map (a `.wmap` or a block of the WoW client) is refused.
- From a script (Python especially), call the dev server at `http://127.0.0.1:34125`, not
  `localhost`: Python on Windows tries `::1` first and spends seconds on each request (#227). curl,
  browsers and Node's fetch don't show it.
- **Always open the page as http://localhost:34125/?nosave.** The page and the user's desktop window
  share config.json and each writes its preferences on any change (a tab opened, a panel folded), so a
  page without the flag overwrites what the user set in the window.
  With `?nosave` the page never writes the file (`lib/state/prefs.ts`). Add `&nosession` for a page
  that starts on an empty world instead of reopening the owner's last session (`lib/io/session.ts`);
  use it only with `nosave`, since the page would otherwise save its blank session over theirs. It also skips the Recover dialog, so `--shot` screenshots are not covered by the owner's recovery copies (#262).
  Add `&defaults` to skip loading config.json's preferences, so the page runs on the defaults (time of
  day, shadows, fog, panel sizes) and not the owner's; the probes' page has it (#253).
- Open a known world: the world format's fixture, `crates/world/tests/fixtures/small.world`
  (`mapio.openPath(__engine, '../crates/world/tests/fixtures/small.world')`; paths are relative to the
  Go process, which runs in `editor/`), or a generated one (`cargo run -p world --bin gen-world --
  editor/build/bin/<name>.world`, git-ignored).
- Loading a scene sets the time of day to its hour (#252). A bare `setSceneView({ hour })` lasts only
  until a pref changes; set `prefs.timeOfDay` with it.
- Traps:
  - Tabs opened by the Chrome extension are usually `document.hidden`, so the rAF loop stops (the
    frame counter is stuck). Drive frames with `__engine.frame()` from `javascript_tool`, then take
    the screenshot.
  - `javascript_tool` results that contain shader source are blocked as "cookie/query data".
    `console.log` them and read them with `read_console_messages` and a pattern.
  - If the page gives no response, the Go side of the user's `wails dev` may have died (its Vite
    child lingers on port 5273 and blocks a new `wails dev`). Tell the user their dev session is
    gone before starting one.
  - Vite's watcher misses files replaced by rename, such as by `sed -i` and Wails' binding
    regeneration (`wails generate module`). Vite then serves the stale module and the page fails with
    "does not provide an export named …". Edit with the Edit tool or an in-place write, and re-save a
    missed file in place to fix it. Check what is served through the Wails proxy, `curl
    localhost:34125/<file>`. After a regeneration even an in-place re-save may not reach it (the
    watcher has lost the file): move `wailsjs/go/main/App.js` out of the folder and copy it back a
    second later, which Vite sees as a new file. The owner's own dev window is broken the same way
    until then.
  - `make build-windows` while `wails dev` runs is fine. It runs from PowerShell too: on Windows the
    makefile runs its recipes through Git for Windows' sh (`GIT_SH`, by default
    `C:/Program Files/Git/usr/bin/sh.exe`); without it, make fails with "CreateProcess sh.exe".
  - After editing `lib/state/editor.svelte.ts` with the page open, HMR gives later modules a new
    instance of it, so a probe's `editor`/`prefs` and the tools' can differ. Reload the page before
    probing.
  - To call app modules (e.g. `editor`) from `javascript_tool`, import the exact
    URL the page loaded (from `performance.getEntriesByType('resource')`, with its `?t=`). A bare
    path gives a second module instance with separate state.
- Off-screen probes settle what screenshots can't: read back a depth texture, or render from the
  sun's view and draw it onto a page overlay.
- three r186 facts that matter when reading shader output: `PCFSoftShadowMap` is removed (falls
  back to PCF), shadow maps are depth textures, and inside `#pragma unroll_loop` only
  `UNROLLED_LOOP_INDEX` and `[ i ]` are substituted.

## Probes (`bun run probe`): checks in the live app you can rerun

Checks: a feature still works in the real app, in one command, with a few lines of JSON as the
result. **Reach for a probe first**: run the existing ones that touch your change, and write a new
probe instead of an ad-hoc CDP script when the check is worth repeating.

- `make dev` should be running. The runner checks the page; if it fails it starts `make dev`
  detached (log: `meld-dev.log` in the temp folder) and waits up to 10 minutes, a few minutes in
  practice. It stays up for the next run; with `MELD_URL` set it never starts one. Keep it running across items.
- `cd frontend && bun run probe <name...>` runs those probes (a name ending in `*` runs every probe it
  starts: `cube-*`), `bun run probe --all` (or `make probe`) runs every one (run it in the background
  and read its log, one line a probe, rather than piping it through `tail`), `bun run probe --list`
  names them, `--shot <dir>` saves a screenshot each (of a frame the runner draws after the probe,
  since the loop is stopped) and `--profile` adds the probe's 12 functions with the most CPU time
  (self / total ms), each followed by `<=` and its heaviest caller chain up to the first editor `src/`
  frame, with that chain's share of its self time. `PROFILE_TOP=<n>` prints `n` functions instead.
  Each probe gets a fresh page (`?nosave&nosession&defaults`: the owner's config is safe and not read,
  and the page doesn't reopen their last session) in a headless Chrome on SwiftShader. It prints one
  JSON line a probe and exits 1 if any failed. A page error also fails the probe (the error of Wails'
  `ipc.js`, which a plain browser page always throws, is left out).
- **`[Unhandled error] TypeError: Cannot read properties of null (reading 'nodes')` in the `make dev`
  terminal** on every page load (stack in `/wails/ipc.js`) is Wails v2.16.0's, not the editor's (#335): its
  injected "disconnected" overlay is compiled with Svelte 5 but mounted with the old `new Component()`
  call (reported as wailsapp/wails#6317). It is harmless, dev-only, and the probe runner already skips it; don't chase it.
- **The GPU instead of SwiftShader** (3dgame #218): `PROBE_ANGLE=d3d11` (Windows; `gl` on Linux) makes the runner's Chrome draw on the GPU. SwiftShader draws a big world at about a frame a second, and the editor builds chunks for a few milliseconds a frame, so the 1536 x 1536 Tibia import never finished building on it. Use the GPU to time a big world, and SwiftShader, the default, for pictures that must match on every machine. Raise `PROBE_TIMEOUT` with it.
- **A hung or throwing probe names its place** (#301): a probe running over 5 minutes (`PROBE_TIMEOUT`, seconds) is stopped with `timed out after N s` and `step`, the `P.until` it waited in (its `what`, `window.__probeStep`); a throw prints `line`, `<file>:<line>:<col>` of the probe body where it stopped. Give every `P.until` a `what`.
- **A lost page does not stall the run, and a failure is retried once** (#388): every CDP command times out or fails when the page's socket closes. After such a loss (`lostPage` in the line) the runner kills its own headless Chrome (found by its port and profile, never the dev window) and starts a new one, and runs the probe again. Any failed probe gets that one retry in a fresh page: if only the retry passes, its line has `flaky: true` and `firstFailure` (and `firstStep`) and counts as passed; a failure twice has `retried: true` and fails the run. Read a `flaky` as a page or load problem to look at, not as a pass to ignore. Trap: a trivial probe that returns at once (`return { ok: true }`) leaves the app half booted, and the next probe's page can then hang at setup; the retry covers it.
- **One-off checks**: `bun run probe probes/scratch/<x>.js` (any argument ending in `.js` or holding a
  slash is a path, from where you typed it) runs a probe file from anywhere, with `P` in scope.
  `frontend/probes/scratch/` is git-ignored: put diagnostics and throwaway views there, so they never
  land in a commit or in `--all`.
- Trap: a probe run that outlives its shell (a background `--all` stopped at its time limit) keeps running with its Chrome and doubles SwiftShader's load, so every timing is wrong (#257). The runner lists other live runs at start (`probe: warning: another probe run seems alive`, with pids). Stop one with `Stop-Process -Id <pid>` (Windows; `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | ? CommandLine -match 'probes.run.mjs'` finds it) or `kill <pid>` (Linux).
- Ports (3dgame #66): this editor's dev server is on its own ports, apart from the owner's original Meld
  (`C:\WoW\meld`: `wails dev` on 34115, Vite on 5173): Wails on `localhost:34125` (`devServer` in
  `wails.json`) and Vite on `127.0.0.1:5273` (`server` in `vite.config.ts`, `strictPort`, so a taken port
  fails at once instead of moving; `frontend:dev:serverUrl` names it).
  `make dev` and the probe runner use them with no setting. Never stop the owner's processes; find yours by
  the listening port (34125, 5273): `wails dev`, its Vite (`bun --bun vite`) and `Meld-dev.exe` stay alive
  after the shell ends and carry no port in their command lines. `make -C editor dev-stop` (Windows;
  `scripts/dev-stop.ps1`) stops everything it started: whatever listens on 34125 or 5273, the `wails.exe` that started it and the `Meld-dev.exe` under this
  folder. It leaves 34115, 5173 and any other Meld alone.
- Trap: don't run `make build-windows` (or `wails generate module`) while probes run. The build
  regenerates `wailsjs`, Vite hot-reloads the page in the middle of a probe and it fails on a page
  error from `App.svelte?t=…` at `@vite/client`. Run the build before or after.
- After a new Go binding, the page can fail on a stale `wailsjs` App.js (the trap above); the runner
  sees "does not provide an export named", moves App.js out and back so Vite reloads it, and runs the
  probe once more (`refreshedWailsjs: true` in its line).
- A probe is `frontend/probes/<name>.js`: the body of an async function run in the page, whose first
  line is a `//` comment saying what it checks (`--list` shows it). It returns an object; `ok: false`
  or a throw fails it. `P` (`probes/lib.js`) is in scope:
  - `P.e` (the Engine), `P.scene(line or object)`, `P.settle(ms)` (steps frames for a while),
    `P.frames(n)`, `P.until(fn, ms, what)`, `P.perf()` (`measurePerf` with frames stepped),
    `P.state()` (the app's own `editor`/`prefs`/`ui`), `P.app(path)` (any app module, the page's own
    instance), `P.env(name, fallback)` (a `PROBE_<name>` variable from the command line) and `P.glError()`.
  - A world: `P.e.openWorld(CubeWorld.create(2, 2, true), 'Probe', '')` (`CubeWorld` from
    `P.app('/src/lib/cubes/world.ts')`; `true` fills the layers by their themes), or the fixture
    through `mapio.openPath`; wait for `activeDocument().cubes.pending === 0` before looking at it.
    The cube probes need the Go bindings (`window.go.main.App`), which the dev page has. Trap:
    `openWorld` takes the place of an untouched tab, so a probe that opens a second world must leave
    an edit in the first.
  - Pictures: `P.shot(draw?)` steps a frame (or runs `draw`) and reads the canvas back in the same
    task, `{ w, h, px, lit }` (`lit`, the share of pixels not black, so a blank read can't pass as
    "the same"); `P.diff(a, b, threshold, region)` gives the share of pixels that differ (`off`) and
    the mean difference; `P.busy(img, region)` how busy a picture is (neighbour differences); a region
    is `{ x0, x1, y0, y1 }` as shares of the picture, y0 = 0 the top. `P.only(object, fn)` runs `fn`
    with the rest of the scene hidden. For "looks the same with the switch on and off", take two shots
    with the switch unchanged as the noise floor.
  - Looking at a picture: `P.save(img, name, region?)` keeps a shot as a PNG, which `bun run probe <probe> --shot <dir>` writes to `<dir>/<probe>-<name>.png` (the page's own `--shot` capture is `<probe>.png`; without `--shot` the saved pictures are dropped, and their pixels stay out of the printed result). `P.fullView()` hides the panels (Tab) so the viewport fills the window; call it before `P.shot`.
  - Which object drew a pixel: `P.whoDrew(x, y)` (shares of the viewport, y = 0 the top; default the centre) renders one
    extra frame in which every mesh ends in a flat colour for its index, and returns `{ name, type, chain, material }`
    of the mesh at that pixel, or null for the background (#299). Each mesh gets a material inheriting from the real one,
    so shaders' vertex work, depth state and discards are as drawn; blending is off and fragments under alpha 0.1 are
    dropped. Points, lines and sprites are hidden for the pass. Name a mesh (`mesh.name = ...`) in the engine to make
    its answer readable. A pixel on an antialiased edge reports a neighbour (`near: true`).
  - Viewport input: `P.click(x, y, opts, frames)` moves, presses and releases the pointer on the canvas and steps a frame; `P.drag([x, y], [x, y], steps, opts)` strokes; `x`, `y` are shares of the viewport, y = 0 the top, `opts` the event's `button`, `altKey`, `ctrlKey`, `shiftKey`. Setting `e.ndc` does not do this: the handlers overwrite it from the event. To click a cube, project its point (`new THREE.Vector3(x, y, z).project(e.camera)`, three from `P.app('/deps/three.js')`) and pass `(v.x + 1) / 2, (1 - v.y) / 2`, as `cube-build` does.
  - Aiming and menus (#309): `P.lookAt({ x, y, z }, { yaw, pitch, back })` flies the camera `back` metres from a point, looking at it. `P.contextMenu(x, y)` right-clicks the viewport at shares of it (default the centre) and returns `ui.contextMenu` (null for no menu).
  - A timeout in `P.until` names the longest frame and the longest wait between frames during the
    wait (`P.stalls`), so a stall doesn't look like a broken feature.
  - `P.frames` waits after each frame until the GPU has drawn it (`P.drawn`, a WebGL2 fence). Without
    the wait, `P.until` stepped frames as fast as the page's tasks ran while a binding answered,
    SwiftShader fell tens of seconds behind, and the next call that reads from the GPU stalled 20 to
    45 s (#233). A probe that steps frames itself goes through `P.frames`, never a loop of
    `engine.frame()`.
  - `lib.js` stops the app's own frame loop (`Engine.stopLoop`) before the probe runs, since the
    probe drives the frames: on SwiftShader the loop kept many cores drawing, and each probe
    frame waited behind it. Something a probe waits on must come from a frame it steps (`P.frames`,
    `P.until`, `P.settle`), never from the loop.
  - A throttle measured in milliseconds fires on every `P.frames(1)` (a SwiftShader frame is slow); to
    check one, call the tool's own method many times in a loop without stepping frames. And
    `history.steps().length` counts redo steps too: compare `history.position` instead.
- The probes: `smoke` (the fixture opens and draws with no WebGL errors), `console-clean` (#336, opening the fixture logs no console warning or error and no HTTP 400+ besides a list of known ones with their issues; drop a known entry when its issue is fixed), `hide-panels` (#248, Tab gives the viewport the whole window), `saving-bar` (#343), `session-log` (#319), `session-prefs` (#461), `focus-motion` (#374), `dialog-focus` (#369, #573), `menu-keys` (#370), `ui-scale` (#372, the interface at 150 %: fits, sharp canvas, pointer, menus and shortcuts), and the cube worlds' (`docs/architecture/cubes.md`, Checks): `cube-world` (3dgame #29, open, save, reopen and revert the fixture, and a new themed world; writes `build/bin/probe-cube-world.world`), `cube-draw` (#30, the drawn triangles against the mesher and the layer slice through every layer; `--shot` saves the world whole and sliced), `cube-build` (#31, the Cubes tool driven by clicks, each step undone and redone, saved and opened again; writes `build/bin/probe-cube-build.world`), `cube-camera` (#62, the free camera down to layer 15, the status bar's layer, the minimap redrawn after an edit, World Properties and the Start dialog), `cube-palette` (#63, #73, the palette's picks, search, categories, preview, sets and a prefab written to `build/bin/probe-cube-prefab.toml`), `cube-copies` (#65, #70, the recovery and scene copies of an edited world, the toolbar's two tools, no Terrain menu) and `cube-select` (#70, a box selected, copied, moved, deleted and pasted into a second world, each undone and redone). The probes of Meld's terrain, models, water, weather, previews and benchmark maps went with those features (#64). Port a recipe from `docs/tests/` into a probe when you next use it, and say in its entry that the probe exists.

## The live app without Claude in Chrome (headless Chrome over CDP)

Checks: the same as above, when the Chrome extension isn't connected (a `claude -p` loop run). The
probes above are this route packaged; use the raw route below for a one-off look (a screenshot
sequence, a question no probe asks). Start `make dev` in the background, wait until
`curl localhost:34125/` answers, then drive a headless Chrome over the DevTools protocol from a scratch
folder (not the repo):
`uv run -q --with websocket-client python -u cdp.py "http://localhost:34125/?nosave" shot step1.js step2.js`.
The script (about 40 lines) starts `chrome.exe --headless=new --remote-debugging-port=0
--user-data-dir=<scratch>\profile --window-size=1400,900 --use-angle=swiftshader
--enable-unsafe-swiftshader about:blank`, reads the port Chrome chose from `<scratch>\profile\DevToolsActivePort` (first line; a fixed port can
belong to another run) and the page's websocket from
`http://127.0.0.1:<port>/json`, sends `Page.navigate`, waits 4 s, and for each JS file runs
`Runtime.evaluate` on `(async () => { <file> })()` with `awaitPromise` and `returnByValue`, prints
the result and saves `Page.captureScreenshot` as `<prefix>-<n>.png`. A step opens a world or loads a
scene with `__loadScene`, then steps the app with `await new Promise(r => setTimeout(r, 50)); __engine.frame()`
in a loop and returns what it wants to report as JSON.
- Traps:
  - SwiftShader is slow: a few hundred `frame()` calls of a large world take minutes, so run it with
    a long timeout, and `python -u`, or nothing prints until the end.
  - Write step files with the Write tool, not a heredoc: heredocs here halve backslashes.
  - Writing `__engine.prefs.x` doesn't stick: the prefs effect re-applies its own copy.
  - The point under the cursor (`__engine.hit`) is picked only while the pointer is inside the
    viewport: set `e.ndc.set(x, y); e.pointerInside = true`, then step a few frames.
  - Dialogs open through the menu bar's DOM: click the `button` whose text is the menu's name
    (`Edit`), then the item's label `span` (its `closest('button')`), then read the dialog's DOM.
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
  the user's config. A world with unsaved changes was written to a `.world` copy in the scenes cache
  (`map.copy`), which the line opens as an untitled world. A scene by hand:

  ```
  Meld scene {"v":1,"map":{"file":"../crates/world/tests/fixtures/small.world"},"view":{"target":[48,3,48],"yaw":0.5,"pitch":0.6,"distance":40,"hour":13},"prefs":{},"tool":"select","viewport":[1000,600]}
  ```
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

## Dead code after a large removal (#113)

`make deadcode` prints what a removal left dead and changes nothing; it always exits 0. Run it
before and after, and compare. It lists:
- frontend files under `src` not reachable from `src/main.ts` (relative `from`, `import()` and
  `new URL()` specifiers), with the tests and probes that still import them;
- exports of `src` that no other file in `src`, `tests` or `probes` names (a name used only inside
  its own file is listed too: drop the `export`);
- unused locals, imports and destructured names, from svelte-check on `frontend/tsconfig.unused.json`
  (`noUnusedLocals` on top of `tsconfig.app.json`);
- unreachable Go functions, from `go run golang.org/x/tools/cmd/deadcode@latest .` (needs the network
  the first time; nothing is added to `go.mod`).

Traps: `deadcode` treats Wails' bound `App` methods as reachable and reports functions only, not types
or constants. Its paths use backslashes on Windows, so filter with `internal.worldfile`, not
`internal/worldfile`. The export scan matches names as words, so a name shared with an unrelated symbol
hides as used. The script is `scripts/deadcode.mjs` (run by Bun from `frontend/`).

## Measuring performance (the overlay, #179)

Checks: where a frame's time goes, before and after a performance change. View › Performance overlay
(Ctrl+Shift+M) shows, averaged over a second, the CPU time of each `Engine.frame()` section
(`CPU_SECTIONS` in `engine/perfMeter.ts`, booked by `meter.mark` after each subsystem; `frame()` is
`simulate` then `draw`), the GPU time of the shadow maps and the scene (`engine/gpuTimer.ts`, timer
queries; n/a where the browser has none) and the draw counts. Help › Copy Performance Report puts the
same numbers and the scene line on the clipboard. Use it as the measure for perf work: the same world
and view, the report before and after. 3dgame names no benchmark for the loop yet (`../../.claude/issue-loop.md`).

- From a probe: `P.perf()` steps frames while `measurePerf()` collects (it reports after a second of
  frames), five windows (`PERF_WINDOWS=n`, or `P.perf(n)`), and `P.perfSummary(r)` makes the line:
  `cpuMeanMs` with `cpuMinMs` to `cpuMaxMs` beside it, the mean ms of each CPU section, calls,
  triangles, geometries, textures and heap. Not `frameMs` on SwiftShader: a frame takes most of the
  one-second window, so it averages one or two intervals and swings 5x between identical runs (#226);
  it is null unless the window held more than 10 frames. Call a change real only when the means
  differ by more than the spreads.
- The shadow maps are timed by wrapping `renderer.shadowMap.render` (`Engine.timeShadowMaps`): three
  draws them inside `renderer.render`, so without the wrap they would count as the scene.
- A/B in one page (#341): `P.ab(on => { ...switch... }, n)` alternates the two states `n` times each
  (default 8) and returns each state's CPU mean, min and max, calls, triangles and mean ms per CPU
  section, the difference, and `overlap`, the measures whose ranges overlap (a section that moves
  without overlap is a real gain even when the total sits inside the spread). Give it a longer
  `PROBE_TIMEOUT` (900). Check the helper on a no-op switch: the means agree within the spreads.
  Every `PROBE_*` variable reaches the page through `P.env` (#347); a variable without the prefix never arrives.
- A cost that isn't a steady frame (chunks building as a world opens, an edit's rebuild) doesn't show in
  `P.perf` (#348). Time the methods: `const t = await P.time({ '/src/lib/cubes/CubeLayer.ts:CubeLayer': ['update', 'rebuild'] })`
  (or `[[Class, 'method'], ...]`) before the work, then `t.snap()` gives ms and calls per method
  (an outermost call only) and a `total`; `t.reset()` zeroes it between the load and an edit. The calls
  divided by the frames stepped give how often a method runs a frame: check that before building a
  gain for it (#331). `P.turn(0.05)` turns the camera 0.05 rad a frame until the function it returns is
  called, and `P.ab(set, n, { turn: 0.05 })` does so around its windows, since a still camera hides a
  cost that only comes with movement. Trap: the classes must come from the page's own modules
  (`P.time` goes through `P.app`); an imported copy is a second one and measures nothing.
- Trap: the first probe run after an edit to served source (`make dev` hot-reloads it) can load cold
  (shader programs compiled twice, long program links in the first frames, #327). For a load or
  first-view measure, run once to warm up and compare the runs after it.
- Trap: the probes' Chrome has no `KHR_parallel_shader_compile`, and on SwiftShader a new program's
  cost lands in the frame that first draws it whether or not it was compiled ahead, so a probe can't
  show what compiling ahead gains on a real GPU (#327).
- Trap: a probe run that outlives the dev server fails every probe after it with "the page never set
  up __engine"; rerun those, and the runner starts `make dev` again. The runner also checks the server when a probe fails, and waits a minute for a rebuild, then starts `make dev` before the retry (`devRestarted` in the result, #391).

## Index of feature checks

### Cube worlds (`docs/architecture/cubes.md`, Checks)

- Opening, saving and reverting a world (probe `cube-world`)
- Drawing and the layer slice (probe `cube-draw`)
- The Cubes tool (probe `cube-build`)
- Camera, minimap, World Properties and the Start dialog (probe `cube-camera`)
- The cube palette, its sets and prefabs (probe `cube-palette`)
- Recovery and scene copies, the toolbar and menus (probe `cube-copies`)
- Selecting, copying and moving boxes of cubes (probe `cube-select`)
- Play World (#33)

### Rendering (`docs/tests/rendering.md`)

- Graphics › Quality presets (#203)
- Losing and restoring the viewport's WebGL context (#209)

### UI and the window (`docs/tests/ui.md`)

- Session restore (reopening the last tabs at start)
- Autosave and recovery (#177)
- The desktop window itself (closing with unsaved worlds, #188)
- Hover previews in tile grids (no gap between tiles)
- Names under the tiles (#655)
- Menu heights (#122)
- Hide panels (Tab)
- Toolbar on the right (#654)
- Tool hints
- Help window
- Preferences from two windows
- Saving bar (#343, probe `saving-bar`)
- Top-down view (U)
- Log window (and the session log file, #319, probe `session-log`)
- Minimap window (M)
- Projects (#48)
- Accessibility (#354)
- Dialog focus and Esc (#369, #573, probe `dialog-focus`)
- Menu keys (#370, probe `menu-keys`)
- Interface size (#372, probe `ui-scale`)
