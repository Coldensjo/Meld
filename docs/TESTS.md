# TESTS.md

Ways to test and verify Meld that are known to work. Read this before working out how to check
a change, and add to it when you find a good way to test something (see CLAUDE.md).

This file holds the general methods. The checks for each feature are in `docs/tests/<area>.md`,
listed in the index at the end: find the feature you are changing there and read its entry. A new
entry goes in its area's file and gets a line in the index; a new general method goes here.

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

- `make test` runs `go test -short ./internal/...`, `go test -short .` (the root package, only when `frontend/dist` exists, since it is `//go:embed`ed; otherwise it prints a skip line) and the frontend unit tests (`bun test ./tests`).
- `make test-full` is the same without `-short`: it also runs the five heavy client scans (`TestSpawnModelsLoad`, `TestServerNavTiles`, `TestSpellColumnsMatchClient`, `TestSpellStartersLive`, `TestClientAnimatedLayersKept`), which skip under `-short` with "heavy client scan; run make test-full". Measured on the owner's machine (#401): the gated ones add about 7 s (`make test` 30 s, `make test-full` 37 s). The loop's coordinator runs it once a run. Trap: `-short` hides any heavy test a worker adds, so a test over about 5 s belongs behind `if testing.Short() { t.Skip(...) }`.
- `make fuzz` (#499) mutates the client parsers' fuzzers for 10 s each: `FuzzParseM2`, `FuzzParseWMORoot`, `FuzzParseWMOGroup`, `FuzzParseMLIQ`, `FuzzDecodeBLP`, `FuzzDXTOf` (`internal/wow/fuzz_test.go`), `FuzzParseTerrain` and `FuzzParsePlacements` (`internal/adt/fuzz_test.go`). Each asserts no panic; their seeds are the synthetic buffers the other tests build and run in `make test` as plain tests. A crash is written to `testdata/fuzz/<name>/` beside the test: fix the parser, keep the file as a regression case (it holds only the mutated bytes, no Blizzard data). Run one with `go test ./internal/wow -run '^$' -fuzz '^FuzzParseM2$' -fuzztime=30s`. Trap: Go allows one `-fuzz` target per run, hence the loop in the target; `ParseM2Look` with a `Look` is not fuzzed (the nil-look path only).
- `make check` runs go vet (`./internal/...`, and `.` when `frontend/dist` exists) and svelte-check/tsc. svelte-check runs twice: on `tsconfig.app.json` (`src`) and on `tsconfig.tests.json` (`frontend/tests`, which Bun runs with types erased, so a fixture that drifts from its type fails `make check`, not `make test`).
- `make check` also runs `make lint`: golangci-lint with the committed `.golangci.yml` (errcheck, govet, ineffassign, staticcheck, unused; tests are left out of errcheck). Discard a best-effort error as `_ = f()`. It skips with a note when golangci-lint is not installed (README), and lints only the files for this OS, so a Linux-only file is checked only on Linux.
- `make check` also runs `make notices-check` (`frontend/scripts/notices.mjs --check`): it fails when a bundled npm package or linked Go module comes under a licence outside the permissive allow list, or when `THIRD_PARTY_NOTICES.md` is out of date. After `bun add`, a Go bump or a lockfile change run `make notices` and commit the file. It needs `node_modules` and the Go module cache.
- `tests/history.test.ts` covers the undo stack (`state/historyCore.ts`: push, the step limit and
  the byte budget, replaceTop, goTo, clear) through a plain sink; `state/history.ts` only wires that sink to the
  runes state. Trap: Bun doesn't run the Svelte compiler, so a test that imports `editor.svelte.ts`, or any module that
  reaches it (the tools, `ObjectLayer`, `Terrain`'s palette), puts `import './runes.ts'` first: it makes `$state` a
  plain value and the module loads with its real defaults. Don't `mock.module` the editor or `wow/api.ts` without
  the rest of the module (`...await import(...)`, as `releaseAsset.test.ts` does): every file runs in one process and
  a module mock lasts the whole run, so a later file that needs another export fails only in `make test`, not alone.
- `tests/terrainRaycast.test.ts` runs the terrain ray-march (`rayMarchGround`) on a flat stand-in ground with a hole: straight and slanted rays through the hole, a miss, `solid` (#528).
- `tests/heightField.test.ts` runs the bilinear `heightAt` (shared by `Terrain` and the shadow bake) and the ray-march over a cliff: a slanted ray onto the top, a low ray into the face, a ray from outside the box, one to the sky (#536).
- `tests/terrainStroke.test.ts` checks that a `TerrainStroke` keeps only the cells that changed (a whole-mask
  step that sets a corner holds that corner, `Command.bytes`) and that its undo and redo restore them, on a
  fake terrain, and that every layer (heights, paint, mask, holes) round-trips exactly, `settleSlots` restores whole
  chunks, a `touch*` without `reserve*` still records and warns, and `ShadowStroke` goes back to no shadows (#462);
  `tests/blockSnapshot.test.ts` covers `BlockSnapshot.diff` and `GridPatch` underneath (#444).
- The client and server tests (about 95 in `internal/adt`, `internal/wow` and `internal/vmangos`) find
  their folders through `internal/testclient` (#400): `testclient.DataDir(t)` is `WOW_DIR`, else
  `config.json`'s `wowPath`; `testclient.ServerDir(t)` is `VMANGOS_DIR`, else `vmangosPath`, and skips
  when the world database in the server's `mangosd.conf` does not answer (a TCP connect), so a stopped
  mariadb skips the database tests instead of failing them; `ServerFolder(t)` is the same without the
  database check, for tests that read the server's files. Each skips the test when it finds nothing, so
  a machine without Meld set up skips them all, and on the owner's machine they run in a plain
  `make test`: `go test ./internal/...` went from 3 s and 98 skips to 29 s and 4 skips (the three
  database-writing tests below, and `TestIronforgePatchIsBackedUp`, which needs a particular patch-3).
  A set variable still wins (`WOW_DIR=/path/to/client go test ./internal/wow/ -v` for another client).
  To see what a machine without a client runs (CI), leave `WOW_DIR` unset and point the config folder at an empty
  one: `APPDATA="$(cygpath -w $(mktemp -d))" go test ./internal/adt/ -v` in Git Bash (`XDG_CONFIG_HOME` on Linux).
  A new client test calls the locator rather than `os.Getenv`; a test that writes the world database
  (`TestCreatedGUIDLive`, `TestSpellStartersLive`, `TestSpellScriptsLive`) keeps the explicit
  `os.Getenv("VMANGOS_DIR")`, and the guard below enforces it.
- Go tests never write the real client or the live world database (#402). `TestNoTestWritesRealClient` (`guard_test.go`, root package) parses every `internal/**/*_test.go` and fails when `InstallPatch`, `SaveRegion`, `AddPending` or `ExportMap` (its second argument) gets a folder derived from `os.Getenv("WOW_DIR")` (through `ResolveDataDir`, `filepath.Join`, ...) instead of `t.TempDir()` or a hard-linked copy (`clientfolder_test.go`); `AddPending` is allowed where the test points `pendingRoot` at a temp folder. `testclient.DataDir` counts as the real client too. It fails on `config.Load` in any test file but the config package's (the locator, `internal/testclient`, is not a test file), and on a `testclient.Server*` call in the tests listed in `guardDBWriters`, which write the world database and so must name it through `VMANGOS_DIR` (`TestCreatedGUIDLive` inserts a row that must fail on its key; the database is MyISAM, so a rollback undoes nothing). A new test that writes the database goes on that list. Limit: a real folder passed on to a helper that writes is not followed. `TestGuardCatchesRealClientWrite` checks the guard on scratch sources.
- `TestMeshEncodeLayout` and `TestCollisionEncodeLayout` (`internal/wow/encode_test.go`) check the
  mesh and collision bodies against the `binary.Write` layout they replaced and that the buffer is
  sized exactly (#503). `go test ./internal/wow/ -run X -bench MeshEncode -benchmem` gives the bytes
  and allocations of encoding a 54k-triangle mesh (6.6 MB and 20 allocs before #503, 2.1 MB and 6 after).
- `internal/wow/m2header_test.go` (#487) checks that an M2 cut short inside the vanilla header
  (0xB4..0x143 bytes, synthetic) is an error, not a panic, and that `/wow/model` answers it, and any
  handler panic (`RecoverPanics`), with a 500. A request needs `c.set` non-nil (`&mpq.Set{}` in the
  package's tests) before the overlay (`SetOverlay`) is asked. Trap: the panic only kills the app in
  the desktop build; `wails dev`'s net/http server recovers it, so the dev page never shows the crash.
- The same locator runs the client checks in `internal/vmangos` (region round trips, the chunk
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
  don't use it for an exact comparison; Westfall (31,49) is exact. `BuildRegion` returns the block's tiles
  first and the WDL last, so a test that walks the block's tiles takes `files[:size*size]` and the WDL
  `files[len(files)-1]`. Between them may sit tiles outside the block that list a model an earlier
  compile moved (#647), so their number depends on the client's `patch-3.MPQ`: a WOW_DIR test must hold
  with and without them (`TestRegionNoEditRoundTrip`, `TestClientRegionAddedModelIDs`, #667).
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
  test recolours one). `TestWriteLightsSynthetic` (no client needed, #403) checks the same on tables it
  builds (`lightTestTables`: 0xcccccccc slots, a band out of time order): an unchanged write is
  byte-identical, a recolour changes only that value's four bytes, new times keep the unused slots, and
  `LightFiles` names only the changed tables by their `DBFilesClient\` paths (a wrong path writes a file
  the client ignores, with no error).
- The adt tests that read a whole tile (`TestTileIntegration`, `TestWriteHeightsIntegration`, `TestNormalsMatchFile` and the
  `TestRewrite*` ones that took the client's tile) run through `eachTile` (`internal/adt/rewrite_test.go`, #497): a
  `synthetic` subtest on `syntheticTile`, a 32_48 tile made by `BuildTile` with every piece a client tile carries (one to
  four layers with alpha, two M2 and a WMO, river, magma and sea, shadows, holes, impassable chunks, area IDs, and MCSE
  records spliced in raw), and a `client` subtest on Azeroth 32_48 that skips without a client. So they guard the tile
  writer on CI and any machine; `TestSyntheticTileHasEveryPiece` checks the fixture still has every piece. Traps: a
  piece Meld never writes (MCSE) is spliced in with MCIN moved by hand, not through `Rewrite`, or a writer that drops
  it would hand the tests a fixture that already lost it; and the synthetic normals check is the writer against itself
  (stored normals match `normalAt` after an edit), so the comparison with Blizzard's normals stays client-only.
- `TestAddGroundEffectSynthetic` (no client needed, #403) is `TestClientAddGroundEffect`'s client-free
  twin: the new GroundEffectTexture row names its models by GroundEffectDoodad's internal IDs (field 1;
  0 is a model, an empty slot is 0xFFFFFFFF), the old rows and the string block stay byte-identical.
  `AddGroundEffect` writes only GroundEffectTexture; the doodad table is read, never written.
- Normals (#492, #668): `TestNormalsMatchFile`'s `client` subtest (WOW_DIR) recomputes the normals of steep and gentle
  chunks inside Azeroth_32_48 and Azeroth_31_49, which must match the file's to the byte, and the
  south, west and east borders of Azeroth_30_40 with the ring from its neighbours, which must stay
  within a twentieth of their bytes and beat both one-sided normals and a ring without the inner
  samples across. Traps: some of the client's chunks have normals that don't follow their heights at
  all (Azeroth_32_48 chunk 0, the first chunk row and column of 31_49, 30_40's north border, whose
  heights differ from the north tile's in 22 shared samples), so pick chunks and sides that were
  checked; and the client truncates each part (`int8(v*127)`), so rounding puts half the bytes 1 off.
  `TestRegionNormalsReachTheTilesBeside` (no client needed) sculpts the column one in from a block's
  east edge and checks the client tiles east of it get their west border normals redone to match,
  heights and other chunks kept, an unedited save and the same edit from the patch writing neither (#666).
  `TestBuildTileNormalsMeetAcrossTheBorder`, `TestWriteHeightsRefreshesTheBorderWhenTheRingMoves`
  (`internal/adt`), `TestRegionNormalsMeetAcrossTiles` and `TestRegionNormalsReadTheInnerSamplesAcrossTiles`
  (`internal/vmangos`, made-up maps in a temp MPQ; the second gives the client tiles inner samples off
  their corners' mean, which the first's don't have) need no client. Trap in a made-up map: give a client tile a ring side only toward a tile the map
  has, or the block's corner samples differ from it for no fault of the export.
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
  `__loadScene` checks the whole line first (`parseScene`, tests/scene.test.ts): a scene must be complete
  (`v`, `map`, `view`, `prefs`, `tool`, `selectedIds`, `selected`, `viewport`), or it throws naming the field and changes nothing.
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
  - `make build-windows` while `wails dev` runs is fine. It runs from PowerShell too: on Windows the
    makefile runs its recipes through Git for Windows' sh (`GIT_SH`, by default
    `C:/Program Files/Git/usr/bin/sh.exe`); without it, make fails with "CreateProcess sh.exe".
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

## Probes (`bun run probe`): checks in the live app you can rerun

Checks: a feature still works in the real app against the client's assets, in one command, with
a few lines of JSON as the result. **Reach for a probe first**: run the existing ones that touch your
change, and write a new probe instead of an ad-hoc CDP script when the check is worth repeating.

- `make dev` should be running. The runner checks `/wow/status` and the page itself (a dead Vite
  leaves `/wow/status` answering while the page is a 502); if either fails it starts `make dev`
  detached (log: `meld-dev.log` in the temp folder) and waits up to 10 minutes, a few minutes in
  practice. It stays up for the next run; with `MELD_URL` set it never starts one. Keep it running across items.
- `cd frontend && bun run probe <name...>` runs those probes, `bun run probe --all` (or `make probe`)
  runs every one but the benchmarks (`bench`, `perf-*`, about 8 of the 31 minutes; name them, or `make probe-perf`, #390), which keeps a whole run under the agent harness's 30-minute task limit (a foreground command gets 10, so run it in the background and read its log, one line a probe, rather than piping it through `tail`), `bun run probe --list` names them, `--touching <git range>` runs the ones a change touches (below), `--shot <dir>` saves a screenshot each (of a frame the runner draws after the probe, since the loop is stopped) and
  `--profile` adds the probe's 12 functions with the most CPU time (self / total ms; it found #233's
  stalls in one run), each followed by `<=` and its heaviest caller chain up to the first Meld `src/` frame, with that
  chain's share of its self time (so three's `intersectTriangle` shows which Meld code raycast). `PROFILE_TOP=<n>`
  prints `n` functions instead: a benchmark map's top 12 are all its loading and the fence waits of `P.frames`,
  and a frame's own work (three's `setProgram`, `ParticleLayer.update`) starts below them. To weight a profile to
  frames, step many after the map settles (the 2026-10-18 sweep stepped 40 turning the camera, then 40 still). Each probe gets a fresh page (`?nosave&nosession&defaults`: the owner's config is safe and not read,
  and the page doesn't reopen their last session) in a headless Chrome on SwiftShader. Without
  `nosession` a region from the session finished opening after the probe's `newDocument`, took the
  active tab, and its spawns, read seconds later, replaced the probe's (#250: `object-entry` and
  `object-loot` timed out once the owner's session held a region). It prints one JSON line a probe and exits 1 if any failed. A page
  error also fails the probe (the error of Wails' `ipc.js`, which a plain browser page always throws,
  is left out).
- **`[Unhandled error] TypeError: Cannot read properties of null (reading 'nodes')` in the `make dev`
  terminal** on every page load (stack in `/wails/ipc.js`) is Wails v2.16.0's, not Meld's (#335): its
  injected "disconnected" overlay is compiled with Svelte 5 but mounted with the old `new Component()`
  call (reported as wailsapp/wails#6317). It is harmless, dev-only, and the probe runner already skips it; don't chase it.
- **The smoke set** (#398): `make probe-smoke` (or `cd frontend && bun run probe --smoke`) runs the probes whose leading comment block holds a `// tier: smoke` line (next to `touches`), so the list lives in the probes: `attach-follow`, `compile-launch`, `compile-spawns`, `dialog-focus`, `hide-panels`, `hotkeys`, `menu-keys`, `path-road`, `shadow-redraw`, `shortcut-table`, `terrain-cell-tex`, `tool-hints`, `undo-sculpt`. They are fast (a flat map or a dialog, no benchmark scene), deterministic (no pixel diffs or timing thresholds) and guard shared code (`App.svelte`, `Modal`, the menu bar, `History`, `ObjectLayer` attachments, the compile state, the terrain shader's sampler budget, shadow redraws). About 100 s in all (81 s without `shadow-redraw`, 19 s). Add a probe only if it is under about 10 s and loads no scene; `--smoke` combines with names and `--touching`.
- **The probes for a change** (#397): every probe's leading comment block holds a `// touches:` line,
  the source files it checks as repo-root paths or globs, comma-separated (`frontend/src/lib/world/nav/*`,
  `internal/vmangos/spawnedit.go`; `*` stays in one folder, `**` crosses folders, a path ending in `/` takes
  what is under it). `cd frontend && bun run probe --touching <git range>` (e.g. `HEAD~3..HEAD`, or
  `origin/main` for the working tree's change against it) runs every probe, but the benchmarks, whose
  globs match a file `git diff --name-only <range>` lists; add `--list` to only name them. A probe also
  touches its own file, a change to `probes/lib.js` picks every probe, and a probe with no `touches`
  line is picked by every range, so a forgotten line only runs too much. A range no probe touches (only
  docs) runs nothing and exits 0. `--list` prints each probe's line. When writing a probe, list the
  component and the engine module it drives and the Go file behind the bindings it calls, not
  `Engine.ts` unless the probe checks the engine itself (most probes go through it) and never
  `frontend/wailsjs/` (`wails dev` regenerates it on any binding change, which would pick every probe).
- **A hung or throwing probe names its place** (#301): a probe running over 5 minutes (`PROBE_TIMEOUT`, seconds) is stopped with `timed out after N s` and `step`, the `P.until` it waited in (its `what`) or the `P.settle` with its client reads pending (`window.__probeStep`); a throw prints `line`, `<file>:<line>:<col>` of the probe body where it stopped. Give every `P.until` a `what`.
- **A lost page does not stall the run, and a failure is retried once** (#388): every CDP command times out or fails when the page's socket closes, so a probe whose page timed out, navigated away or closed no longer leaves `--all` waiting for ever. After such a loss (`lostPage` in the line) the runner kills its own headless Chrome (found by its port and profile, never the dev window) and starts a new one, ends a throwaway client the lost page had left on, and runs the probe again. Any failed probe gets that one retry in a fresh page: if only the retry passes, its line has `flaky: true` and `firstFailure` (and `firstStep`) and counts as passed; a failure twice has `retried: true` and fails the run. Read a `flaky` as a page or load problem to look at, not as a pass to ignore. Trap: a trivial probe that returns at once (`return { ok: true }`) leaves the app half booted, and the next probe's page can then hang at setup; that is the same stall, and the retry covers it.
- **One-off checks**: `bun run probe probes/scratch/<x>.js` (any argument ending in `.js` or holding a
  slash is a path, from where you typed it) runs a probe file from anywhere, with `P` in scope.
  `frontend/probes/scratch/` is git-ignored: put diagnostics and throwaway views there, so they never
  land in a commit or in `--all`.
- Trap: a probe run that outlives its shell (a background `--all` stopped at its time limit) keeps running with its Chrome and doubles SwiftShader's load, so every timing is wrong (#257: a 2 s fence that is 0.6 s alone). The runner now lists other live runs at start (`probe: warning: another probe run seems alive`, with pids). Stop one with `Stop-Process -Id <pid>` (Windows; `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | ? CommandLine -match 'probes.run.mjs'` finds it) or `kill <pid>` (Linux).
- Trap: don't run `make build-windows` (or `wails generate module`) while probes run. The build
  regenerates `wailsjs`, Vite hot-reloads the page in the middle of a probe and it fails on a page
  error from `App.svelte?t=…` at `@vite/client`. Run the build before or after.
- After a new Go binding, the page can fail on a stale `wailsjs` App.js (the trap above); the runner
  sees "does not provide an export named", moves App.js out and back so Vite reloads it, and runs the
  probe once more (`refreshedWailsjs: true` in its line).
- A probe is `frontend/probes/<name>.js`: the body of an async function run in the page, whose first
  line is a `//` comment saying what it checks (`--list` shows it). It returns an object; `ok: false`
  or a throw fails it. `P` (`probes/lib.js`) is in scope:
  - `P.e` (the Engine), `P.scene(line or object)`, `P.BENCH` (the benchmark scene), `P.settle()` (waits for client reads and the spawn layer's version to go quiet, #393)
    (frames until the client reads stop), `P.frames(n)`, `P.until(fn, ms, what)`, `P.perf()`
    (`measurePerf` with frames stepped), `P.state()` (the app's own `editor`/`prefs`/`ui`),
    `P.app(path)` (any app module, the page's own instance) and `P.glError()`.
  - Pictures: `P.shot(draw?)` steps a frame (or runs `draw`) and reads the canvas back in the same
    task (so whatever the frame sets each frame, such as a mesh's `visible` from a preference, is set
    back before the read: hide such a mesh through its `material.visible` instead), `{ w, h, px, lit }` (`lit`, the share of pixels not black, so a blank read can't pass as
    "the same"); `P.diff(a, b, threshold, region)` gives the share of pixels that differ (`off`) and
    the mean difference; `P.busy(img, region)` how busy a picture is (neighbour differences: shimmer,
    noise); a region is `{ x0, x1, y0, y1 }` as shares of the picture, y0 = 0 the top.
    `P.only(object, fn)` runs `fn` with the rest of the scene hidden. For "looks the same with the
    switch on and off", take two shots with the switch unchanged as the noise floor (swaying trees,
    particles); `wmo-cull` and `terrain-dxt` do this.
  - Looking at a picture: `P.save(img, name, region?)` keeps a shot as a PNG, which `bun run probe <probe> --shot <dir>` writes to `<dir>/<probe>-<name>.png` (the page's own `--shot` capture is `<probe>.png`; without `--shot` the saved pictures are dropped, and their pixels stay out of the printed result). `P.fullView()` hides the panels (Tab) so the viewport fills the window, about 1384 x 745 instead of 1017 x 387 under the asset browser, which matters for pixel-sized effects such as snow; call it before `P.shot`.
  - Looking at a client texture: `await P.texture(path, { size?, alpha? })` returns a picture like `P.shot`'s
    (so `P.save` and `P.diff` take it) from the decoded RGBA, scaled to `size` px square if given; `alpha: true`
    shows the alpha channel as grey (where an atlas is cut out, which end of a streak is bright). Write the
    client path with the Write tool (backslashes), and save with `bun run probe <probe> --shot <dir>`.
  - Which object drew a pixel: `P.whoDrew(x, y)` (shares of the viewport, y = 0 the top; default the centre) renders one
    extra frame in which every mesh ends in a flat colour for its index, and returns `{ name, type, chain, batch, material }`
    of the mesh at that pixel, or null for the background (#299). Each mesh gets a material inheriting from the real one,
    so shaders' vertex work, depth state and discards are as drawn; blending is off and fragments under alpha 0.1 are
    dropped (a soft particle does not cover what is behind it). Points, lines and sprites are hidden for the pass, and
    the selection outline is not drawn. `batch` is the object layer's key for an instanced model. Name a mesh
    (`mesh.name = ...`) in the engine to make its answer readable; `brd-pit` checks it against the #289 floor plane.
    A pixel on an antialiased edge reports a neighbour (`near: true`).
  - Viewport input: `P.click(x, y, opts, frames)` moves, presses and releases the pointer on the canvas and steps a frame; `P.drag([x, y], [x, y], steps, opts)` strokes; `x`, `y` are shares of the viewport, y = 0 the top, `opts` the event's `button`, `altKey`, `ctrlKey`, `shiftKey`. Setting `e.ndc` does not do this: the handlers overwrite it from the event. The status bar and tool state are read after the helper returns (its frame lets the handlers' messages land); `walkable` uses it.
  - Aiming and menus (#309): `P.lookAt({ x, y, z }, { yaw, pitch, back })` flies the camera `back` yards from an editor point, looking at it, whatever Follow the Ground says (a flying camera is its own target, so a view "on" a point puts the camera inside it; a following one lifts the target onto the terrain, above a cave). `P.contextMenu(x, y)` right-clicks the viewport at shares of it (default the centre) and returns `ui.contextMenu` (null for no menu); `teleport-trigger` uses both. Trap: on the benchmark scene (Follow the Ground on) the view still moves for a few frames after `P.lookAt`, so a probe comparing two states frame by frame steps `P.frames(3)` first and checks the first state again after the second (`particles-reach` failed once without it, #330).
  - Writing the client (#368): `await P.sandboxClient()` points every client read and write of the Go side (`clientDataDir`, the asset server's archives) at a throwaway copy of the client's Data folder in the user's cache (`Meld/probe-client`: the archives hard links to the real ones, a symbolic link across volumes, and `patch-3.MPQ` a copy made afresh at each call), so a probe can press what writes Meld's patch (Import PNG…, Save in the spell editor, Generate) and check the result in the app. It throws when it can't, so a probe never writes the real client by mistake. `P.endSandbox()` ends it and returns `realUnchanged` (the real patch kept its size and time), which a probe should check; the runner ends it after every probe anyway. `P.sandboxFile(name, bytes)` writes a file (a `Blob` or bytes made in the page) into its scratch folder and returns the path, for a binding that reads a file the user picked; stub the dialog binding (`window.go.main.App.OpenIconsDialog = async () => [path]`, restored in a `finally`), since the wailsjs wrappers look it up at call time. `icons` is the example (`loading-screen` and `world-map` too). Traps: only `wails dev` offers it; the owner's dev window shares the Go process, so while it is on that window reads and writes the copy too, which is why it ends by itself after 10 minutes; and nothing that closes the game, starts the servers or writes the server's tables runs meanwhile (`gameSession`, `clientRoot`, an `installClient` with server tables and every binding that writes the world database answer with an error: a saving binding takes its server folder from `serverForWrite` or `optionalServerForWrite`, never `serverAndData`, and `TestSandboxRefusesWorldDatabaseWrites` lists them, #383), so a check of those still needs the real client and database. A new binding that writes the world database belongs in that test (`make test` runs it when `frontend/dist` exists; by hand, `go test -run TestSandbox .` at the repo root).
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
    from the loop. The previews' own loops (`lib/ui/previewRenderer.ts`) still run, while their model moves (#589).
  - A probe frame takes about 250 ms even on a flat map, so a throttle measured in milliseconds
    (once every 100 ms) fires on every `P.frames(1)`. To check one, call the tool's own `frame` (or
    `onMove`) many times in a loop without stepping frames, as `drag-state` does for the vertex slope
    (#448). And `history.steps().length` counts redo steps too: compare `history.position` instead.

  A probe on a fresh flat map (`P.e.newDocument(256, 'flat', 0, 'Probe')`) takes about
  4 s; one that loads the benchmark scene about 90 s, nearly all of it SwiftShader drawing the region.
- The probes on 2026-10-17: `tool-hints` (#238, tool hints in the status bar, not the options bar), `hide-panels` (#248, Tab gives the viewport the whole window), `options-more` (#254, the options bar keeps one row and More shows the rest), `probe-helpers` (#348, P.time, P.stroke and P.turn), `smoke` (the benchmark scene draws, no errors), `bench` (its numbers), `perf-*` (#322, each benchmark map's numbers, below),
  `undo-sculpt` and `undo-holes` (an edit and its undo on a flat map), `stamp-settings` (#445, the Stamp tool's per-brush settings copy holds only `TOOL_SETTING_KEYS`, never the region's spawns), `drag-state` (#448, a model drag reaches `editor.selected` and an area drag `editor.selection` at the next frame, not on each pointer move; a path point reaches `editor.paths` on release; the vertex slope slider records its undo step at most every 100 ms and once at rest; a full chunk's paint message shows once a stroke), `undo-spawns` (#193, undoing a Spawn brush stroke of 60 creatures redraws the spawn layer once; needs the world database), `wmo-cull` (#198's Stormwind
  cull, in the scene pass and the near shadow cascade, #215), `terrain-dxt` (#216's DXT3 tileset
  array draws the ground as the RGBA one does, and #225's mips smooth the distant ground), `object-entry` (#136, a game object spawn turned into
  another in the game object editor, and undone), `object-tilt` (#229, the Sunken Chest drawn tilted
  and its rotation kept by a move's SQL), `object-loot` (#220, a vein's shared loot list in the game
  object editor's Contents tab, a copy of its own, an added item, Make it a chest and the respawn time,
  nothing written), `walkable` (#175, the navmesh view's tiles, a path round holes, a WMO's floors), `walkable-worker` (#508, the benchmark scene's tiles built in the Web Workers match a main-thread build, with a shorter longest `NavPreview.update`), `walkable-server` (#240, the server's own mmaps in the benchmark scene, drawn on the ground and walked; needs the VMaNGOS folder's `data/mmaps`), `walkable-wmo-liquid` (#281, Ironforge's forge lava is slime area in the browser's build as in the server's mmaps; needs `data/mmaps`), `erode` (#165, the Erode brush and the area pass on a Mountains map, with undo; #242, the area pass's settled mask), `weather` (#185, rain, snow and a sandstorm with the storm light, and the Zones dialog's weather sliders), `weather-wind` (#244, rain's ground splashes and #316, snow's settled flakes, the wind's lead and streak tilt, and the weather through a Stormwind shop's door; #315, from outside its door the drops under its roof hidden), `zones-fit` (#247, the Zones dialog has no horizontal scrollbar), `creature-spells` (#243, the creature editor's Spells tab: a creature's list with names, icons and text, a search and add, Revert; nothing written), `creature-spell-fields` (#255, the Creature tab names its auras and its spawn spell; #367, their Find browses spells by category; nothing written), `spawn-drag` (#514, moving a spawn a frame at a time leaves `SpawnLayer.version` alone, the moves being read through `moveSeq` and `movedSince`; needs the world database), `spawn-groups` (#172, formations and pools read, built by clicks, written as SQL and undone; nothing written), `quest-editor` (#259, a quest's names, givers and unsaved bad edits, over the creature editor; nothing written), `object-quests` (#293, the game object editor's Quests tab, and a chest offered no quests or giver slot; nothing written), `object-find` (#351, Tools › Game Objects… opens on Find object, searches by name and entry and opens the result; nothing written), `messages-conditions` (#160, the creature editor's Messages tab lists a text shown under a condition as an editable row, with Save, Revert, Add text and ✕; nothing written), `loading-screen` (#218, Map Properties lists the client's loading screens and previews the chosen one; #382, Picture… writes a PNG made in the page as a new one in the throwaway client), `hole-walls-fade` (#249, the hole walls show near the camera and round the cursor, not from across the map), `instance-open` (#222, the Start dialog picks a block on an instance's tiles and opens it; #271, a WMO-only instance opens as its building), `wmo-only-frame` (#272, a WMO-only map made with New World: Launch's spot over its building is the server's 0,0, where Publish writes the building, and the corner's frame once WMO-only is unticked; nothing written), `compile-alpha` (#526, a compile in the throwaway client keeps every unpainted chunk's alpha bytes and changes only the painted spot's texels), `restore-paint` (#645, a chunk compiled painted into the throwaway client's patch, restored to the client's paint with undo and redo and compiled again, reads back as the client's own), `region-alpha` (#636, Azeroth 31_49 3x3's alpha maps come as one GET from `/wow/handoff`, not in LoadRegion's JSON: 4096 bytes a layer but each chunk's first, the URL served once; prints the ms of the call and the fetch), `brd-fly` (#286, flying through Blackrock Depths with the names over spawns on: the sight lines test the dungeon's WMO through its bounds tree and no frame stalls; needs the world database), `brd-pit` (#289, the Ring of Law seen from the stands draws the arena, not the floor plane under the map), `top-down-shot` (#554, `renderMinimapTile` on the benchmark scene draws the tile without a frame of the view: the frame counter and the clock stay put, the shot is lit and the same twice, and the report has the Paths and baked shadows section; prints the ms a shot), `world-map` (#219, World › World Map lists Elwynn's twelve exploration overlays and Generate redraws Northshire Valley's; #382, Write to Client in the throwaway client, read back), `teleport-trigger` (#306, a right-click on the Deadmines entrance trigger teleports into the Deadmines, and a spellcaster portal's destination is read; needs the world database), `flight-paths` (#180, World › Flight Paths in Redridge: Lakeshire's stop picked and dragged, a route's point drawn, Fly it and back; nothing saved), `wmo-collide` (#305, with Camera Collision on a 13 yd step at a Trade District wall stops off it, in the room, the near plane at 0.5 yd; off, it flies through; #310, the eye comes down to 3 yd over the street's floor), `walk-wmo` (#312, Camera › Walk stands 3 yd over the Trade District street's floor, not the terrain), `wmo-nav-fail` (#515, Stormwind's room data made to fail once is counted, logged and not fetched each frame, and loads on the retry after `RETRY_MS`), `shadow-redraw` (#326, a still view redraws neither sun shadow map; moving an object, sculpting, holes, undo, a layer toggle and a turn of the camera each redraw the near one; #324, the far one holds through a small turn and a sun moved under 0.1°, and is redrawn after a long pan or a larger sun move), `shadow-poses` (#346, on the creatures and objects-mixed maps with animations on, a still view draws only the moving models into the near shadow map, and with the clock held the view matches a full redraw and differs without the moving pass), `shadow-sun-drift` (#366, with the sun stepped under 0.1° a frame, the near map's lookup matrix stays the one it was drawn with until its redraw), `pose-drawn` (#328, on the creatures map only the animated spawn types the cull drew are posed each frame, none while creatures and NPCs are hidden, all again on the frame they show, and with Prop animations off each drawn type holds its first frame), `attach-follow` (#329, attached objects follow their parent's drawn instance through a move, an undo-style snapshot that detaches one, re-parenting, a type change, a sculpt re-snap and the parent deleted and added back, on a flat map), `object-move` (#510, dragging one of 3000 cubes of one type rewrites its own instance row and packs nothing again, a sculpt re-snap leaves every drawn row matching its object, and the moved cube is picked where it went, on a flat map), `objects-near` (#512, on the everything benchmark map the Clear tool's models under the brush, the Doodad brush's spacing neighbours and prop list, and the area's objects, read from the layer's cells, match a scan of every object, after the models loaded and after a move of every tenth root; prints the ms a call; about 90 s), `select-groups` (#630, on the everything benchmark map with every root in a group of ten, `withGroups` for each model under a Select brush, read from the layer's group index, matches a scan of every object, and Group and Ungroup with their undo keep the index; prints the ms a brush spot against the scan's; about 90 s), `hand-tilt` (#344, Z+scroll tilts and rolls the Place preview 5° a notch with the camera still, the click places with that tilt over Random tilt, a selected model tilts as one undo step and flips past 180°, scrolled back to 0 Random tilt applies again, and with Z released the wheel tilts nothing), `place-spawn-size` (#672, the Place tool's preview of a creature and a game object template sized away from 1 is drawn at the spawn's size, Shift+scroll leaves it, and the placed spawn matches; needs the world database), `world-settings` (#571, Map Properties' sea on/off, sea level and rock/dirt roles through `setWorldSettings`: one undo step each, dirty flag, undo and redo, roles surviving a tab switch), `activate-same` (#547, Ctrl+Tab with one tab and activating the open document keep the palette and dirty flag the editor holds; with two tabs a cycle still moves and back), `tab-switch-drag` (#549, a tab switch in the middle of a gizmo drag on one model and on a group of two puts the turn's one undo step in the tab it began in and none in the other, and drops an Alt+right brush-size drag; the switch goes through `switchDocument`, since `cycleDocument` lands on whatever tab the dev page has open next), `gizmo-undo` (#694, the Select tool's gizmo on a flat map: one model's ring, height arrow, scale knob and move arrow, and a group's ring and arrow, each one undo step that Undo and Redo restore), `hover-outline` (#641, the faint stroke round the helper cube under the pointer with the Select tool: cleared off it, none on a selected cube, no pick while still, none with the pref off or the Sculpt tool), `selection-visuals` (#551, on objects-mixed the outline colours of 16 floating models and one model's warn boxes match a scan of every object, still, dragged, moved away, beside a hidden model and a prop attached elsewhere; prints `updateSelectionVisuals`' ms a frame; about 3 minutes), `outline-heights` (#567, the selection outline's red underground marks follow a sculpt stroke through the terrain's shared height texture, which uploads only the edited texels), `effects-drag` (#511, on the lights benchmark map a brazier dragged a frame at a time and a sculpt stroke under the braziers update the lights, flames, particle pools and model boxes of the moved objects without a rebuild, leave no shadowed light dark for a frame, and match a full rebuild; #629, the three shadowed lights' cube maps are redrawn in turn through both, about a frame in three each (`redraws`), not light 0's every frame; prints the ms a frame of `PropEffects.update`, `ParticleLayer.update` and `WmoRooms.update` for before and after), `particles-reach` (#330, the far-emitter pre-test runs the same particle pools and ribbons as the exact range and view test, on the benchmark scene; `PROBE_MAP` for a benchmark map), `item-editor` (#353, Tools › Items…: the Worn Shortsword's tooltip, held and alone, typed values in the tooltip, a level past 255 left unsaved, Change look… and Change icon…, Stats one a row with an Equip bonus, the right-click .additem copy, a bow's look shot visual, New item from a kind; #355, a set piece's set block; nothing written), `spell-editor` (#294, Tools › Spells…: Fireball's tooltip with its tokens filled in, its effects and visual, typed values in the tooltip, a cost past an unsigned int left unsaved, Change icon… and Take the visual of; #360, New spell's starters; nothing written), `spell-visual` (#361, the visual composer: Blizzard with Rain of Fire's area, a hovered and a picked effect model, Use this visual waiting for Save; nothing written), `patch-cache` (#471, a patch write in the throwaway client keeps Stormwind's decoded WMO in the asset server's cache and reads a rewritten icon again), `icons` (#364, the icon grid's Import PNG… and Export … as PNG…, the search narrowing the export, and the bindings refusing a missing file and folder; #368, Import PNG… of a PNG made in the page, listed and previewed, in the throwaway client; the real client left alone; #683, Tools › Icons…: a picked icon's name, SpellIcon ID and spells, Copy name), `nothing-to-draw` (#333, Blackrock's open-door collision M2 loads once, with no warning, as a wireframe marker of its hull that casts no shadow), `preview-idle` (#589, the asset browser's preview spins a hovered tile's model a few seconds and then draws nothing, spins again under the pointer, keeps to the FPS limit, and the Preview window on a helper cube draws only while Turn is checked; prints the frames each drew in 2 s; about 30 s), `release-asset` (#506, a waterfall built and released fifty times as a thumbnail, and the Preview window opened and closed on it, leave `animatedCount()`, the per-frame texture and colour animation lists, as they were), `release-models` (#505, the objects-mixed benchmark map, then the buildings one opened and closed: the registry's models, shared materials and model textures and the renderer's geometries return to the first map's numbers, and the renderer's own textures (those on the GPU that are not the texture cache's, `api.isCachedTexture`) within a few of the first map's; #658: the renderer's whole count (`renderer.info.memory.textures`) also grows with the cached textures uploaded only when first drawn, the liquids' animation frames (up to 30 a liquid, one as each frame comes round, so more the longer the run) and the first map's model textures newly in view, which made a whole-run check fail with +22, so the probe counts the textures on the GPU through three's `dispose` listeners and leaves the cache's out; the second map's liquid, particle and weather textures stay cached by design; about 2 minutes), `ui-scale` (#372, the interface at 150 %: fits, sharp canvas, pointer, menus and shortcuts), `reference-image` (#184, a plan laid over a flat map: drawn on the ground and over the top-down view, dragged, and turned into zones, heights, textures and the mask, each undone), `terrain-cell-tex` (#394, the no-tufts overlay and a lasso area's tint share one texture and draw together, and the terrain shader's samplers leave a unit free under WebGL2's 16), `model-worker` (#507, Stormwind's bounds tree, LOD and group cull built in the model workers: the longest stall while it loads, and the results against a main-thread build), `autosave` (#546, on a dirty 1024-cell map no recovery copy is taken while a stroke is held, and the copy after it encodes heights and paint over many turns with the fallback encoder forced, the longest stretch without a turn far under the one-go encoding's; #637, it sends them a slice a `SaveRecoveryPart` call, each call short; the copy loads back with the edits and is dropped; prints the ms of each and the longest stretch while the parts go), `console-clean` (#336, loading the benchmark scene logs no console warning or error and no HTTP 400+ besides a list of known ones with their issues, and the terrain asks only for the `_s` sheen twins the client has; drop a known entry when its issue is fixed). Port a recipe from `docs/tests/` into a probe when you next use it, and say in its entry
  that the probe exists.

## The live app without Claude in Chrome (headless Chrome over CDP)

Checks: the same as above, when the Chrome extension isn't connected (a `claude -p` loop run). The
probes above are this route packaged; use the raw route below for a one-off look (a screenshot
sequence, a question no probe asks). Start
`make dev` in the background, wait until `curl localhost:34115/wow/status` answers, then drive a
headless Chrome over the DevTools protocol from a scratch folder (not the repo):
`uv run -q --with websocket-client python -u cdp.py "http://localhost:34115/?nosave" shot step1.js step2.js`.
The script (about 40 lines) starts `chrome.exe --headless=new --remote-debugging-port=0
--user-data-dir=<scratch>\profile --window-size=1400,900 --use-angle=swiftshader
--enable-unsafe-swiftshader about:blank`, reads the port Chrome chose from `<scratch>\profile\DevToolsActivePort` (first line; a fixed port can
belong to another run) and the page's websocket from
`http://127.0.0.1:<port>/json`, sends `Page.navigate`, waits 4 s, and for each JS file runs
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

## The docs site (VitePress)

Checks: that `docs/` still builds into the site `.github/workflows/docs.yml` publishes. Run `make docs`
(or `cd frontend && bun run docs:build`); `bun run docs:preview` then serves
`docs/.vitepress/dist` at `http://localhost:4173/Meld/`. The build fails on a dead link between pages.
- A new page needs a line in the sidebar in `docs/.vitepress/config.mts`, or it is reachable only by search.
- Raw HTML in the Markdown renders as text (`markdown.html` is off, so `<placeholder>`s in prose
  don't break Vue); a link to a file outside `docs/` (the README, source files) must be a full GitHub URL.
- The scripts run Bun with `--no-install`: without it Bun auto-installs Vue from its global cache for
  the pages (which sit outside `frontend/`) and the build fails to resolve `@vue/runtime-dom`.

## Measuring performance (the overlay, #179)

Checks: where a frame's time goes, before and after a performance change. View › Performance overlay
(Ctrl+Shift+M) shows, averaged over a second, the CPU time of each `Engine.frame()` section
(`CPU_SECTIONS` in `engine/perfMeter.ts`, booked by `meter.mark` after each subsystem; `frame()` is
`simulate` then `draw`, and `renderTopDown`'s shots run `simulate` with the meter off, so they book
nothing), the GPU time of
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
  their numbers compare. `cd frontend && bun run probe bench` loads it, waits for the client reads to
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

  Baseline, `bun run probe bench` on 2026-10-17 after #215 (SwiftShader, so GPU n/a and CPU ms only
  compare between probe runs on this machine): 1996 draw calls, 697,402 triangles (2,052,549 before
  #215 culled Stormwind's groups in the near shadow cascade), 168 geometries, 719 textures, 325 MB
  heap; the most triangles: a Defias HumanMale (54k), Wolf (42k), nsabbey.wmo (35k), stormwind.wmo
  (33k). Since #253 the probe page runs on default prefs, so the numbers hold on any machine. Since
  #256 the scene turns Follow the Ground on (`P.BENCH`): the default flying camera took the view's
  target as the camera's own spot, down on the ground by the abbey (2001 calls, 743,861 triangles, and
  `terrain-dxt` read a flat far half). On 2026-10-17 after #256: 3015 draw calls, 2,574,488 triangles,
  185 geometries, 688 textures, 305 MB heap; the most triangles: HumanMale (54k), Wolf (44k),
  nsabbey.wmo (35k), stormwind.wmo (31k). On 2026-10-18 after #325 (a batch joins the near shadow
  cascade only with a drawn instance in its box): 1287 draw calls, 679,161 triangles (2026 and 853,913
  before it), 173 geometries, 722 textures, 314 MB heap. This table is history; the guard's numbers are in `frontend/probes/bench-baseline.json`.
  **The guard** (#429): `bun run probe bench` fails when draw calls, triangles, geometries or textures drift more than 10 % from `frontend/probes/bench-baseline.json` (the runner hands it to the page as `window.__benchBaseline`; the failing line gives both numbers). On 2026-10-25 it holds 1159 calls, 597,707 triangles, 175 geometries and 727 textures; calls vary by a few with late spawns and triangles by under 0.1 % (#350). Milliseconds and heap never fail it (SwiftShader, #226, #337). A commit that moves a count on purpose edits the file and gives the reason in its message and the before/after in the issue's done comment. The numbers hold only for the probe page (default prefs, `P.BENCH` with Follow the Ground on).
- **Benchmark maps** (#322): generated maps that each stress one system, for performance work the
  Northshire scene can't show (how a cost grows with how much there is of something).
  `lib/bench/benchMaps.ts` builds them (`buildBenchMap(engine, kind, count?, seed?)`, `BENCH_MAPS` has
  each kind's default count, size, terrain and hour): the same kind, count and seed always give the same
  map, with models picked from the client by path (`listAssets`), so nothing of Blizzard's is in the repo.
  - Kinds (the object, light and creature maps on flat 2x2 tiles, so nothing stands in the sea):
    `objects-same` (5000 copies of one tree: instancing), `objects-mixed` (3000 doodads of 400
    models, Teldrassil's world tree left out, as it hid the view: draw calls, loading), `wmo` (a grid of 120 buildings less the camera's clearing: groups,
    portals, doodad sets), `lights` (600 braziers, campfires and lamps at midnight: the light pool,
    flames, particles), `creatures` (2000 creatures of 60 displays: skinning), `terrain` (4x4 tiles of
    mountains with the sea off, four tilesets blended on every chunk, holes), `water` (water, ocean, magma and slime on 70% of the
    chunks, half of them two layers deep, and the sea) and `everything` (a moderate mix on 4x4 tiles).
  - `cd frontend && bun run probe 'perf-*'` measures all of them, each on a fresh page (one probe file a
    map, `perf-<kind>.js`, all through `P.benchMap(kind, count?)` in `lib.js`; a probe that only needs
    the map, not its numbers, uses `P.loadBenchMap`, which skips the measurement's 25 to 70 s); `bun run probe
    perf-lights` one. A name ending in `*` runs every probe it starts. The line adds `buildMs` (making
    the map) and `loadMs` (that plus the client reads) to `bench`'s numbers. Give it a longer
    `PROBE_TIMEOUT` (900) when raising a count.
  - Help › Benchmark maps opens each in the window, on the real GPU (the probes run on SwiftShader), at
    its hour; Help › Copy Performance Report then measures it. The tab saves as any map.
  - Sizes: Help › Benchmark map size (`prefs.benchScale`, `BENCH_SCALES`) multiplies the default counts
    by 1, 4 or 16; the buildings, terrain and water maps grow their side by the square root instead,
    up to 1024 cells (8x8 tiles). In a probe, `P.benchMap(kind, undefined, 4)`.
  - Trap: the window can't draw faster than the screen (Graphics › FPS limit's None is the screen's
    rate), so on a fast GPU the normal maps all show the screen's 240 FPS and say nothing. Read the
    report's CPU and GPU ms a frame instead, which don't stop at the screen's rate, or take a larger size.
  - The creatures are spawns made in the tab (`Engine.setSpawns`), dressed from the client's displays
    (`ListDisplays`, which needs no database). Nothing reads or writes the world database, and a
    benchmark map's spawns must never be saved to it.
  - The camera stands over a corner, a fifth of the way in, looking over the middle (`benchView`);
    nothing is placed within 60 yd of that spot, or the view would be inside a tree.
  - Baseline, `bun run probe 'perf-*'` on 2026-10-18 (SwiftShader; CPU ms, calls, triangles,
    geometries and textures compare between runs on one machine; `loadMs` is mostly the client reads):

    | Map | CPU ms | Calls | Triangles | Geometries | Textures | Heap MB | Load s |
    |---|---|---|---|---|---|---|---|
    | objects-same | 1.5 | 108 | 1,435,230 | 150 | 21 | 88 | 9.1 |
    | objects-mixed | 17.3 | 1,610 | 1,114,050 | 642 | 736 | 149 | 8.2 |
    | wmo | 8.8 | 1,224 | 1,010,950 | 387 | 537 | 172 | 12.0 |
    | wmo at 4x (476 buildings, 8x8 tiles) | 19.9 | 3,159 | 5,057,184 | 1,138 | 537 | 288 | 34.6 |
    | lights | 5.1 | 209 | 405,020 | 188 | 80 | 96 | 5.9 |
    | creatures | 7.6 | 450 | 2,681,747 | 211 | 208 | 122 | 6.0 |
    | terrain | 2.2 | 254 | 485,501 | 341 | 20 | 147 | 15.0 |
    | water | 1.5 | 166 | 319,204 | 212 | 50 | 94 | 4.4 |
    | everything | 19.7 | 1,895 | 1,232,645 | 839 | 938 | 207 | 18.0 |

    What they show at once: CPU time follows draw calls (objects-mixed, wmo, everything), not
    triangles (objects-same draws 1.4M triangles in 108 calls for 1.5 ms). Update the table when a
    commit moves a number on purpose. The everything row is the median of five runs after #323 (which
    hid the empty instanced meshes). The everything and objects-mixed rows are the mean of two runs
    after #325 (a batch joins the near shadow cascade only with a drawn instance in its box: everything
    2,725 calls and 21.1 ms before); the other rows' calls predate it and drop too. The wmo row is the
    mean of two runs after #326 (the near map kept on a still view: 12.1 ms and 1,466 calls before); the
    maps with animated models in the near box (objects-mixed, creatures, everything) redraw it every
    frame with Prop animations on, as the probes run, and gain only with them off (objects-mixed
    A/B: 17.0 ms against 12.4). The creatures row is the mean of two runs after #328 (bones posed
    only for the types drawn, without three's identity multiply or an unchanged texture upload: 10.2 ms
    before; in-page A/B 8.0 and 9.1 ms against 7.4 and 7.7, and on the everything map 22.4 against 21.0
    with its Animation section 1.6 ms against 1.0).
  - Trap: one `measurePerf()` window holds only two or three SwiftShader frames, so its `cpuMs` swings
    ±3 ms between identical runs (perf-everything gave 18.8 to 29.5 on one tree). Since #337 `P.perf()`
    takes 5 windows (`PERF_WINDOWS=n` in the environment, or `P.perf(n)`) and the probes' lines give
    `cpuMeanMs` with `cpuMinMs` to `cpuMaxMs` beside it (`cpuMs` is the last window's). `sections` gives the mean ms of each CPU section over the same windows, and `PROBE_SCALE=4` sets a benchmark map's size (the line prints `scale`): `PROBE_SCALE=4 PROBE_TIMEOUT=900 bun run probe perf-everything` (#349). A run costs
    about 5 s a window more. Three runs of perf-everything gave means 21.3, 20.4 and 20.4 with spreads
    of about 2.5 ms. Call a change real only when the means differ by more than the spreads; a gain of
    about 3 ms (15%) is at the edge, so for a change that can be switched at run time A/B it in one
    page: a scratch probe (`bun run probe <path.js>`) that builds the map with `P.benchMap`, then
    calls `P.ab(on => { ...switch... })` (#341), which alternates the two states eight times each and
    returns each state's CPU mean, min and max, calls, triangles and mean ms per CPU section, the
    difference, and `overlap`, the measures whose ranges overlap (a section that moves without overlap
    is a real gain even when the total sits inside the spread; #323: 19.6 ms against 22.5; #325:
    Shadow maps (CPU) 5.0 to 2.3). Sixteen windows after the everything map's 100 s build take 360 s:
    run it with `PROBE_TIMEOUT=900`. Check the helper on a no-op switch: the means agree within the spreads.
    Take its map and prefs from the command line (#347): every `PROBE_*` variable reaches the page, and
    `P.env('MAP', 'creatures')` reads `PROBE_MAP` (a number or boolean fallback converts the value), so one
    scratch probe serves every map: `PROBE_MAP=everything PROBE_TIMEOUT=900 bun run probe path.js`. A
    variable without the `PROBE_` prefix never arrives (`AB_MAP=x` reads as the fallback); print what
    `P.env` returned in the probe's result.
  - A cost that isn't a steady frame (a rebuild while a map's models load, a sculpt stroke's
    re-snapping) doesn't show in `P.perf` or `loadMs`, which the client reads dominate (#348). Time
    the methods: `const t = await P.time({ '/src/lib/world/ObjectLayer.ts:ObjectLayer': ['update', 'markRegionDirty'] })`
    (or `[[Class, 'method'], ...]`) before `P.benchMap`, then `t.snap()` gives ms and calls per method
    (an outermost call only) and a `total`; `t.reset()` zeroes it between the load and a stroke, and
    `P.stroke('sculpt', { x, z }, { x, z }, 30)` drives the stroke (set `editor.tool`, the mode and
    `editor.brush` first, as `undo-sculpt` does). The calls divided by the frames stepped give how
    often a method runs a frame: check that before building a gain for it (#331: a method that ran 0
    times a frame on the map it was meant for). `P.turn(0.05)` turns the camera 0.05 rad a frame
    until the function it returns is called, and `P.ab(set, n, { turn: 0.05 })` does so around its
    windows: the `perf-*` probes look at a still camera, which hides a cost that only comes with
    movement. `probe-helpers` checks all three. #329 measured this way: on creatures the spawn
    rebuilds while loading went from 107 ms to 10. Trap: the classes must come from the page's own
    modules (`P.time` goes through `P.app`); an imported copy is a second one and measures nothing.
  - Trap: the first probe run after an edit to served source (`make dev` hot-reloads it) can load the
    map cold: on the everything map it ended with 117 shader programs instead of 72 (models drawn
    before their textures, so three made each program twice) and waited 15 to 18 s on program links in
    its first frames instead of about 1.2 s, and every run first after an edit did so in #327. For a
    load or first-view measure (worst frame, `loadMs`, `renderer.info.programs.length`), run once to
    warm up and compare the runs after it.
  - Trap: the probes' Chrome has no `KHR_parallel_shader_compile`, and on SwiftShader a new program's
    cost lands in the frame that first draws it whether or not it was compiled ahead
    (`renderer.compileAsync`), so a probe can't show what compiling ahead gains on a real GPU (#327).
    To see where programs cost, wrap `getProgramInfoLog`, `getShaderInfoLog`, `getProgramParameter`
    and `getShaderParameter` on the context with timers and time each `frame()`.
  - Trap: a probe run that outlives the dev server fails every probe after it with "the page never set
    up __engine"; rerun those, and the runner starts `make dev` again. The runner also checks the server when a probe fails, and waits a minute for a rebuild, then starts `make dev` before the retry (`devRestarted` in the result, #391). When the app restarted during a probe (`/wow/status` reports a new `started`, as when a Go change, maybe another session's, makes wails dev rebuild), the runner prints `probe: <name>: the dev server restarted during this probe` and the line has `devRebuilt` (#656): read a lost page or a failure there as the restart, and rerun the probe.
  - **The rule for using them**: a change measured as faster on a stress map is kept only if
    `perf-everything` and `bench` (Northshire) are not slower. Give the stress map's numbers and those
    two, before and after, in the done comment.
- Trap: a scene's `view` means an orbit (target, distance) only with Follow the Ground on; with the
  default flying camera the target is where the camera stands. A hand-written scene or a probe that
  places the camera by target and distance must set `cameraFollowGround: true` (#256).

## Index of feature checks

### Rendering (`docs/tests/rendering.md`)

- Particles (M2 emitters, B-182)
- Ground effects (grass tufts)
- Water look (the client's combine, B-174)
- Client clouds (B-179)
- Liquid types from the client, and a layer's kind kept in the map file (#540, probe `liquid-kinds`)
- Selection outline colours (free, touching, buried)
- Hover outline (#641)
- Ground effects: no-doodad cells and density
- Graphics › Quality presets (#203)
- The camera's WMO room (down-ray probe, #8)
- Client Lighting's ground: per-vertex light and the sheen (#111)
- Losing and restoring the viewport's WebGL context (#209)
- Losing and restoring the previews' WebGL contexts (#213)
- WMO culling by group (#198, #215)
- A model's bounds tree, LOD and group cull built in the model workers (#507)
- Compressed client textures (DXT, #178)
- The terrain's tileset array as DXT3 (#216)
- The tileset array's mips (#225)
- Preview window: particles, ribbons and texture animation (#200)
- Weather preview and zone weather (#185); splashes, wind and doorways (#244); roofs (#315)
- The floor plane under the map is a backdrop (#289)
- A map with no sky shows the dark earth behind it (#339, probe `sky-dungeon`)
- A WMO's liquids: Blackrock Depths' lava (#287)
- A camera over a building is in none of its rooms (#300)
- Camera collision keeps the flying camera off a WMO's walls (#305)
- The instance batch: culling, packing and picking of placed models and spawns (#517)

### Terrain, water and map data (`docs/tests/terrain.md`)

- Growing a region (the Map panel's plus)
- Opening a region: the alpha maps' handoff (#636, probe `region-alpha`)
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
- Reference image (View › Reference Image, #184)
- Water layers (the Water tool's All layers / Layer, #14)
- Baked shadows: bake, paint, save and export (B-057, #16)
- The .wmap snapshot round trip and every readable version (#431)
- The unknown state of holes, liquids and chunk data across a save (#525, #644, #663, probe `unknown-flags`)
- Walkable ground: the navmesh view and the path test (#175), and the server's mmaps (#240)
- The world view: streamed tiles and Edit Here (#15, probe `world-view`)

### Tools and placing models (`docs/tests/tools.md`)

- Brush size controls (Photoshop-style)
- Scripted brush strokes
- Every tool's stroke is one undo step (#438, `tests/toolUndo.test.ts`; the gizmo's drags, #555, `tests/gizmoDrag.test.ts`)
- Vertex mode undo and keys on a focused control (#127)
- Gizmo drags (spin ring, height arrow, scale knob) without a mouse
- Place tool keys (preview height and offset)
- Tilting by hand (Z+scroll, #344)
- Placing a creature or game object: the preview's size (#672)
- Placement tilt (the client's rotation order, #149)
- Doodad brush (scatter models by weight)
- Spawn brush (the Doodad tool's Creatures mode, #171)
- Prefabs (#170)
- Rotate around pivot point (group spins)
- Group gizmo (ring, knob and arrow on a multi-selection)
- Mouse-move snap (Follow cursor, Snap models to the ground)
- Clear tool: the models a stroke would delete (#131)
- Tools reuse their plans and brushes per frame (#452, probe `tool-reuse`)
- Paths: roads along a curve (#167, probe `path-road`)
- Paths: rivers (#167, probe `path-river`)
- Paths: fences (#167, probe `path-fence`)

### UI and the window (`docs/tests/ui.md`)

- Session restore (reopening the last tabs at start)
- Autosave and recovery (#177)
- Folder setup dialog at start (#689)
- The desktop window itself (closing with unsaved maps, #188)
- Hover previews in tile grids (no gap between tiles)
- Thumbnail loading order (asset browser grids)
- Asset browser tabs remember their place (#123)
- Names under the tiles (#655)
- The same header on every tab (#651)
- Model sets (the asset browser's Sets tab, #124)
- Menu heights (#122)
- Dock panel (Layers) and the Inspector
- Hide panels (Tab)
- Hide the dock (#653)
- Toolbar on the right (#654)
- Tool hints
- Options bar overflow (More, #254)
- Help window
- Preferences from two windows
- Detail info readout
- Loading bar (#159)
- Saving bar (#343, probe `saving-bar`)
- Preview window (#197)
- Previews draw only while something moves (#589)
- Moving the view up and down in the previews (#662)
- Top-down view (U)
- Log window (and the session log file, #319, probe `session-log`)
- Minimap window (M)
- Projects (#48)
- Start dialog: opening an instance (#222, #271, probe `instance-open`)
- Accessibility (#354)
- Dialog focus and Esc (#369, #573, probe `dialog-focus`)
- Confirm dialog (#581, probe `confirm-dialog`)
- Selected state for assistive tech (#373, probe `aria-state`)
- Menu keys (#370, probe `menu-keys`)
- Shortcut table (#583, probe `shortcut-table`)
- Interface size (#372, probe `ui-scale`)

### Creatures, objects and the server database (`docs/tests/spawns.md`)

- Spawn save: the edit list (#199, #432)
- Spawn actions: new guids and pool entries (#557)
- Gear picker (a spawn's main hand, off hand and ranged items)
- Spawn tabs of the asset browser (Creatures, NPCs, Objects)
- Sorting the creature tabs by level (#659)
- Spawns on cave and dungeon floors (#660)
- Game object editor: turning a spawn into another object, pools (#136)
- Game object editor: Find object, with no spawn (#351)
- Game object editor: Contents, Make it a chest, respawn (#220)
- Game object editor: Display, picking a display from thumbnails (#230)
- Tilted game objects (#229)
- Names over spawns (#125)
- Right-click near the selected creature (#205)
- Formations and spawn pools (#172)
- Creature path editing on the map (#138)
- World event spawns (#143)
- Creature editor: Looks opens on the creature's display (#206)
- Creature editor: Shop tab (npc_vendor, #145)
- Creature editor: Spells tab (creature_spells, #243)
- Portals and area triggers (#141, #18; Teleport to destination #306, spawn teleports #308, probe `teleport-trigger`)
- Flight paths (#180, probe `flight-paths`)
- Creatures workspace and the new-creature guide (#132)
- Quest editor (#259)
- Game object quests (#293)
- Name colours by reaction (#134)
- Shop tab: item icons and tooltips (#202)
- Item editor (#353; body armour #356; probe `item-editor`)
- Spell editor (#294, probe `spell-editor`; #361 visual composer, probe `spell-visual`)

### Export, the client and the game (`docs/tests/client.md`)

- Launch where the camera is (character placement)
- Play here: move the character in the world (#13)
- Benilla launcher: nothing on screen until the world (benilla-launcher)
- The game's template cache after an editor's Save (#234)
- Minimap tiles for the client (B-129, #17)
- Server map extraction for one map (Publish, #174; nothing closed or started, #661)
- Movement maps on compile (#173)
- Compile to Client, Server, All and Launch's check for uncompiled edits (#214; probe `compile-launch`)
- Compile to Server and Compile All save the spawn edits (#342; probe `compile-spawns`)
- Compile keeps the client's alpha where nothing was painted (#526; probe `compile-alpha`)
- Restore the Client's Paint (#645; probe `restore-paint`)
- Added models get unique IDs across the map (#491)
- Border models in every tile that lists them (#646)
- Border models in the tiles outside the block (#647)
- A map's own loading screen (Map Properties › Picture…, #218)
- World map of a zone (World › World Map, #181; exploration overlays, #219)
- Icons from PNG files and back, and the Icons tool (#364, #683, probe `icons`)
- Icons beside item, spell and class names (#682, probe `editor-icons`)
- The asset server across a patch write (#471, probe `patch-cache`)
- The binary replies against their parsers (#520, the wire fixtures)
- The format constants and the axis swap on both sides (#538, the format fixture)
- The cost of a write into Meld's patch (#476, `BenchmarkInstallPatch`)
