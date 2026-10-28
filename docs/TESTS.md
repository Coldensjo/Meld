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
- In a shell, quote a heredoc's delimiter when the text holds backslashes, `$` or backticks (client
  paths, JS strings, Markdown). Unquoted, the shell halves the backslashes and expands the rest:

  ```sh
  cat <<EOF      # Textures\\Weather\\x.blp comes out as Textures\Weather\x.blp
  cat <<'EOF'    # Textures\\Weather\\x.blp comes out unchanged
  ```

  Write multi-line source with the Write tool all the same.
- Check the exit status and skip messages. A test that skipped because the client was absent did not
  verify compatibility with that client.

## Unit tests and static checks

Run from the repository root:

| Command | What it covers |
| --- | --- |
| `make test` | Short-mode Go tests under `internal/`, `cmd/` and the root package; frontend Bun tests |
| `make test-full` | The same suites without short mode, including heavier client scans |
| `make check` | Formatting, Go vet/lint, binding and licence-notice consistency, Svelte and TypeScript |
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
bun run probe --touching HEAD~1..HEAD # select checks relevant to a committed change
bun run probe --all                  # all probes but the benchmarks and the `tier: manual` ones
```

The root shortcuts are `make probe-smoke`, `make probe` and `make probe-perf`. The runner checks
the dev server and may start or restart it when no explicit `MELD_URL` is set. Do not use it while
someone else relies on the shared development backend. With an explicit `MELD_URL`, the runner
uses that server rather than managing one itself.

Probe pages use `?nosave&nosession&defaults` to avoid restoring the normal editing session or
persisting preferences. This does **not** isolate client writes by itself. A probe that writes client
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
5. Record how to run it in the appropriate feature-check page below.
6. When it needs data a machine may lack (the server's `data/mmaps`, say), check for it first and return
   `{ ok: true, skipped: '<reason>' }` without it (`P.noMmaps` does this for the mmaps, #427). The runner prints
   `probe: <name> skipped: <reason>` and lists it under `skipped` in the summary line, apart from `passed`.

For the helper API, profiling options and unusual browser failures, use the
[testing notebook](reference/testing-notes.md#probes-bun-run-probe-checks-in-the-live-app-you-can-rerun).

## Rendering and performance

The paint rules (four textures a chunk, undo and redo, paste across palettes, auto-paint) run on a real
`Terrain` in `tests/paintRules.test.ts`, part of `make test`; that the terrain shader compiles and draws is
the probes' part (`smoke`, `terrain-cell-tex`, `terrain-dxt`). The old hand-run pages in
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
- For a client round trip, compare an edited export with an unedited export through the same save
  path. Comparing only to the original client tile can mistake normal writer changes for a regression.

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
