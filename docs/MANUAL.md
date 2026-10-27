# Meld manual

Everything Meld does, tool by tool. For building it, see the [README](https://github.com/Coldensjo/Meld#readme).

## Features

| Tool | Key | What it does |
|---|---|---|
| Select | `1` / `V` | Click a model to select it (`Shift`+click adds or removes one; `Alt`+click is the pipette: it picks the model to place, or the ground's texture to paint with); every selected model is outlined, and the Properties panel lists the selection. Drag a model to move the selection over the ground or onto buildings (it re-attaches to what it lands on; Properties › Detach frees it). Arrow keys nudge (camera-relative), `Alt+↑/↓` or `PgUp/PgDn` raise/lower, `Alt+←/→` or `R` spin, `Shift` for bigger steps, `Del` delete, `F` focus. `Ctrl+C` copies the selected models and `Ctrl+V` pastes copies under the cursor (a preview follows the mouse; click or `Enter` places them, in any map tab); `Ctrl+Shift+D` duplicates them in place. Drag on the ground to select an **area** and the models standing in it (`L` switches between rectangle, lasso and polygon; with any of them `Shift`+drag adds to the area and `Ctrl`+drag takes from it): **Cut hole** cuts the area out of the ground (for caves and cellars; **Fill hole** puts it back), `Ctrl+C` copies its terrain, holes, textures and objects, and `Ctrl+V` pastes into any open map: the paste follows the mouse, a click (or `Enter`) places it, `PgUp/PgDn` adjust its height, and `Esc` cancels. `Ctrl+A` / `Ctrl+D` select all / deselect. |
| Sculpt | `2` | Raise, Lower, Smooth, Flatten, Noise, Mountain (ridged noise), Crevice and Terrace (steps the ground into levels; Shift+drag levels to the first click's step) brushes, picked by the icons in the options bar (hover one for its name). Its **Brush** button opens the settings set once: edit limit, brush image, falloff curve, shape, Flatten's target and angled plane, Terrace's offset and painting while sculpting. The Paint, Water and Doodad brush bars have such a button too (Brush, Water, Placement or Spawns) for their own settings set once. |
| Paint | `3` / `B` | **Paint mask** mode: brush a mask onto the ground (red overlay; `Alt` or Erase removes). Then click a texture in the palette to fill the whole mask with it, or use Fill mask / Invert / From selection / Clear. |
| ↳ Paint texture | | Pick any WoW tileset texture in the palette and paint. Each paint chunk (8×8 cells) holds up to 4 textures, assigned automatically; the map's palette holds up to 255. |
| Roads | `4` | Paints the selected texture with a hard edge and levels the ground across it. |
| Paths | `K` | Draws a road, a river or a fence along a curve: click the ground to drop its points, drag a point to move it (`Shift`+drag raises or lowers it), click on the curve to insert one, `Del` deletes the picked one. Set the width, falloff, max grade, texture and paint edge in the options bar, then **Apply** (`Enter`) levels the ground at the curve's height and paints along it, as one undo step. A **River** carves a bed of the set depth instead and fills it with the chosen liquid, its surface running downhill from the higher end. A **Fence** stands the model picked in the asset browser end to end along the curve (at its own length, or the set spacing), each turned along it: fences, walls, palisades, lamp posts. Move the path and Apply again: the last apply is taken back first. The paths are saved with the map and never exported. `Esc` starts a new path. |
| Water | `5` | Paint lakes and rivers (liquid layers per chunk: water, ocean, magma, slime), and a map-wide sea with its own level. Dig lakes or raise shores relative to the sea. Animated water drawn as the client draws it. |
| Place | `6` | Place the model selected in the palette. The selected prop shows a **ring** (drag to spin) and an **up/down arrow** (drag to raise/lower); hold `Shift` to snap. Its outline is **yellow**; the parts that are underground or inside another prop are drawn **red**. Props **attach** to whatever they're placed on: a building's floor or roof, another prop, or the ground. Attached props move along with their building, and ground props follow the terrain. `Ctrl`+scroll rotates the preview and `Alt`+scroll raises/lowers it before placing. The placed object stays selected, so the arrow keys and `R` adjust it right away. Click to place, `R` rotate, `Shift`+drag or "Scatter brush" to spray. |
| Clear | `7` | Erase models, or paint in the brush: heights, liquids or holes. |
| Doodad brush | `8` | Scatter a brush of weighted models over the ground; `Ctrl` erases them. |
| Stamp | `0` | One stroke applies a stack of sculpt and paint brushes together. |
| Script brush | `Y` | Paints with a Lua brush script (Noggit Red's script brushes): pick a `.lua` file of the scripts folder that calls `brush("name")` in the options bar (or Run it in Tools › Scripts), and its settings (tags) show beside the size and falloff. The click, each frame the button is held and the release run the brush's `on_left_click`, `on_left_hold` and `on_left_release`; `Shift`, `Ctrl`, `Alt` and `Space` reach it as `holding_shift()` and so on. One stroke is one undo step. The right mouse button moves the camera, so `on_right_*` never runs. Noggit Red's own brushes run where they use what Meld has (heights, models, noise, images), such as its height noise and prop placer. |
| Map data | `9` | Paints the zone (AreaTable.dbc) each chunk belongs to, shown as a colour per zone; Set or Clear, `Alt`+click takes the zone under the cursor. It also marks chunks impassable and cells that grow no grass tufts. The export writes it into the tiles' chunk headers. |

### Layout

The layout follows Photoshop:

- **Menu bar** at the top.
- **Options bar** below it, showing the active tool's settings (mode, size, strength, falloff…).
- **Toolbar** on the left, or on the right (Preferences › Toolbar on the right).
- **Asset browser** along the bottom: search the client's doodads, buildings and textures in one box
  (`Ctrl+F`), narrow by category and zone, and hover a tile to see it large and turning in the
  preview on the right (drag to turn a model, right-drag to move up and down it, scroll to zoom).
  Recent picks sit at the top. The Creatures and NPCs tabs sort by level, and the Names checkbox
  hides the names under the tiles. Drag its top edge to resize it.
- **Document tabs** above the 3D view. Several maps can be open at once, each with its own undo
  history and camera. New Map and Open add a tab, Ctrl+Tab switches tabs, and Ctrl+W or the tab's
  ✕ closes one (it asks first if there are unsaved changes).
- **Panel dock** on the right, with **Layers**: the four texture layers of the paint chunk under the
  cursor (or of the selected area).
- **Inspector**: a floating window (`I`) with the selected model's placement numbers.

Drag the dock's left edge to resize it, and click a panel's header (▾) to collapse it. Both are
remembered.

Every map is a map for the WoW 1.12 client and a VMaNGOS server. The **Start** dialog (`Ctrl+N`)
has two pages:

- **New world**: a name (the map's folder in the client), a size in tiles, and a preset card:
  Open sea, Island, Archipelago, Rolling hills, Lakeland, Highlands, Mountains or Flat land. Every
  preset but Flat land is an island, so the world ends in sea. The cards show the layout for the
  current seed; the dice rolls another. Once published, the world can be reached from Azeroth
  through a portal.
- **Part of Azeroth**: pick a continent, then drag a square of up to 8×8 tiles on a map stitched
  from the client's own minimap (scroll to zoom, right-drag to pan), or click a zone in the list to
  jump there. The tiles' ground, textures and models open in a new tab, and saving writes them
  back to the client. This page needs a **project** (File › Project…): a project folder, where
  your maps of it go (the Open and Save dialogs start there), and the WoW 1.12 client folder it
  edits. File › Project… also lists the recent projects, and the File menu switches between them.

### Asset browser (Models / Textures panel)

On first start, click **Select WoW folder…** in the Models panel and pick your WoW 1.12 client (the
client folder or its `Data` folder). The palette then shows:

- **Models › Doodads**: every `World\…\*.m2`, in categories such as Trees, Bushes & Plants,
  Rocks, Fences & Walls, Lights & Fire, Containers, Furniture & Decor and Ground Clutter.
- **Models › Buildings**: every `.wmo`, in categories (Human, Orc & Horde, Night Elf, Dungeons &
  Caves…). Buildings include the furniture from their default doodad set.
- **Textures**: every `Tileset\…\*.blp`, plus the map's own palette.
- **Creatures, NPCs and Objects**: the spawns of the VMaNGOS database, and **Sets**: your own named lists of models.

Each tab has a zone filter and a search box. Thumbnails render as tiles scroll into view and
are cached in your user cache folder, so they load instantly next time. Clicking a model selects
the Place tool. Clicking a texture adds it to the map's palette and selects the Paint tool.

Nothing is extracted into the project. Assets are decoded on demand by the Go backend from your
local install, and never end up in the repository, the build or map files. Maps store only asset
*paths*, so a map needs the same client to render. Without the client, placeholders are shown.

Supported formats: MPQ v1/v2, BLP2 (palettized, DXT1/3/5, raw), M2 v256–263 (vanilla/TBC) with
bone animation, lights, particles, ribbons and texture animation, and WMO v17 (groups, doodad sets,
portals and interior fog). Creatures are dressed from their displays, equipment and pose.

Also included:

- Round or **square** brushes; square brushes can snap to the grid for tile-aligned painting.
- New-world generator: Open sea, Island, Archipelago, Rolling hills, Lakeland, Highlands, Mountains or Flat land, from 1 to 6 tiles a side, seeded.
- **Auto-paint** textures by height and slope, plus automatic rock on cliffs. New maps start with
  Elwynn tilesets.
- Undo/redo for every edit (`Ctrl+Z`, `Ctrl+Y`).
- Save and load `.wmap` files: a compact gzip binary written by the Go backend.

### Camera

| Input | Action |
|---|---|
| Right mouse drag | Look around (the cursor hides while you hold it). Orbit when following the ground |
| Middle mouse drag | Slide sideways and up/down. Pan when following the ground |
| Mouse wheel | Flight speed. Zoom when following the ground |
| `W A S D` / arrows | Fly first person: `W` goes the way you look, so look down and hold `W` to dive into a cave; `A`/`D` strafe |
| `Space` / `X` | Fly up / down |
| `Q` / `E` | Rotate |
| `Shift` / `Ctrl+Shift` | Fast / very fast |
| `T` | Follow the ground on/off (Camera menu). On, the camera orbits a point that rides the terrain and stays above the ground, for sculpting from above |

### Menus

- **File**: New World / Open / Open Part of Azeroth, Project… and the recent projects, Save / Save As / Revert, Map Properties,
  Compile to Client / Compile to Server / Compile All, Close Map, Exit. Compile to Client writes the
  open region into the client's tiles, Compile to Server rebuilds the server's map data from those
  tiles, and Compile All does both. Compile to Server and Compile All also save the region's
  creature and game object edits into the world database, as File › Save Spawns to Database does. Launch asks first when the open region has edits the client lacks.
  Meld never closes or starts the game or the servers: while the game runs, what a compile or save
  writes into the client waits for you to close it (the status bar says how many files wait), and the
  server's map data is rebuilt once you stop the world server. Start them again yourself.
  Everything Meld writes into the client goes into `Data\patch-3.MPQ`, and each write keeps the patch
  it replaced as `Data\patch-3.MPQ.prev` (only the last one). If a write lost something (a spell, an
  icon, a zone, a flight path), close the game and Meld and rename `patch-3.MPQ.prev` back to
  `patch-3.MPQ`.
- **Edit**: Undo / Redo, History, Copy / Paste, Select All / Deselect, cut or fill holes in the area.
- **Models**: duplicate, group, hide, delete, ground and replace the selected models; the Inspector.
- **Terrain**: clean up the tile under the camera, auto-paint, replace a texture everywhere, climb view.
- **World**: Doodad Brushes, Ground Effects, Texture Looks, Zones, Lights.
- **Tools**: the creature, game object, quest, item and spell editors, Icons, and **Scripts (Lua)**: a
  window to write Lua scripts and run them on the open map, with Noggit Red's script API (`vec`,
  `select_origin`, `sel:verts()` and `vert:set_height`, `sel:models()`, `add_m2`, `add_wmo`,
  `random_from_seed`, the math functions) plus `target_pos()` (where the camera looks) and
  `selected_area()` (the Select tool's area). What a script prints shows under it, and everything one
  run changes is one undo step. Scripts are `.lua` files in the scripts folder
  (`%AppData%\Meld\scripts` or `~/.config/Meld/scripts`); Ctrl+Enter runs, Ctrl+S saves. A script that
  calls `brush()` loads into the Script brush tool instead. `make_noise` and `sel:make_noise` give noise
  maps (SIMPLEX, PERLIN, VALUE, FRACTAL, CELLULAR, WHITE; FastNoise2's encoded trees fall back to
  FRACTAL), `create_image` and `load_png` images (a path relative to the scripts folder, or a whole one).
  Texture layers, vertex colours, water, holes and files are not in Meld yet.
- **Import/Export**: heightmaps, watermaps, normal maps, alphamaps, object lists, doodad brushes,
  port coordinates, minimap image.
- **View**: grid, chunk lines, a reference image (a plan of your own laid over the map to trace, and turned into heights, zones, textures or the mask), far horizon, walkable ground (the server's navmesh, built by Meld or read from the server's own mmaps) and a path test, layers (terrain, water, objects, tufts, spawns), hide panels.
- **Graphics**:
  - Render scale (50–150%) and view distance.
  - **Particles**, prop animations, skipping models too small to see.
- **Lighting**:
  - **Time of day** and an **animated day/night cycle**, **Shadows** (Off / Medium / High).
  - **Client Lighting** (the zone's own light, fog and water colours), clouds, fog, baked shadows.
  - The ☀/☾ button next to the menus switches between day and night.
  - **Prop lights & flames**: torches, braziers, campfires, lamps and candles get animated flames
    and flickering light (up to 8 nearest lights).
- **Camera**: follow the ground, collision, top-down view, minimap (in the dock above Layers, or detached into a floating window), speed, bookmarks.
- **Game**: launch the 1.12 client or Benilla, Game Login.
- **Preferences**: WoW client folder, VMaNGOS and Benilla folders, game client and window, thumbnail
  cache, camera speed, mouse sensitivity, interface size, toolbar icon size and side, invert camera Y,
  tablet support, and the **Hotkey Manager**: every command and camera movement key with its keys,
  changed with a click and a key press, cleared or reset (a key given to one command leaves any other
  that had it). The keys the selection and the tools read themselves (Del, H, R, the arrows, Esc) and
  the mouse stay fixed. The menus, the toolbar and Help › Keyboard Shortcuts show the keys you set.
- **Help**: a help window (F1) with the tools, brushes, camera and view in short, the keyboard shortcuts, the manual (this file), the log and app info.

The sky is a physically based atmosphere (or the client's own sky with Client Lighting) with a sun
disc, clouds, a moon with phases, stars and the Milky Way. At night the moon is the light source and
casts soft shadows.

Graphics and camera preferences are saved in the user config file
(`~/.config/Meld/config.json` or `%AppData%\Meld\config.json`).

### Other shortcuts

`[` / `]` brush size · `G` grid · `Ctrl+N` new · `Ctrl+O` open · `Ctrl+S` save · `Ctrl+Shift+S` save as

## Building from source

### Prerequisites

All platforms:

- Go ≥ 1.26
- Bun ≥ 1.4 (bun.sh); it runs the frontend tooling, so Node.js isn't needed
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Check with `wails doctor`
- golangci-lint v2 for `make check` (`go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`); without it the lint is skipped
- GNU Make; on Windows its recipes run through Git for Windows' `sh.exe`

**Linux:** `gtk3` and `webkit2gtk-4.1` dev packages.

- Arch: `sudo pacman -S gtk3 webkit2gtk-4.1`
- Debian/Ubuntu: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`
- Builds need the `webkit2_41` build tag (the Makefile adds it).

**Windows:** WebView2 runtime (preinstalled on Windows 10/11). No C compiler is required.

### Development

```bash
make dev            # = wails dev -tags webkit2_41   (hot reload)
```

On Windows: `wails dev`.

`wails dev` also serves the app at <http://localhost:34115>, so you can debug it in a browser
with Go bindings still working.

### Building

```bash
make build-linux     # → build/bin/Meld
make build-windows   # → build/bin/Meld.exe  (cross-compiles from Linux)
```

On Windows, natively: `wails build`. To build an NSIS installer: `wails build -nsis`.

### Tests & checks

```bash
make test    # Go tests under internal/ and cmd/, and the frontend unit tests (bun test)
make check   # gofmt, go vet, golangci-lint, bindings and notices checks, svelte-check/tsc
make verify  # check + test + the build for this OS
WOW_DIR=/path/to/WoW go test ./internal/wow/ -v   # integration test against a real 1.12 client
```

## Troubleshooting

- **Linux/Wayland crash** with `Error 71 (Protocol error) dispatching to Wayland display`:
  this is a WebKitGTK DMA-BUF renderer bug. The app sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself (`env_linux.go`). If it still crashes, try
  `GDK_BACKEND=x11`.
- **Low FPS on Linux**: make sure hardware acceleration works in WebKitGTK. The app already
  requests `WebviewGpuPolicyAlways`.

## Source layout

```
main.go, app*.go       Wails entry + bound Go API (app.go: App and config; app_<area>.go: one file a seam)
env_linux.go           Linux WebKitGTK workarounds
internal/mapfile/      .wmap binary format (+ tests)
internal/mpq/          Read-only MPQ reader (WoW 1.x archives)
internal/wow/          BLP/M2/WMO decoders, creature looks, minimaps + /wow/* HTTP endpoints serving the local client
internal/adt/          Reads and rewrites 1.12 tiles (terrain, textures, liquids, holes, ground effects)
internal/vmangos/      Regions to and from the client, the world database, DBC tables, spawn SQL
internal/game/         Starts Wow.exe or Benilla (Launch), and the game's template caches
internal/heightmap/    Heightmap PNGs
internal/config/       Per-user settings (client, server and Benilla folders, preferences)
internal/recovery/     Autosaved copies of maps with unsaved changes, offered again after a crash
internal/sessionlog/   Each session's status lines, kept in a file for bug reports
internal/handoff/      Large binary replies of bound methods, fetched by the page in one GET
internal/sandbox/      Throwaway copies of the client's Data folder for the probes
internal/testclient/   Finds the client and server the client-dependent Go tests read
cmd/meldtool/          Read-only inspector for .wmap files, tiles, MPQs and the bound methods
benilla-launcher/      Meld's launcher for Benilla (BENILLA.md)
frontend/src/
  App.svelte           Layout + global shortcuts
  components/          Svelte UI (menu, toolbar, tool panel, asset browser, status bar)
  lib/engine/          Renderer, render loop, camera, sky, noise
  lib/terrain/         Chunked heightmap terrain, splat shader, fallback colours
  lib/water/           Liquids, the sea and their shaders
  lib/tools/           Editor tools (select/sculpt/paint/road/path/water/place/clear/doodad/stamp/map data) + brush helpers
  lib/models/          Placeable model types (client models, helper shapes), LODs
  lib/world/           Instanced object layer
  lib/state/           Svelte rune state, undo history
  lib/io/              Bridge to Go (save/load), base64
  lib/wow/             Client for the /wow/* endpoints (lists, textures, meshes)
  lib/ui/              Tool list, menu commands and keys, UI scale, virtual grids
  lib/check/           File › Check Map's checks
  lib/bench/           Generated benchmark maps
frontend/tests/       Bun unit tests
frontend/probes/      Checks in the live app (docs/TESTS.md)
```
