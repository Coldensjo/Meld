# Noggit Red features missing in Meld

Compared against Noggit Red (`gitlab.com/prophecy-rp/noggit-red`, commit b274edb, 2026-09-21,
shallow clone, read from source: `src/noggit/MapView.cpp`, `src/noggit/tools/*`, `src/noggit/ui/*`,
`src/noggit/ui/tools/*`, `src/noggit/tool_enums.hpp`) and Meld's README, `MenuBar.svelte`,
`TerrainTools.ts` and `ObjectTools.ts`. This file began as the noggit3 gap list; Noggit Red is the
maintained fork of noggit3 and keeps nearly all of its features, so the noggit3 items stay where they
were and the ones only Noggit Red has are tagged **(Red)**. Section numbers are unchanged, since
BACKLOG.md cites them as `gap §N`.

Items marked **(unverified)** are inferred from code or docs and were not tested in either app.

noggit edits WoW's native ADT/WMO tile format. Items tagged **(format-specific)** only exist because
of that format. Meld saves `.wmap`, so they are listed for completeness, not as goals. Noggit Red also
edits clients after 1.12 (up to WotLK and, partly, later ones). Features that only exist in those
clients are left out of this list, since Meld targets 1.12: vertex colours (MCCV), 8-bit alpha maps,
MH2O water, texture height mapping, WMO low-res models, map difficulties, skyboxes and zone lights.

## 1. Terrain sculpting

- ~~**Falloff curve types**: Linear, Polynomial, Trigonometric, Quadratic, Gaussian, plus a Flat (hard edge) option.~~ *Done: Smooth (the default), Linear, Quadratic, Gaussian and Trigonometric, chosen next to the Falloff slider; a falloff of 0 is still the hard edge.*
- ~~**Edit-mode limits**: "Only above cursor" / "Only below cursor" (only affect ground above or below the cursor height).~~ *Done: the Sculpt options have Only above cursor and Only below cursor, which compare each vertex with the height under the cursor. Road (level) and Water use the same limit (BACKLOG B-019).*
- ~~**Vertex edit mode**: raise/lower a single vertex, oriented from the mouse or from the selection centre.~~ *Done: Sculpt › Vertex selects vertices with the brush (Ctrl or Alt deselects), Shift+drag moves them, Flatten levels them, and Slope and Direction lay them on a plane through the selection centre or the cursor (Space aims the slope from the cursor to the centre).*
- **Flatten variants**: Flat, Linear, Smooth, Origin (flatten to the clicked height), Smooth-inner, and raise-only / lower-only toggling. *Partly done: Origin was already there; the Sculpt options now add an average-height target (Flat), raise-only / lower-only and Noggit Red's Angled mode (angle and orientation). Linear, Smooth and Smooth-inner remain (BACKLOG B-018). Noggit Red drops Smooth-inner from its Flatten/Blur panel (`ui/FlattenTool.cpp`).*
- ~~**Flatten lock mode** **(Red)**: Flatten/Blur's "Lock mode" flattens to a locked point (x, y, z fields, set from the cursor) instead of the clicked height, so several strokes level to one height (`ui/FlattenTool.cpp`).~~ Meld's Origin target takes each stroke's own start. *Done: Sculpt › Flatten's Lock levels every stroke to a point locked with Alt+click (its height can be typed), and Angled pivots on it.*
- ~~**Blur** as a separate tool from Smooth (noggit combines it with Flatten in one tool).~~ *Done: Sculpt › Blur pulls each vertex toward the average over the brush's width (BACKLOG B-004).*
- ~~**Tablet pressure**: radius or speed mapped to pen pressure, with an on/off setting.~~ *Done: Camera › Tablet support (off by default) scales every Sculpt mode's speed and Paint's strength (paint, spray, swap) by pen pressure. Radius is unchanged, and so is a mouse.* **(Red)** Noggit Red instead puts a "Use Tablet" switch on every slider (`ui/tools/UiCommon/ExtendedSlider.cpp`), so radius, speed, inner radius or pressure can each follow the pen. Meld still has no pressure-driven radius.
- ~~**Chunk Mover**: drag a whole terrain chunk, with its heights and objects, to a new location.~~ *Done: noggit3's chunk mover (`chunk_mover.cpp`) copies the selected chunks' heights, textures, holes, liquids and models to where the cursor is, with a preview, a height offset, a quarter turn and a mirror. Meld's area copy and paste does the same for any cell rect (Ctrl+C, Ctrl+V with a preview, Height and Blend edges in the options bar), now with the painted liquids and a quarter turn (R). No mirror, and no min/max/add height modes. Noggit Red's Chunk Manipulator tool (`tools/ChunkTool.cpp`) is an empty panel so far, with only its chunk clipboard written.*
- **Clearing tool**: brush-based erase by category (height, textures, models, liquids, holes, shadows, impassable flags), with a radius and a texture-alpha threshold. *Mostly done: the Clear tool (7) erases models, resets textures to the base texture, brings the height to zero, removes painted liquids and fills holes, with the brush size and falloff. Shadows have no field in Meld's map file (B-057); impassable flags are painted with the Map data tool. No texture-alpha threshold. Noggit Red has no clearing brush; it clears per tile from Assist › Clean up (§5).*
- **Seam fix**: "Fix terrain gaps between chunks" (Assist menu).
- **Sphere and terrain-projected cursor shapes** (noggit3's cursor switcher offers disk, sphere and terrain modes) **(unverified for Meld's current brush outline)**. Noggit Red dropped the switcher: it draws a circle, or the stamp image for an image brush (`CursorType`).
- ~~**Image brushes** **(Red)**: Raise/Lower and Texture painting each take a "Custom Brush", a greyscale image from the user's Samples folder that shapes the brush footprint, with a rotation dial, used either as a sculpt brush or as a stamp (`ui/tools/UiCommon/ImageMaskSelector.cpp`, `World::stamp`).~~ *Done: Sculpt's shaping modes and Paint's texture brush take a greyscale image from the user's brush image folder, with Turn and Random turn; no Stamp mode (IDEAS.md B-131).*
- ~~**Stamp mode and brush stacks** **(Red)**: a Stamp tool (`tools/StampTool.cpp`, `ui/tools/BrushStack/`) that applies a stack of brushes in one press: Raise/Lower, Flatten/Blur and Texture items, reordered by drag, each inheriting or overriding the radius, inner radius, speed and rotation. Stacks are saved and loaded as files.~~ *Done: the Stamp tool (0) applies a saved, reorderable stack of sculpt and paint brushes in one stroke, each taking the stack's size, strength and turn or its own (BACKLOG B-132); the one-imprint Stamp mode is left out.*
- **Inner radius** for the sculpt brush **(Red)**: Raise/Lower has an Inner Radius slider, a flat-top core before the falloff starts. Meld's single Falloff slider covers the same ground (falloff 0 is a hard edge).

