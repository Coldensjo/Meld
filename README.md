# WorldEditor

A fast, cross-platform 3D world editor in the spirit of the classic Warcraft / World of Warcraft
editors. You can sculpt terrain, paint ground textures, dig lakes, lay roads, and place low-poly
buildings, nature and doodads. The camera works like a third-person game camera.

Built with **[Wails v2](https://wails.io)** (Go) + **Svelte 5** + **Three.js**. It runs on
**Windows** and **Linux**, and the binary is about 10–12 MB with no bundled assets. Every texture
and model is generated procedurally at startup.

## Features

| Tool | Key | What it does |
|---|---|---|
| Select / Move | `1` | Click to select, drag to move along the ground, `R` rotate, `Del` delete, `F` focus. Properties panel for precise edits. |
| Sculpt | `2` | Raise, Lower, Smooth, Flatten, Noise, Mountain (ridged noise) brushes. |
| Paint | `3` | 8 ground layers: Grass, Lush Grass, Dirt, Rock, Sand, Snow, Cobblestone, Dirt Path. |
| Roads | `4` | Paints cobblestone or dirt-path roads and levels the ground across them. |
| Water | `5` | Global water level. Dig lakes or raise shores relative to it. Animated water with shore foam and depth tint. |
| Place | `6` | 17 WoW-style prefabs (houses, orc hut, tower, walls, trees, rocks, mushrooms, barrels, fences, campfire, well…). Click to place, `R` rotate, `Shift`+drag or "Scatter brush" to spray. |

Also included:

- New-map generator: Flat, Rolling Hills, Mountains or Island, with sizes 128², 256² and 512², seeded.
- **Auto-paint** textures by height and slope, plus automatic rock on cliffs.
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
make test    # Go unit tests (map file format)
make check   # go vet + svelte-check/tsc
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
frontend/src/
  App.svelte           Layout + global shortcuts
  components/          Svelte UI (menu, toolbar, tool panel, asset browser, status bar)
  lib/engine/          Renderer, render loop, camera, sky, noise
  lib/terrain/         Chunked heightmap terrain, splat shader, procedural textures
  lib/water/           Water shader
  lib/tools/           Editor tools (sculpt/paint/road/water/place/select) + brush/undo helpers
  lib/models/          Procedural low-poly prefabs + thumbnails
  lib/world/           Instanced object layer
  lib/state/           Svelte rune state, undo history
  lib/io/              Bridge to Go (save/load), base64
```
