# Meld manual

Use this page as a reference while editing. For your first session, start with
[Getting started](getting-started.md). Before writing to the game, read
[Saving, compiling and playing](guides/saving-and-compiling.md).

Keys below are defaults. Open **Edit › Preferences…** (`Ctrl+,`), then **Camera and input ›
Keyboard shortcuts**, to launch the Hotkey Manager and change command and camera bindings;
**Help › Keyboard Shortcuts** shows the current ones. Mouse gestures and certain tool-local keys
such as Delete, R, arrows and Escape remain fixed.

## The workspace

The toolbar chooses the tool; the options bar above the viewport holds its settings. Open the
**Brush**, **Water**, **Placement**, **Spawns** or **Mask** panel for less frequently used settings.
If the bar is too narrow, open **More** to see its remaining controls.

The asset browser sits below the map. The dock on the right holds panels such as Layers and
Properties. Drag panel edges to resize them, and click a panel header to collapse it.
Preferences can move the toolbar to the other side of the window.

Several maps can be open in document tabs, each with its own camera and undo history.
**Ctrl+Tab** switches tabs and **Ctrl+W** closes one, asking first about unsaved changes.

## Camera controls

| Input | Action |
| --- | --- |
| Right mouse drag | Look around; orbit in Follow the Ground mode |
| Middle mouse drag | Slide sideways and vertically; pan in Follow the Ground mode |
| Wheel | Adjust flight speed; zoom in Follow the Ground mode |
| `W A S D` | Fly forward/back and strafe; forward follows your viewing direction |
| `Space` / `X` | Fly up / down |
| `Q` / `E` | Turn, unless configured to fly up/down in Preferences |
| `Shift` / `Ctrl+Shift` | Move fast / very fast |
| `T` | Toggle Follow the Ground |

Follow the Ground orbits a target that rides the terrain. Turn it off when you need to fly freely,
for example into a cave. The Camera menu also offers top-down view, collision and speed;
saved views are in the Bookmarks menu.

## Find models and textures

Set your client folder in **Edit › Preferences… › Folders** or through **Select WoW folder…**
in the asset browser.
**Ctrl+F** focuses asset search.

- **Doodads:** trees, rocks, fences, furniture and other M2 props.
- **Buildings:** WMO structures, including their default doodad set.
- **Textures:** client terrain textures and the current map's palette.
- **Creatures, NPCs and Objects:** server database assets when a VMaNGOS database is configured.
- **Sets:** named collections you create for reuse.

Use the category and zone filters to narrow a search. Hover an asset to preview it; drag the
preview to rotate it, right-drag to move vertically, and scroll to zoom. Clicking a model selects
Place; clicking a texture adds it to the palette and selects Paint.

Assets stay in your client archives. Thumbnails are generated on demand and cached. A `.wmap`
stores asset paths rather than copies, so another installation needs the corresponding assets
to display it correctly.

## Tool reference

| Tool | Default key | Use it to |
| --- | --- | --- |
| Select | `1` / `V` | Select, move and copy models or areas |
| Sculpt | `2` | Raise, lower, smooth and reshape terrain |
| Paint | `3` / `B` | Paint textures directly or through a mask |
| Roads | `4` | Brush a hard-edged road and level its ground |
| Paths | `K` | Apply a road, river or model fence along a curve |
| Water | `5` | Paint liquid layers or set a map-wide sea |
| Place | `6` | Place the selected model |
| Clear | `7` | Erase selected kinds of map content |
| Doodad brush | `8` | Scatter a weighted mix of models |
| Map data | `9` | Paint zones, impassable chunks and no-grass cells |
| Stamp | `0` | Apply a stack of sculpt and paint brushes |
| Script brush | `Y` | Paint with a compatible Lua brush script |

### Select models and areas

Click a model to select it. **Shift+click** adds or removes it from the selection. Selected models
are outlined and listed in Properties; **I** opens the floating Inspector for placement values.

| Action | Input |
| --- | --- |
| Move over a surface | Drag the selection |
| Nudge horizontally, relative to the camera | Arrow keys |
| Raise / lower | `Alt+Up/Down` or `PgUp/PgDn` |
| Rotate | `Alt+Left/Right` or `R` |
| Use larger adjustment steps | Hold `Shift` |
| Delete / focus | `Del` / `F` |
| Duplicate in place | `Ctrl+Shift+D` |
| Select all / deselect | `Ctrl+A` / `Ctrl+D` |
| Sample a model to place or ground texture to paint | `Alt+click` |

To select an area, drag on the ground. **L** switches between rectangle, lasso and polygon.
**Shift+drag** adds to the area; **Ctrl+drag** subtracts. Use **Cut hole** for a cave or cellar
opening and **Fill hole** to restore the ground.

**Ctrl+C** copies selected models, or an area's terrain, holes, textures and objects.
**Ctrl+V** shows a preview, including in another open map. Click or press **Enter** to place it;
**Esc** cancels. For an area paste, **PgUp/PgDn** adjusts the height first.

### Sculpt terrain

Choose Raise, Lower, Smooth, Flatten, Noise, Mountain, Crevice or Terrace in the options bar.
Hover a mode icon to see its name. Set size and strength, then drag over the ground.
**[ / ]** adjusts brush size.

The Brush panel holds the edit limit, brush image, shape and falloff curve, plus mode-specific
settings such as Flatten's target and angled plane, or Terrace's offset. Terrace makes stepped
levels; **Shift+drag** levels to the first click's step. Painting while sculpting is also configured
in this panel.