## 2. Texture painting

- ~~**Spray mode**: a pressure-based spray brush, distinct from the normal brush.~~ *Done: Paint has a Spray switch (T) with Dab size, Pressure and Inner radius, after noggit3's `World::sprayTexture`.*
- ~~**Texture swap tool**: replace one texture with another over a brushed area, or across the whole map.~~ *Done: whole-map replace, from Layers › Replace…; a chunk that has the new texture merges the two. Brushed areas are not done.* **(Red)** Noggit Red's swapper (`ui/texture_swapper.cpp`) also has a Brush mode with a radius, Entire chunk and Entire tile scopes, and "Remove this texture from ADT". Meld's Layers panel replaces or deletes a texture in the chunks of a selected area, which covers the chunk scope. *Done (B-133): Paint › Swap swaps under the brush, in Entire chunks or the Entire tile, and Keep holds the swapped texture across strokes, as the swapper's Brush mode.*
- ~~**Animated texture layers**: per-layer animation with a speed setting ("Add anim" / "Remove anim"). Noggit Red adds a rotation dial for the direction (`ui/texturing_tool.cpp`).~~ *Done: Edit › Texture Looks… sets a texture's scrolling (direction in 45° steps and speed) per map, written into MCLY on export; a region save keeps the client's own animation (BACKLOG B-014).*
- ~~**Undockable quick texture palette**: a small palette floating outside the dock.~~ *Done: Edit › Map Textures opens a floating palette of the map's textures, a click paints with one (BACKLOG B-017).*
- ~~**Show unpaintable chunks** overlay.~~ *Done: Paint's Show unpaintable chunks tints red the chunks full with four other textures (BACKLOG B-013).*
- ~~**Clear textures** and **Clear textures + set base texture** as map-wide operations.~~ *Done: Layers › Replace… › Fill whole map makes the map one chosen texture.*
- **Remove duplicate texture layers** per tile.
- ~~**Overbright** option. *Defined from Noggit Red's source: it sets the layer's glow flag (`FLAG_GLOW` in MCLY) when Add anim is applied, next to the animation settings, so it belongs with animated layers (`texturing_tool::change_tex_flag`).* **(format-specific)**~~ *Done with B-014: the same dialog's Overbright (BACKLOG B-015).*
- **Brush hardness** **(Red)**: Paint's Hardness slider (0–1) sets the inner radius as a share of the radius (`Brush::setHardness`). Meld's Falloff slider is the same control.
- **Ensure 4 texture layers** **(Red)**: Assist › Ensure 4 texture layers fills every chunk of a tile (or the map) up to four layers. *(format-specific: a modding aid; Meld's chunk slots don't need it.)*
- ~~**Cleanup empty texture chunks** **(Red)**: Assist › Loaded ADTs removes layers whose alpha is empty everywhere in a chunk. Meld's slot compaction (`acquireSlotCompacting`) frees an emptied slot only when a stroke needs it.~~ *Done: Edit › Remove Empty Texture Layers frees them across the map, or in the selected area, as one undo step (BACKLOG B-134).*

