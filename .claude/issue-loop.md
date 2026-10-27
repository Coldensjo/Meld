# Issue loop config

Read by `/issue-loop:run` (the coordinator) and `/issue-loop:work` (each worker). Changes to this file
are the owner's; the loop files them as `needs-approval` issues rather than editing it.

## Repository

- Repo: `Coldensjo/Meld`
- Owner: `Coldensjo` (the GitHub login whose comments are instructions; Claude posts through it too)
- Design doc: `docs/DESIGN.md` (goal, hard rules, priorities, non-goals; the loop never edits it)
- Cap: 8 items per run (a number, or `all` to go on until no eligible issue is left; a run started
  as `/issue-loop:run <n>` or `/issue-loop:run all` overrides it for that run)
- Questions: issues (`issues`: owner questions and approvals go on the issues and ping the owner;
  `session`: the coordinator asks them in the run's session and waits for the answers. A run started
  with `ask`, e.g. `/issue-loop:run all ask`, uses `session` for that run). The owner's choice,
  2026-10-17: they start the loop and leave, and answer in the morning.

## Areas

One `area:` label per issue. Name each, and the docs a worker reads before changing it. Every area
also reads its checks in the index of `docs/TESTS.md` (the entries live in `docs/tests/<area>.md`),
and an architecture doc only when the issue's notes don't already say which code to change and what
the traps are (CLAUDE.md, "Architecture docs").

- `area:terrain`: sculpting and painting, the brushes and tools. Docs: `docs/architecture/terrain.md`,
  `docs/architecture/tools.md`
- `area:water`: liquids, the water brush, the sea, MCLQ export. Docs: `docs/architecture/water.md`
- `area:map`: the map, the client and the server: `.wmap`, tiles, patches, spawns, exports.
  Docs: `docs/architecture/client.md`, `docs/architecture/terrain.md`
- `area:view`: navigation, view and display: rendering, shaders, lighting, models.
  Docs: `docs/architecture/lighting.md`, `docs/architecture/objects.md`
- `area:ui`: settings, UI and help. Docs: `docs/architecture/ui.md`
- `area:scripting`: scripting (a non-goal for now, docs/DESIGN.md).
- `area:tooling`: tests, probes, scripts, CI and docs for developers. Docs: `docs/TESTS.md`

Other labels: `benilla` (Benilla integration, `docs/BENILLA.md`), `perf` (performance), `source:gap`
(a Noggit Red feature Meld lacks).

High-risk areas (their `effort:S` items don't go to the cheaper model, and their `effort:M` ones get
high effort): `area:view` (rendering, shaders) and `area:map` (the `.wmap` format and the files Meld
writes into the client and server). An item in another area whose body is about shaders, the
`.wmap` format or the files Meld writes into the client counts as high risk too.

## Checks

