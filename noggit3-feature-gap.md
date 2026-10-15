# noggit3 features missing in Meld

Compared against noggit3 (main branch, shallow clone, read from source: `src/noggit/MapView.cpp`,
`src/noggit/ui/*`, `src/noggit/tool_enums.hpp`) and Meld's README, `MenuBar.svelte`,
`TerrainTools.ts` and `ObjectTools.ts`.

Items marked **(unverified)** are inferred from code or docs and were not tested in either app.

noggit edits WoW's native ADT/WMO tile format. Items tagged **(format-specific)** only exist because
of that format. Meld saves `.wmap`, so they are listed for completeness, not as goals.

## 1. Terrain sculpting

- ~~**Falloff curve types**: Linear, Polynomial, Trigonometric, Quadratic, Gaussian, plus a Flat (hard edge) option.~~ *Done: Smooth (the default), Linear, Quadratic, Gaussian and Trigonometric, chosen next to the Falloff slider; a falloff of 0 is still the hard edge.*
- ~~**Edit-mode limits**: "Only above cursor" / "Only below cursor" (only affect ground above or below the cursor height).~~ *Done: the Sculpt options have Only above cursor and Only below cursor, which compare each vertex with the height under the cursor. Road (level) and Water use the same limit (BACKLOG B-019).*
- ~~**Vertex edit mode**: raise/lower a single vertex, oriented from the mouse or from the selection centre.~~ *Done: Sculpt › Vertex selects vertices with the brush (Ctrl or Alt deselects), Shift+drag moves them, Flatten levels them, and Slope and Direction lay them on a plane through the selection centre or the cursor (Space aims the slope from the cursor to the centre).*
- **Flatten variants**: Flat, Linear, Smooth, Origin (flatten to the clicked height), Smooth-inner, and raise-only / lower-only toggling. *Partly done: Origin was already there; the Sculpt options now add an average-height target (Flat) and raise-only / lower-only. Linear, Smooth and Smooth-inner remain (BACKLOG B-018).*
- **Blur** as a separate tool from Smooth (noggit combines it with Flatten in one tool).
- ~~**Tablet pressure**: radius or speed mapped to pen pressure, with an on/off setting.~~ *Done: Camera › Tablet support (off by default) scales every Sculpt mode's speed and Paint's strength (paint, spray, swap) by pen pressure. Radius is unchanged, and so is a mouse.*
- ~~**Chunk Mover**: drag a whole terrain chunk, with its heights and objects, to a new location.~~ *Done: noggit3's chunk mover (`chunk_mover.cpp`) copies the selected chunks' heights, textures, holes, liquids and models to where the cursor is, with a preview, a height offset, a quarter turn and a mirror. Meld's area copy and paste does the same for any cell rect (Ctrl+C, Ctrl+V with a preview, Height and Blend edges in the options bar), now with the painted liquids and a quarter turn (R). No mirror, and no min/max/add height modes.*
- **Clearing tool**: brush-based erase by category (height, textures, models, liquids, holes, shadows, vertex colours, impassable flags), with a radius and a texture-alpha threshold. *Mostly done: the Clear tool (7) erases models, resets textures to the base texture, brings the height to zero, removes painted liquids and fills holes, with the brush size and falloff. Shadows, vertex colours and impassable flags have no field in Meld's map file (B-055, B-057, B-058). No texture-alpha threshold.*
- **Seam fix**: "Fix terrain gaps between chunks" (Assist menu).
- **Sphere and terrain-projected cursor shapes** (noggit's cursor switcher offers disk, sphere and terrain modes) **(unverified for Meld's current brush outline)**.

## 2. Texture painting

