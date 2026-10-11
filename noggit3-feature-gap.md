# noggit3 features missing in WorldEditor

Compared against noggit3 (main branch, shallow clone, read from source: `src/noggit/MapView.cpp`,
`src/noggit/ui/*`, `src/noggit/tool_enums.hpp`) and WorldEditor's README, `MenuBar.svelte`,
`TerrainTools.ts` and `ObjectTools.ts`.

Items marked **(unverified)** are inferred from code or docs and were not tested in either app.

noggit edits WoW's native ADT/WMO tile format. Items tagged **(format-specific)** only exist because
of that format. WorldEditor saves `.wmap`, so they are listed for completeness, not as goals.

## 1. Terrain sculpting

- ~~**Falloff curve types**: Linear, Polynomial, Trigonometric, Quadratic, Gaussian, plus a Flat (hard edge) option.~~ *Done: Smooth (the default), Linear, Quadratic, Gaussian and Trigonometric, chosen next to the Falloff slider; a falloff of 0 is still the hard edge.*
- **Edit-mode limits**: "Only above cursor" / "Only below cursor" (only affect ground above or below the cursor height).
- **Vertex edit mode**: raise/lower a single vertex, oriented from the mouse or from the selection centre.
- **Flatten variants**: Flat, Linear, Smooth, Origin (flatten to the clicked height), Smooth-inner, and raise-only / lower-only toggling.
- **Blur** as a separate tool from Smooth (noggit combines it with Flatten in one tool).
- **Tablet pressure**: radius or speed mapped to pen pressure, with an on/off setting.
- **Chunk Mover**: drag a whole terrain chunk, with its heights and objects, to a new location.
- **Clearing tool**: brush-based erase by category (height, textures, models, liquids, holes, shadows, vertex colours, impassable flags), with a radius and a texture-alpha threshold.
- **Seam fix**: "Fix terrain gaps between chunks" (Assist menu).
- **Sphere and terrain-projected cursor shapes** (noggit's cursor switcher offers disk, sphere and terrain modes) **(unverified for WorldEditor's current brush outline)**.

## 2. Texture painting

- **Spray mode**: a pressure-based spray brush, distinct from the normal brush.
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
- **MCLQ export** **(format-specific)**.

## 4. Object (prop) editing

- **Numeric Pos/Rotation editor** with fields for position, rotation, tilt and scale.
- **Tilt** (pitch) per object. WorldEditor only spins props around Y.
- **Random rotation, tilt and scale** on placement. WorldEditor has random rotation and scale but no tilt.
- **Follow-ground rotation**: props tilt to match the terrain normal, with a smooth-follow option.
- **Rotate around a pivot point**, for single and multi-selection.
- **Rotate-following-cursor** mode.
- **Multi-selection movement** mode, with a local/world coordinate toggle for the gizmo.
- **Selective paste options**: paste only rotation, tilt or scale.
- **Hide models**: hide individual objects, toggle hidden-model visibility, and clear the hidden list.
- **Import / export object lists** as text files.
- **Helper models window**: reference models placed as visual aids.
- **WMV log import** ("Last M2 / Last WMO from WMV") (niche; depends on the WoW Model Viewer log).
- **Duplicate-model detection**, and "Clear duplicate models".
- **Clear all models** in an area.
- **Reset rotation** (Ctrl+R) as a menu item **(unverified: WorldEditor may have no explicit reset)**.
- **Mouse-move snap**: "follow cursor on the ground" vs "snap models to the ground" as separate modes.
- **Bounding box display**: draw models with boxes, and a single-box-per-model option.

## 5. Map and tile management (Assist and File menus)

