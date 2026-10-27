# Scripting

Lua scripts that edit the open map (#28): the engine, the script API, the Scripts window and where
the scripts are kept, and the script brushes, noise and images built on it (#29).

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
- **Chunks, texture layers, holes, zones and water** (#760): `get_chunk(pos)` and `sel:chunks()` give
  paint chunks (8 by 8 cells, an MCNK). A chunk's texture layers are its paint slots that hold a
  texture, in slot order, the first the base (`EngineScriptHost.layers`); `add_texture` puts a texture
  on top (adding it to the map's palette, undone with the step; the layer it has when the chunk has it
  already, since a chunk holds a texture once in Meld; -1 when it has four), packing the layers down
  first; a chunk's first texture covers it. `remove_texture` gives each texel's weight to its strongest
  other layer. The host's `TerrainStroke` runs with `settle: false`: a layer a script added stays
  while nothing is painted on it yet, for a later stroke to paint (Noggit Red's `clean.lua` then
  `texture_brush.lua`). `get_texture` gives the path lower case with `/`, as `get_filename` does.
  `get_effect` is the ground effect the export writes for the layer's texture there; `set_effect`
  changes nothing and says so once (Meld keeps an effect per texture for the map, a zone or a tile,
  not per chunk layer). `set_area_id` and `set_impassable` go through a `ChunkDataStroke`.
- **Texels** (`sel:tex()`, `chunk:get_tex`) are the paint's grid, 4 a cell (Noggit Red's are 64 a
  chunk, 8 a cell, so `get_tex(i)` maps two of its indices a side onto one of Meld's); a texel's
  position is its corner. Alphas cross a block at a time as heights do (`alphas`, `set_alphas`, four a
  texel by its chunk's layers) and go back on `apply` or `flush`. The write is Noggit Red's
  `apply_alpha_changes`: the layers above the base keep their alphas (0..1, clamped) in order while
  they fit in 255, the base takes the rest; a chunk with one texture or none takes no alpha.
  `vert:set_alpha` and `get_alpha` work on the texels whose middles lie within half a cell of the
  vertex (layer 0 is ignored, and reads 1). `procedures:paint_texture(sel, img, layer, pressure,
  angle)` (or with a dot) is Noggit Red's: the image's red, turned about the selection's middle and
  fading by distance, added to the layer.
- **Holes**: `chunk:set_hole` cuts or fills the chunk's cells; `vert:set_hole` the 2 by 2 hole block of
  the cell the vertex is the first corner of (a 1.12 tile keeps holes by those blocks). **Water**:
  `vert:set_water(type, height)` is Noggit Red's (the water brush at the vertex, radius 1, locked at
  the height, overriding the liquid there; a type of 0 or less removes it), through a `LiquidStroke`;
  every vertex of Meld's grid is a corner of the liquid's cells, so `is_water_aligned` is true.
  `chunk:get_vert(i)` maps Noggit Red's 145 vertices onto the chunk's 81 (an inner one is the corner
  before it). **Vertex colours**: 1.12 tiles have none, so `set_color` and `clear_colors` do nothing and
  say so once, and `get_color` gives `vec(1, 1, 1)`.
- **Not in Meld yet** (each raises "... is not in Meld yet" at the script's line): the file functions
  with `image:save` (#761). The `holding_*` keys are false in a run from the window.
- **Sessions** (#29): `openScript` gives each script a `ScriptSession` (`scriptApi.ts`), the Lua state
  with the prelude and the script run in it. `runScript` closes it at once; `Engine.runScript` keeps it
  when the script made brushes and hands it to the Script Brush tool, closing the one before. The
  `__host` functions reach `session.host`, which the tool swaps for each stroke, so a brush paints
  whichever map is active (the prelude reads the terrain's size again at each event). A brush event runs
  `__meld_event` in a new Lua thread (`ScriptSession.event`) under the same 10 s limit; `newThread` leaves
  the thread on the main stack, so `runChunk` sets the stack top back after each.
- **Script brushes** (#29): `brush(name)` registers a brush on the JavaScript side (`add_brush`), and its
  tags (`add_int_tag`, `add_real_tag` with its digits, `add_string_tag`, `add_bool_tag`,
  `add_string_list_tag`, `add_null_tag`, `add_description`) become `TagSpec`s whose values live in the
  session (`values`); `tag:get()` reads them through the host, so a change in the options bar is seen at
  the next call. A default past the range is kept to it; a missing default is the low end, '' or false.
  After the script runs, the prelude reports which `on_*` handlers each brush has (`brush_handles`).
- **The Script Brush tool** (tool `script`, key Y, `tools/ScriptBrushTool.ts` over
  `engine/ScriptBrushes.ts`, `Engine.scriptBrushes`): the press sends `left_click`, each frame the button
  stays down `left_hold` with the seconds since the last one sent, and the release `left_release`, Noggit
  Red's order (`scripting_tool.cpp` `sendBrushEvent`: the first frame is a click, not a hold). The event's
  position is the brush's ground point, `outer_radius` the brush size and `inner_radius` one minus the
  falloff (Noggit Red's inner radius is the part of the radius at full strength); `set_outer_radius` and
  `set_inner_radius` write them back (`onRadius`). The events run one at a time on a promise chain, as
  a handler may wait for a file (`load_png`); a hold is skipped while the last event still runs and its
  time goes to the next. A stroke's edits gather in one `EngineScriptHost` and become one undo step,
  `Script brush <name>`, pushed after the release's handler; a handler's error ends the stroke (its
  edits so far are still the step) and goes to the Scripts window's output and the status bar.
  `holding_shift`, `holding_ctrl` (or Cmd) and `holding_alt` come from the pointer events, `holding_space`
  from the keyboard while the tool is active, and `holding_left_mouse` is true during the stroke. The
  right mouse button is the camera's, so `on_right_*` never runs (the options bar says so for a brush
  that only handles the right button).
- **The options bar** (`components/ScriptBrushBar.svelte`): the folder's scripts that call `brush(`, the
  brush when the script makes several, Reload, Scripts…, Size and Falloff, then the tags as controls
  (a slider for a number range up to 100000, a number field past it). The script's file is
  `prefs.scriptBrush`, loaded again the first time the tool's bar shows; the tag values are kept in
  `prefs.scriptBrushTags` under `file/brush` and the tag's label, and come back when a value still fits
  the tag. A brush run unsaved from the Scripts window keeps no values. `lib/script/scriptBrush.svelte.ts`
  holds the loaded brushes (`scriptBrush`) and the output (`scriptLog`) the window and the strokes share.
- **Noise** (#29, `lib/script/scriptNoise.ts`): `make_noise(x, z, w, h, frequency, algorithm, seed)` and
  `sel:make_noise(frequency, algorithm, seed)` (the selection's whole yards padded by 2 all round, as
  Noggit Red pads it) fill a grid over whole yards on the JavaScript side, the value at grid point
  (i, j) the algorithm at ((x + i) × frequency, (z + j) × frequency), as FastNoise2's GenUniformGrid2D
  fills Noggit Red's. `map:get(pos)` reads the point nearest `pos`, `is_highest(pos, r)` checks Noggit
  Red's square (x - r to x + r - 1), and past the grid both raise Noggit Red's out-of-bounds error. The
  names are Noggit Red's (`script_noise.cpp`): SIMPLEX (simplex-noise), PERLIN, VALUE, FRACTAL (three
  octaves of simplex, FastNoise's FractalFBm defaults), CELLULAR (the value of the nearest scattered
  point) and WHITE, each about -1..1, with the seed string hashed (FNV-1a). An encoded FastNoise2 node
  tree (base64, as Noggit Red's `height_noise.lua` passes) can't be read without FastNoise2: it falls
  back to FRACTAL, said once a session. A seed gives the same values each time in Meld, but not the
  values it gives in Noggit Red.
- **Images** (#29): `create_image(w, h)` and `load_png(path)` keep RGBA pixels on the JavaScript side
  (up to 4096 by 4096); `get_red`... `get_alpha` and `set_pixel_floats` work in 0..1, `get_pixel` and
  `set_pixel` pack red in the top byte as Noggit Red does. `load_png` reads through the binding
  `LoadScriptImage` (`internal/scripts` `ImagePath` and `LoadPNG`, Go's PNG decoder): a path relative
  to the scripts folder, or a whole path (only read, and only as a PNG); the pixels come over as a
  handoff GET. The script waits for it with wasmoon's `promise:await()`, which yields the Lua thread:
  that is why every run and event is a `thread.run` in a thread of its own, never a call from
  JavaScript (wasmoon can't yield there). Noise maps and images are freed when Lua collects them
  (`__gc`), and with the session.
- **The scripts folder**: `internal/scripts` keeps one `.lua` file a script in
  `<user config dir>/Meld/scripts` (`os.UserConfigDir`: `%APPDATA%` on Windows, `~/.config` on
  Linux), made on first use. The bindings are `ScriptsFolder`, `ListScripts`, `SaveScript` and
  `DeleteScript` (`app_scripts.go`); a name with `/`, `\`, `:` or `..` is refused.
- **The Scripts window** (`components/ScriptWindow.svelte`, Tools › Scripts (Lua), `ui.scripts`): the
  folder's scripts on the left, the name, Run (Ctrl+Enter), Save (Ctrl+S) and Delete, a plain textarea
  (Tab indents) and the output, the last 500 lines. It stays mounted while closed, so an unsaved
  script survives closing it; switching scripts with unsaved changes asks first. A new script starts
  from a starter that raises a hill at the camera's target.
