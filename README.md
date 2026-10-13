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
| Select | `1` / `V` | Click a model to select it (`Shift`+click adds or removes one; `Alt`+click is the pipette: it picks the model to place, or the ground's texture to paint with); every selected model is outlined, and the Properties panel lists the selection. Drag a model to move the selection over the ground or onto buildings (it re-attaches to what it lands on; Properties › Detach frees it). Arrow keys nudge (camera-relative), `Alt+↑/↓` or `PgUp/PgDn` raise/lower, `Alt+←/→` or `R` spin, `Shift` for bigger steps, `Del` delete, `F` focus. `Ctrl+C` copies the selected models and `Ctrl+V` pastes copies under the cursor (a preview follows the mouse; click or `Enter` places them, in any map tab); `Ctrl+Shift+D` duplicates them in place. Drag on the ground to select an **area** and the models standing in it: **Cut hole** cuts the area out of the ground (for caves and cellars; **Fill hole** puts it back), `Ctrl+C` copies its terrain, holes, textures and objects, and `Ctrl+V` pastes into any open map: the paste follows the mouse, a click (or `Enter`) places it, `PgUp/PgDn` adjust its height, and `Esc` cancels. `Ctrl+A` / `Ctrl+D` select all / deselect. |
| Sculpt | `2` | Raise, Lower, Smooth, Flatten, Noise, Mountain (ridged noise) brushes. |
| Paint | `3` / `B` | **Paint mask** mode: brush a mask onto the ground (red overlay; `Alt` or Erase removes). Then click a texture in the palette to fill the whole mask with it, or use Fill mask / Invert / From selection / Clear. |
| ↳ Paint texture | | Pick any WoW tileset texture in the palette and paint. Each map has 8 texture slots, assigned automatically. |
| Roads | `4` | Paints the selected texture with a hard edge and levels the ground across it. |
| Water | `5` | Global water level. Dig lakes or raise shores relative to it. Animated water with shore foam and depth tint. |
| Place | `6` | Place the model selected in the palette. The selected prop shows a **ring** (drag to spin) and an **up/down arrow** (drag to raise/lower); hold `Shift` to snap. Its outline is **yellow**; the parts that are underground or inside another prop are drawn **red**. Props **attach** to whatever they're placed on: a building's floor or roof, another prop, or the ground. Attached props move along with their building, and ground props follow the terrain. `Ctrl`+scroll rotates the preview and `Alt`+scroll raises/lowers it before placing. The placed object stays selected, so the arrow keys and `R` adjust it right away. Click to place, `R` rotate, `Shift`+drag or "Scatter brush" to spray. |

### Layout

The layout follows Photoshop:

- **Menu bar** at the top.
- **Options bar** below it, showing the active tool's settings (mode, size, strength, falloff…).
- **Toolbar** on the left.
- **Asset browser** along the bottom: search the client's doodads, buildings and textures in one box
  (`Ctrl+F`), narrow by category and zone, and hover a tile to see it large and turning in the
  preview on the right. Recent picks sit at the top. Drag its top edge to resize it.
- **Document tabs** above the 3D view. Several maps can be open at once, each with its own undo
  history and camera. New Map and Open add a tab, Ctrl+Tab switches tabs, and Ctrl+W or the tab's
  ✕ closes one (it asks first if there are unsaved changes).
- **Panel dock** on the right, with:
  - **Layers**: the map's 8 texture slots, with coverage.
  - **Properties**: the selected object's transform, or world settings.

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
  back to the client.

### Asset browser (Models / Textures panel)

On first start, click **Select WoW folder…** in the Models panel and pick your WoW 1.12 client (the
client folder or its `Data` folder). The palette then shows:

- **Models › Doodads**: every `World\…\*.m2`, in categories such as Trees, Bushes & Plants,
  Rocks, Fences & Walls, Lights & Fire, Containers, Furniture & Decor and Ground Clutter.
- **Models › Buildings**: every `.wmo`, in categories (Human, Orc & Horde, Night Elf, Dungeons &
  Caves…). Buildings include the furniture from their default doodad set.
- **Textures**: every `Tileset\…\*.blp`, plus the map's 8 texture slots.

Each tab has a zone filter and a search box. Thumbnails render as tiles scroll into view and
are cached in your user cache folder, so they load instantly next time. Clicking a model selects
the Place tool. Clicking a texture assigns it to a free slot and selects the Paint tool.

Nothing is extracted into the project. Assets are decoded on demand by the Go backend from your
local install, and never end up in the repository, the build or map files. Maps store only asset
*paths*, so a map needs the same client to render. Without the client, placeholders are shown.

Supported formats: MPQ v1/v2, BLP2 (palettized, DXT1/3/5, raw), M2 v256–263 (vanilla/TBC, static
bind pose), WMO v17 (groups + default doodad set). Not yet supported: animations, particles,
replaceable creature skins, WMO liquids.

Also included:

- Round or **square** brushes; square brushes can snap to the grid for tile-aligned painting.

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
| `W A S D` / arrows | Move. The camera flies: `W` goes the way you look, so pitch down and hold `W` to dive into a cave |
| `Space` / `X` | Fly up / down |
| `Q` / `E` | Rotate |
| `Shift` | Move faster |
| `T` | Follow the ground on/off (Camera menu). On, the target rides the terrain and the camera stays above it, for sculpting from above |

### Menus

- **File**: New / Open / Save / Save As / Close Map, Exit
- **Edit**: Undo / Redo, Copy / Paste, Select All / Deselect (asks first if there are unsaved changes).
- **Graphics**:
  - Render scale (50–150%) and view distance.
  - **Time of day** (Dawn / Day / Dusk / Night) and an **animated day/night cycle**.
  - **Shadows** (Off / Medium / High).
  - Clouds, fog, water, automatic cliff rock, grid.
  - The ☀/☾ button next to the menus switches between day and night.

  - **Prop lights & flames**: torches, braziers, campfires, lamps and candles get animated flames
    and flickering light (up to 8 nearest lights). Buildings light up from their lanterns.
  - **Prop animations**: props play their idle animation (windmills turn, flags wave…).

  The sky is a physically based atmosphere with a sun disc, clouds, a moon with phases, stars
  and the Milky Way. Lighting, fog and water colours follow the sun; at night the moon is the
  light source and casts soft shadows.
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
