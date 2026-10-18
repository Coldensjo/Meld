# CLAUDE.md

Meld: a 3D world/map editor (WoW/WC3-editor style). Desktop app built with Wails v2 (Go) and a
Svelte 5 + TypeScript + Three.js frontend. It must stay **fast** and build on **Windows and Linux**.

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
- Commit to the current branch. At the end of every session, pull and push: `git pull --rebase
  --autostash`, then `git push`. Never force push. If the pull conflicts or the push is rejected,
  abort the rebase, leave the commits local and tell the user.
- When a commit finishes an issue, end the message with a blank line and `Closes #<n>` before the
  `Co-Authored-By` trailer.

## Backlog: GitHub issues

The backlog is the issues of `Coldensjo/Meld`, through `gh` (logged in on this machine); LOOP.md is
the loop's own use of them. The old BACKLOG.md and PROGRESS.md (the loop's log up to 2026-10-15) are
in the git history (`git show b47706b:PROGRESS.md`).

- **Anything new goes in an issue**: a bug you find, an idea, a follow-up you leave for later. Search
  first (`gh issue list --search`) and comment on an existing issue rather than filing a duplicate.
  Don't build it unasked. Label it `value:H|M|L`, `effort:S|M|L`, one `area:` label, a `source:`
  label (`owner` if the user asked for it, `loop` if you found it while working on another issue,
  `gap` for a Noggit Red feature Meld lacks; those issues are the gap list; `external` for an issue
  someone other than the owner opened, which always needs the owner's approval), and `bug` or `needs-approval` where they apply.
- **Write issues for the next agent.** It starts cold, so the issue must hold what it needs: what and
  why, then a `**Claude:** notes for the agent working on this.` comment (or a section in the body)
  with the code to read (files and functions), the decisions that apply (`decision` issues, earlier
  comments), how to verify it (the test entry in `docs/tests/`, listed in docs/TESTS.md; a client test, a spot on the map) and the traps
  you know of. Give a view to reproduce as a scene line (`window.__sceneText()` or Help > Copy Scene,
  `Meld scene {...}`, loaded with `P.scene(line)`), never as camera numbers copied by hand: the line
  holds the target and the prefs that move the camera (Follow the Ground), which the numbers lose. While working on an issue, comment anything a later session would otherwise have to
  rediscover: a dead end, a finding about the client's format, where a half-done item stands.
- **Before working on an issue**, read it with its comments (`gh issue view <n> --json title,body,labels,comments`; the plain `--comments` form prints nothing in the agent shells).
- **Comments**: start every comment you write with `**Claude:**`. A comment by the owner (author
  `Coldensjo`, not starting with `**Claude:**`) is an instruction for that item; comments by
  `github-actions` are only pings. A decision about an item (the user's answer, or a choice you made
  from Noggit Red or Benilla) goes in a comment on its issue; a decision that reaches beyond one item
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

The tool chain lives in `C:\WoW` (moved there 2026-10-15, from `C:\Servers\Meld` and `C:\Servers\Software`):

- `meld`: this repository.
- `client`: the WoW 1.12.1 client (Meld's client folder, `wowPath`; Meld writes its `Data\patch-3.MPQ`).
  The only copy on the machine: Benilla reads it too, through `WOW_DATA` (set for the user to `C:\WoW\client\Data`).
- `vmangos`: the VMaNGOS server (confs in `run`, logs in `logs`, map data in `data`).
- `mariadb`: the database it runs on (port 3307, data in `vmangos\database`; `mariadb\bin` is on the PATH).
- `scripts`: the server scripts (`start-server.bat`, `stop-server.bat`, `apply-sql.bat`,
  `restore-world.bat`, `update-maps.bat`), kept out of the vmangos clone. They find the other folders
  relative to their own (`%~dp0..`), so moving all of `C:\WoW` needs no edits.
- `benilla`: the Benilla client (docs/BENILLA.md).
- `blender`: Blender 5.2 LTS, portable (its settings and add-ons in `blender\portable`).
- `noggit-red`: the Noggit Red map editor.
- `backup`: files kept aside by hand (not a backup of the rest).

`benilla`, `vmangos` and `noggit-red` are clones of other people's projects. Never commit to their
upstream branches or push them. Our changes to vmangos (the extractor reading patch-3 to patch-9), to
noggit-red (opening 1.12.1 clients) and to benilla (dialling IPv4 first, offered upstream as samwhosung/benilla#1385 from the branch
`fix/dial-ipv4-first`) are on a branch named `local` in each; after a `git pull` on the upstream branch,
rebase `local` onto it. A change of ours that upstream merges drops out of `local` in that rebase.

Meld's config (`%APPDATA%\Meld\config.json`) holds absolute paths (`wowPath`, `vmangosPath`,
`benillaPath`), so moving a folder means updating those.

## Commands

```bash
make dev             # wails dev -tags webkit2_41 (hot reload; browser debug at http://localhost:34115)
make build-linux     # wails build -tags webkit2_41  → build/bin/Meld
make build-windows   # wails build -platform windows/amd64 → build/bin/Meld.exe
make test            # go test ./internal/... + frontend unit tests (`bun test`)
make check           # go vet + (cd frontend && bun run check)
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

- **Go owns files, archives and the server; the frontend owns rendering and editing.** `app.go` is
  the thin binding layer (dialogs, `SaveMap`, `LoadMap`, the client and server calls), and the real
  work sits in packages under `internal/`:
  - `mapfile` reads and writes `.wmap` files; `config` keeps the user's settings; `heightmap` reads
    and writes heightmap PNGs.
  - `mpq` is our own read-only MPQ reader; `wow` opens the client, decodes BLP, M2 and WMO, dresses
    creature looks, builds minimap overviews and serves `/wow/*`.
  - `adt` reads and rewrites 1.12 tiles: terrain, textures and alpha maps, liquids (MCLQ), models,
    holes and ground effects, and builds new tiles.
  - `vmangos` is the server side: regions read from the client and written back as a patch (with the
    map's WDL horizon redrawn for the block, `wdl.go`), the map and spawn exports, the world database's spawns, templates and looks, the DBC tables the editor
    needs (maps, zones, emotes, liquids, ground effects), and launching the client and servers.
  - `game` closes and reopens the client and servers around an export: Wow.exe, or Benilla (the
    open-source 1.12.1 client, `config.GameClient`, started from its folder with `WOW_DATA`,
    `WOW_USER`, `WOW_PASS`, `WOW_REALM` and `WOW_CHAR`; see docs/BENILLA.md). Launch (`LaunchGameAt`)
    puts the Game Login's character where the camera is: `Engine.playerSpot` finds the ground or
    model below the camera in the server's coordinates (`io/portCoords.ts` `serverSpot`), and
    `vmangos.PlaceCharacter` writes it into the character's row once the server has logged it out.
    Play here (`PlayHere`) moves a character already in the world to that spot without closing the
    game: `vmangos.TeleportCharacter` sends `.tele name` through the world server's SOAP console.

  No editing logic goes in Go: it never decides what a brush does. It parses, converts and writes
  formats the frontend should not have to know, and anything that must read the client's archives.

- **Engine** (`frontend/src/lib/engine/Engine.ts`) owns the renderer, scene, camera and rAF loop.
  Svelte talks to it through `engineRef.current` methods.
- **Documents** (`lib/engine/MapDocument.ts`):
  - Each open map (tab) owns its terrain, water, objects, `History`, per-map settings (`meta`)
    and camera.
  - `engine.terrain`, `engine.objects` and `engine.history` are getters for the active
    document.
  - On tab switch, `Engine.activate` stashes the live `editor` per-map fields into the old
    document's `meta` and loads the new one's. Add any new per-map editor field to `DocMeta`,
    `stashActive` and `activate`.
  - The tab list for the UI is `docs` in `editor.svelte.ts`.
- **State**: `lib/state/editor.svelte.ts` holds Svelte 5 runes (`editor`, `stats`, `ui`). The engine
  *reads* `editor.*` each frame. **Never write per-frame data into reactive state.** `stats` is
  throttled to 2 Hz for this reason.

## Architecture docs

The architecture lives in `docs/architecture/`, one file an area. **Before changing code in an area,
read its doc**; when a change alters what a doc says (a new feature, a moved function, a new rule),
update the doc in the same commit. A new area gets its own file and a line here.

| Doc | What it covers |
|---|---|
| `docs/architecture/terrain.md` | The `.wmap` format, heights, holes, splat paint and the paint mask, map data (zones, flags), baked shadows, the far horizon, ground effects, growing a region, the start dialog, zones and the world map |
| `docs/architecture/tools.md` | The `Tool` interface, brush size and image brushes, Sculpt's painting, Stamp and brush stacks, the doodad and spawn brushes, the Select tool, the clipboard and nudging, the selection outline and gizmo |
| `docs/architecture/objects.md` | Attachments, `ObjectLayer` (instancing, BVH picking, LOD, WMO group culling, WMO rooms and the portal gate), prop animation, lights, flames, particles, ribbons and texture animation |
| `docs/architecture/water.md` | Liquid layers, the water brush, the sea, the liquid shader and MCLQ export |
| `docs/architecture/lighting.md` | Shaders, the sky and time of day, shadow cascades, client lighting and clouds |
| `docs/architecture/ui.md` | The window layout, the asset browser (search, tabs, sets, prefabs, thumbnails), the dock, the Inspector, History and Map Properties |
| `docs/architecture/client.md` | The `/wow/*` endpoints, coordinates, the asset registry, WMO doodad sets, and spawns: looks, editing, waypoints, names and the creature editor |

## Rules that cut across the code

These are repeated from the docs above, since breaking one breaks things far from where you work.

- **Every edit must be undoable** through `History`. Undo closures write per-map state through
  `editor` at call time, never through captured arrays, because tab switches replace those arrays.
- **Never write per-frame data into reactive state** (`editor`, `stats`, `ui`).
- Avoid per-frame allocations in hot paths (brush loops, `frame()`). Reuse vectors and buffers.
- **Never send request bodies (POST) to the Wails asset server.** WebKitGTK segfaults reading them.
  Use bindings for uploads.
- Move objects only through `ObjectLayer.place(o, parentId, worldPlacement)`; never write world values
  into an attached object's fields. Build every model rotation through `placementEuler`.
- Terrain picking ray-marches the heightmap (`Terrain.raycast`). Don't use triangle raycasts on it.
- Prop lighting is tuned to the terrain shader's uniforms: change both together. The key light must
  stay directional light 0.
- Change `.wmap` only by bumping `Version`, keeping older versions readable and updating the tests.

## Debugging the UI

- Hold **F8** and `components/DebugOverlay.svelte` names what is under the cursor: the component
  chain and the element. The chain comes from `data-ui="<Component>"` attributes that the
  preprocessor in `frontend/svelte.config.js` adds to every component's root elements. When a
  user reports "the X is broken", ask for that label.

- **Scenes** (`lib/io/scene.ts`): Help > Copy Scene puts one line on the clipboard
  (`Meld scene {...}`) with the map, camera, hour, tool, selection and view prefs. A map
  with unsaved changes is first written to a copy in `<user cache>/Meld/scenes`
  (`SaveSceneMap`, the last 20 kept). Help > Load Scene from Clipboard opens it again. When a
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

## WoW client assets

- **Never copy, bundle or commit Blizzard assets.** No extracted files in the repo, the binary or
  test fixtures. A `.wmap` file refers to the client's assets by path only (`m2:<path>` /
  `wmo:<path>` object types and the texture `palette`), never by content. What Meld writes *into*
  the client (tiles, the map table, spawn SQL) goes to the user's own client and server folders and
  is never checked in.
- Integration test: `WOW_DIR=/path/to/client go test ./internal/wow/ -v`.

## Conventions

- TypeScript strict, no `any` in committed code. Prettier-ish style: tabs (`.editorconfig`), single
  quotes, no semicolons. Older files still indent with 2 spaces; new and edited files use tabs.
- Svelte 5 runes only (`$state`, `$derived`, `$props`, `onclick=`). No legacy `export let` or
  `on:click`.
- UI styling: plain CSS with the tokens in `frontend/src/app.css` (dark editor theme). No UI
  framework dependency.
- Avoid per-frame allocations in hot paths (brush loops, `frame()`). Reuse vectors and buffers.
- In agent shells, write source, edit scripts and any text with backticks, mixed quotes or backslashes
  (client paths) with the Write and Edit tools, never a Bash heredoc: it fails to parse or halves the
  backslashes (short heredocs, such as a commit message, are fine).
- The app ships asset-free. All models and textures come from the user's own WoW install at
  runtime; there are no built-in prefabs. The one exception is the helper shapes (`models/helpers.ts`,
  types `helper:*`, the owner's decision): generated cubes, discs, spheres and a human-height post,
  placed as visual aids, saved in the map and never exported (`exportInput`, `regionObjects` and the
  object list leave them out).

## Reuse existing code

- Don't write everything from scratch. Before building a non-trivial piece (a format parser,
  geometry or noise algorithm, UI widget, compression, spatial index, etc.), check whether a good
  library or project on GitHub already does it, and import or port it when it fits.
  - Frontend: add npm packages with `bun add`. Three.js addons (`three/examples/jsm/...`) are
    already available.
  - Go: add modules with `go get`.
  - WoW-specific logic: noggit3, wowdev.wiki and similar projects are good references to
    port from (as the water code ports noggit3).
- Pick code that fits the project:
  - **License**: MIT, BSD, Apache-2.0, ISC, zlib or similar permissive licenses only. No GPL,
    LGPL or AGPL code or dependencies (that's why `Gophercraft/mpq` isn't used). When porting
    from a copyleft project such as noggit3, port the behaviour and reimplement it rather than
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