- ~~**Spray mode**: a pressure-based spray brush, distinct from the normal brush.~~ *Done: Paint has a Spray switch (T) with Dab size, Pressure and Inner radius, after noggit3's `World::sprayTexture`.*
- ~~**Texture swap tool**: replace one texture with another over a brushed area, or across the whole map.~~ *Done: whole-map replace, from Layers › Replace…; a chunk that has the new texture merges the two. Brushed areas are not done.*
- **Animated texture layers**: per-layer animation with a speed setting ("Add anim" / "Remove anim").
- **Undockable quick texture palette**: a small palette floating outside the dock.
- **Show unpaintable chunks** overlay.
- **Alphamap conversion**: convert the map between 8-bit and 4-bit alphamap formats **(format-specific)**.
- ~~**Clear textures** and **Clear textures + set base texture** as map-wide operations.~~ *Done: Layers › Replace… › Fill whole map makes the map one chosen texture.*
- **Remove duplicate texture layers** per tile.
- **Overbright** option **(unverified: exact effect not clear from the labels)**.

## 3. Water and liquids

- **Multiple liquid types** with a liquid ID per type (noggit has River, Ocean and Custom).
- **Water layers**: separate layers, with "Show all layers" and a "Current layer" selector.
- **Opacity modes**: auto, river, ocean, or custom factor, plus "Regen ADT opacity" to recompute it.
- **Angled river mode** with an orientation setting for flowing water.
- **Crop water**: remove water in a region.
- **Lock** setting for the liquid layer.
- **Cursor intersects liquids**: the brush can pick the water surface.
- ~~**MCLQ export** **(format-specific)**.~~ *Done: noggit3's setting writes vanilla MCLQ liquids instead of MH2O. Meld's tile writer only writes MCLQ, and a test now reads the written water back through the client tile reader.*

## 4. Object (prop) editing

- ~~**Numeric Pos/Rotation editor** with fields for position, rotation, tilt and scale.~~ *Done: the Properties panel has typed fields for X, Z, height, rotation, tilt, roll and scale.*
- ~~**Tilt** (pitch) per object. Meld only spins props around Y.~~ *Done: Tilt and Roll (forward-back and side-to-side) in the Properties panel, saved in the map and written to the client placements. The sign of the tilt in the client is not yet checked in game.*
- ~~**Random rotation, tilt and scale** on placement. Meld has random rotation and scale but no tilt.~~ *Done: Random tilt (up to 8 degrees each way) is an option next to Random rotation and scale.*
- ~~**Follow-ground rotation**: props tilt to match the terrain normal, with a smooth-follow option.~~ *Done: the Select tool's Follow ground rotation option tilts a model dragged along the ground to the ground's slope, with a Smooth option.*
- ~~**Rotate around a pivot point**, for single and multi-selection.~~ *Done: with two or more models selected, R, Alt+arrows and the gizmo ring turn them about the mean of their positions (the Select tool's "Rotate around pivot point", on by default, as noggit's); off, or with one model, each turns about its own origin.*
- ~~**Rotate-following-cursor** mode.~~ *Done with Follow-ground rotation: "Rotate following cursor" is noggit3's label for that same checkbox (`ui/ObjectEditor.cpp`, "Follow Ground Rotation" group).*
- ~~**Multi-selection movement** mode, with a local/world coordinate toggle for the gizmo.~~ *Done: Shift+click builds a selection set, a drag moves it along the ground, and the gizmo stands at the group's pivot: the ring turns it (about the pivot, or each in place), the knob scales the models and their spread, and the arrow lifts them, one undo step each. noggit3 has no local/world toggle (`ui/ObjectEditor.cpp`); its Multi Selection Movement group is the pivot checkbox (B-031) and the ground snap (B-037).*
- **Selective paste options**: paste only rotation, tilt or scale.
- ~~**Hide models**: hide individual objects, toggle hidden-model visibility, and clear the hidden list.~~ *Done: H hides the selected placed object for the session, Edit › Show Hidden Models draws them again so H can unhide one, and Shift+H unhides all. Hiding is per placed object and is not saved.*
- ~~**Import / export object lists** as text files.~~ *Done: File › Import Object List and Export Object List, tab-separated, one model per line. Tilt is in the text format too, as two more columns; six-column lists from before still read.*
- **Helper models window**: reference models placed as visual aids.
- **WMV log import** ("Last M2 / Last WMO from WMV") (niche; depends on the WoW Model Viewer log).
- ~~**Duplicate-model detection**, and "Clear duplicate models".~~ *Done: Edit › Remove Duplicate Models, one undo step.*
- ~~**Clear all models** in an area.~~ *Done: the Clear tool in Models mode.*
- **Reset rotation** (Ctrl+R) as a menu item **(unverified: Meld may have no explicit reset)**.
- ~~**Mouse-move snap**: "follow cursor on the ground" vs "snap models to the ground" as separate modes.~~ *Done: two checkboxes in the Select tool's options bar, as noggit's. Follow cursor on the ground (on by default): a dragged single model follows the surface under the cursor, or off, slides across a level plane at its own height. Snap models to the ground (off by default): a dragged group lands on the ground, or off, keeps every model's height. An attached model stays attached either way.*
- **Bounding box display**: draw models with boxes, and a single-box-per-model option.