- **Area ID painting** with a zone ID browser **(format-specific)**.
- **Impassable flag** tool **(format-specific)**.
- **Holes tool**: cut terrain holes, e.g. for caves **(format-specific)**.
- **Shadows editor**: auto-generate baked shadows with a sun pitch and threshold, plus a brush. noggit bakes shadows into the tile; WorldEditor shadows are runtime-only **(format-specific)**.
- **Vertex colour (shader) editor**: paint per-vertex colour with hue, saturation, value, radius and speed **(format-specific)**.
- **Tile-level save**: save the current tile, changed tiles, or all tiles. WorldEditor saves one `.wmap` file.
- **Reload tile** from disk.
- **Load full map** and mark everything changed.
- **Streaming**: ADT loading radius, unload distance and interval, plus an async loader thread count. WorldEditor loads the whole map in memory.
- **Native tile grid**: noggit works on a 64×64 ADT tile world; WorldEditor works on standalone 128–512 maps.
- **UID management**: unique IDs for models, a UID fix tool, forced UID checks, and optional shared UID storage in MySQL **(format-specific)**.
- **Port coordinates export**: write the camera position to a text file in TrinityCore / ArcEmu `.go` / `.worldport` format.
- **Save minimap images** (Ctrl+Shift+P).
- **Convert map** between alphamap formats **(format-specific)**.

## 6. Navigation and bookmarks

- **Bookmarks**: save named camera positions per map, shown in a menu.
- **Minimap window**: click to jump to a location, with ADT boundaries and light-zone overlays.
- **Map entry list** (Continents, Dungeons, Raids, Battlegrounds, Arenas, from the DBC map database). WorldEditor only has New / Open.
- **Turn camera 180°** (Shift+R).
- **Reset camera roll** (End).
- **FPS camera mode**, and a **debug camera** you can return to.
- **Locked cursor mode**, which keeps the cursor fixed while the camera moves.
- **Camera speed step keys** (O / P). WorldEditor has speed preferences, not hotkeys **(unverified)**.
- **Invert mouse** as a menu toggle. WorldEditor has "Invert camera Y" in Preferences.
- **Top-down 2D tile mode** (U).
- **Time-speed controls**: increase, decrease and pause time. WorldEditor has a day cycle but no explicit pause or speed keys **(unverified)**.

## 7. View toggles and display

- **Per-layer visibility**: Doodads, WMO doodads, Terrain, Water, WMOs (each toggleable on its own).
- **Wireframe** mode (F10).
- **Height contour lines** (F9).
- **Tile and chunk grid lines**, with "hole lines always on".
- **Flight bounds** display.
- **Vertex colour display**.
- **DBC lighting colour data**: use the client's lighting data for preview.
- **Skybox** toggle, separate from the sky.
- **Toggle UI** (Tab) to hide all panels.
- **Detail info panel**: per-tile or chunk information.
- **Light zone display** on the minimap.
- **Anti-aliasing**, **VSync** and **view distance** settings. WorldEditor has render scale and view distance.
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

- **Heightmap import and export** as an image (WorldEditor has neither).
- **Object list import / export** as text.
- **WoW ADT read/write**: noggit's native format. Large, and probably a non-goal given the `.wmap` design in CLAUDE.md.
- **MySQL UID sync**: shared unique IDs across machines **(format-specific)**.

## 10. Settings and UI

- **Settings panel** covering game path, import path, project path, WMV log path, and MCLQ export path. WorldEditor only has the WoW folder and cache.
- **Undockable tool properties** panel. WorldEditor's dock is fixed.
- **Floating tool windows**: noggit's tools open as separate windows.
- **Key Bindings window** (Ctrl+F1). WorldEditor has a Shortcuts dialog, so this is largely covered.
- **Help window** and manual links.
- **Log window** and "additional file loading log" setting.
- **Asset browser** with a dedicated search **(unverified: WorldEditor's palette is similar; may be covered)**.

## Suggested priority (fits `.wmap`, no WoW file format needed)

1. Tilt and random tilt for props, plus a numeric transform editor.
2. Clearing tool and region clear-by-category.
3. Chunk-based streaming, or at least tile-level save for large maps.
4. Heightmap image import and export.
5. Bookmarks and a minimap with click-to-jump.
6. Texture swap and spray brush.
7. Falloff curve types and flatten variants.
8. Lua scripting with script brushes. This is the largest piece and noggit's biggest differentiator.
