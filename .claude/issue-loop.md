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

Start of run (the coordinator, after the pull, beside reading the backlog): the last CI run on Linux
(`.github/workflows/check.yml`, #414), since the loop works on Windows and a red Linux check would
otherwise sit unread (#441):
- `gh run list --repo Coldensjo/Meld --workflow check.yml --branch main --limit 1 --json databaseId,conclusion,status,headSha,url,name`.
  It prints `[]` when Actions has never run. A run still going (`status` not `completed`, `conclusion`
  empty) is not red; nor is `cancelled` (a newer push replaced it).
- When the conclusion is `failure` (or another that is not `success`, `cancelled` or `skipped`): read the
  failing job and step with `gh run view <databaseId> --repo Coldensjo/Meld --log-failed`, and file a
  `bug` issue titled "Make the <job> CI job pass again, red since <short sha>", labelled `bug`,
  `area:tooling`, `source:loop`, `value:H`, `effort:S`, with the run's URL, the commit and the failing
  step's log excerpt. If such an issue is already open, comment the new run on it instead of filing a
  second. It is a bug in the pick order like any other; the run does not stop for it.
- The `build-linux` job is allowed to fail (`continue-on-error`), so its failure leaves the run green;
  it is not checked here until that line is dropped.

While working:
- `make test`, whole: the Bun suite takes seconds and the Go suite well under a minute, so a subset
  saves nothing and misses a break in another package (#442).
- only the probes that touch the change, since a probe costs minutes: `cd frontend && bun run probe
  --touching HEAD` (the uncommitted change; `HEAD~1` once it is committed; add `--list` to see which),
  plus any other probe you know drives the change (`bun run probe <name...>`), and fix that probe's
  `touches` line in the same commit (against the coordinator's `make dev-page`). Do not pick by hand
  from `bun run probe --list`.
- when `--touching HEAD --list` names more than about 30 probes (the change touched `probes/lib.js` or a
  hot file such as `Engine.ts`, `menus.ts` or `prefs.svelte.ts`, which about 150 probes name), run only
  the probes whose subject the change is (named in the item's notes, or picked by you), plus
  `make probe-smoke`, and name them in the closing comment. The broad pass is the coordinator's (#899): a
  worker that ran it lost hours to it.

Before commit (all of them):
- `make test`
- `make check`
- `make build-windows` (on Linux, `make build-linux`)
- the probes that touch the change, again (`bun run probe --touching HEAD` against the uncommitted change, plus the ones you added; the same subject probes when `--touching` names more than about 30)
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
- On a run that is not the day's first, a `--touching <start>..HEAD` that names more than about 30
  probes (`bun run probe --touching <start>..HEAD --list` first) is the full sweep under another name:
  `probes/lib.js` picks every probe, and a hot file about 150. Then run instead the probes the run's
  workers named in their closing comments, with the probes the run added, and the same set for the
  `PROBE_GPU=1` pass; the next day's full `make probe` covers the rest (#899). Say in the run log that
  the selection was cut and how many `--touching` had named. The day's first run keeps the broad
  `--touching` for its GPU pass.
- `make probe-perf` only for optimization items.
- The run log says which selection ran and how long it took. A failure is handled as before: find the
  commit, file a bug, revert if it cannot be fixed.

Flaky probes (#440): a probe line with `flaky: true` (failed once, passed on the retry, docs/TESTS.md
"Probes") is quarantined after its second flaky result on commits that did not touch its subject,
instead of costing a worker item each time (`wmo-cull` cost #350 and #392 that way, #392 at high
effort, before #393 fixed `P.settle`).
- Untouched means the probe is not picked by `cd frontend && bun run probe --touching <range> --list`
  for the commits under test (the item's change for a worker, `<start>..HEAD` for the full-run check).
  A flaky or failed result on a commit that does touch its subject is a real failure, handled as today.
- The first flaky result goes in the run log (probe, commit, the line) and nothing more; search the
  earlier run logs and the open issues for the probe's name to tell whether it is the second.
- On the second: file a `bug` issue "Fix the flaky <probe> probe", labelled `bug`, `area:tooling`,
  `source:loop`, holding the two flaky lines (with their `first` fields), the commits and the probe; then
  add `// quarantine: #<n>` to the probe's header (#399) in its own commit. The coordinator does it in the
  full-run check; a worker does it in its own checks only when the flaky probe is not its item's subject,
  and says so in its report.
- Only after two: #252 (0 triangles drawn with the cull on) looked like a flake and was a real break
  that `wmo-cull` found. A failure on both attempts (`retried: true`) is never a flake.
- Fixing a flaky probe (the bug issue above, #887): reproduce the failure first (the probe alone, or
  after the probes before it in `--list` order), or instrument the failing step in a scratch copy of
  the probe (`probes/scratch/`: a wrapper around the binding, the state logged before and after the
  step), and name the observed cause in the closing comment. A cause inferred from the code alone is
  not enough to take the `quarantine` line out (#882 was closed that way, failed the next full-run
  check on both attempts, and was worked twice). When the failure can't be reproduced or observed,
  keep the `// quarantine` line and report the item unfinished with what was tried.
- A quarantined probe is out of `--all`, `--smoke` and `--touching`, but still run by name (`bun run
  probe <name>`) when a change touches its area, and workers spend no time on it until it fails for
  real there or its bug issue is picked; that item takes the `quarantine` line out when it closes.

Benchmark for optimizations: `cd frontend && bun run probe bench`, on the commit before the change and
on the change (docs/TESTS.md, "Measuring performance"). An estimate with its working also counts (e.g.
"stormwind.wmo draws 1.3M triangles a frame, about 77k of them in view").

## Services

Started by the coordinator before the first worker and left running; workers never start their own, except to restart
`make dev-page` after a Go binding change (below).

- One loop at a time (#656): two loops on this checkout and its one dev page broke each other's
  whole-run probes. At the start of the run, before the pull, the coordinator runs
  `cd frontend && bun probes/loop-lock.mjs take`. If it exits 1, another live loop holds the lock
  (`<user cache>/Meld/loop.lock`, its pid and start time): stop the run and say so, without touching
  the issues. A lock whose process is gone is stale and is taken over. After the report (or when the
  run stops early, for any reason) it runs `bun probes/loop-lock.mjs release`. Workers never touch it.
- `make dev-page` (the browser page; `make dev` is the desktop window), brought up through the probe runner: `make probe-smoke` (or `cd frontend && bun run
  probe <any probe>`), which starts `make dev-page` detached when the server is down (log `meld-dev.log` in
  the temp folder) and waits for it, so it outlives the run's shell. Never start it as a background task
  of the agent harness: the harness stops those after 30 minutes, and a worker then found no server
  (#277, #513, #321). Healthy when `curl -s localhost:34115/wow/status` answers. Read the dead-session
  trap in docs/TESTS.md first: the owner's own session may be half dead.
- After a worker changes a bound Go method, `make dev-page` may not rebuild (#319, #387), and the binding
  then answers null or "is not a function". The probe runner restarts the page itself when a Go file is
  newer than the running Go side (#864), so just run a probe; `cd frontend && bun run probe --restart-page`
  does it on demand. Workers never kill the processes by hand (the agent harness refuses it). The runner
  will not restart while another live loop holds the loop lock or another probe run is alive, and says
  so (`staleBackend`, in docs/reference/testing-notes.md).

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

## The owner's uncommitted changes (#896)

The owner edits this checkout between and during runs, so files can be dirty that no worker touched
(#160's worker lost an edit to `AppDialogs.svelte` that way; the coordinator recovered it from a
dropped stash). The rules, for the coordinator and every worker:

- Coordinator: at the start of the run, after the lock and before the pull, record
  `git status --short` and `git diff > <scratchpad>/owner-dirty.patch` (plus `git diff --stat`). After
  each worker, run `git status --short` again: every file that was dirty at the start must still hold
  the same diff (`git diff -- <file>` against the patch). If one does not, restore it from the patch
  (`git apply`) or the worker's stash, and note it in the run log. Never `git pull --rebase
  --autostash` blindly over such files without that patch saved first.
- Worker: list the files dirty before you start (`git status --short`). Never run a whole-tree
  `git stash`, `git stash -u`, `git checkout -- .`, `git restore .`, `git reset --hard` or `git clean`.
  Never `git checkout` or `git restore` a file you did not change yourself. Stash only your own files,
  by name (`git stash push -m "loop #<n>" -- <files>`). If a file you must change is already dirty with
  someone else's edit, do not stash or discard it: edit around it, or stop and ask (`asked-owner`).
  Stage by name. Before reporting, check that every file that was dirty at the start still holds its
  diff, and say in the report's "Friction" line if one changed.

## Generated files

- `frontend/bindings/` and `frontend/src/lib/wails/App.ts`, `models.ts` are generated from the bound Go
  methods (`make bindings`, which `make dev` and `make dev-page` run on each Go rebuild). Never edit them by hand;
  regenerate them only when the item changed a bound Go method, and stage only the files that changed for that reason.
