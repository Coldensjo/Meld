# Meld manual

Use this page as a reference while editing. For your first session, start with
[Getting started](getting-started.md). Before writing to the game, read
[Saving, compiling and playing](guides/saving-and-compiling.md). For creatures, objects, quests,
items, spells and world-table changes, follow
[Database and client-table authoring](guides/database-editing.md).

Keys below are defaults. Open **Edit › Preferences…** (`Ctrl+,`), then **Camera and input ›
Keyboard shortcuts**, to launch the Hotkey Manager and change command and camera bindings;
**Help › Keyboard Shortcuts** shows the current ones. Delete, H, R, the arrows, PgUp/PgDn, Esc,
Paint's T and the held Z can be moved too; mouse gestures, and Enter and Esc for placing and
cancelling a paste or an outline, remain fixed.

Jump to [tools](#tool-reference), [generation](#start-with-generated-ground),
[exchange](#exchange-images-models-and-brushes), [map checks](#check-a-map-before-compiling) or
[viewport limits](#understand-the-viewport-preview). Technical contracts live in the
[architecture references](architecture/index.md), not in the first-edit walkthrough.

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

### Explore a world, then open an editable block

1. Configure a client and project. From an open client region, choose **File › World View**
   (or start a world view from the Start dialog). Tiles stream around the camera; this is a
   browsing view, not a map you can paint, place into or run editing scripts against.
2. Move to the area you want, then choose **File › Edit Here (Open the Block Around the Camera)**.
   Select a project if asked. Meld opens the available block around the camera target in a region
   tab, or switches to an already-open region containing it. The world-view tab stays open.
3. Edit and Save As a working copy in that region tab. Compile separately to update the client;
   browsing the world view is not a save or publish operation.

Use Flying View to inspect caves; Walking View and camera collision are editor navigation aids,
not a game character simulation. A missing floor/model/tile can change where you can stand. Check
important indoor paths in the game rather than interpreting editor movement as authoritative collision.

### Inspect walkable ground and test a path

1. Open the relevant editable region and turn on **Show › Walkable ground (the server's navmesh)**.
   With server mode off, the preview builds navigation from editor geometry.
2. To compare stored server data, choose **Show › Server's mmaps (its own navmesh, for a compiled
   region)** with the appropriate server data available. This reads existing movement maps; it
   does not rebuild them or prove they match your unsaved/client edits.
3. Choose **Show › Test a Path (click two points)**, then click the start and end in the viewport.
   Read the result: a path, swimming-only route, short/unreachable route, or missing/unbuilt endpoint.
   Press **Esc** to stop picking. A missing tile is not proof the destination is impossible in-game.
4. Compare preview and stored server results only after following the
   [compile/server rebuild workflow](guides/saving-and-compiling.md). Optional movement-map
   generation may fail without failing the main compile; check the log and output freshness.

These are diagnostic overlays, not a guarantee of creature movement in a running realm. Synthetic
navigation tests check selected transforms and made-up geometry; worker/GPU/WMO/game fidelity
still requires a representative native-session comparison. Graphics quality, lighting and visibility
preferences affect the editor view, not necessarily exported terrain or the game's display settings.

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

To use models and textures from another 1.12 client (a modded or older install), open
**Tools › Import from Another Client…**, add that client's folder and pick it. Its models,
buildings and textures show as thumbnails; **Only what this client lacks** hides what your client
has already. Click thumbnails to choose them and press **Import**: each one is copied into your
client's `patch-3.MPQ` under the same path, with the textures, building groups and doodads it
needs, and then appears in the asset browser. Meld only reads the other client, and never replaces
a file your client already has a different copy of; the result lists any it left out.

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

While the current terrain session remembers a live previous application, adjusting the path and
applying again first takes that application back. That bookkeeping is not stored as a reversible
modifier in the working file: after reopening, do not assume Apply can identify old fence placements
or undo intervening terrain edits safely. Save a copy before rebuilding a baked path. **Esc** starts
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

1. Open an editable map or region, not the read-only world view. Save a separate working copy
   before trying a new script; only run scripts you trust. A second script cannot start while a run
   is active. Open **Tools › Scripts (Lua)** and enter or choose a script.
2. To inspect without changing the map, run this small example with **Ctrl+Enter**:

```lua
print(camera_pos(), #select_origin(target_pos(), 50):models())
```

   Output shows the editor camera position and number of models in the selection around its target.
   Coordinates/radii are in yards, x/z across the map and y up, not server-world coordinates;
   model turns use degrees. Results depend on your scene. This snippet was executed on a fake
   flat-map host, not in the native UI.
3. For a first editing example, use the window's shipped hill starter on a disposable map: it
   raises ground around the camera target. A run's retained edits form one undo step. Check the
   output and map, then Undo and Redo before building a larger script. The starter was also
   executed on fake terrain; its native UI/visual result remains a manual check.
4. **Ctrl+S** saves the script text, not the map. Scripts live in
   `%AppData%/Meld/scripts` on Windows or `~/.config/Meld/scripts` on Linux
   (or the OS-configured user configuration directory). Save the map separately to retain its edits.

::: warning Errors do not roll back edits
A returned Lua error or timeout can leave changes made earlier in the run. Wait for it to finish,
then use map Undo rather than rerunning it immediately. The 10-second Lua execution limit is not
an end-to-end cancellation/rollback guarantee for awaited host work; closing the Scripts window
is not an undo operation. The limited libraries are not a general security boundary for untrusted code.
:::

Meld supports terrain heights, models, vectors, noise/images, chunk texture layers, holes, zones,
impassable flags and water, plus `target_pos()` and `selected_area()`. Vertex-colour writes are
no-ops with a notice for the 1.12 format, and general file writes/image saving are not implemented.
Image loading is a separate read-only PNG host operation; ordinary Lua OS/IO libraries are absent.

A script calling `brush("name")` registers a Script brush. Pick it in that tool's options, or run
it from the Scripts window to load it. Its settings appear beside size and falloff. Left press,
held frames and release send callbacks in sequence; slow callbacks skip holds and accumulate time.
A whole stroke's retained edits become one undo step after release/events finish, including edits
before a handler error. Right-click callbacks do not run because right-click controls the camera.
A loaded brush can edit the newly active map; reload after changing its file. Saved-file tag settings
can persist, while an unsaved window-run brush does not keep those preferences.

Compatibility with Noggit Red is partial, not interchangeable scripting environments. See the
[scripting reference](architecture/scripting.md) for units, supported API and limitations, and
[scripting checks](tests/scripting.md) for synthetic tests versus live probes.

## Grow a region or exchange terrain safely

For an existing client region, use the File menu's **Grow region (save first; the map stays square)**
entries. First Save As a working copy, compile pending terrain/model/liquid changes to the client,
and save pending spawns to the database. Saving only the working file is insufficient: growth reads
fresh client tiles and server spawns. Meld refuses known uncompiled/spawn changes before replacing
the old region tab with the larger block. Adding a side also extends the other axis to keep a square;
the map edge and a 16-tile side limit restrict available choices.

New-world growth is different: changing its tile square grows the working snapshot. It shifts roots,
paths and scoped data into the larger square while attached models keep parent-local coordinates.
This operation starts a fresh undo history and leaves the map unsaved; keep a separate pre-growth
working file rather than relying on Undo. See the [terrain reference](architecture/terrain.md) for
implementation and format-preservation limits.

For **Import/Export › Import Heightmap…**, review the destination scope and min/max before Apply.
Decoded greys are bilinearly resampled and mapped into that range. Set replaces heights; Add and
Subtract offset them; Multiply multiplies current heights by the mapped values, not by a generic
percentage. Work on a saved disposable copy first. The per-tile import leaves shared boundary
vertices unchanged. Image decoding and game compatibility are separate from synthetic height tests.

### Start with generated ground

Use **File › New World** to create a new document, not to regenerate a selected patch in an existing
map. Choose the tile layout, preset and seed, then adjust the terrain and water controls before
creation. Keep the seed **and** the tile layout and settings if you need to reproduce the starting
ground: a seed alone does not describe a world. Preset cards are previews, not a game validation.

The generator fills the tile layout's bounding square. For irregular layouts, coast-aware presets
use the picked tiles to shape their coast; the stored tile mask controls which tiles belong to the
world. Unpicked tiles are not an instruction to preserve terrain in another document. A heightmap
instead stretches across the square; its own min/max, Sea and Erosion settings replace the preset
shape controls. Erosion starts off for imported images.

For presets with a sea (or an image with Sea enabled), Sea level sets the sea surface. Lakes fill
terrain basins; rivers are carved and filled, and remain editable River paths. Their Water/Slime/Magma
choice does not change the sea into that liquid. Creation shapes ground, plans lakes/rivers and then
auto-paints; it does not read an existing paint mask or area selection. Save As a working copy before
making further edits; Undo is not a way to return to another map's pre-generation state.

Do not confuse three different scopes:

- **World tile layout:** stored with the world; controls present tiles, not a paint selection.
- **Paint mask:** temporary texture coverage, not saved in the working file. Select by water includes
  ground below the enabled sea or covered by a painted liquid. It prepares texture painting; it does
  not create, remove or constrain water.
- **Selected area:** used by operations that explicitly support it. Crop water and Regenerate water
  opacity operate on whole liquid chunks touched by the area (for a free-form selection, chunks
  containing selected cells), not an exact per-cell cutout. With no area they cover the whole map.

**Paint › Auto-paint Textures by Height and Slope** replaces texture weights/slots over the whole
map as an undoable step, ignoring the paint mask and area selection. It uses current terrain and sea
settings; it is not the creation-time lake/river shore pass. Keep manual painting in a saved copy
before trying it. See [terrain contracts](architecture/terrain.md#generation-and-scope-contracts)
and [liquid scope](architecture/water.md#editing-scope-and-exchange).

### Exchange images, models and brushes

Use an editable map and the desktop backend for file dialogs. Save As a separate `.wmap` first,
then import one item, inspect it and use Undo if needed. Imports are not Compile or Publish.
Images and text lists are partial exchanges, not a replacement for the working file.

| Exchange | Scope, units and important limits |
| --- | --- |
| Heightmap | Export is a 16-bit grey PNG, one sample per outer vertex, mapping −1024…+1024 yards to black…white; heights outside that range are clamped. Import uses the range/mode and map/tile scope described above, not the paint mask. |
| Normal map | Export-only RGB ground normals, one pixel per outer vertex; not an editable heightmap or a saved material. |
| Watermap | Import greys as depth **above current ground**, between the chosen min/max in yards. Black leaves cells alone; a cell gets ordinary water only when all four corners are above the black threshold. This lays water, not a clear-and-replace of existing liquids or a sea-level change. |
| Alphamap | Pick a client paint texture first. Export/import its whole-map weight image (black absent, white full), resampled on import. It ignores the paint mask/selected area; chunks with four other textures can refuse it and keep their paint. Read the status message and undo if necessary. |
| Object list | Export root client models from the active map, not just the selection; helpers and attachments are omitted. Tab-separated x/z and height-above-ground are in yards; turn/tilt/roll are radians. Import adds valid rows as one undo step; unreadable rows are skipped and reported. It does not recreate attachment hierarchies. |
| Doodad brush | Import/Export menu commands exchange TOML brush definitions, not placed models. Imported brushes go to Preferences with unique names; an existing brush is not overwritten. |
| Model set | Use Import…/Export… in the asset browser's model-set controls for TOML definitions. Imported sets also go to Preferences under unique names, not into the map as placements. |
| Minimap | Save Minimap Image writes a standalone overview PNG. Write Minimap Tiles to the Client changes client minimap data; it is not an ordinary image export. Follow the [client-write precautions](guides/saving-and-compiling.md) first. |

Height/water/alpha imports decode square PNGs, 2–8193 pixels per side; colour PNGs are read as grey.
Use a working file, not a heightmap export, to preserve out-of-range heights and non-height data.

Map image/placement imports have undo steps; brush/set imports change preferences instead and are
not map-history operations. Their parsers can accept usable entries while reporting skipped ones;
review the result rather than assuming an all-or-nothing import. Remove unwanted definitions in their
editors or restore your backed-up preferences. Prefabs, lists, brushes and sets reference client
assets; they do not bundle those assets. The receiving client must provide them. No native file-dialog,
GPU or game round trip is certified by these source-verified instructions.

## Check a map before compiling

1. Save a working copy. Wait for models to load, then open **File › Check Map…**.
2. Review the grouped errors, warnings and notes. Checks cover model duplicates/heights,
   spawns/paths, zones, textures, hidden painted liquids and, when available, region edges and
   unsaved spawn IDs against the database. This is diagnostic advice, not permission to publish.
3. Click a located finding to move the camera there. Model/spawn findings also select their target;
   chunk findings move the camera but do not select a terrain area. Notes without a location may
   have no Go there action.
4. Inspect before using **Delete copies**, **Put on ground** or **Crop water**. Each applied fix has
   an undo step; an **(all)** action invokes a fix for each finding, not one combined undo step.
   Crop water affects the finding's whole liquid chunk. Undo unwanted fixes before saving.
5. Use **Check again** after edits or fixes: dimmed findings are not a fresh scan. Re-run if the
   window reports models still loading, then follow the [compile guide](guides/saving-and-compiling.md).

Missing client texture/area lists disable their respective existence checks. Unread region borders
cannot be compared. Database checks require backend/region context and unsaved spawns; a query failure
is reported as a note, not a successful ID check, and can trigger the usual
[database startup path](troubleshooting.md#database-features-cannot-connect). A clean list is not
proof of complete assets, safe SQL, valid compiled files, walkability or correct game rendering.

## Understand the viewport preview

The viewport helps you edit; it is not the WoW renderer. **Show** toggles world layers, **Graphics**
controls cost/detail and **Lighting** controls the preview's time, shadows and lighting. Hiding a
layer does not delete it. For a missing feature, check those controls and wait for asset loading
before changing your map. See [asset troubleshooting](troubleshooting.md).

- **World View** streams nearby terrain/models and shows a coarse horizon beyond them. Ground
  detail and small-doodad reach vary with distance; absence at a distance is not proof of missing
  map data. Use Edit Here for authoring, as described [above](#explore-a-world-then-open-an-editable-block).
- Models load asynchronously; failed models can remain placeholders. Far models may use simplified
  geometry; picking uses the full model. Instances of one animated model share an idle pose/clock,
  not independent gameplay animation states.
- **Client Lighting** reads the open map's client light tables and blends at the camera. Without
  usable tables/map context the editor keeps its fallback lighting; toggling it is not a light-table
  edit. **Weather Preview** is temporary and is not a zone weather save. Storm lighting needs
  Client Lighting; weather particles are a separate preview, hidden in top-down view.
- Water, WMO rooms, fog, shadows and effects have editor-specific shaders/culling. A correct-looking
  frame does not verify exported liquid data, indoor visibility, collision or gameplay. Check the
  compiled result in an authorized development game before distribution.

For implementation boundaries, use [placed models](architecture/objects.md#loading-workers-and-resource-lifetime),
[lighting](architecture/lighting.md#preview-and-verification-boundary) and the existing
[rendering checks](tests/rendering.md). Synthetic tests do not replace a real WebGL/native run.

## Menus by task

| Task | Where to look |
| --- | --- |
| New/open/save maps, projects, validation and compilation | File |
| Undo, redo, history, copying, selection areas and Preferences | Edit |
| Adjust selected models | Models; Properties; Inspector |
| Terrain cleanup and shaping | Terrain |
| Auto-paint and texture replacement | Paint |
| Doodad brushes, ground effects, zones and lights | World |
| Creature, game object, quest, item, spell, icon and Lua editors; importing models and textures from another client | Tools |
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