## 3. Water and liquids

- ~~**Multiple liquid types** with a liquid ID per type (noggit has River, Ocean and Custom).~~ *Done: the Water tool's Paint mode paints LiquidType IDs (water, ocean, magma, slime and the client's own rows) into per-chunk layers (B-020).*
- **Water layers**: separate layers, with "Show all layers" and a "Current layer" selector.
- ~~**Opacity modes**: auto, river, ocean, or custom factor, plus "Regen ADT opacity" to recompute it.~~ *Done: the Water tool's Opacity select (B-025).*
- ~~**Angled river mode** with an orientation setting for flowing water.~~ *Done: Angled, with angle and direction, in the Water tool (B-024).*
- ~~**Crop water**: remove water in a region.~~ *Done: Crop water in the Water tool's options bar (B-021).*
- ~~**Lock** setting for the liquid layer.~~ *Done: Lock, set with Alt+click, in the Water tool (B-023).*
- ~~**Cursor intersects liquids**: the brush can pick the water surface.~~ *Done: the Water tool's "On liquids" switch (B-022).*
- ~~**MCLQ export** **(format-specific)**.~~ *Done: noggit3's setting writes vanilla MCLQ liquids instead of MH2O. Meld's tile writer only writes MCLQ, and a test now reads the written water back through the client tile reader.*
- ~~**Watermap import** **(Red)**: Assist › Import › Import watermap reads a 257×257 PNG as the tile's water heights between a min and max height, with Set, Add, Subtract and Multiply modes and tiled edges.~~ *Done as the owner decided: File › Import Watermap… lays water where the image isn't black, its grey the depth above the ground between Min and Max (BACKLOG B-137).*

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
- ~~**Helper models window**: reference models placed as visual aids (Noggit Red's list: cubes of 50 to 1000, discs and spheres of 50, 200 and 777 radius, a human-scale figure; `ui/HelperModels.cpp`).~~ *Done as the owner decided: the asset browser's Helpers category has see-through cubes, discs, spheres and a human-height post, placed and saved like models and never exported (BACKLOG B-040).*
- **WMV log import** ("Last M2 / Last WMO from WMV") (niche; depends on the WoW Model Viewer log).
- ~~**Duplicate-model detection**, and "Clear duplicate models".~~ *Done: Edit › Remove Duplicate Models, one undo step.*
- ~~**Clear all models** in an area.~~ *Done: the Clear tool in Models mode.*
- ~~**Reset rotation** (Ctrl+R) as a menu item **(unverified: Meld may have no explicit reset)**.~~ *Done: Edit › Reset Rotation (Ctrl+R) stands the selected models upright, as noggit's does: the tilt goes and the heading stays (IDEAS.md B-036).*
- ~~**Mouse-move snap**: "follow cursor on the ground" vs "snap models to the ground" as separate modes.~~ *Done: two checkboxes in the Select tool's options bar, as noggit's. Follow cursor on the ground (on by default): a dragged single model follows the surface under the cursor, or off, slides across a level plane at its own height. Snap models to the ground (off by default): a dragged group lands on the ground, or off, keeps every model's height. An attached model stays attached either way.*
- ~~**Bounding box display**: draw models with boxes, and a single-box-per-model option.~~ *Done: View › Bounding boxes draws one box per shown model, turned and scaled with it (BACKLOG B-038).*
- ~~**Selection groups** **(Red)**: Group Selected Objects (Ctrl+B) and Ungroup tie models together, so a click on one selects the group; Clear Selection Groups List empties them (`tools/ObjectTool.cpp`, `World::_selection_groups`).~~ Meld's attachments (a parent and children) cover part of this, but a group has no leader. *Done: Edit › Group Selected Models (Ctrl+G) and Ungroup (Ctrl+Shift+G); a click selects the whole group; groups are saved in the map file (IDEAS.md B-138).*
- **Select all like selected** **(Red)**: selects every instance of the selected model. *Covered: the Properties panel's "Select all of these" (`Engine.selectModelsOfType`).*
- **Snap selected to ground** **(Red)** (Edit › Set to ground, Page Down): drops the selection onto the terrain. Meld's roots always stand at the ground plus their height offset; a one-key "height offset to 0" is not there **(unverified)**.
- ~~**Replace models by clipboard** **(Red)**: swaps each selected model for the copied one, keeping placements.~~ *Done: Edit › Replace with Copied Model swaps the selected models for the copied one in place, doodads for doodads and buildings for buildings (IDEAS.md B-140).*
- ~~**Selection brush** **(Red)**: a brush (Selection Brush Radius) that adds the models under it to the selection, and a Drag Selection Depth for the box select (`ui/ObjectEditor.cpp`).~~ Meld's area drag selects the models standing in the area, with no depth limit. *Done: the Select tool's Brush selects the models under the brush (Shift adds, Ctrl takes out).*
- ~~**Object palette** **(Red)**: a dockable list of favourite models filled from the asset browser, to place from (`ui/object_palette.cpp`). Meld's asset browser keeps recent picks; the doodad brush (B-110) is a saved list of models, but for scattering.~~ *Done: a right-click on an asset browser tile stars it as a favourite, and the favourites show first in the browser, kept in the preferences (BACKLOG B-142).*
- ~~**Translate/rotate/scale gizmo** **(Red)**: an ImGuizmo-based gizmo with move arrows on three axes, rotation rings and scale handles, in world or local space (`ui/tools/ViewportGizmo/`). Meld's gizmo has a spin ring, a height arrow and a scale knob.~~ *Done: the gizmo has x and z move arrows beside the ring, the height arrow and the scale knob, along the map's axes or the model's own (Edit › Gizmo Arrows in Local Space); scale stays uniform, as the 1.12 placement has one scale (BACKLOG B-143).*
- **Server coordinates** **(Red)**: the object context menu's "Save objects coords (to file)" writes each selected model's server position and rotation quaternion, for a gameobject spawn. Meld writes spawns itself.
- ~~**WMO doodad set and name set** per placed WMO **(Red)**: "Selected WMO Options" chooses the doodad set shown and the name set.~~ Meld places WMOs with their default set **(unverified)**. *Done: the Inspector chooses a placed WMO's doodad set, drawn with its global set and written as the MODF doodad set; the name set is kept, not shown.*

## 5. Map and tile management (Assist and File menus)

- ~~**Area ID painting** with a zone ID browser **(format-specific)**.~~ *Done: the Map data tool (9) paints a zone from the client's AreaTable.dbc (a picker with every zone and subzone) into the chunks under the brush, Set or Clear, Alt+click takes a chunk's zone, and an overlay colours the chunks by zone. The `.wmap` keeps it (version 5) and the export writes it into the MCNK headers.*
- ~~**Impassable flag** tool **(format-specific)**.~~ *Done: the Map data tool's Impassable mode marks the chunks under the brush (Set or Clear), hatched red, kept in the `.wmap` (version 5) and written as the MCNK header's 0x2 flag on export.*
- ~~**Holes tool**: cut terrain holes, e.g. for caves **(format-specific)**.~~ *Done: Sculpt › Hole cuts and fills triangles, kept in the `.wmap` (version 3) and the clipboard (B-056). Exported to client tiles since B-145: the hole tools work on the client's 2×2-cell blocks (the owner's decision) and the export writes the chunks' hole bitmaps. Noggit Red's Hole Cutter is a brush with a radius.*
- **Shadows editor**: auto-generate baked shadows with a sun pitch and threshold, plus a brush. noggit bakes shadows into the tile; Meld shadows are runtime-only **(format-specific)**. Noggit Red also has Assist › Clean up › Clear shadows and a Baked Shadows view toggle (Shift+F4).
- ~~**Tile-level save**: save the current tile, changed tiles, or all tiles. Meld saves one `.wmap` file.~~ *Done as the owner chose: the `.wmap` stays one file, and Export to Client and the region save write only the tiles that changed since the last export (BACKLOG B-051).*
- ~~**Reload tile** from disk.~~ *Done: File › Revert to Saved reloads the whole `.wmap` in the same tab, since Meld has no tiles; it asks first when there are unsaved changes.*
- **Load full map** and mark everything changed.
- **Streaming**: ADT loading radius, unload distance and interval, plus an async loader thread count. Meld loads the whole map in memory.
- **Native tile grid**: noggit works on a 64×64 ADT tile world; Meld works on standalone 128–512 maps.
- **UID management**: unique IDs for models, a UID fix tool, forced UID checks, and optional shared UID storage in MySQL **(format-specific)**.
- ~~**Port coordinates export**: write the camera position to a text file in TrinityCore / ArcEmu `.go` / `.worldport` format.~~ *Done: File › Export Port Coordinates writes the camera's `.go xyz` and `.worldport` lines for a map made for the client, using its map ID. The file starts with noggit's `Map: <zone> on ADT x y` line, the zone being the chunk's from the Map data tool.*
- ~~**Save minimap images** (Ctrl+Shift+P).~~ *Done: File › Save Minimap Image… (Ctrl+Shift+P) saves the map from above as a PNG, with the tile borders (noggit3's own action does nothing; see IDEAS.md B-059). Not written into the client's minimap textures.*
- **Minimap Editor** **(Red)**: a tool (`tools/MinimapTool.cpp`, `ui/MinimapCreator.cpp`) that renders the selected tiles (or the current one) into the client's minimap textures, with a resolution, what to draw (terrain textures, normals, models, WMOs, water, shadows, elevation, the ADT grid), the lighting and water colours, and per-model include/exclude filters. This is the client write in BACKLOG B-129.
- **Per-tile Clean up** **(Red)**: Assist › Clean up on the tile under the camera: Clear height map, Remove texture duplicates, Clear textures, Clear textures + set base, Clear shadows, Clear models, Clear duplicate models. Meld's Clear tool and Layers › Fill whole map do these by brush or for the whole map, not per tile.
- ~~**Generate new WDL** **(Red)**: rewrites the map's WDL (the low-detail horizon heights and the map's tile mask) from its tiles. Meld exports tiles to the client but leaves the WDL, so a new or reshaped region keeps the old far horizon **(unverified in game)**.~~ *Done: Export to Client writes a new map's WDL from its tiles, and a region save redraws its block's horizon in the map's WDL (BACKLOG B-146).*
- **Map creation wizard** **(Red)**: create or edit a Map.dbc entry (name, directory, type, loading screen, area, corpse position, max players), pick its tiles on a 64×64 grid (click adds, Ctrl erases, Shift adds 3×3), or make a WMO-only map; it writes the DBCs and the WDT (`ui/tools/MapCreationWizard/`). *Partly covered: New World writes a new map for the client (folder and map ID, Map.dbc row), and Map Properties sets its kind (world, dungeon, raid, battleground), shown name, zone, loading screen, player limit and ghost entrance, written on publish (BACKLOG B-147). WMO-only maps too: Map Properties' WMO-only makes the map its first building, written as the WDT's global WMO with no tiles (BACKLOG B-163).*

