# Testing

Choose the smallest check that can demonstrate the behavior you changed, then run the broader
checks. Unit tests, client integration tests and live-app probes answer different questions;
a passing unit test does not prove a shader renders or a compiled map works in the game.

## Before you run anything

- Use a development client and server, with backups. Some tests discover the configured paths
  automatically; leaving environment variables unset is not the same as isolating the test.
- Do not run builds, formatters or live-app probes against another person's active session without
  coordinating. A probe uses its own browser page, but shares the Go backend.
- Never put Blizzard assets in committed fixtures. Use synthetic data or read a local installation.
- In a shell, quote a heredoc's delimiter when the text holds `$` or backticks. Unquoted, the shell
  expands them and halves backslashes; quoted, `$` and backticks pass through:

  ```sh
  cat <<EOF      # `$HOME` is expanded, and Textures\\Weather\\x.blp loses a backslash each
  cat <<'EOF'    # `$HOME` stays as typed
  ```

  In the agents' Git Bash a quoted delimiter still halves doubled backslashes, so write text with
  backslashes (client paths, JS strings, regexes) with the Write tool, and multi-line source too.
- Check the exit status and skip messages. A test that skipped because the client was absent did not
  verify compatibility with that client.
- In a fresh Linux container (a cloud session, CI), run `scripts/setup-linux.sh` first: it installs
  `wails3`, Chrome, the GTK3 and WebKitGTK 4.1 headers and the frontend's packages, without which only
  `go test`, `bun test` and `bun run check` run (docs/development.md, "Cloud and CI containers"). Without
  the WoW client, the client tests skip and only the probes on flat maps can pass.

## Unit tests and static checks

Run from the repository root:

| Command | What it covers |
| --- | --- |
| `make test` | Short-mode Go tests under `internal/`, `cmd/` and the root package; frontend Bun tests |
| `make test-full` | The same suites without short mode, including heavier client scans |
| `make check` | Formatting, Go vet/lint, binding and licence-notice consistency, ESLint, Svelte and TypeScript |
| `make verify` | Checks, tests and a desktop build for the current OS |
| `make fuzz` | Time-bounded mutation runs against the client format parsers |

The root Go package embeds `frontend/dist`, so `make test`, `make test-full` and `make check` first build the
frontend (`bun run build`, about 6 s) when `frontend/dist/index.html` is missing, and then always test and vet
the root package: its tests guard the bindings that write the world database (`TestSandboxRefusesWorldDatabaseWrites`).
A plain `go test .` or `go vet ./...` without that build still fails.
`make check` also reports when golangci-lint is absent instead of silently proving the lint passed.
On Windows, the Linux-only files (`*_linux.go`) and the Linux build are checked only by CI:
`.github/workflows/check.yml` runs the checks and short tests on ubuntu at every push (docs/development.md).

For a focused run:

```sh
go test ./internal/mapfile/ -run TestName -v
cd frontend
bun test tests/history.test.ts
```

Replace `TestName` with the test you intend to run. For setup and platform build commands, see
[Building and development](development.md).