## 5. Map and tile management (Assist and File menus)

- ~~**Area ID painting** with a zone ID browser **(format-specific)**.~~ *Done: the Map data tool (9) paints a zone from the client's AreaTable.dbc (a picker with every zone and subzone) into the chunks under the brush, Set or Clear, Alt+click takes a chunk's zone, and an overlay colours the chunks by zone. The `.wmap` keeps it (version 5) and the export writes it into the MCNK headers.*
- **Impassable flag** tool **(format-specific)**.
- **Holes tool**: cut terrain holes, e.g. for caves **(format-specific)**.
- **Shadows editor**: auto-generate baked shadows with a sun pitch and threshold, plus a brush. noggit bakes shadows into the tile; Meld shadows are runtime-only **(format-specific)**.
- **Vertex colour (shader) editor**: paint per-vertex colour with hue, saturation, value, radius and speed **(format-specific)**.
- **Tile-level save**: save the current tile, changed tiles, or all tiles. Meld saves one `.wmap` file.
- ~~**Reload tile** from disk.~~ *Done: File › Revert to Saved reloads the whole `.wmap` in the same tab, since Meld has no tiles; it asks first when there are unsaved changes.*
- **Load full map** and mark everything changed.
- **Streaming**: ADT loading radius, unload distance and interval, plus an async loader thread count. Meld loads the whole map in memory.
- **Native tile grid**: noggit works on a 64×64 ADT tile world; Meld works on standalone 128–512 maps.
- **UID management**: unique IDs for models, a UID fix tool, forced UID checks, and optional shared UID storage in MySQL **(format-specific)**.
- ~~**Port coordinates export**: write the camera position to a text file in TrinityCore / ArcEmu `.go` / `.worldport` format.~~ *Done: File › Export Port Coordinates writes the camera's `.go xyz` and `.worldport` lines for a map made for the client, using its map ID. Noggit's `Map: <area>` header is not written; Meld has no area names (see B-108).*
- **Save minimap images** (Ctrl+Shift+P).
- **Convert map** between alphamap formats **(format-specific)**.

## 6. Navigation and bookmarks

- ~~**Bookmarks**: save named camera positions per map, shown in a menu.~~ *Done: Bookmarks menu, Ctrl+B adds a view of the map; each map keeps its own.*
- ~~**Minimap window**: click to jump to a location, with ADT boundaries and light-zone overlays.~~ *Done: Camera › Minimap Window (M), a floating map of the heights (and the continent overview for a part of Azeroth) with the tile borders and the camera's spot; a click moves the camera there. Light zones are B-082.*
- ~~**Map entry list** (Continents, Dungeons, Raids, Battlegrounds, Arenas, from the DBC map database). Meld only has New / Open.~~ *Done: New Map lists the client's maps from Map.dbc, grouped by type, for a map made for the client. It is not yet in Open.*
- ~~**Turn camera 180°** (Shift+R).~~ *Done: Camera › Turn Around (180°). Not on Shift+R, which rotates a selected prop.*
- **Reset camera roll** (End).
- **FPS camera mode**, and a **debug camera** you can return to.
- **Locked cursor mode**, which keeps the cursor fixed while the camera moves.
- ~~**Camera speed step keys** (O / P).~~ *Done: O and P slow and speed up the camera, and the Camera menu does the same.*
- ~~**Top-down 2D tile mode** (U).~~ *Done: U (Camera › Top-down View) draws the map straight down with an orthographic camera, as noggit's tile mode does; the wheel zooms, the keys and a middle drag pan, Q/E and a right drag turn the map. Every tool works in it (noggit switches to paint), and the 3D view comes back where it was.*
- **Time-speed controls**: increase, decrease and pause time. Meld has a day cycle but no explicit pause or speed keys **(unverified)**.

