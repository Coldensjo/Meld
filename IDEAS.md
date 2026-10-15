# IDEAS.md: owner decisions on open items

This file records the decisions behind items that were left open for the owner. The loop in LOOP.md
reads it and treats these decisions as settled. Do not reopen one without the owner's say-so.

When the loop meets a term it cannot pin down, it checks Noggit Red (LOOP.md, "Unknown meaning") and
records its choice here, marked "chosen by the loop from Noggit Red" (earlier entries say noggit3).
The owner can change any of them.

Each decision says which source it follows. Where the owner asked for noggit3 unless ours was better,
the entry says whether **noggit3** or **ours** won, and why. The definitions themselves are in
noggit-red-feature-gap.md, under "Definitions for the items the loop left open".

Recorded 2026-10-12. Source for noggit3 behaviour: commit 59e58add of wowdev/noggit3.

## Decisions

### Nothing beyond the 1.12 client · owner
- A Noggit Red feature that only exists in clients after 1.12 does not go in the gap list or the
  backlog: vertex colours (MCCV), 8-bit alpha maps, MH2O water, texture height mapping, WMO low-res
  models, map difficulties, skyboxes and zone lights. B-058 and B-083 are parked for this.
- Decided by the owner, 2026-10-15.

### B-003 Vertex edit mode: orientation reference · noggit3
- Two references, as noggit has: **Selection centre** (default) and **Cursor**.
- The ramp has a slope angle (−89° to 89°) and a direction (0° to 360°). Space + right-drag turns the
  direction to point from the cursor toward the selection centre.
- Status: unblocked. Eligible for the loop.

### B-005 Tablet pressure · noggit3
- One on/off setting, "Tablet support", off by default.
- With the setting on and a pen in use: pressure drives sculpt **speed** (Ground and Flatten), and paint
  **strength** in Paint.
- Pressure does **not** drive brush radius.
- A mouse has no pressure, so the sliders apply unchanged.
- Status: unblocked. Eligible for the loop.
- How pressure drives them, chosen by the loop (2026-10-12, B-005) · **ours**: noggit3 overwrites the speed
  and paint-pressure sliders with the pen's pressure (`MapView.cpp`, speed = pressure × 10). Meld
  multiplies the Strength slider by the pressure instead, so the slider still sets the maximum and a pen
  stroke doesn't leave the slider at its last pressure. Pressure applies to every Sculpt mode (noggit's
  Ground and Flatten tools between them cover all of its sculpt modes) and to Paint, Spray and Swap, not to
  the Mask brush, which always paints at full strength. The owner can change this.

### B-008 Seam fix · ours
- Keep ours. Meld keeps one height array, so there is no tile border to leave a gap.
- Status: dropped. Moved to Parked in BACKLOG.md. Revisit only if the in-app check shows a seam.

### B-010 Spray mode · noggit3
- Toggle with T. The spray group has Size (1 to 40, the scatter radius), Pressure (0 to 10) and an
  Inner radius checkbox.
- Pressure is the density. A grid point inside Size gets a paint dab with chance Pressure/1000.
- Inner radius also paints the normal brush at the cursor.
- Pen pressure changes dab strength, as it does for ordinary painting. It does not define the spray.
- Status: unblocked. Eligible for the loop.
- Correction, chosen by the loop from noggit3 (2026-10-12, B-010): in noggit3's code Size is not the
  scatter radius. `texturing_tool::update_spray_brush` sets the dab brush radius to Size × TEXDETAILSIZE / 2,
  and `World::sprayTexture` scatters over the normal brush radius. Meld follows the code: the brush
  Size is the scatter radius and the spray slider, labelled "Dab size", sizes each dab (at least one splat
  texel). Inner radius paints the brush's solid centre, radius × (1 − falloff), as noggit's inner brush is
  radius × hardness. The owner can change this.

### B-012 Remove duplicate texture layers · ours
- Keep ours. The paint model cannot give one chunk the same texture twice, and the `.wmap` load path
  does no merging, so it can't create a duplicate either.
- If a duplicate ever shows up on load, treat it as a bug in the loader, not as a feature.
- Status: dropped. Moved to Parked in BACKLOG.md.

### B-018 Flatten targets · ours
- noggit's Linear and Smooth flatten types are distance falloff curves. Ours already applies the Falloff
  curve to every sculpt mode, so they are covered. Keep ours.
- Smooth-inner is noggit's "wip" routine. It needs cell-centre vertices, which Meld does not have.
  Its meaning in our grid is not settled.
- Status: Linear and Smooth closed. Smooth-inner moved to Parked in BACKLOG.md.

### B-030 Follow-ground rotation · noggit3 behaviour, ours for the default
- Chosen by the loop from noggit3 (2026-10-12). noggit3's "Follow Ground Rotation" group
  (`ui/ObjectEditor.cpp`) has "Rotate following cursor" (on by default) and "Smooth follow rotation" (on).
  When a dragged model snaps to the ground, `World::rotate_selected_models_to_ground_normal` sets its X and Z
  rotation from the terrain normal. Meld does the same in the Select tool's drag, with a Smooth option.
