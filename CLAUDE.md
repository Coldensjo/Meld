# CLAUDE.md

The world editor of 3dgame's cube worlds, a fork of Meld (once a WoW 1.12 map editor). Desktop app
built with Wails v2 (Go) and a Svelte 5 + TypeScript + Three.js frontend. It must stay **fast** and build on **Windows and Linux**.

**This copy is 3dgame's fork of Meld**, in the `editor/` folder of the `Coldensjo/3dgame` repository
(brought in with `git subtree` from `Coldensjo/Meld` on 2026-10-23). It has been reshaped from a WoW
1.12 editor into the editor of 3dgame's cube world; the WoW features went with 3dgame #59, #60 and #61. The editor has no design doc of its own: its goal and priorities are the Editor section of the root
`../docs/DESIGN.md`, and its rules are below. Where this file disagrees
with the root `../CLAUDE.md` or `../docs/DESIGN.md`, the root ones win. Issue numbers (`#123`) in
this folder's docs and commits before that date are `Coldensjo/Meld` issues, not 3dgame ones. Never
commit to, push to or file issues on `Coldensjo/Meld`; Meld fixes come in with
`git subtree pull --squash --prefix=editor https://github.com/Coldensjo/Meld.git main`, run from the
repository root and only when the owner asks. Always `--squash`: Meld's own commit messages carry
`Closes #<n>` lines that would otherwise close this repository's issues of the same numbers (#45).

## Git workflow

- Commit as soon as a feature is finished. Do not wait to be asked.
- Commit as soon as a bug fix or other fix is applied. Do not wait to be asked.
- Give each feature or fix its own commit, so unrelated changes are not bundled together.
- Before committing, make sure the project still builds and the relevant checks pass:
  - `make check` (go vet + svelte-check/tsc)
  - `make test`
  - the build for the OS you are running on: `make build-windows` on Windows, `make build-linux` on
    Linux. The other one cannot run here, so say so in the issue's closing comment.

  If they fail, fix the problem first, or tell the user rather than committing broken code.
- Match the style of existing commit messages: one sentence in the imperative mood that says what
  changed and why, e.g. "Save palette thumbnails through a Go binding instead of a POST, since
  WebKitGTK crashes on request bodies".
- Commit to the current branch of the 3dgame repository; pushing follows the root `../CLAUDE.md`.
  Never force push, and never `git subtree push` to Meld.
- When a commit finishes an issue, end the message with a blank line and `Closes #<n>` before the
  `Co-Authored-By` trailer.

## Backlog: GitHub issues

The backlog is the issues of `Coldensjo/3dgame` labelled `area:editor`, through `gh`, worked by the
issue loop configured in `../.claude/issue-loop.md` (the root `../CLAUDE.md` has the rules). The
rules below are Meld's own and still apply to editor work where the root ones don't say otherwise;
the `gap` source label and the B-numbers are Meld's and are not used in 3dgame.