## 7. View toggles and display

- ~~**Per-layer visibility**: Doodads, WMO doodads, Terrain, Water, WMOs (each toggleable on its own).~~ *Done: Graphics › Layers toggles Terrain, Water and Objects. Doodads and buildings share the Objects toggle, so they can't be hidden separately.*
- ~~**Wireframe** mode (F10).~~ *Done: Graphics › Layers › Wireframe (no F10 key).*
- **Height contour lines** (F9).
- ~~**Tile and chunk grid lines**, with "hole lines always on".~~ *Done already: Graphics › Show grid (every 4 cells), Show chunk lines (the 8x8-cell paint chunks, pale blue) and the amber tile lines a region always draws (`Terrain.setTileBorders`). Holes are cut out of the mesh with walls, so they are always visible without lines.*
- **Flight bounds** display.
- **Vertex colour display**.
- **DBC lighting colour data**: use the client's lighting data for preview.
- **Skybox** toggle, separate from the sky.
- ~~**Toggle UI** (Tab) to hide all panels.~~ *Done: Tab (and Graphics › Hide panels) hides the toolbar, options bar, asset browser, dock and status bar; the menu bar stays, as Photoshop's Tab keeps it. Ctrl+Tab still cycles the map tabs.*
- ~~**Detail info panel**: per-tile or chunk information.~~ *Done: Graphics › Detail info shows the tile, chunk, cell, height, slope, hole and no-tuft flags, the chunk's texture layers with their share at the cell and effect IDs, the liquids covering the cell and the models in the chunk, in the viewport's top right corner, refreshed at 2 Hz.*
- **Light zone display** on the minimap.
- **Anti-aliasing**, **VSync** and **view distance** settings. Meld has render scale and view distance.
- **Full-screen** setting.

## 8. Scripting (large gap)

- **Lua 5.1 scripting engine** with a script editor tool.
- **Script brushes**: user-defined brushes that edit terrain, textures and objects.
- **Script APIs**: terrain, chunks, models, textures, images, noise, random, filesystem, settings, profiles and procedures.
- **Procedural noise** via FastNoise2 in scripts.
- **Image-based heightmap import** through a script (`image_brush.lua`).
- **Procedural prop placement** (`prop_placer.lua`).
- **Texture printing** from a script (`texture_printer.lua`).
- **Clean-up script** (`clean.lua`) and **height noise** (`height_noise.lua`) examples.
- **Script settings and profiles** saved per user.
- **Script-writes-to-any-file** permission setting.

## 9. Import, export and data

- ~~**Heightmap import and export** as an image (Meld has neither).~~ *Done: File › Export Heightmap… and Import Heightmap… use a 16-bit grey PNG of (cells + 1) samples per side, mapped from −1024 to +1024 yards. Import needs the same size and is one undo step.*
- **Object list import / export** as text.
- **WoW ADT read/write**: noggit's native format. Large, and probably a non-goal given the `.wmap` design in CLAUDE.md.
- **MySQL UID sync**: shared unique IDs across machines **(format-specific)**.

## 10. Settings and UI