## 6. Navigation and bookmarks

- ~~**Bookmarks**: save named camera positions per map, shown in a menu.~~ *Done: Bookmarks menu, Ctrl+B adds a view of the map; each map keeps its own.*
- ~~**Minimap window**: click to jump to a location, with ADT boundaries and light-zone overlays.~~ *Done: Camera › Minimap Window (M), a floating map of the heights (and the continent overview for a part of Azeroth) with the tile borders and the camera's spot; a click moves the camera there. Light zones are B-082.*
- ~~**Map entry list** (Continents, Dungeons, Raids, Battlegrounds, from the DBC map database). Meld only has New / Open.~~ *Done: New Map lists the client's maps from Map.dbc, grouped by type, for a map made for the client. It is not yet in Open.* Noggit Red's list adds search, a type filter, pinned maps and per-map bookmarks.
- ~~**Turn camera 180°** (Shift+R).~~ *Done: Camera › Turn Around (180°). Not on Shift+R, which rotates a selected prop.*
- **Reset camera roll** (End).
- **FPS camera mode**, and a **debug camera** you can return to. In Noggit Red the FPS camera stays 3 yards above the ground, so it walks the map as a player would; its separate Game View toggle is commented out (`MapView.cpp`).
- **Camera collision** **(Red)**: View › Camera Collision keeps the free camera at least 3 yards above the ground.
- **Locked cursor mode**, which keeps the cursor fixed while the camera moves.
- ~~**Camera speed step keys** (O / P).~~ *Done: O and P slow and speed up the camera, and the Camera menu does the same.*
- ~~**Top-down 2D tile mode** (U).~~ *Done: U (Camera › Top-down View) draws the map straight down with an orthographic camera, as noggit's tile mode does; the wheel zooms, the keys and a middle drag pan, Q/E and a right drag turn the map. Every tool works in it (noggit switches to paint), and the 3D view comes back where it was.*
- **Time-speed controls**: increase (N), decrease (B) and pause (J) time. Meld has a day cycle but no explicit pause or speed keys **(unverified)**.
- **Invert mouse** toggle (I). *Covered: Preferences › Invert camera Y.*

