# Scripting

Lua scripts that edit the open map (#28): the engine, the script API, the Scripts window and where
the scripts are kept. Script brushes, noise and images build on it (#29).

- **The owner's decisions** (#28, 2026-10-25): scripting is approved for Lua, lifting the non-goal in
  `docs/DESIGN.md` for it. Mirror Noggit Red's script API where it fits Meld cheaply, so its scripts
  mostly run, without bending Meld's design. Noggit Red is GPL: match the names and behaviour (its
  `scripts/global.d.ts` and `src/noggit/scripting/`), never copy its code.
- **The engine**: wasmoon (npm, MIT), Lua 5.4 compiled to WebAssembly, the Lua Noggit Red itself builds
  against (its `cmake/FindLua.cmake` takes 5.4; the old backlog's "Lua 5.1" named no requirement).
  `lib/script/scriptApi.ts` `runScript` gives each run a fresh Lua state with the base, table, string
  and math libraries (Noggit Red opens base, table and string; math is harmless), a 10 s limit
  (`SCRIPT_TIMEOUT`, wasmoon's count hook, so an endless loop ends in an error rather than a frozen
  window) and the API. A few Lua 5.1 names come back for older scripts (`unpack`, `loadstring`,
  `math.pow`, `math.mod`, `table.getn`). It runs in the page, on the main thread: the API reaches the
  terrain and models directly, and no editing logic goes to Go.
- **Loading**: `lib/script/luaRun.ts` is imported dynamically by `Engine.runScript`, so wasmoon (120 KB
  of JS) and its 270 KB `glue.wasm` stay out of the main bundle until the first run. It points wasmoon at
  the bundled `glue.wasm?url`: left to itself, wasmoon fetches its module from unpkg in a browser. The
  unit tests import `scriptApi.ts` directly, where wasmoon reads the module from `node_modules`.
- **The API** is Lua (`lib/script/prelude.ts`) over a handful of host functions (`ScriptHost` in
  `scriptApi.ts`). The prelude defines Noggit Red's globals (`vec`, the math functions, `dist_2d`,
  `rotate_2d`, `random_from_seed`, `select_origin`, `select_between`, `add_m2`, `add_wmo`,
  `camera_pos`, `get_map_id`, `get_area_id`, `holding_*`) and the selection, vert and model objects,
  then loads the script with `load(code, '=' .. name)` and runs it, so an error reads `name:line:`
  and the whole run is one time limit. `runScript` cuts the traceback to the script's own lines
  (`scriptTrace`). Meld's own additions: `target_pos()` (what the camera looks at) and
  `selected_area()` (a selection over the Select tool's area, or nil).
- **Heights cross a block at a time**: `sel:verts()` reads the selection's vertex rect in one host call
  into a Lua table; `vert:set_height` writes that copy, and the block goes back (`set_heights`) on
  `sel:apply()`, before any model call (a model's height is read against the ground), before the next
  `verts()` and when the script ends. A host call costs about 1 µs, so per-vertex calls would also do,
  but the block keeps a 512×512 selection fast.
- **Positions and turns**: the map's own frame (x and z across, y up, yards), not the client's world
  frame; a script only sees positions the API gave it, so Noggit Red's scripts don't notice. Model
  rotations are Noggit Red's degrees: y is the file's yaw, the editor's `rotY` plus 90 (as
  `adt.EditorTurn` reads it), x and z the tilts. `get_filename` gives the path lower case with `/`, as
  Noggit Red does; `add_m2` takes either slash and turns `.mdx` into `.m2`.
- **The host** for the open map is `lib/engine/ScriptRun.ts` `EngineScriptHost`. Heights go through a
  `TerrainStroke`; models through `ObjectLayer.add`, `place` and `remove` (with what hangs on them), noting
  what was added, the map's own models as they were before a move, and the removed ones. `finish` makes
  one undo step of it all (heights, moves, removals, additions, undone in reverse), named
  `Script <name>`, pushed even when the script failed half way, so its edits so far can be undone.
  `Engine.runScript` refuses in a world view (`refuseInWorld`) and while another script runs.
- **Not in Meld yet** (each raises "... is not in Meld yet" at the script's line): `brush` and the
  tags (script brushes, #29), `make_noise`, images, chunks and texture layers (`tex`, `vert:set_alpha`),
  vertex colours, water and holes, and the file functions. The `holding_*` keys are false, as a script
  runs once from the window.
- **The scripts folder**: `internal/scripts` keeps one `.lua` file a script in
  `<user config dir>/Meld/scripts` (`os.UserConfigDir`: `%APPDATA%` on Windows, `~/.config` on
  Linux), made on first use. The bindings are `ScriptsFolder`, `ListScripts`, `SaveScript` and
  `DeleteScript` (`app_scripts.go`); a name with `/`, `\`, `:` or `..` is refused.
- **The Scripts window** (`components/ScriptWindow.svelte`, Tools › Scripts (Lua), `ui.scripts`): the
  folder's scripts on the left, the name, Run (Ctrl+Enter), Save (Ctrl+S) and Delete, a plain textarea
  (Tab indents) and the output, the last 500 lines. It stays mounted while closed, so an unsaved
  script survives closing it; switching scripts with unsaved changes asks first. A new script starts
  from a starter that raises a hill at the camera's target.