- Default **off** (ours): on would overwrite tilts set by hand on every drag. The owner can change it.
- B-039 "Rotate-following-cursor mode" is this same checkbox, so it is closed with B-030.

### B-031 Rotate around a pivot · noggit3
- Pivot is the **mean position** of the selection. noggit's UI says "median", but its code uses the mean.
- A checkbox, "Rotate around pivot point", is on by default. With it off, each model turns about its
  own origin.
- A single model always uses its own origin.
- Status: unblocked. Eligible for the loop.

### B-033 Selective paste · ours
- Drop it. noggit3 has no per-field paste either. It has one "Copy rotation, tilt, and scale" option.
- Status: dropped. Moved to Parked in BACKLOG.md.

### B-034 Hide models · noggit3 for the lifetime, ours for the scope
- **Session only**, as noggit has it. The hidden state is not saved in the map file. Shift+H clears it.
- **Per placed object**, not per model type. Ours already places objects as separate instances, and a
  per-type hide would hide every copy of a model. noggit's per-type hide comes from its model cache, not
  from a design choice.
- Status: unblocked. Eligible for the loop.

### B-037 Mouse-move snap · noggit3
- Two independent checkboxes, one per selection size. They are not two modes.
- **Single model**, "Mouse move follow cursor on the ground", on by default. On: the model follows the
  cursor's ground point. Off: the mouse moves the model across the camera plane, at its current height.
- **Multiple models**, "Mouse move snap models to the ground", off by default. Off: the group moves to
  the cursor and keeps each model's height. On: each model is then snapped to the terrain.
- Status: built 2026-10-15.
- Two details noggit3 leaves open, chosen by the loop (2026-10-15, B-037): a model attached to a prop
  that is moved with Follow cursor off, or in a group with Snap off, **stays attached** and keeps its
  height on its parent (noggit3 has no attachments, so it has no rule); and a model snapped to the
  ground keeps its height above it (`yOff`), so a sunk rock stays sunk, where noggit3's
  `snap_selected_models_to_the_ground` puts the origin on the ground (**ours**, since the sink is a
  deliberate setting). The owner can change either.

### B-052 Reload tile from disk · ours, scoped to the map
- Meld has no tiles, so "reload tile" becomes **Revert to saved map**. It discards unsaved
  changes and reloads the `.wmap` file.
- This is smaller than the tile reload noggit does, because the whole map is one file. Effort is S/M.
- Status: unblocked. Eligible for the loop.

### B-053 Port coordinates export · noggit3, one line changed
- noggit3 writes the camera position as `.go X Y Z MAP` (Trinity) and `.worldport MAP X Y Z` (ArcEmu), with
  `X = ZEROPOINT - z`, `Y = ZEROPOINT - x`, `Z = y` (`MapView.cpp`, "Write coordinates to port.txt").
- The Trinity line is the one change: it uses `.go xyz X Y Z MAP`, because the `xyz` subcommand is what
  the app's own publish hint already uses for this server. The loop chose this from noggit3's line, and
  the owner can change it back.
- The map ID comes from the map's client ref, so a map that is not made for the client can't export.
- Status: built. chosen by the loop from noggit3.

### B-061 Map entry list · the item's own wording
- Grouped by the Map.dbc instance type (continents, dungeons, raids, battlegrounds, arenas), named from
  the English name field and offered in New Map. Field layout checked against the owner's 1.12 client.
- Status: built. chosen by the loop from the item's wording.

## Not decided here

- B-102 (mask mode has no switch) and B-103 (emptied slots stay assigned) were not open for owner
  decisions. They are still in BACKLOG.md as the loop's to pick up.

### B-006 Chunk Mover · noggit3, as Meld's area paste
- Chosen by the loop from noggit3 (2026-10-15, B-006). noggit3's chunk mover (`src/noggit/chunk_mover.cpp`,
  `ui/chunk_mover.cpp`) is not a drag: chunks are selected, follow the cursor as a preview, and a click
  copies their heights, textures, alpha maps, vertex colours, liquids, shadows, area IDs, holes and models
  onto the target chunks (each behind an Override checkbox), with a height offset, height modes (normal,
  min, max, add, subtract), a quarter turn, a mirror, "fix gaps" and "clear models" at the target. The
  source stays as it was.
- Meld's area copy and paste is the same operation for any cell rect, with a preview, Terrain / Textures /
  Objects switches, a height offset and an edge blend. The loop added what it lacked and was cheap: the
  painted liquids travel with the area, and R turns the pending paste a quarter turn. Not added: the
  mirror and the min/max/add/subtract height modes (**ours**: the blend and offset cover the common case;
  they can be a later item), and the chunk-aligned selection (ours is any rect, which is more).

### B-054, B-055, B-123 Map data fields in the `.wmap` · owner decision 2026-10-15
- One format bump: `.wmap` version 5 adds an area ID per paint chunk, an impassable flag per chunk and
  the no-tuft (noEffectDoodad) bits per cell. Maps of versions 1 to 4 still open, with the fields empty.