## 7. View toggles and display

- ~~**Per-layer visibility**: Doodads, WMO doodads, Terrain, Water, WMOs (each toggleable on its own).~~ *Done: Graphics › Layers toggles Terrain, Water and Objects. Doodads and buildings share the Objects toggle, so they can't be hidden separately.* Noggit Red puts them on F1–F6 and adds a WMO exterior toggle.
- ~~**Wireframe** mode (F10).~~ *Done: Graphics › Layers › Wireframe (no F10 key).*
- **Height contour lines** (F9).
- ~~**Tile and chunk grid lines**, with "hole lines always on".~~ *Done already: Graphics › Show grid (every 4 cells), Show chunk lines (the 8x8-cell paint chunks, pale blue) and the amber tile lines a region always draws (`Terrain.setTileBorders`). Holes are cut out of the mesh with walls, so they are always visible without lines.*
- ~~**Climb view** **(Red)**: View › Climb (Shift+F2) colours the ground too steep for a character to walk up, with a maximum climb value and an option to colour every angle (`draw_impassible_climb` in the terrain shader).~~ *Done: View › Climb (Shift+F2) tints the triangles steeper than the chosen slope red (40° to 60°, 49° by default); the colour-every-angle and smooth options are left out (BACKLOG B-153).*
- **Flight bounds** display.
- ~~**DBC lighting colour data**: use the client's lighting data for preview.~~ *Done: View › Client Lighting takes the sun, sky light, fog and water colours from the client's Light tables where the camera is (BACKLOG B-084).*
- **Skybox** toggle, separate from the sky.
- **Fog** toggle (F12). *Covered: Graphics › Fog.*
- **Model animation** toggle (F11). *Covered: Graphics › Prop animations.*
- **Particles and ribbons** **(Red)**: Noggit Red draws M2 particle emitters and ribbons (`Particle.cpp`, `rendering/glsl/particle_*`, `ribbon_*`). Meld draws only a procedural flame at a fire emitter.
- ~~**Far horizon** **(Red)**: beyond the loaded tiles Noggit Red draws the map's WDL horizon (`map_horizon.cpp`). Meld's sea floor plane hides the map edge, and a part of Azeroth ends at its block.~~ *Done: around an open region Meld draws the map's WDL tiles within five tiles, as the client draws them (View › Far Horizon; BACKLOG B-155 with B-167).*
- ~~**Toggle UI** (Tab) to hide all panels.~~ *Done: Tab (and Graphics › Hide panels) hides the toolbar, options bar, asset browser, dock and status bar; the menu bar stays, as Photoshop's Tab keeps it. Ctrl+Tab still cycles the map tabs.*
- ~~**Detail info panel**: per-tile or chunk information.~~ *Done: Graphics › Detail info shows the tile, chunk, cell, height, slope, hole and no-tuft flags, the chunk's texture layers with their share at the cell and effect IDs, the liquids covering the cell and the models in the chunk, in the viewport's top right corner, refreshed at 2 Hz.*
- **Light zone display** on the minimap.
- **Anti-aliasing**, **VSync** and **view distance** settings. Meld has render scale and view distance. Noggit Red adds an FPS limit.
- **Full-screen** setting.

