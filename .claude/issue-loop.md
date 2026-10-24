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

Cannot run here: the Linux build (`make build-linux`), on Windows. Workers say so in the closing
comment.

If the item changes what the app shows or does, check it in the app or say in the closing comment
that you did not. A check worth repeating becomes a probe (`frontend/probes/<name>.js`, docs/TESTS.md,
"Probes"), committed with the item. Name the probes run in the closing comment.

Full-run check (once per run, after the last item, when the run committed anything):
- `make probe` (every probe, about 30 minutes: start it in the background and read its log). Skip it
  when the run changed only Markdown files (`git diff --name-only @{u}..HEAD` lists only `.md`
  files), since no probe can catch a doc edit; say so in the report.

Benchmark for optimizations: `cd frontend && bun run probe bench`, on the commit before the change and
on the change (docs/TESTS.md, "Measuring performance"). An estimate with its working also counts (e.g.
"stormwind.wmo draws 1.3M triangles a frame, about 77k of them in view").

## Services

Started by the coordinator before the first worker and left running; workers never start their own.

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