- ~~**Settings panel** covering game path, import path, project path, WMV log path, and MCLQ export path.~~ *Covered: the Preferences menu holds the game path (WoW Client Folder), the project path (VMaNGOS Server Folder, where tiles, the map table and SQL go), the game login, the thumbnail cache, camera speed, mouse sensitivity, invert Y and tablet support. noggit's import path (its model import list) is a file dialog in Meld (File › Import Object List), its WMV log path imports from WoW Model Viewer, which Meld doesn't do, and its MCLQ export path is moot since Meld's tiles are always MCLQ.*
- **Undockable tool properties** panel. Meld's dock is fixed.
- **Floating tool windows**: noggit's tools open as separate windows.
- ~~**Help window** and manual links.~~ *Done: the About menu is now Help, with Help… (F1: a window of short sections on getting started, the tools, brushes and undo, camera and view, with buttons to the manual and the shortcuts), Keyboard Shortcuts… and Manual (the README on GitHub, opened in the browser).*
- ~~**Log window** and "additional file loading log" setting.~~ *Done: Help › Log… keeps the last 500 lines with their time: every status message, the Go side's progress lines (exports, the ground effect scan) and, with Preferences › Log file loading on, every file read from the client with its time taken or its error. Copy and Clear buttons.*
- **Asset browser** with a dedicated search **(unverified: Meld's palette is similar; may be covered)**.

## Suggested priority (fits `.wmap`, no WoW file format needed)

1. Tilt and random tilt for props, plus a numeric transform editor.
2. Clearing tool and region clear-by-category.
3. Chunk-based streaming, or at least tile-level save for large maps.
4. Heightmap image import and export.
5. Bookmarks and a minimap with click-to-jump.
6. Texture swap and spray brush.
7. Falloff curve types and flatten variants.
8. Lua scripting with script brushes. This is the largest piece and noggit's biggest differentiator.

## Definitions for the items the loop left open

Checked against noggit3 `main` at commit 59e58add (2026-04-13), in `src/noggit/`. "noggit does" is the
behaviour in its source. "Open" is what still needs an owner decision.

- **B-003 Vertex edit mode orientation.** noggit's Vertex mode raises or lowers the selected vertices
  onto a sloped plane through a reference point. The reference is either the **cursor** or the
  **selection centre** (`ui/terrain_tool.cpp`, `World::orientVertices`). Height is
  `ref.y + ((x - ref.x)·cos θ + (z - ref.z)·sin θ)·tan(angle)`, with the slope angle in −89°..89° and the
  direction θ in degrees. Space + right-drag turns θ to point from the cursor toward the selection centre.
  *Open:* none for the meaning. The owner only needs to say whether Meld should keep both
  references.
- **B-005 Tablet pressure.** Off by default (Settings › Tablet support). When on and a pen is in use,
  noggit maps pressure (0–1) to **speed** in the Ground and Flatten tools (speed = pressure × 10) and to
  the **paint pressure** in Paint (`MapView.cpp`, `tabletEvent`). It does not map pressure to brush
  radius. A mouse sends no pressure, so the sliders stay as set. *Open:* the owner picks speed or
  radius and the on/off setting. The noggit answer is speed plus paint strength, with no radius.
- **B-008 Seam fix.** Assist › "Fix terrain gaps between chunks" runs `World::fixAllGaps`. For each
  loaded tile it copies the edge heights of the neighbouring tile on its left and above
  (`MapChunk::fixGapLeft` / `fixGapAbove`). So a **gap is a height mismatch on the border between two
  map tiles** (64-yard ADTs in noggit), not between chunks inside one tile. Chunk Mover also applies it to
  moved chunks. *Open:* Meld keeps one height array with no tile border, so there is no border to
  mismatch. This item looks not applicable. Close it after the in-app check, or drop it.
- **B-010 Spray mode.** Corrects the note in BACKLOG. noggit's spray is **not** defined by pen pressure.
  The spray group has its own Size (1–40, the scatter radius), Pressure (0–10) and Inner radius
  (`ui/texturing_tool.cpp`). Pressure is the density: each grid point inside Size gets a paint dab with
  chance Pressure/1000 (`World::sprayTexture`). Inner radius also paints the normal brush at the cursor.
  Tablet pressure changes the dab strength, as it does for ordinary painting, but not the spray shape.
  *Open:* none. B-010 is not blocked by B-005.
- **B-012 Remove duplicate texture layers.** Assist › "Remove texture duplicates" runs on the tile under
  the camera. For each chunk, `TextureSet::removeDuplicate` finds layer slots that name the same texture
  and merges their weights into one slot. *Open:* Meld's paint model should not create a
  duplicate, so the question is whether the `.wmap` load path can. If it cannot, close the item.
- **B-018 Flatten targets.** Corrects the BACKLOG note. noggit's flatten types are weight curves on
  distance from the brush centre, not directional (`MapChunk::flattenTerrain`):
  - Linear: weight = remain × (1 − d/r).
  - Smooth: weight = remain^(1 + d/r).
  - Smooth-inner: a separate routine, labelled "wip" in noggit's UI. It moves each inner vertex (the
    8×8 cell-centre vertices in noggit's 9+8 layout) toward the midpoint of its shorter diagonal, by
    `remain` with no distance weight.

  Meld's flatten already uses the brush weight with the Falloff curve, so Linear and Smooth are
  mostly covered by the curve choice. *Open:* the owner confirms that. Smooth-inner needs a decision,
  because Meld has no cell-centre vertices. One option is the midpoint of each cell's shorter
  diagonal.
- **B-031 Rotate around a pivot.** Object Editor › Multi Selection Movement › "Rotate around pivot point"
  (default on). With two or more models selected, rotation moves each model around the **mean position**
  of the selection (`moveable_object_group::update_center`). The box says "median", but the code uses the
  average. With the box off, each model turns about its own origin. A single model always uses its own
  origin. *Open:* the owner confirms the average is wanted. Then B-031 is defined.
- **B-033 Selective paste.** Corrects the gap doc: noggit has **no per-field paste option**. Its Paste
  Options choose where the object lands (Terrain, Selection, Camera). One checkbox, "Copy rotation, tilt,
  and scale", copies all three together (`ui/ObjectEditor.cpp`, `pasteObject`). With it off, a pasted
  model gets rotation 0, tilt 0 and scale 1. Separate settings (`model/random_rotation`, `random_tilt`,
  `random_size`) then add random values in the Paste ranges. *Open:* the owner decides whether to add
  per-field paste. If so, an unchosen field uses the noggit "off" value above.
- **B-034 Hide models.** Hiding is per **model file**, not per placed object. `H` toggles a flag on the
  shared `Model`, so every instance of that model type hides together (`ModelManager`). `Space+H` draws
  hidden models, and `Shift+H` clears all hidden models and WMOs. The flag lives in memory and is not
  written to any file, so it is **session-only**. *Covered:* Meld hides per placed model (H),
  session-only, with Show hidden models and Shift+H to unhide all; whether H should take a model's
  attachments with it is B-105.
- **B-037 Mouse-move snap.** These are two **independent checkboxes**, not two modes, and each applies to
  a different selection size (`ui/ObjectEditor.cpp`, middle-drag handling):
  - Single model: "Mouse move follow cursor on the ground" (default on). On: the model's position follows
    the cursor's ground point. Off: the mouse moves the model across the camera plane (×150 per unit of
    mouse movement), at its current height.
  - Multiple models: "Mouse move snap models to the ground" (default off). Off: the group moves to the
    cursor and keeps each model's height. On: each model is then snapped to the terrain.

  *Open:* the owner decides whether Meld needs both pairs, and the defaults.
- **B-052 Reload tile from disk.** File › Reload tile (`Shift+J`) reloads the ADT under the camera
  (`World::reload_tile` → `MapIndex::reloadTile`). It **discards unsaved edits to that tile**, re-reads
  its models and textures, and resets the selection. *Covered:* Meld has no tiles; it saves one
  `.wmap`, and File › Revert to Saved discards unsaved changes and reloads the file.