## 8. Scripting (large gap)

- **Lua 5.1 scripting engine** with a script editor tool.
- **Script brushes**: user-defined brushes that edit terrain, textures and objects.
- **Script APIs**: terrain, chunks, models, textures, images, noise, random, filesystem, settings, profiles and procedures.
- **Procedural noise** via FastNoise2 in scripts.
- **Image-based heightmap import** through a script (`image_brush.lua`).
- **Procedural prop placement** (`prop_placer.lua`). *Partly covered by the doodad brush (B-110), which scatters weighted models by brush.*
- **Texture printing** from a script (`texture_printer.lua`).
- **Clean-up script** (`clean.lua`) and **height noise** (`height_noise.lua`) examples.
- **Script settings and profiles** saved per user.
- **Script-writes-to-any-file** permission setting.
- **Node editor** **(Red)**: a visual scripting graph (View › Show Node Editor, Shift+N; `ui/tools/NodeEditor/`) saved as `.ns` files, with nodes for maths, logic, lists, images and the world: chunk heightmaps, textures and alpha layers, area IDs, detail doodads, and adding and selecting object instances. It is a second way to script besides Lua.

## 9. Import, export and data

- ~~**Heightmap import and export** as an image (Meld has neither).~~ *Done: File › Export Heightmap… and Import Heightmap… use a 16-bit grey PNG of (cells + 1) samples per side, mapped from −1024 to +1024 yards. Import needs the same size and is one undo step.* **(Red)** Noggit Red's importer also has Set, Add, Subtract and Multiply modes, a min/max height (with Auto Heights from the tile) and tiled edges, per tile or for every tile; its exporter adds a normal map export.
- ~~**Object list import / export** as text.~~ *Done: see §4, Import / export object lists.*
- ~~**Alphamap export and import** **(Red)**: Assist › Export alphamaps (all, or the current texture's) writes a tile's texture alphas as images, and Import alphamaps reads them back into a chosen layer, optionally removing layers that end up empty. Meld has no texture-weight image import or export.~~ *Done: File › Export Alphamap of the Paint Texture… and Import Alphamap into the Paint Texture…, over the whole map (BACKLOG B-135).*
- **WoW ADT read/write**: noggit's native format. *Mostly covered: Meld opens part of Azeroth from the client's tiles and exports regions and new worlds back as tiles, while its own documents stay `.wmap` (CLAUDE.md, `internal/adt`).*
- **MySQL UID sync**: shared unique IDs across machines **(format-specific)**.

## 10. Settings and UI

- ~~**Settings panel** covering game path, import path, project path, WMV log path, and MCLQ export path.~~ *Covered: the Preferences menu holds the game path (WoW Client Folder), the project path (VMaNGOS Server Folder, where tiles, the map table and SQL go), the game login, the thumbnail cache, camera speed, mouse sensitivity, invert Y and tablet support. noggit's import path (its model import list) is a file dialog in Meld (File › Import Object List), its WMV log path imports from WoW Model Viewer, which Meld doesn't do, and its MCLQ export path is moot since Meld's tiles are always MCLQ.* Noggit Red adds a light/dark/system theme and the FPS limit.
- **Undockable tool properties** panel. Meld's dock is fixed.
- **Floating tool windows**: noggit's tools open as separate windows.
- ~~**Help window** and manual links.~~ *Done: the About menu is now Help, with Help… (F1: a window of short sections on getting started, the tools, brushes and undo, camera and view, with buttons to the manual and the shortcuts), Keyboard Shortcuts… and Manual (the README on GitHub, opened in the browser).*
- ~~**Log window** and "additional file loading log" setting.~~ *Done: Help › Log… keeps the last 500 lines with their time: every status message, the Go side's progress lines (exports, the ground effect scan) and, with Preferences › Log file loading on, every file read from the client with its time taken or its error. Copy and Clear buttons.*
- ~~**Asset browser** with a dedicated search **(unverified: Meld's palette is similar; may be covered)**.~~ *Done: the search-first asset browser (B-093). Noggit Red's asset browser (`ui/tools/AssetBrowser/`) is a file tree with a live 3D preview, which Meld's hover preview matches.*
- ~~**History panel** **(Red)**: a list of the undo stack with its size, where a click goes back to any step (`ui/tools/ActionHistoryNavigator/`). Meld has Undo and Redo only.~~ *Done: Edit › History opens a floating History window listing the map's steps with their times and the stack's size; a click undoes or redoes to that step (BACKLOG B-156).*
- **Projects** **(Red)**: Noggit Red opens a project (a client folder plus a project folder where edited files go) from a start window, and lists recent projects. Meld keeps one client folder and one server folder in Preferences.
- **Preset editor** **(Red)**: a window of saved model presets with a 3D preview and a minimap (`ui/tools/PresetEditor/`) **(unverified: unfinished in the source)**.
- **Changelog and updater** windows **(Red)**: shows what changed in a release and downloads a new one.

## 11. Client data editors and client tools (Noggit Red)

Noggit Red edits the client's DBC tables and patches the client. Meld reads the DBCs it needs and
writes only Map.dbc rows and tiles, so these are all gaps. Each is a client write, so check it against
the client's own reader as the tile writer is checked.

- ~~**Zone editor** **(Red)**: the Area Designator's zone browser (`ui/ZoneIDBrowser.cpp`) also creates zones and subzones and edits an AreaTable row: name, parent, exploration level, faction group, flags, minimum elevation, ambient multiplier, sound ambience by day and night, sound provider preferences, zone music and intro music (with pickers that play the sounds), and the zone's liquid type; Save writes the DBC. Meld's Map data tool only picks existing zones.~~ *Done: Edit › Zones… lists a map's zones and subzones, edits every AreaTable field (sounds, music and light as IDs, no pickers that play them) and adds zones and subzones with a free ID and exploration bit; Save writes AreaTable.dbc into the patch and the rows into the server's area_template (BACKLOG B-148).*
- ~~**Light editor** **(Red)**: the Lightning Editor (`tools/LightTool.cpp`, `ui/tools/LightEditor/`) lists the map's Light.dbc entries and the ones active at the camera (with their weights), and edits a light's position and inner and outer radius, its LightParams (glow, highlight sky, the water and ocean alphas) and its colour bands by time of day (sky, fog, clouds, water, ocean), for clear, storm and underwater weather. It adds lights and copies, and writes the DBCs. Related: B-082 (light zones on the minimap) and B-084 (reading the client's lighting for the preview).~~ *Done: Edit › Lights… lists the map's lights (the one the camera is in first), moves and resizes them, adds one at the camera, and edits their clear-weather colour bands by time of day, fog and water alphas; Save writes the four light tables into the patch (BACKLOG B-149).*
- **Area trigger editor** **(Red)**: an Area Trigger tool (`tools/AreaTriggerTool.cpp`, `ui/tools/AreaTriggerEditor/`) that shows the map's AreaTrigger.dbc entries as boxes and spheres, and adds, removes, moves, resizes and rotates them, with a category and name per trigger. Meld has no trigger display; VMaNGOS keeps its own `areatrigger_*` tables beside the DBC.
- ~~**Ground effects editor** **(Red)**: the Ground Effects tool (`ui/GroundEffectsTool.cpp`) scans the current or loaded tiles for each texture's effect sets, shows them coloured by set, creates and saves new GroundEffectTexture sets (up to four doodads and a terrain type), applies a set to a texture in the current tile, subzone, zone or the whole map, and paints the per-cell exclusion (`noEffectDoodad`). *Mostly covered: Meld learns each texture's effect from the client's tiles, sets one per texture per map (Edit › Ground Effects…), draws the tufts, and paints the no-tuft cells with the Map data tool. It can't make a new effect set, and the choice is per map, not per subzone or tile.*~~ *Done: Edit › Ground Effects… makes new effects of the client's detail models (written to GroundEffectTexture.dbc) and sets a texture's effect for the whole map, the zone or the tile under the camera, written into the tiles on export (BACKLOG B-151).*
- **Patch client** **(Red)**: Client › Patch Client and "Save Project to Client MPQ" pack the project's edited files into an MPQ (with compression and a DBC locale) for the client. *Covered differently: Meld's region export writes the tiles and map table into the user's client folder and server.*
- **Start client and server** **(Red)**: Client › Start Client, Start Server and Extract Server Map. *Covered: Meld closes and reopens the client and servers around an export (`internal/game`) and writes the server's map itself.*

## Suggested priority (fits `.wmap` and the 1.12 client, no new file format needed)

Most of the original list is done (tilt and the numeric editor, the Clear tool, heightmap import and
export, bookmarks and the minimap, spray and swap, the falloff curves). What is left, highest first:

1. Client round trip: export holes, generate the WDL for an exported region, and write the client's
   minimap textures (B-129), so an exported map looks right in game.
2. Flatten lock mode, a texture-swap brush, and image (stamp) brushes for sculpting and painting.
3. Climb view and the selection tools (groups, selection brush, replace by clipboard, snap to ground).
4. Client data: the light editor (with B-084) and the zone editor, then area triggers.
5. A history panel and the FPS (walking) camera.
6. Chunk streaming, or at least tile-level save for large maps (B-050, B-051, on the back burner).
7. Lua scripting with script brushes, or a node editor. This is the largest piece, and noggit's
   biggest differentiator.

## Definitions for the items the loop left open

Checked against noggit3 `main` at commit 59e58add (2026-04-13), in `src/noggit/`, before this file
moved to Noggit Red. "noggit does" is the behaviour in its source. "Open" is what still needs an owner
decision. A spot check of Noggit Red at b274edb finds the same behaviour for these items, except where
an entry says otherwise.

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
  *Noggit Red differs:* each slider has its own "Use Tablet" switch, radius included (§1).
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
  diagonal. *Noggit Red* offers only Flat, Linear, Smooth and Origin (`eFlattenType`), with no
  Smooth-inner.
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