- **Anything new goes in an issue**: a bug you find, an idea, a follow-up you leave for later. Search
  first (`gh issue list --search`) and comment on an existing issue rather than filing a duplicate.
  Don't build it unasked. Label it `value:H|M|L`, `effort:S|M|L`, one `area:` label, a `source:`
  label (`owner` if the user asked for it, `loop` if you found it while working on another issue,
  `external` for an issue someone other than the owner opened, which always needs the owner's approval), and `bug` or `needs-approval` where they apply.
- **Write issues for the next agent.** It starts cold, so the issue must hold what it needs: what and
  why, then a `**Claude:** notes for the agent working on this.` comment (or a section in the body)
  with the code to read (files and functions), the decisions that apply (`decision` issues, earlier
  comments), how to verify it (the test entry in `docs/tests/`, listed in docs/TESTS.md; a probe, a world and a spot in it) and the traps
  you know of. Give a view to reproduce as a scene line (`window.__sceneText()` or Help > Copy Scene,
  `Meld scene {...}`, loaded with `P.scene(line)`), never as camera numbers copied by hand: the line
  holds the target and the prefs that move the camera (Follow the Ground), which the numbers lose. While working on an issue, comment anything a later session would otherwise have to
  rediscover: a dead end, a finding about a format, where a half-done item stands.
- **Before working on an issue**, read it with its comments (`gh issue view <n> --json title,body,labels,comments`; the plain `--comments` form prints nothing in the agent shells).
- **Comments**: start every comment you write with `**Claude:**`. A comment by the owner (author
  `Coldensjo`, not starting with `**Claude:**`) is an instruction for that item; comments by
  `github-actions` are only pings. A decision about an item (the user's answer, or a choice you made)
  goes in a comment on its issue; a decision that reaches beyond one item
  becomes its own closed issue labelled `decision`. Before changing how a finished feature behaves,
  search those: `gh issue list --state closed --label decision --search "<words>"`.
- **When the owner is needed** (a question, a decision, something only they can do, such as a check
  in the game), comment what you need from them, starting `**Claude:** @Coldensjo`, with the options
  and your recommendation, and add the `owner-question` label. Claude posts through the owner's own
  login, so the mention alone would not notify them; the label does: `.github/workflows/ping-owner.yml`
  then mentions them as `github-actions[bot]`. Adding `needs-approval` pings them the same way. Add the
  label after the comment, so the ping lands under it.
- **Approval**: the owner approves a `needs-approval` issue by commenting `approved`, with any limits
  after the word; `.github/workflows/approve.yml` then removes the label. Those limits are part of the
  approval. Never remove `needs-approval` yourself without such a comment. A limit on *when* ("for
  the backburner", "later") becomes the `backburner` label: approved, but picked only when nothing
  else is eligible.
- **When the work is done and committed**, comment `**Claude:** done in <hash>.` with Done, Verified
  (checks run, and whether it was seen in the app) and Left (follow-ups as new issues), then close it
  (`gh issue close <n>`). Partly done: comment what is left and keep it open. Dropped: label it
  `parked` and close it as not planned, with the reason.
- Pass bodies and comments with `--body-file`, so backticks and backslashes survive the shell.
- Older items keep their B-number in the title (`B-182 ...`), which the older docs refer to.

## Folder layout (this machine)

- The repository is `C:\Users\Chris\Desktop\3dgame`; the editor is its `editor/` folder, and the
  game's crates, assets and docs sit beside it (`../crates`, `../assets`, `../docs`).
- `C:\WoW` holds the owner's own WoW tool chain, which this editor no longer uses: the original Meld
  (`C:\WoW\meld`, a clone of `Coldensjo/Meld`; never commit to it or push it), the WoW client, VMaNGOS
  and its database, Benilla and Noggit Red. Leave it alone.
- The editor's config (`%APPDATA%\Meld\config.json`) holds the user's preferences, the recent
  projects and the game client's path for Play World (`config.WorldClientPath`).

## Commands

```bash
make dev             # wails dev -tags webkit2_41 (hot reload; browser debug at http://localhost:34125)
make build-linux     # wails build -tags webkit2_41  → build/bin/Meld
make build-windows   # wails build -platform windows/amd64 → build/bin/Meld.exe
make test            # go test ./internal/... (and . when frontend/dist exists) + frontend unit tests (`bun test`)
make check           # the shape table (export-shapes --check), gofmt, go vet (same rule) + (cd frontend && bun run check)
make probe           # every live-app probe (frontend/probes) against the running `make dev`
cd frontend && bun run probe <name...>   # chosen probes; --list names them (docs/TESTS.md, "Probes")
cd frontend && bun run build   # frontend only
```

- Linux **requires** `-tags webkit2_41`. This system only has webkit2gtk-4.1.
- Bun runs the frontend tooling (install, scripts, tests; Vite, svelte-check and tsc run with `bun --bun`, which
  keeps them off Node). Its lockfile `frontend/bun.lock` is the only one: don't add npm/yarn/pnpm lockfiles.
  Vite stays: `bun-plugin-svelte` can't run the `tagRoots` preprocessor the F8 overlay needs (#297).
- `go vet ./...` at the repo root fails if `frontend/dist` is missing (it's `//go:embed`ed). Build the
  frontend first, or vet `./internal/...` only.
- `frontend/wailsjs/` is generated by Wails from the bound Go methods. Never edit it by hand; it
  regenerates on `wails dev`/`wails build` (or `wails generate module -tags webkit2_41`).

## Testing notes (docs/TESTS.md)

- Before working out how to test or verify a change, read `docs/TESTS.md`. It holds the general
  methods (unit tests, the probes, the dev page in headless Chrome or Claude in Chrome, scenes,
  measuring performance) and an index of the checks for each feature, which live in
  `docs/tests/<area>.md`. A check in the live app worth repeating becomes a probe
  (`frontend/probes/<name>.js`, run with `bun run probe <name>`) rather than a paragraph.
- When you find a good way to test something (a command, a scene or spot on the map, a
  `javascript_tool` probe, a fixture), or a trap that cost you time while testing, add it to the
  area's file under `docs/tests/` (a general method goes in `docs/TESTS.md` itself), and add its
  heading to the index in `docs/TESTS.md`, in the same commit as the work or in its own commit. Say
  what it checks, how to run it, and what to watch out for. Update an entry that turns out to be
  wrong instead of adding a second one.

## Architecture

- **Go owns files and archives; the frontend owns rendering and editing.** `app.go` is
  the thin binding layer (dialogs, preferences, recovery, prefabs, projects), and the real
  work sits in packages under `internal/`:
  - `worldfile` reads and writes the game's cube worlds (`.world`, `../docs/world-format.md`), bound
    in `app_world.go`; the frontend holds them in `lib/cubes/world.ts` (`docs/architecture/cubes.md`).
  - `config` keeps the user's settings; `recovery` the autosaved copies of unsaved worlds; `play`
    starts the game on a world (Play World); `handoff` passes a bound reply's binary part to the page
    as one GET. The WoW client readers (`mpq`, `wow` and the `/wow/*` endpoints) went with #59.

  No editing logic goes in Go: it never decides what a brush does. It parses, converts and writes
  formats the frontend should not have to know.

- **Engine** (`frontend/src/lib/engine/Engine.ts`) owns the renderer, scene, camera and rAF loop.
  Svelte talks to it through `engineRef.current` methods.
- **Documents** (`lib/engine/MapDocument.ts`):
  - Each open cube world (tab) owns its `world`, the `CubeLayer` that draws it, its `History`,
    per-world settings (`meta`) and camera.
  - `engine.history` is a getter for the active document.
  - On tab switch, `Engine.activate` stashes the live `editor` per-world fields into the old
    document's `meta` and loads the new one's. Add any new per-world editor field to `DocMeta`,
    `stashActive` and `activate`.
  - The tab list for the UI is `docs` in `editor.svelte.ts`.
- **State**: `lib/state/editor.svelte.ts` holds Svelte 5 runes (`editor`, `stats`, `ui`). The engine
  *reads* `editor.*` each frame. **Never write per-frame data into reactive state.** `stats` is
  throttled to 2 Hz for this reason.

## Architecture docs

The architecture lives in `docs/architecture/`, one file an area. It is a reference, not a step
before every change: **read an area's doc when the issue's notes don't already say which code to
change and what the traps are**, or when a change reaches past the code the notes name. Update the
docs **once an issue**, in its last commit or a commit of its own, and only for what a later reader
needs: a feature's behaviour and where it lives, a rule, a trap, a decision. A renamed or moved
function needs a doc edit only where a doc names it. A new area gets its own file and a line here.
The test docs are kept to the same rule (see "Testing notes"): a check worth repeating still goes in.

| Doc | What it covers |
|---|---|
| `docs/architecture/cubes.md` | The game's cube worlds (`.world`): reading and writing them in Go, `CubeWorld`, the world document and its tab, the tools, drawing them and the layer slice |
| `docs/architecture/lighting.md` | The sky and time of day, and the shadow cascades |
| `docs/architecture/ui.md` | The window layout, the palette frame, History, World Properties, dialogs and menus |

## Rules that cut across the code

These are repeated from the docs above, since breaking one breaks things far from where you work.

- **Every edit must be undoable** through `History`. Undo closures write per-world state through
  `editor` at call time, never through captured arrays, because tab switches replace those arrays.
- **Never write per-frame data into reactive state** (`editor`, `stats`, `ui`).
- Avoid per-frame allocations in hot paths (brush loops, `frame()`). Reuse vectors and buffers.
- **Never send request bodies (POST) to the Wails asset server.** WebKitGTK segfaults reading them.
  Use bindings for uploads.
- The key light must stay directional light 0 (the shadow cascades' cascade 0).
- **Windows and Linux both build.** Linux uses `-tags webkit2_41`; avoid anything that needs cgo or
  one OS only.
- **The owner's uncommitted files stay theirs.** The working tree may hold changes of the owner's;
  never revert or stage them.

## Debugging the UI

- Hold **F8** and `components/DebugOverlay.svelte` names what is under the cursor: the component
  chain and the element. The chain comes from `data-ui="<Component>"` attributes that the
  preprocessor in `frontend/svelte.config.js` adds to every component's root elements. When a
  user reports "the X is broken", ask for that label.

- **Scenes** (`lib/io/scene.ts`): Help > Copy Scene puts one line on the clipboard
  (`Meld scene {...}`) with the world, camera, hour, tool and view prefs. A world
  with unsaved changes is first written to a copy in `<user cache>/Meld/scenes`
  (`SaveSceneWorld`, a `.world` file, the last 20 kept). Help > Load Scene from Clipboard opens it again. When a
  user pastes a scene, load it in `make dev`'s browser page with `await window.__loadScene(text)`
  (and `window.__sceneText()` gives the current one). Loading sets the view prefs, which are
  saved to the user's config.

## Menus & preferences

- `components/MenuBar.svelte` builds its dropdowns from a reactive item list (action, check,
  radio, header, separator). Add entries there, not ad-hoc buttons.
- `prefs` (in `editor.svelte.ts`) holds user preferences. `App.svelte` applies them via
  `Engine.applyPrefs` and persists them through the `LoadPrefs`/`SavePrefs` bindings into
  `config.json` (`internal/config`, opaque JSON). A save sends only the keys that changed since the
  last load or save (`prefs.ts`), and Go merges them over the file's current object
  (`config.MergePrefs`), so two windows (or the dev page) don't wipe each other's settings. Add new
  prefs with a default value in `prefs`; loading ignores unknown or mistyped keys.
- Dialogs live in `components/AppDialogs.svelte` (state: `ui.dialog`) on top of
  `components/Modal.svelte`.

## Assets

- **Never copy, bundle or commit Blizzard assets** (from the WoW client the editor once read), in
  the repo, the binary or test fixtures. The cubes' textures are the game's own
  (`../assets/textures`, imported by Vite, `docs/architecture/cubes.md`).

## Conventions

- TypeScript strict, no `any` in committed code. Prettier-ish style: tabs (`.editorconfig`), single
  quotes, no semicolons. Older files still indent with 2 spaces; new and edited files use tabs.
- Svelte 5 runes only (`$state`, `$derived`, `$props`, `onclick=`). No legacy `export let` or
  `on:click`.
- UI styling: plain CSS with the tokens in `frontend/src/app.css` (dark editor theme). No UI
  framework dependency.
- Avoid per-frame allocations in hot paths (brush loops, `frame()`). Reuse vectors and buffers.
- Agent shells: edit with the Write and Edit tools, never a Bash heredoc (see the root `CLAUDE.md`).
- The editor reads the game's own tables (kinds, shapes, layer themes, monsters, NPCs, the model
  table) from `crates/world` and `crates/gameplay`, generated or imported as text, and the props'
  models from `../assets/models`, so the two cannot drift;
  `docs/architecture/cubes.md` says which.

## Reuse existing code

- Don't write everything from scratch. Before building a non-trivial piece (a format parser,
  geometry or noise algorithm, UI widget, compression, spatial index, etc.), check whether a good
  library or project on GitHub already does it, and import or port it when it fits.
  - Frontend: add npm packages with `bun add`. Three.js addons (`three/examples/jsm/...`) are
    already available.
  - Go: add modules with `go get`.
- Pick code that fits the project:
  - **License**: MIT, BSD, Apache-2.0, ISC, zlib or similar permissive licenses only. No GPL,
    LGPL or AGPL code or dependencies (that's why `Gophercraft/mpq` isn't used). When porting
    from a copyleft project, port the behaviour and reimplement it rather than
    copying code verbatim.
  - **Fast and small**: no heavy dependencies for a small gain, and nothing that allocates per
    frame in hot paths.
  - **Cross-platform**: it must build on Windows and Linux. Avoid Go modules that need cgo.
  - **Maintained** and typed (TypeScript types for npm packages).
- Mention the library you chose, and why, in the commit message.

## Platform notes

- Linux/Wayland: `env_linux.go` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Without it, WebKitGTK
  crashes with "Error 71 (Protocol error)" on this KDE Wayland machine.
- Windows uses WebView2 (Chromium) and has no cgo requirement, so it cross-compiles from Linux.