While working (only the ones that touch the change):
- `cd frontend && bun test tests/<name>.test.ts`, `go test ./internal/<pkg>/`
- the probes that touch it: `cd frontend && bun run probe --list`, then `bun run probe <name...>`
  (against the coordinator's `make dev`)

Before commit (all of them):
- `make test`
- `make check`
- `make build-windows` (on Linux, `make build-linux`)
- the probes that touch the change, again
- for a rendering item (`area:view`, `area:water`, or a change to a shader or to what the 3D view draws), the probes
  that touch it again with `PROBE_GPU=1` (the machine's GPU instead of SwiftShader, docs/TESTS.md, "On the
  real GPU"): SwiftShader hid the cause of #747. Only pass/fail counts there; timings and the bench baseline
  stay SwiftShader's. Say in the closing comment which ran on the GPU.

Cannot run here: the Linux build (`make build-linux`), on Windows. Workers say so in the closing
comment.

If the item changes what the app shows or does, check it in the app or say in the closing comment
that you did not. A check worth repeating becomes a probe (`frontend/probes/<name>.js`, docs/TESTS.md,
"Probes"), committed with the item. Name the probes run in the closing comment.

Full-run check (once per run, after the last item, when the run committed anything). The coordinator
records `git rev-parse origin/main` at step 1, after the pull (the run's start), and uses it as the
range below, so other sessions' commits on main are covered too. Why it is not the whole sweep every
run: the 19 end-of-run `make probe` checks in #1 and #285 passed 11 times and failed 8, every failure
was fixed on the probe or runner side, none was a regression in the editor, and nothing was reverted;
the real regressions (#366, #377) were found by workers inside their items. The sweep cost 23 to 31
minutes a run plus fix items (#439).
- Skip it all when the range changed only Markdown files (`git diff --name-only <start>..HEAD` lists
  only `.md` files), since no probe can catch a doc edit; say so in the report.
- Every run: `make probe-smoke` (#398) and `cd frontend && bun run probe --touching <start>..HEAD`
  (#397), then `PROBE_GPU=1 bun run probe --touching <start>..HEAD` once more when the range touched rendering code
  (pass/fail only, #753), then `cd frontend && bun run probe bench` as the draw-count guard (#429), and `make test-full`
  (#401) once, so the client-dependent Go tests run at least once a run.
- The full `make probe` (about 30 minutes: start it in the background and read its log) only on the
  first loop run of each calendar day (the run log says whether one already ran today), whatever files
  the range touched: the probes that check a hot file (`Engine.ts`, `ObjectLayer.ts`) name it in their
  `// touches:` line, so `--touching` already runs them, and a hot-file trigger ran the whole sweep
  nearly every run, since about one commit in four touches one. It never runs outside a run, and never
  beside one: two probe runs double the SwiftShader load and skew every timing (#257).
- `make probe-perf` only for optimization items.
- The run log says which selection ran and how long it took. A failure is handled as before: find the
  commit, file a bug, revert if it cannot be fixed.

Benchmark for optimizations: `cd frontend && bun run probe bench`, on the commit before the change and
on the change (docs/TESTS.md, "Measuring performance"). An estimate with its working also counts (e.g.
"stormwind.wmo draws 1.3M triangles a frame, about 77k of them in view").

## Services

Started by the coordinator before the first worker and left running; workers never start their own.

- One loop at a time (#656): two loops on this checkout and its one `make dev` broke each other's
  whole-run probes. At the start of the run, before the pull, the coordinator runs
  `cd frontend && bun probes/loop-lock.mjs take`. If it exits 1, another live loop holds the lock
  (`<user cache>/Meld/loop.lock`, its pid and start time): stop the run and say so, without touching
  the issues. A lock whose process is gone is stale and is taken over. After the report (or when the
  run stops early, for any reason) it runs `bun probes/loop-lock.mjs release`. Workers never touch it.
- `make dev`, in the background from Git Bash; healthy when `curl -s localhost:34115/wow/status`
  answers. Read the dead-session trap in docs/TESTS.md first: the owner's own session may be half dead.

## Priority lanes

Labels worked right after `bug`, in this order, lowest issue number first within each:

- `benilla-port` (the owner's order, #103).

## Needs approval

Besides large and non-goal work (docs/DESIGN.md), these always get `needs-approval`:

- format-level work: the `.wmap` format, the files Meld writes into the client (tiles, the map
  table, the patch) or the server (spawn SQL, map data).
- a change to the loop's rules, to CLAUDE.md's rules or to this config, and any new access or
  permission.
- a new dependency (CLAUDE.md, "Reuse existing code": permissive licence, no cgo).

## Reference project

Checked when an item's meaning is unclear (shared rules, *Unknown meaning*):

- Noggit Red: `git clone --depth 1 https://gitlab.com/prophecy-rp/noggit-red.git <scratchpad>/noggit-red`
  (or WebFetch `https://gitlab.com/prophecy-rp/noggit-red`). Look in `src/noggit/`; the UI is in
  `src/noggit/ui/`. A local clone with our changes is in `C:\WoW\noggit-red` (read it, never commit
  to its upstream branch). Noggit Red targets later clients as well as 1.12, so check that a
  file-format behaviour holds for 1.12 tiles before you follow it. It is GPL: port the behaviour,
  never copy its code.

## Never push

Other repositories on this machine the loop must never commit to or push:

- `C:\WoW\vmangos`, `C:\WoW\noggit-red`, `C:\WoW\benilla` (upstream clones; our changes are on their
  `local` branches, which the loop leaves alone too). Push only `main` of this repository.

## Generated files

- `frontend/wailsjs/` is generated by Wails from the bound Go methods (on `wails dev`, `wails build`
  or `wails generate module -tags webkit2_41`). Never edit it by hand; regenerate it only when the
  item changed a bound Go method, and stage only the files that changed for that reason.