The frontend tests use Bun's own runner, `bun:test`, in every file (`import { test } from 'bun:test'`), with
assertions from `node:assert/strict` or `expect`; don't import `node:test` (#614,
[testing notes](reference/testing-notes.md#unit-and-integration-tests)).

## Client and server integration tests

The helper in `internal/testclient` looks for a client using `WOW_DIR`, then the `wowPath` in
Meld's user configuration. Server reads use `VMANGOS_DIR`, then `vmangosPath`. Tests skip when
the necessary installation or database is unavailable. An explicit variable pointing to a missing
folder is treated as an invalid setup and can fail the test rather than skip it.

For example, in a POSIX shell or Git Bash:

```sh
WOW_DIR=/path/to/client go test ./internal/wow/ -v
```

In PowerShell:

```powershell
$env:WOW_DIR = 'C:\path\to\client'
go test ./internal/wow/ -v
Remove-Item Env:WOW_DIR
```

Client-write tests must target a temporary directory or an isolated copy, not the real patch.
The root guard tests enforce known cases, but do not follow every possible helper call.

::: warning Database-writing tests
Some live tests explicitly require `VMANGOS_DIR` because they write the world database.
Point it only at a disposable test server/database after reading the relevant test. A rollback is
not a safety net for MyISAM tables. Do not set this variable merely to make skipped tests run.
:::

## Probes: repeatable checks in the live app

A probe drives the real app in a fresh browser page and reports a JSON result. Prefer an existing
probe over a one-off browser script for a repeatable feature check.

```sh
cd frontend
bun run probe --list                 # discover available checks
bun run probe undo-sculpt            # run a focused check
bun run probe --smoke                # fast checks of shared behavior
bun run probe --touching HEAD          # the uncommitted change, untracked files included
bun run probe --touching HEAD~1..HEAD # select checks relevant to a committed change
bun run probe --all                  # all probes but the benchmarks and the `tier: manual` ones
bun run probe --all --shard 1/2      # every second one of them; --shard 2/2 runs the rest (make probe SHARD=1/2)
```

The root shortcuts are `make probe-smoke`, `make probe` and `make probe-perf`. The whole `--all` run takes
over 30 minutes, past an agent harness's task limit: run it as two background tasks one after the other,
`--shard 1/2` and `--shard 2/2` (#669). The closing `{"summary":true,...}` line is also printed when a
signal stops the run (Ctrl-C, a kill, a harness's time limit), with `stopped` and the probes it never
reached in `notRun`. The runner checks
the dev server and may start or restart it when no explicit `MELD_URL` is set. Do not use it while
someone else relies on the shared development backend. With an explicit `MELD_URL`, the runner
uses that server rather than managing one itself. Under Git Bash's `timeout` the process chain to the loop breaks (MSYS leaves `timeout.exe` an orphaned parent pid), so `loop-lock.mjs check` counts a chain that ends at an orphaned `timeout`/`bash`/`sh` as the loop's own (#900) and the runner restarts a stale page as usual.

To ask whether a probe already failed at an older commit (a full-run check's failure, say), run it with
`--at <commit>` (#873): `bun run probe weather-wind --at 03c23de4`. The runner checks that commit out into a
temporary git worktree in the user cache (`Meld/probe-at`), runs `bun install` there and serves its frontend
from its own Vite on a free port, proxying `/wow`, `/wowx`, `/meld` and `/wails` to the running dev page; the
summary line names the commit in `at`, and the worktree goes when the run ends. It never touches the checkout,
which the agent shell refuses for `git checkout <old> -- frontend`. Only the frontend is the old one: the
Go side, the probe files and `lib.js` are this checkout's, so a probe that needs a binding the Go side lacks
cannot run this way. To run the probe as it was at that commit too, put its old copy in the git-ignored
scratch folder and run it by path: `git show 03c23de4:frontend/probes/weather-wind.js > probes/scratch/ww-old.js`,
then `bun run probe probes/scratch/ww-old.js --at 03c23de4`. Setting up adds about 25 seconds.

Probe pages use `?nosave&nosession&defaults` to avoid restoring the normal editing session or
persisting preferences. So a pref a probe sets never reaches Go: a binding that reads a pref from
`config.json` (as `App.buildMoveMaps` does) sees the owner's saved value, not the probe's. Pass such a
setting to the binding as an argument instead (#894's `SpawnEditSQL` core). This does **not** isolate client writes by itself. A probe that writes client
files must use `P.sandboxClient()` and check the `realUnchanged` field returned by
`await P.endSandbox()`.
The sandbox redirects the shared backend too; it is not safe to use while a person edits in that backend.
It refuses operations that write the real server database or control the game and servers.

When adding a probe:

1. Give its leading comment a `touches:` list identifying the source files it checks. `tests/probeTouches.test.ts`
   (in `make test`) fails when a path there no longer exists or a glob matches no file, so rename it with the file.
2. Step rendering with `P.frames`, `P.until` or `P.settle`; the runner stops the normal engine loop.
3. Assert an observable outcome, including undo/redo when it edits a map.
4. Keep it deterministic. Add `tier: smoke` only for a fast check that needs no heavy scene, and
   `tier: manual` for a slow check of a rarely touched path that `--all` should skip (`--touching` still picks it).
5a. To right-click a placed model, use `await P.contextMenuOn(id)` (#892), not `P.contextMenu` at the screen centre: it waits for the model to load, aims the camera at its box and tries a grid of spots over it until the menu opened is the model's (the click selected it alone). A thin model such as a signpost has air at its box centre, and each missed attempt used to cost a probe timeout (see `sign-swap`).
5. Find a dialog or component through its F8 `data-ui` attribute, not through aria attributes or text (#415): `P.dialog(heading)`
   finds a Modal by `[data-ui="Modal"] header h2`, and a bare dialog is `[data-ui="Modal"]`. Accessibility work moves `aria-*`
   (#369 broke the Zones dialog checks now in `weather`); `data-ui` is the component's name. Only a root element carries it, so an inner control
   keeps a stable attribute. Keep an aria lookup where the probe is about accessibility (`aria-state`, `dialog-focus`).
   The editors share `EditorFrame`, so each root carries `data-editor="creature|object|item|quest|spell|character"`; the other
   windows are found by their component's `data-ui` (`FlightPathsWindow`, `MinimapWindow`, `IconsWindow`, `SoundsWindow`, `ModelPreviewWindow`),
   and the docked minimap by `[data-panel="minimap"]`. Inner lists and fields keep their `aria-label` (#870).
5b. Find a template editor's field by `[data-col="<column>"]` (`TemplateFields.svelte` puts it on each field's cell) rather than by the grid's structure (`.grid > label`), which broke seven probes when #951 added the cell wrapper (#977). A probe that finds fields through `TemplateFields.svelte` names it in `touches:`.
6. Record how to run it in the appropriate feature-check page below.
7. When it needs data a machine may lack (the server's `data/mmaps`, say), check for it first and return
   `{ ok: true, skipped: '<reason>' }` without it (`P.noMmaps` does this for the mmaps, #427). The runner prints
   `probe: <name> skipped: <reason>` and lists it under `skipped` in the summary line, apart from `passed`.

Every probe has an entry under its feature in the pages below (`Probe: bun run probe <name>`), but
`probe-helpers`, which checks the probe helpers themselves (#348, `P.time`, `P.stroke`, `P.turn`; #317,
`P.texture`). Run it after changing `frontend/probes/lib.js`.

To see a spawn by eye or in a probe, `await P.viewSpawn('Young Wolf')` (or a spawn object; `{ distance, pitch, hideObjects }`) frames it
from a scene line with Show > Objects off, loading `P.BENCH`'s region when no spawn by that name is loaded (#983, probe `view-spawn`).

For the helper API, profiling options and unusual browser failures, use the
[testing notebook](reference/testing-notes.md#probes-bun-run-probe-checks-in-the-live-app-you-can-rerun).

## Rendering and performance

The paint rules (four textures a chunk, undo and redo, paste across palettes, auto-paint) run on a real
`Terrain` in `tests/paintRules.test.ts`, part of `make test`; that the terrain shader compiles and draws is
the probes' part (`console-clean`, `terrain-cell-tex`, `terrain-dxt`). The old hand-run pages in
`frontend/tests/browser/` were retired for these (#613).

For performance changes, use the same scene, camera, preferences and loading state before and after.
Record CPU time, GPU time when available, draw calls and triangle counts. The performance overlay
is under **Help › Performance overlay** (`Ctrl+Shift+M`). `make probe-perf` runs benchmark probes.

Headless probes use software rendering, so their wall-clock frame rate is not representative of
desktop GPU performance. Report comparable work counters and timings, not a general FPS claim
from SwiftShader. See the [performance notes](reference/testing-notes.md#measuring-performance-the-overlay-179)
for the benchmark scene and measurement details.

## Reproduce and inspect a failure

- Use **Help › Copy Scene** for a `Meld scene {...}` description of the map and view. Prefer this
  over camera coordinates copied by hand; view preferences can change what the camera sees.
- Include **Help › Log**, reproduction steps, expected behavior and the test/probe command in the report.
- Use `go run ./cmd/meldtool` to inspect `.wmap`, ADT and MPQ files without opening the editor.
  Its `wmap info`, `adt dump`, `adt diff`, `mpq ls` and `bindings` commands help distinguish a bad
  export from a rendering problem. `mpq cat -o` writes the output file you explicitly name.
  `mpq ls <substring>` searches the client's file list and `mpq cat <path>` prints a file: the way to
  find a UI texture's path and the FrameXML that uses it, instead of a throwaway Go test (#698).
  It also converts BLP textures to and from PNG, prints an M2's or WMO's facts, moves a `.wmap`'s
  heights to and from a heightmap image, and reads the world database's creatures, objects, items and
  spells (`get`, `search`), all as JSON (#893); `meldtool mcp` offers the same commands to an AI
  agent as an MCP server on stdio (#777). See the
  [meldtool notes](reference/testing-notes.md#looking-into-files-without-the-app-meldtool).
- An HTML5 drag that fails only in the desktop window needs a real mouse in a real WebView2: the
  probes' synthetic `DragEvent`s pass anyway (#930). Start the built `Meld.exe` with `MELD_DEBUG_PORT=9333` (`$env:MELD_DEBUG_PORT = '9333'; Start-Process build\bin\Meld.exe`; off by default, Windows only, #989), which opens WebView2's DevTools protocol on `127.0.0.1:9333` (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` is not picked up under Wails), so no throwaway build is needed. `bun frontend/probes/desktop/cdp.mjs --file script.js` (or `--expr`) evaluates a script in the main page (`/json/list`, `Runtime.evaluate`) to open the view and log the drag events, and `scripts/real-drag.ps1 -FromX .. -FromY .. -ToX .. -ToY .. -Shot drag.png` moves the real cursor between two client points (`SetCursorPos`, `mouse_event`, offset by `ClientToScreen`) and takes a screenshot. Trap: the Wails runtime's document listener sets `dropEffect = 'none'`
  on every drag whose types hold `Files`, and dragging an `<img>` adds `Files`, so a draggable element
  holding an image must make the image `draggable="false"` (ItemIcon does).
- For a client round trip, compare an edited export with an unedited export through the same save
  path. Comparing only to the original client tile can mistake normal writer changes for a regression.

## Recipe evidence and limits

The 2026-10-28 documentation pass checked selected save/compile/extractor and item-editor claims
against source and focused synthetic tests. It did not execute the live probes or certify every
recipe below. In particular, the item-editor probe enters an invalid level and uses Revert without
pressing Save: backend refusal tests are separate evidence, not a live tab-jump check.
Failed extraction leaves the game/server under explicit user control; successful staging does not
make later installation atomic. A recorded local mmap.enabled value is not a setting Meld changes.

Old recipes retain machine-specific scene names, ports and observations. Substitute your own
disposable resources and read current guards before executing them. Historical counts and screenshots
are not expected outcomes for every client or GPU. For everyday workflows, use
[authoring](guides/database-editing.md) and [safe writes](guides/saving-and-compiling.md).

## Index of feature checks

These pages retain detailed regression recipes and known pitfalls. They are reference material,
not steps every contributor must run for every change.

| Area | Checks and reproduction notes |
| --- | --- |
| Terrain, water and map data | [Terrain checks](tests/terrain.md) |
| Tools, placement and selection | [Tool checks](tests/tools.md) |
| Shaders, lighting and models | [Rendering checks](tests/rendering.md) |
| Panels, windows and preferences | [UI checks](tests/ui.md) |
| Creatures, objects and databases | [Spawn checks](tests/spawns.md) |
| Export, client compatibility and game launch | [Client checks](tests/client.md) |
| Lua scripts and brushes | [Scripting checks](tests/scripting.md) |

The [testing notebook](reference/testing-notes.md) preserves the earlier detailed methods and
heading-by-heading feature index. For documentation-only changes, build the site and check its
navigation and search; you do not need to start the game or run the application probes.