### Paint textures or a mask

Pick a texture in the asset browser, then paint directly onto the terrain. Each 8 × 8-cell paint
chunk can contain **four texture layers**; the map palette can contain up to **255 textures**.
The layer limit is per chunk, not per map.

In **Paint mask** mode:

1. Brush the intended area; the red overlay shows the mask.
2. Hold **Alt**, or choose Erase, to remove parts of it.
3. Click a palette texture to fill the mask with that texture.

Use Fill mask, Invert, From selection and Clear to prepare larger areas. **Paint › Auto-paint Textures by Height and Slope**
assigns textures by height and slope. Round and square brushes are available; square brushes can
snap to the grid for aligned work.

### Build a road, river or fence

Use Roads for a brushed road. Use Paths for a curve you can adjust before applying it:

1. Click the ground to add control points.
2. Drag a point to reposition it; **Shift+drag** changes its height. Click the curve to insert a
   point, or select a point and press **Del** to remove it.
3. Choose the mode and its settings, such as width, texture, falloff or spacing.
4. Press **Apply** or **Enter** to commit one undoable edit.

A **Road** levels and paints along the curve. A **River** carves a bed and adds the chosen liquid,
with its surface running downhill from the higher end. A **Fence** repeats the selected model,
aligned along the curve at the model's length or a chosen spacing.

Adjusting the path and applying again first takes back its previous application. **Esc** starts
a new path. The curve is saved as an editing aid in `.wmap`; the applied terrain, liquids and
models are exported, not the control curve itself.

### Place models and scatter details

Pick a model to preview it under the cursor, then click to place it. **Ctrl+wheel** rotates the
preview and **Alt+wheel** adjusts its height. The placed object stays selected for further adjustment.

A selected model has a rotation ring and an up/down arrow. Drag either to adjust it; hold
**Shift** to snap. The outline is yellow, with buried or intersecting parts shown in red.

Models attach to the surface they are placed on. A prop on a building moves with that building;
a ground prop follows terrain edits. Use **Properties › Detach** when that is not what you want.

For repeated placement, use **Shift+drag** or Scatter brush. For a weighted mix of models, use
Doodad brush; **Ctrl** erases its models. The Models menu groups, hides, grounds, replaces or
deletes selected models.

### Add water, zones and restrictions

Water paints liquid layers per chunk: water, ocean, magma or slime. A map-wide sea has its own
level; sculpt shorelines or dig lake beds relative to it.

Map data paints the zone assigned to each chunk. Choose Set or Clear; **Alt+click** samples
an existing zone. It also marks impassable chunks and cells that must not grow grass tufts.
These values are written to client tile data when compiled.

Clear removes the content enabled in its options, such as models, heights, liquids or holes.
Check those options before brushing a large area. Undo with **Ctrl+Z** if the result is not intended.

### Run Lua scripts and script brushes

Open **Tools › Scripts (Lua)** to write or run a `.lua` script against the open map.
**Ctrl+Enter** runs it and **Ctrl+S** saves it. Output appears below the editor; a run's map changes
form one undo step.

Scripts live in `%AppData%/Meld/scripts` on Windows or `~/.config/Meld/scripts` on Linux.
Meld supports part of Noggit Red's API, including terrain heights, models, vectors, noise maps
and images. It also provides `target_pos()` and `selected_area()`.

A script calling `brush("name")` becomes a Script brush. Pick it in that tool's options, or run
it from the Scripts window to load it. Its settings appear beside size and falloff. A whole stroke
is one undo step. Right-click brush callbacks do not run because right-click controls the camera.

Compatibility is partial: texture-layer editing, vertex colours, water, holes and general file APIs
are not supported by the scripting API. See the [scripting reference](architecture/scripting.md)
for the implemented API and limitations.

## Menus by task

| Task | Where to look |
| --- | --- |
| New/open/save maps, projects, validation and compilation | File |
| Undo, redo, history, copying, selection areas and Preferences | Edit |
| Adjust selected models | Models; Properties; Inspector |
| Terrain cleanup and shaping | Terrain |
| Auto-paint and texture replacement | Paint |
| Doodad brushes, ground effects, zones and lights | World |
| Creature, game object, quest, item, spell, icon and Lua editors | Tools |
| Heightmaps, watermaps, alphamaps, object lists and minimap images | Import/Export |
| Grid, reference image, horizon and editor display aids | View |
| Visible world layers, spawns, routes and navigation display | Show |
| Render scale, view distance, particles and model detail | Graphics |
| Time of day, shadows, client lighting, fog and prop flames | Lighting |
| Camera movement and saved views | Camera; Bookmarks |
| Launch, Play Here, login and the Game Settings shortcut | Game |
| Client/server folders, autosave, hotkeys, appearance and input | Edit › Preferences… |
| Help, keyboard shortcuts, log, Copy Scene and performance overlay | Help |

**Save is not always just a file write.** Save As keeps a `.wmap`; an existing region compiles
separately, while Save on a new client world opens a publish confirmation. Read the
[save and compile guide](guides/saving-and-compiling.md) before using these commands.

## Common shortcuts

| Action | Default shortcut |
| --- | --- |
| New / open | `Ctrl+N` / `Ctrl+O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Change brush size | `[` / `]` |
| Toggle grid | `G` |
| Help | `F1` |

For setup and builds, see [Building and development](development.md). For missing assets,
pending writes or crash recovery, see [Troubleshooting](troubleshooting.md).
