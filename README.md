# WorldEditor

A fast, cross-platform 3D world editor in the spirit of the classic Warcraft / World of Warcraft
editors. You can sculpt terrain, paint ground textures, dig lakes, lay roads, and place WoW
doodads and buildings. The camera works like a third-person game camera. Models and textures
come from your own WoW 1.12 client, read live from its MPQ archives.

Built with **[Wails v2](https://wails.io)** (Go) + **Svelte 5** + **Three.js**. It runs on
**Windows** and **Linux**, and the binary is about 10–12 MB with no bundled game assets.

## Features

| Tool | Key | What it does |
|---|---|---|
| Select / Move | `1` | Click to select, drag to move along the ground, `R` rotate, `Del` delete, `F` focus. Properties panel for precise edits. |
| Sculpt | `2` | Raise, Lower, Smooth, Flatten, Noise, Mountain (ridged noise) brushes. |
| Paint | `3` | Pick any WoW tileset texture in the palette and paint. Each map has 8 texture slots, assigned automatically. |
| Roads | `4` | Paints the selected texture with a hard edge and levels the ground across it. |
| Water | `5` | Global water level. Dig lakes or raise shores relative to it. Animated water with shore foam and depth tint. |
| Place | `6` | Place the model selected in the palette. Click to place, `R` rotate, `Shift`+drag or "Scatter brush" to spray. |

### Asset palette (left panel)

On first start, click **Select WoW folder…** in the palette and pick your WoW 1.12 client (the
client folder or its `Data` folder). The palette then shows:

- **Models › Doodads**: every `World\…\*.m2`, in categories such as Trees, Bushes & Plants,
  Rocks, Fences & Walls, Lights & Fire, Containers, Furniture & Decor and Ground Clutter.
- **Models › Buildings**: every `.wmo`, in categories (Human, Orc & Horde, Night Elf, Dungeons &
  Caves…). Buildings include the furniture from their default doodad set.
- **Textures**: every `Tileset\…\*.blp`, plus the map's 8 texture slots.

Each palette has a zone filter and a search box. Thumbnails render as tiles scroll into view and
are cached in your user cache folder, so they load instantly next time. Clicking a model selects
the Place tool. Clicking a texture assigns it to a free slot and selects the Paint tool.

Nothing is extracted into the project. Assets are decoded on demand by the Go backend from your
local install, and never end up in the repository, the build or map files. Maps store only asset
*paths*, so a map needs the same client to render. Without the client, placeholders are shown.

Supported formats: MPQ v1/v2, BLP2 (palettized, DXT1/3/5, raw), M2 v256–263 (vanilla/TBC, static
bind pose), WMO v17 (groups + default doodad set). Not yet supported: animations, particles,
replaceable creature skins, WMO liquids.

Also included:

- New-map generator: Flat, Rolling Hills, Mountains or Island, with sizes 128², 256² and 512², seeded.
- **Auto-paint** textures by height and slope, plus automatic rock on cliffs. New maps start with
  Elwynn tilesets.
- Undo/redo for every edit (`Ctrl+Z`, `Ctrl+Y`).
- Save and load `.wmap` files: a compact gzip binary written by the Go backend.

### Camera

| Input | Action |
|---|---|
| Right mouse drag | Orbit |
| Middle mouse drag | Pan |
| Mouse wheel | Zoom |
| `W A S D` / arrows | Move |
| `Q` / `E` | Rotate |
| `Shift` | Move faster |

### Menus

- **File**: New / Open / Save / Save As, Undo / Redo, Exit (asks first if there are unsaved changes).
- **Graphics**: render scale (50–150%), view distance, fog, water, automatic cliff rock, grid.
- **Preferences**: WoW client folder, clear thumbnail cache, camera speed, mouse sensitivity,
  invert camera Y.
- **About**: keyboard shortcuts and app info.

Graphics and camera preferences are saved in the user config file
(`~/.config/WorldEditor/config.json` or `%AppData%\WorldEditor\config.json`).

### Other shortcuts

`[` / `]` brush size · `G` grid · `Ctrl+N` new · `Ctrl+O` open · `Ctrl+S` save · `Ctrl+Shift+S` save as

## Prerequisites

All platforms:

- Go ≥ 1.23
- Node.js ≥ 20 and **pnpm** (`npm i -g pnpm`)
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Check with `wails doctor`

**Linux:** `gtk3` and `webkit2gtk-4.1` dev packages.

- Arch: `sudo pacman -S gtk3 webkit2gtk-4.1`
- Debian/Ubuntu: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`
- Builds need the `webkit2_41` build tag (the Makefile adds it).

**Windows:** WebView2 runtime (preinstalled on Windows 10/11). No C compiler is required.

## Development

```bash
make dev            # = wails dev -tags webkit2_41   (hot reload)
```

On Windows: `wails dev`.

`wails dev` also serves the app at <http://localhost:34115>, so you can debug it in a browser
with Go bindings still working.

## Building

```bash
make build-linux     # → build/bin/WorldEditor
make build-windows   # → build/bin/WorldEditor.exe  (cross-compiles from Linux)
```

On Windows, natively: `wails build`. To build an NSIS installer: `wails build -nsis`.

## Tests & checks

```bash
make test    # Go unit tests (map format, MPQ hashing, BLP decoding)
make check   # go vet + svelte-check/tsc
WOW_DIR=/path/to/WoW go test ./internal/wow/ -v   # integration test against a real 1.12 client
```

## Troubleshooting

- **Linux/Wayland crash** with `Error 71 (Protocol error) dispatching to Wayland display`:
  this is a WebKitGTK DMA-BUF renderer bug. The app sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself (`env_linux.go`). If it still crashes, try
  `GDK_BACKEND=x11`.
- **Low FPS on Linux**: make sure hardware acceleration works in WebKitGTK. The app already
  requests `WebviewGpuPolicyAlways`.

## Project layout

```
main.go, app.go        Wails entry + bound Go API (file dialogs, save/load)
env_linux.go           Linux WebKitGTK workarounds
internal/mapfile/      .wmap binary format (+ tests)
internal/mpq/          Read-only MPQ reader (WoW 1.x archives)
internal/wow/          BLP/M2/WMO decoders + /wow/* HTTP endpoints serving the local client
internal/config/       Per-user settings (WoW client path)
frontend/src/
  App.svelte           Layout + global shortcuts
  components/          Svelte UI (menu, toolbar, tool panel, asset browser, status bar)
  lib/engine/          Renderer, render loop, camera, sky, noise
  lib/terrain/         Chunked heightmap terrain, splat shader, fallback colours
  lib/water/           Water shader
  lib/tools/           Editor tools (sculpt/paint/road/water/place/select) + brush/undo helpers
  lib/models/          Procedural low-poly prefabs + thumbnails
  lib/world/           Instanced object layer
  lib/state/           Svelte rune state, undo history
  lib/io/              Bridge to Go (save/load), base64
  lib/wow/             Client for the /wow/* endpoints (lists, textures, meshes)
```
