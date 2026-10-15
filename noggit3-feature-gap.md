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
- **Chunk Mover**: drag a whole terrain chunk, with its heights and objects, to a new location.
- **Clearing tool**: brush-based erase by category (height, textures, models, liquids, holes, shadows, vertex colours, impassable flags), with a radius and a texture-alpha threshold. *Partly done: the Clear tool (8) erases models and resets textures to the base texture, with the brush size. Height, liquids, holes, shadows, vertex colours and impassable flags are not done yet.*
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
- **Rotate around a pivot point**, for single and multi-selection.
- ~~**Rotate-following-cursor** mode.~~ *Done with Follow-ground rotation: "Rotate following cursor" is noggit3's label for that same checkbox (`ui/ObjectEditor.cpp`, "Follow Ground Rotation" group).*
- **Multi-selection movement** mode, with a local/world coordinate toggle for the gizmo.
- **Selective paste options**: paste only rotation, tilt or scale.
- ~~**Hide models**: hide individual objects, toggle hidden-model visibility, and clear the hidden list.~~ *Done: H hides the selected placed object for the session, Edit › Show Hidden Models draws them again so H can unhide one, and Shift+H unhides all. Hiding is per placed object and is not saved.*
- ~~**Import / export object lists** as text files.~~ *Done: File › Import Object List and Export Object List, tab-separated, one model per line. Tilt is in the text format too, as two more columns; six-column lists from before still read.*
- **Helper models window**: reference models placed as visual aids.
- **WMV log import** ("Last M2 / Last WMO from WMV") (niche; depends on the WoW Model Viewer log).
- ~~**Duplicate-model detection**, and "Clear duplicate models".~~ *Done: Edit › Remove Duplicate Models, one undo step.*
- ~~**Clear all models** in an area.~~ *Done: the Clear tool in Models mode.*
- **Reset rotation** (Ctrl+R) as a menu item **(unverified: Meld may have no explicit reset)**.
- **Mouse-move snap**: "follow cursor on the ground" vs "snap models to the ground" as separate modes.
- **Bounding box display**: draw models with boxes, and a single-box-per-model option.

## 5. Map and tile management (Assist and File menus)

- **Area ID painting** with a zone ID browser **(format-specific)**.
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
- **Minimap window**: click to jump to a location, with ADT boundaries and light-zone overlays.
- ~~**Map entry list** (Continents, Dungeons, Raids, Battlegrounds, Arenas, from the DBC map database). Meld only has New / Open.~~ *Done: New Map lists the client's maps from Map.dbc, grouped by type, for a map made for the client. It is not yet in Open.*
- ~~**Turn camera 180°** (Shift+R).~~ *Done: Camera › Turn Around (180°). Not on Shift+R, which rotates a selected prop.*
- **Reset camera roll** (End).
- **FPS camera mode**, and a **debug camera** you can return to.
- **Locked cursor mode**, which keeps the cursor fixed while the camera moves.
- ~~**Camera speed step keys** (O / P).~~ *Done: O and P slow and speed up the camera, and the Camera menu does the same.*
- **Top-down 2D tile mode** (U).
- **Time-speed controls**: increase, decrease and pause time. Meld has a day cycle but no explicit pause or speed keys **(unverified)**.

## 7. View toggles and display

- ~~**Per-layer visibility**: Doodads, WMO doodads, Terrain, Water, WMOs (each toggleable on its own).~~ *Done: Graphics › Layers toggles Terrain, Water and Objects. Doodads and buildings share the Objects toggle, so they can't be hidden separately.*
- ~~**Wireframe** mode (F10).~~ *Done: Graphics › Layers › Wireframe (no F10 key).*
- **Height contour lines** (F9).
- **Tile and chunk grid lines**, with "hole lines always on".
- **Flight bounds** display.
- **Vertex colour display**.
- **DBC lighting colour data**: use the client's lighting data for preview.
- **Skybox** toggle, separate from the sky.
- **Toggle UI** (Tab) to hide all panels.
- **Detail info panel**: per-tile or chunk information.
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

- **Settings panel** covering game path, import path, project path, WMV log path, and MCLQ export path. Meld only has the WoW folder and cache.
- **Undockable tool properties** panel. Meld's dock is fixed.
- **Floating tool windows**: noggit's tools open as separate windows.
- **Help window** and manual links.
- **Log window** and "additional file loading log" setting.
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
  written to any file, so it is **session-only**. *Open:* the owner decides whether Meld hides per
  instance, which the noggit design does not do, and whether to keep it session-only. The `.wmap` format
  has no field for it.
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
  its models and textures, and resets the selection. *Open:* Meld has no tiles; it saves one
  `.wmap`. The equivalent is "Revert to saved map", which discards unsaved changes and reloads the file.
  The owner needs to confirm that scope, since it is larger than S/M.
