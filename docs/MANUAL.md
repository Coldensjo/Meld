# Editor manual

The world editor of 3dgame: it builds the game's cube worlds (`.world` files, `../../docs/world-format.md`)
that the server and the client load. For building it, see the [README](../README.md).

## Worlds

A world is 31 layers of cubes 3 m wide and 5 m tall, from the sky (layer 0) down through the ground (layer 10), dirt,
stone and the lava cavern to the metal floor (layers 26 to 30, where nothing is built), in chunks of
16 × 16 cubes. Each world is a tab above the 3D view, with its own undo history and camera; Ctrl+Tab
switches tabs, and Ctrl+W or the tab's ✕ closes one (it asks first if there are unsaved changes).

- **File › New Cube World…** (`Ctrl+N`, or the tabs' **+**) opens the Start dialog: a name, the size
  in chunks, and whether the layers start filled by their themes (grass, dirt, stone and so on) or empty.
- **File › Open…** (`Ctrl+O`) opens a `.world` file; **Save** (`Ctrl+S`) and **Save As…**
  (`Ctrl+Shift+S`) write one; **Revert to Saved** reloads it.
- **File › World Properties…** shows the world's size, layers, stored chunks, monsters and NPCs, and
  sets or clears its spawn point.
- **File › Project…** opens a project: a folder for your worlds, where the Open and Save dialogs
  start. The File menu lists the recent projects to switch between.
- **Game › Play World** saves the world and starts the game's own client on it, at the camera's spot
  and view. The client plays alone, on a server it starts inside itself, and saves its changes beside
  the world (its `.save` folder), never into the `.world`.

Unsaved worlds are copied every few minutes (Preferences › Autosave unsaved worlds); after a crash the
next start offers to recover them. The editor reopens the saved worlds that were open when it closed.

## Tools

| Tool | Key | What it does |
|---|---|---|
| Select | `V` / `1` | Drag from a cube to a cube to select the box between them (Higher in the options bar reaches up more layers), or click one cube; a click on nothing deselects. `Ctrl+C` copies the box, `Ctrl+X` cuts it, `Del` empties it, and `Ctrl+V` pastes under the cursor in this or another world tab: `R` turns the paste a quarter, `M` / `Shift+M` mirror it, a click or `Enter` puts it down, `Esc` cancels. The arrow keys move the selected box a column the way the camera faces, `PgUp` / `PgDn` a layer, `Shift` four. `J` joins the box's cubes into one object (a door that moves as one), `Shift+J` splits the groups. |
| Cubes | `Y` | Builds the world with the cube picked in the options bar (a material or liquid, a shape and its turn; `R` turns it a quarter, `Shift+R` upside down, `Alt`+click copies a cube from the world). Its modes are below. |

The Cubes tool's modes:

- **Place** puts the cube against the face clicked; `Ctrl`+click removes the cube.
- **Remove** and **Replace** change the cubes clicked or dragged over, on the layer the drag began on.
- **Box** fills the box dragged from corner to corner (`Ctrl`+drag empties it; Higher raises it for walls).
- **Object** attaches the picked object to the face clicked: a door or window shuts an opening, a lever
  or button opens what it is linked to, a teleporter (on a cube's top) leads to the pad it is linked to,
  a torch burns and lights what is around it, in the fire colour picked beside it (orange, green
  witch-fire, blue spirit-fire or purple; picking another colour with a torch selected recolours it).
  `Ctrl`+click removes it, `Shift`+click selects it.
- **Link** links objects: click one, then the objects it acts on.
- **Paint** paints the faces clicked or dragged over with a texture (`Shift`: the whole cube, `Ctrl`:
  clear the paint, `Alt`+click picks the texture a face shows).
- **Monster** puts a spawn point of the picked monster kind (the game's `crates/gameplay/monsters.toml`)
  in the cell beside the face clicked; drag one to move it, `Ctrl`+click removes it.
- **NPC** puts the picked NPC (`crates/gameplay/npcs.toml`) in the cell beside the face clicked, then
  `Shift`+click cubes to give it a route it walks round; drag an NPC or a route cube to move it.

Every edit can be undone (`Ctrl+Z`, `Ctrl+Y`); Edit › History lists the steps and goes back to any of
them. The status bar names the layer the camera is in, and View › Layer slice (`,` and `.`) shows only a
layer and those below it (or above it), to build underground.

## Layout

- **Menu bar** at the top.
- **Options bar** below it, with the active tool's settings; what doesn't fit is under its More button.
- **Toolbar** on the left, or on the right (Preferences › Toolbar). Hover a tool for its description.
- **World tabs** above the 3D view.
- **Asset browser** along the bottom: the cube palette. Its **Cubes** tab lists every shape, material
  and liquid (search with `Ctrl+F`, narrow by category; a click picks it for the Cubes tool, and your
  picks gather under Recent); hover a tile to see it in the preview. **Sets** holds your own named
  lists of tiles (right-click a tile to add it to one). **Prefabs** lists the boxes of cubes saved in the
  prefab folder (pick the folder there, select a box with the Select tool and press Save selection…); a click pastes one. The Names
  checkbox hides the names under the tiles; drag the browser's top edge to resize it, or fold it away.
- **Status bar** at the bottom: the tool's hint, messages, the camera's layer.
- **Minimap** (`M`): the camera's layer from above, darker where the first cube is deeper; a click moves
  the camera there.
- `Tab` hides every panel but the menu bar.

## Camera

| Input | Action |
|---|---|
| Right mouse drag | Look around (the cursor hides while you hold it) |
| Middle mouse drag | Slide sideways and up/down |
| Mouse wheel | Flight speed |
| `W A S D` / arrows | Fly: `W` goes the way you look, so look down and hold `W` to dive through the layers; `A`/`D` strafe |
| `Space` / `X` | Fly up / down |
| `Q` / `E` | Rotate |
| `Shift` / `Ctrl+Shift` | Fast / very fast |
| `P` / `O` | Camera faster / slower |
| `U` | Top-down view (straight down, no perspective) |

The camera always flies freely, through the ground and down the layers. Camera › Walk puts you on the
ground layer with a first-person camera; Camera › Turn Around turns it 180°. **Bookmarks** keeps views
(`Ctrl+B` adds one).

## Menus

- **File**: New Cube World, Open, Import Tibia Map, Project and the recent projects, Save, Save As,
  Revert to Saved, World Properties, Close World, Exit.
- **Edit**: Undo, Redo, History, Copy, Cut, Paste and Delete Selected Cubes, Deselect, and Textures in
  This World: every texture id with how many faces are painted with it, unknown ids (shown as a
  magenta and black checker) included. Pick rows on the left (click, Ctrl+click, Shift+click, or
  Select all shown) and a texture in the grid on the right; the bar shows what becomes what, and
  Replace repaints all their faces as one undo step. Import Tibia textures reads a .zip of Tibia item
  sprites named by item id (`0102_item_image.png`): every ground, floor, wall and border of the map's
  items.otb becomes a texture with its name, "grass (item 4526)", to replace with or, with Paint with
  it, to paint with, and each flat one (a ground or a floor) shows on its cubes. Both searches take a
  name, a texture id or a Tibia item id (4526 or item 4526). Walls get their face, straightened out of Tibia's slanted drawing (it asks once for the
  map's items.otb); trees, monsters and objects keep their colour. A Tibia map's borders lie over
  the tops of the tiles and show their sprite see-through over the ground once it is loaded.
- **Tools**: Sprite to 3D Model makes a 3D model (.glb) of a sprite drawn slanted, a Tibia item such
  as a pillar or a 2:1 isometric sprite. Folder lists a folder's sprites (search by item id or name;
  the arrow keys step through them), and a click converts one. The middle shows the model in 3D
  (drag to turn, the wheel to zoom; As drawn, Front, Side and Top views; Turn, Wire, Texture and
  Grid), and under it the sprite beside the model drawn the same way from its four sides, the first
  of which should match the sprite. On the right: how the sprite is drawn, how to read its depth
  (Auto, or Box for pillars and furniture, Round for columns, trees and rocks, Wall for walls and
  fences, Cut-out for statues and one-sided things), the outline, the axis's centre, and what was
  made, with how much of the sprite each reading Auto tried explains. An outfit sheet (a creature
  drawn facing north, east, south and west, one column each, as Tibia's are) is carved from its four
  views instead, with Frame picking the row (a frame of its walk). Save .glb writes the model.
- **View**: the performance overlay (`Ctrl+Shift+M`, where the frame time goes), Hide panels, Layer slice.
- **Graphics**: a quality preset, render scale, view distance, anti-aliasing, FPS limit, full screen (`F11`).
- **Lighting**: the look, the game's mood (its sky, fog, light and colour grade, from
  `crates/gameplay/moods.toml`, as the game shows the layer you look at) or a plain work light; the
  mood, one of the game's surface moods or the one the time of day gives, as the game's day and night
  does; time of day and an animated day/night cycle (`J` pauses it, `N` / `Shift+N` faster or
  slower), shadows, clouds and fog. Under the work light the sky is a physically based atmosphere
  with a sun, clouds, a moon with phases and stars.
- **Camera**: Turn Around, Top-down View, Walk, the Minimap window, speed.
- **Bookmarks**: add, go to and clear view bookmarks.
- **Game**: Play World.
- **Preferences**: autosave, theme, camera speed, mouse sensitivity, interface size (`Ctrl+=`, `Ctrl+-`,
  `Ctrl+0`), toolbar icon size and side, invert camera Y.
- **Help**: a help window (`F1`), the log, the keyboard shortcuts, this manual, Copy Scene and Load
  Scene from Clipboard (a line that reopens the world and view, for a bug report), Copy Performance
  Report, and About.

Preferences are saved in the user config file (`~/.config/Meld/config.json` or `%AppData%\Meld\config.json`).

## Building from source

### Prerequisites

All platforms:

- Go ≥ 1.25
- Bun ≥ 1.4 (bun.sh); it runs the frontend tooling, so Node.js isn't needed
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- Check with `wails doctor`
- Rust (cargo): `make check` checks the shape table against `crates/world`, and Play World needs the
  game's client built (`cargo build --release -p client`).

**Linux:** `gtk3` and `webkit2gtk-4.1` dev packages.

- Arch: `sudo pacman -S gtk3 webkit2gtk-4.1`
- Debian/Ubuntu: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`
- Builds need the `webkit2_41` build tag (the Makefile adds it).

**Windows:** WebView2 runtime (preinstalled on Windows 10/11). No C compiler is required.

### Development

```bash
make dev            # = wails dev -tags webkit2_41   (hot reload)
```

`wails dev` also serves the app at <http://localhost:34125>, so you can debug it in a browser
with Go bindings still working.

### Building

```bash
make build-linux     # → build/bin/Meld
make build-windows   # → build/bin/Meld.exe  (cross-compiles from Linux)
```

### Tests & checks

```bash
make test    # Go tests under internal/ and the frontend unit tests (bun test)
make check   # the shape table, gofmt, go vet, svelte-check/tsc
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
main.go, app*.go       Wails entry + bound Go API (dialogs, preferences, recovery, prefabs, projects, worlds)
env_linux.go           Linux WebKitGTK workarounds
internal/worldfile/    The game's .world format (+ tests against crates/world's fixtures)
internal/config/       Per-user settings (preferences, projects)
internal/recovery/     Autosaved copies of unsaved worlds
internal/play/         Starts the game's client on a world (Play World)
internal/sessionlog/   The session's log file
internal/handoff/      Passes a bound reply's binary part to the page as one GET
frontend/src/
  App.svelte           Layout + global shortcuts
  components/          Svelte UI (menus, toolbar, options bar, cube palette, dialogs, status bar)
  lib/engine/          Renderer, render loop, camera, sky, documents
  lib/cubes/           Cube worlds: the format's tables, mesher, drawing, editing, palette
  lib/tools/           The Select and Cubes tools
  lib/state/           Svelte rune state, undo history, preferences
  lib/io/              Bridge to Go (open/save, recovery, scenes, session, projects)
```