- The export writes them into the MCNK headers (area ID, flag 0x2, the noEffectDoodad bits), checked
  against our own reader as hard rule 5 asks.
- A region keeps the client's own values for these fields, so a save and export doesn't drop them.
- Painting them is one new Map data tool with Area, Impassable and No tufts modes.
- Status: unblocked. Eligible for the loop.

### B-105 Hide a model with its attachments · owner decision 2026-10-15
- H hides the selected objects and everything attached to them (the whole `parent` chain below), so no
  prop is left floating. Shift+H shows them all again. Still session only, as in B-034.
- Status: built 2026-10-15.

### B-059 Save minimap image · ours
- Chosen by the loop from noggit3 (2026-10-15, B-059). noggit3's File › "Save minimaps" (Ctrl+Shift+P,
  `MapView.cpp`) only sets a `Saving` flag that nothing reads, so in noggit3 it does nothing; older noggit
  rendered each tile top-down into the client's minimap textures.
- **Ours**: File › Save Minimap Image… (Ctrl+Shift+P) saves the Minimap window's picture as a PNG: the
  ground shaded by height (the client's overview for a part of Azeroth) with the tile borders, at least
  512 pixels across. Writing the client's own minimap textures would be a client write, which is a
  larger item. The owner can change this.

### B-036 Reset rotation · noggit3
- Chosen by the loop from noggit3 (2026-10-15, B-036). noggit3's Edit › Reset rotation (Ctrl+R,
  `MapView.cpp`) calls `moveable_object_group::reset_xz_rotation`, which zeroes each selected model's X and
  Z rotation (its tilt) and keeps Y (its heading). Meld does the same: Edit › Reset Rotation (Ctrl+R) takes
  the tilt off the selected models and keeps their turn. The owner can change this.

### B-133 Texture swap brush · Noggit Red, with our weighted brush
- Chosen by the loop from Noggit Red (2026-10-15, B-133). Noggit Red's swapper (`ui/texture_swapper.cpp`,
  `TextureSet::replace_texture`) swaps a set "texture to swap" for the selected texture within the brush
  radius, or in each chunk the brush reaches (Entire chunk), or in every chunk of the tile (Entire tile).
- Meld's Paint › Swap gets the two scopes and a Keep switch (the first stroke's texture stays the one to
  swap, Noggit Red's set texture). **Ours** under the brush: the swap follows the brush's strength and
  falloff, as Meld's Swap mode already did, where Noggit Red moves each texel wholly; at full strength
  and no falloff the two are the same. The owner can change this.

### B-140 Replace models with the copied one · Noggit Red, in place
- Chosen by the loop from Noggit Red (2026-10-15, B-140). Noggit Red's Replace Models (By Clipboard)
  (`tools/ObjectTool.cpp`) needs exactly one copied model and swaps every selected model of another type
  for it, keeping position, rotation and scale; its menu text says M2s are only replaced by M2s.
- Meld follows it, with a doodad replacing only doodads and a building only buildings (the menu's rule;
  a 1.12 building has no scale). **Ours** for how: the model's type changes in place, so it keeps its id,
  attachments and, in a region, its unique ID (the region save then rewrites that placement with the new
  model), where Noggit Red deletes the old instances and adds new ones. The owner can change this.

### B-131 Image brushes · Noggit Red's sculpt mode, without its stamp mode
- Chosen by the loop from Noggit Red (2026-10-15, B-131). Noggit Red's image mask
  (`ui/tools/UiCommon/ImageMaskSelector.cpp`, `MapChunk::stamp`) lays a greyscale image from the user's
  Samples folder over the brush's square, turned by a rotation (randomised after each stroke if asked),
  and multiplies each vertex's brush weight by the grey under it. It has a Sculpt mode (the brush applies
  as usual) and a Stamp mode (Shift+drag sideways grows one imprint from the stroke's original heights).
- Meld does the Sculpt mode for Sculpt's shaping modes and Paint's texture painting, with the folder as a
  preference and the image, Turn and Random turn in the options bar. The Stamp mode is left for B-132
  (stamps, which needs approval). The images are the user's own, read at runtime, so nothing ships.

### B-138 Selection groups · Noggit Red, kept in the map file
- Chosen by the loop from Noggit Red (2026-10-15, B-138). Noggit Red's selection groups (`Selection.cpp`,
  `World::add_to_selection`, the object tool's Group and Ungroup Selected Objects) make selecting one
  member select the whole group and deselecting one deselect it; grouping takes the models out of the
  groups they were in. Noggit Red keeps them per map in its project file.
- Meld does the same, with the group as a number on each placed model, saved in the `.wmap`'s header (a
  JSON field, so no format bump; older Meld ignores it). **Ours** for paste: pasted models form new groups
  of their own instead of joining the originals'. Group and Ungroup are undo steps (Ctrl+G, Ctrl+Shift+G).
