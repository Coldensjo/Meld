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

Since 2026-10-15 the backlog is GitHub issues (CLAUDE.md, "Backlog: GitHub issues"). A decision about one item is now a comment
on its issue; this file keeps the decisions made before then and the ones that reach beyond one item
(rules for many items or for the loop).

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
- Status: dropped. Parked (a closed issue labelled `parked`). Revisit only if the in-app check shows a seam.

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
- Status: dropped. Parked (a closed issue labelled `parked`).

### B-018 Flatten targets · ours
- noggit's Linear and Smooth flatten types are distance falloff curves. Ours already applies the Falloff
  curve to every sculpt mode, so they are covered. Keep ours.
- Smooth-inner is noggit's "wip" routine. It needs cell-centre vertices, which Meld does not have.
  Its meaning in our grid is not settled.
- Status: Linear and Smooth closed. Smooth-inner parked (a closed issue labelled `parked`).

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
- Status: dropped. Parked (a closed issue labelled `parked`).

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
  decisions. They were left for the loop to pick up (both done 2026-10-12).

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
  Noggit Red's key is Ctrl+B, which is Meld's Add Bookmark, so Meld uses Ctrl+G.

### B-145 Export holes to client tiles · owner decision 2026-10-15
- Question: a 1.12 tile stores holes per 2×2-cell block (a 4×4 bitmap per chunk), but Meld cut single
  cells and half cells. How should the export map Meld's holes onto the blocks?
- Choice: **snap the Hole tool to blocks**. Cutting and filling holes works on whole 2×2-cell blocks, so
  what the editor shows is what the game gets; single-cell and half-cell holes go. A hole made before the
  snap (an older map, a paste at an odd offset) exports as a hole in every block it touches.
- Decided by the owner, 2026-10-15.

### B-146 Generate the WDL · Noggit Red, with the client's sampling
- Chosen by the loop from Noggit Red (2026-10-15, B-146). Noggit Red's WDL save (`map_horizon.cpp`,
  `map_horizon::save_wdl`, `update_horizon_tile`, `getWdlheight`) writes MAOF and per tile a MARE of
  17×17 heights at the chunk corners and 16×16 at the chunk centres, each truncated to an int16, plus a
  MAHO hole mask.
- **Ours** where the 1.12 client differs: the client's own WDLs (Azeroth, Kalimdor, PVPZone01) are MVER
  18, MAOF and MARE only, with no MAHO, so Meld writes no MAHO. The outer heights are Noggit Red's (they
  match the client's Azeroth.wdl exactly). For the inner heights Meld takes the mean of the chunk's outer
  heights instead of its centre height: Noggit Red's own comment says the client's values "appear to use
  some form of averaging", and the mean comes about twice as close to the client's.
- A new map's export writes the WDL from its tiles; a region save rewrites the map's WDL with its
  block's tiles redrawn from the edited heights and every other tile as the client has it.

### B-153 Climb view · Noggit Red
- Chosen by the loop from Noggit Red (2026-10-15, B-153). Noggit Red's View › Climb (Shift+F2;
  `MapView.cpp`, `ViewToolbar.cpp`, `draw_impassible_climb` in `terrain_frag.glsl`) blends the ground half
  way to full red where the normal's angle from straight up passes the climb value (0 to 90°, 856
  milliradians or 49° by default, with a Reset), by the triangle's normal unless Smooth uses the vertex
  normals; "Display all angle color" instead puts the angle into the red channel everywhere.
- Meld does the default: the triangle's slope, the same half-way red, Shift+F2 and View › Climb, with the
  slope picked from 40°, 45°, 49°, 55° and 60° in the View menu (a pick turns the view on). It is a view
  preference (`prefs.climbView`, `prefs.climbAngle`), carried in scenes. **Ours**: Smooth and the
  all-angle colour are left out, since the triangle's slope is what the game's walk test uses and the
  all-angle colour only reads in Noggit Red's red channel.

### B-156 History panel · Noggit Red, as a floating window
- Chosen by the loop from Noggit Red (2026-10-15, B-156). Noggit Red's action history navigator
  (`ui/tools/ActionHistoryNavigator/ActionHistoryNavigator.cpp`) is a dock widget listing every action
  with its time and what it touched (terrain, textures, objects added…), the stack's size against its
  limit, and a radio button per action that sets the current action (undoing or redoing to it).
- Meld does the same list with each step's own label (Meld's commands already name what they did) and
  time, the size against the 100-step limit, and a click to go to a step; the steps Redo would bring back
  are dimmed. **Ours** for the place: a floating window opened from Edit › History, like the Inspector,
  since the owner keeps the dock to Layers alone (2026-10-15). Going to a step runs each step's own
  undo or redo, so it is no new edit of its own and the jump can be undone step by step.

### Loop: lesser tasks when no big ones are left · owner decision 2026-10-15
- Question: when every eligible backlog item is value L, should the loop stop or keep working?
- Choice: **keep working on the value L items**, in the usual order (bugs, DESIGN.md priority, value,
  then the smallest effort first), up to the run's cap. Items tagged `needs-approval` are still skipped.
- Decided by the owner, 2026-10-15.

### Approval round · owner decisions 2026-10-15
- B-051 Tile-level save. Question: save to the export's changed tiles, a tile index inside the `.wmap`, a
  folder of per-tile files, or drop it? Choice: **changed tiles in the export**; the `.wmap` stays one
  file, and Export to Client and the region save write only the tiles changed since the last export.
  Decided by the owner, 2026-10-15.
- DBC editors. Question: which client-DBC editors may the loop build? Choice: **all four**: B-148 Zone
  editor, B-149 Light editor (after B-084), B-150 Area triggers, B-151 New ground effect sets, each write
  checked against the client's reader. Decided by the owner, 2026-10-15.
- Other large items. Question: which may the loop build? Choice: **B-132 Stamp tool, B-026 Water layers
  and B-057 Baked shadows editor**; B-094 Undockable tool properties is **not approved**. Decided by the
  owner, 2026-10-15.
- Scripting. Question: approve B-100 (Lua engine), B-101 (script brushes), B-157 (node editor)? Choice:
  **keep it off**; the three stay blocked as a non-goal. Decided by the owner, 2026-10-15.

### B-051 how "changed since the last export" is found · the loop's call
- The plan sketched a hash per tile kept in the cache dir. Built instead: each built file is compared
  with the copy in Meld's own patch (`ChangedFiles`), which is always current, needs no cache and can't go
  stale when the patch is replaced or deleted. A region build is byte-for-byte deterministic (tested), so
  an unedited save finds nothing changed. With nothing changed a region save leaves the patch, the game and
  the servers alone, and a publish skips the server's map extraction when its map files are newer than
  the patch.

### B-148 Zone editor · Noggit Red, written where 1.12 and VMaNGOS read it
- Chosen by the loop from Noggit Red (2026-10-15, B-148). Noggit Red's zone browser (`ui/ZoneIDBrowser.cpp`,
  `AreaDB` in `DBC.h`, `get_new_areabit`) edits an AreaTable row and adds zones and subzones with the next
  area bit. Its field numbers are WotLK's (16 locales); the 1.12 client's table has 25 fields: ID, map,
  parent, area bit, flags, two sound preferences, ambience, music, intro music, exploration level, eight
  names and a locale mask (11 to 19), faction group, liquid, minimum elevation, ambient multiplier and
  light. Meld uses that layout, checked against the client's own file.
- **Ours**: VMaNGOS reads areas from the world database's `area_template` (entry, map, zone, explore
  bit, flags, level, name, team, liquid), not from AreaTable.dbc, so Save writes both. Sounds, music and
  light are typed as IDs; Noggit Red's pickers that play them are B-161. Rows are a form saved with Save,
  not undo steps, as the creature templates are.

### B-141 Snap selected to ground · Noggit Red, on another key
- Chosen by the loop from Noggit Red (2026-10-15, B-141). Noggit Red's Page Down
  (`World::snap_selected_models_to_the_ground`, `get_ground_height`) sets each selected model's height
  to the ground's under it, one undo step. Meld had no such action: its Page Down lowers the selection
  a step, so the snap is **Ctrl+Page Down** and Edit › Put Selected Models on the Ground. **Ours**:
  attached models are left alone, since their height is in their parent's space and they ride it.

### B-126 Area paste mirror and height modes · the loop's call
- Noggit Red's chunk manipulator has no mirror or height modes (its paste only replaces); the backlog line
  came from noggit3's chunk mover, which defines them: mirror the copied chunks, and lay the heights in as
  min, max, add or subtract. Meld's meaning, as no Noggit Red behaviour settles it: **raise only** (max)
  and **lower only** (min) take the higher or lower of the ground and the paste; **add** and **subtract**
  raise or lower the ground by how far the clip rises above its own lowest point, so a copied hill lands
  as a bump or a dent on any ground (adding absolute heights would throw it hundreds of yards up). The
  height offset slider applies in every mode, and the edge blend fades each mode's result.
- Mirror flips everything in the clip. A model can't be mirrored itself, so it turns to face the mirrored
  way, taking WoW models to face +x and be left-right symmetric: across x the yaw becomes pi - yaw, across z
  -yaw, and the forward tilt flips. A model that isn't symmetric (a sign with text, say) shows its other
  side rather than a mirror image.

### B-119 Restore the base under the dirt · the loop's call
- The map's texture roles have a rock and a dirt but no base, and adding one would change the map file's
  roles field and Map Properties. So "the base" is each chunk's own first texture, which slot compaction
  keeps as the chunk's base: on ground gentler than the dirt angle Restore base paints it back by how flat
  the ground is, and never where that first texture is the rock or the dirt role. Off by default, as the
  backlog line asked, since it also paints over roads and details under the brush.

### B-152 Camera collision · off by default
- The loop's call (2026-10-15, B-152): Meld's free camera is meant to enter caves and cellars (CLAUDE.md),
  so camera collision is a Camera menu switch, off by default, not the flying camera's only behaviour. It
  keeps the camera 3 yards above the ground the controller follows, which is the water's surface where the
  ground is under the sea, so with it on the camera stays above water too.

### B-137 Watermap import · owner decision 2026-10-15
- Question: what does the image's grey mean? Noggit Red's own import (`TileWater::setWatermapImage`) is
  unfinished: it works out a height, then skips with a TODO and changes nothing; its comments say black is
  no water and grey is water added on top of the ground.
- Choice: **depth above ground**. Black is no water; grey puts the water's surface at the ground's height
  plus min + grey × (max − min). A cell gets water where all four of its corners are not black.
- Decided by the owner, 2026-10-15.

### B-004 Blur · Noggit Red's, as a Sculpt mode
- Chosen by the loop from Noggit Red (2026-10-15, B-004). Noggit Red's blur (`flatten_blur_tool::blur`,
  `MapChunk::blurTerrain`) moves each vertex toward the average height within the brush radius, weighted
  1 - distance / radius. It differs from Meld's Smooth (a 3x3 average), so it is kept as its own mode.
- **Ours**: a Sculpt mode rather than a tool of its own, as Meld's Sculpt holds Smooth and Flatten; and the
  weight runs along x then z (a separable tent) instead of by the round distance, which is nearly the same
  blur and keeps big brushes fast. Noggit Red's Flatten/Blur raise-only and lower-only toggles are Meld's
  Only above/below cursor limits.

### B-014 and B-015 Texture animation and overbright · Noggit Red, per texture
- Chosen by the loop from Noggit Red (2026-10-15, B-014, B-015). Noggit Red's texture tool sets a layer's
  MCLY animation flags (switch 0x40, speed in 0x38, turn in 0x7, in 45-degree steps) and its glow flag
  (0x80) on the chunks it paints. These are 1.12 flags too: the client's Burning Steppes lava layers carry
  0xf2 (scrolling, speed 6, turned 90 degrees, overbright).
- **Ours**: the look is set per texture for the whole map (Edit › Texture Looks…, `editor.textureLooks`,
  saved in the `.wmap` header's `textureLooks`, no format bump), as the ground effects are, rather than per
  painted chunk, since a texture that scrolls in one chunk and not the next looks broken. A texture the map
  doesn't set keeps what the client's tile gives it. The editor doesn't animate or brighten the textures
  in its own view. Each change is an undo step.
- Found on the way, and fixed with it: a region save that rewrote a painted chunk wrote each layer's flags
  as "has alpha" alone, so the client's animated and overbright textures (lava, slime) lost both; now a
  layer without the map's own look keeps the flags its texture has in the tile (`tileLayerFlags`), checked
  against the client's Burning Steppes tiles.

### B-135 Alphamap images · Noggit Red, for the whole map and the paint texture
- Chosen by the loop from Noggit Red (2026-10-15, B-135). Noggit Red's Assist › Export/Import alphamaps
  write and read a tile's alpha maps as images, all textures or the current one. **Ours**: one image for
  the whole open map, of the paint texture (the one picked to paint with), since Meld's splat is one grid
  over the map rather than per tile; the image is stretched on import as the heightmap's is. A full chunk
  refuses a texture it lacks rather than evicting one, as painting does.

### B-142 Object palette · in the asset browser
- Chosen by the loop from Noggit Red (2026-10-15, B-142). Noggit Red's object palette is a dockable list
  of favourite models filled from its asset browser, to place from. **Ours**: the favourites are a row at
  the top of Meld's asset browser (starred with a right-click on a tile), not a dock panel, since the owner
  keeps the dock to Layers alone; they are a preference, shared by every map, and textures can be starred too.

### B-017 Quick texture palette · the map's palette, floating
- Chosen by the loop from Noggit Red (2026-10-15, B-017). Noggit Red's Quick Access Texture Palette
  (`ui/texture_palette_small.cpp`) is a floating list of textures saved with the project, added and
  removed by hand, a click selecting one. **Ours**: the window lists the map's own palette, which is
  already the textures saved with the map, so nothing is kept twice; a texture joins it by being picked
  in the asset browser, and favourites (B-142) are the cross-map list.

### B-143 Three-axis gizmo · move arrows, uniform scale
- Chosen by the loop from Noggit Red (2026-10-15, B-143). Noggit Red's ImGuizmo gizmo has move arrows on
  three axes, rotation rings and scale handles per axis, in world or local space. **Ours**: Meld's gizmo
  gains x and z move arrows (y is its height arrow already) and a local-space switch for them; rotation
  stays the yaw ring (tilts are typed in the Inspector), and scale stays the one uniform knob, since a 1.12
  placement (MDDF and MODF) stores a single scale, so a per-axis scale couldn't be exported.

### B-040 Helper models · owner decision 2026-10-15
- Question: CLAUDE.md says Meld ships no built-in prefabs; how should Noggit Red's helper models (cubes,
  discs and spheres of set sizes, a human-scale figure) work, if at all?
- Choice: **editor-only primitives**. Plain generated shapes (cube, disc, sphere in set sizes, a 2-yard
  human-height post), placeable and saved in the `.wmap` like models, never exported to the client, and
  drawn as see-through outlines. No Blizzard assets; an exception to "no built-in prefabs" for visual aids.
- Decided by the owner, 2026-10-15.

### B-162 Texture looks in the editor's view · Noggit Red's scroll, an approximate glow
- Chosen by the loop from Noggit Red (2026-10-15, B-162). Noggit Red's terrain vertex shader
  (`animUVOffset`) scrolls an animated layer's texture coordinates by one unit every 1600 ms × 7 / speed,
  along its eight direction tables; Meld uses the same rate and directions. Noggit Red draws no glow for
  overbright, so **ours** is an approximation: 1.5 times brighter. Only the looks the map sets are drawn;
  a texture keeping the client's own look shows still, as the editor doesn't read those flags per texture.

### B-132 Stamp tool with brush stacks · Noggit Red's stack, Meld's brushes
- Chosen by the loop from Noggit Red (2026-10-15, B-132, approved by the owner). Noggit Red's brush stack
  (`ui/tools/BrushStack/`) holds raise/lower, flatten/blur, texturing and shader brushes; one stroke runs
  each brush that is on, with the stack's radius, inner radius and speed overriding a brush's where it
  "affects" them, and the mask rotation likewise. **Ours**: brushes are Meld's Sculpt shaping modes and
  Paint textures (the shader brush paints vertex colours, which 1.12 hasn't got); the stack's size,
  strength and image turn are the Stamp tool's own brush settings; stacks are preferences rather than
  per-project files. Noggit Red's one-imprint Stamp mode is not built.

### B-084 Client lighting · Noggit Red's Skies, on the editor's own sky
- Chosen by the loop from Noggit Red (2026-10-15, B-084, approved by the owner). Noggit Red's Skies
  (`Sky.cpp`: `Sky::Sky`, `findSkyWeights`, `colorFor`) read Light.dbc (positions and radii divided by 36),
  start from the map's global light (at 0,0,0) and blend each local light over it by distance, fully
  inside the inner radius and fading to the outer, sorted farthest first; colours interpolate between
  band keys by time of day. Meld does the same with the 1.12 layouts (5 params per light, not 8).
- **Ours**: the client's colours drive the sun's light, the sky light, the horizon and fog colour and the
  water, while Meld keeps its own sky dome, fog distance and shadows (the client's sky is a coloured dome
  that would replace the Preetham sky; left for later). Only clear weather (the first params) is read. The
  ground ambient is half the sky ambient, as the editor's hemisphere light needs a ground colour the client
  doesn't have.

### B-149 Light editor · Noggit Red's, clear weather, one table write
- Chosen by the loop from Noggit Red (2026-10-15, B-149, approved by the owner). Noggit Red's Lightning
  Editor (`tools/LightTool.cpp`, `ui/tools/LightEditor/`) lists the map's lights and the ones active at the
  camera, edits a light's position and radii, and its params' colour and float bands by time. **Ours**: the
  same in a dialog (Edit › Lights…), for the clear-weather params only; a float band (fog distance and
  start) is set as one value for the day rather than keyed; a new light copies the global light's params
  into a params row of its own. A params row shared by several lights is edited once for all of them (the
  dialog says so). Nothing reaches the server, which doesn't read the lights.

### B-147 Map.dbc fields · the 1.12 layout, client and server
- Chosen by the loop from Noggit Red (2026-10-15, B-147). Noggit Red's map creation wizard edits a Map.dbc
  entry's name, directory, type, loading screen, area, corpse position and max players (its layout is a
  later client's). In 1.12 the client's Map.dbc keeps the type (field 2), PvP flag (3), names (4 to 12),
  zone (19) and loading screen (38), found against Molten Core's (raid, 2717, 192), Onyxia's and Warsong's
  rows; the player limit and the ghost's corpse position live in VMaNGOS's map_template, not the client's
  table. **Ours**: Map Properties edits all of them for a map made for the client; publish writes the
  client's fields into Map.dbc and the server's into map_template. WMO-only maps are left for B-163.

### B-151 Ground effect sets and scopes · Noggit Red's, per zone and tile
- Chosen by the loop from Noggit Red (2026-10-15, B-151, approved by the owner). Noggit Red's Ground Effects
  tool (`ui/GroundEffectsTool.cpp`) shows the effect sets on the loaded tiles, creates and saves new
  GroundEffectTexture sets (up to four doodads and a density), and applies a set to a texture across a
  zone, a tile or the loaded tiles. **Ours**: the choices are kept as the map's (whole map, per zone, per
  tile; a narrower one wins) and written on export, rather than painted into tiles at once, so they stay
  undoable and editable; a new set's models are picked from the detail models the client's own effects
  use (GroundEffectDoodad rows already there).

### B-163 WMO-only maps · the client's own form
- The loop's call (2026-10-15, B-163). Noggit Red's map wizard makes WMO-only maps (a global WMO in the
  WDT). Meld writes the form the 1.12 client's own WMO-only dungeons have (Blackfathom Deeps, the
  Stormwind Stockade: MPHD flag 0x1, an empty MAIN, MWMO and one MODF with unique ID 0xFFFFFFFF), checked
  byte for byte. The building is the map's first WMO as placed in the editor, so the author places and
  turns it like any model; the rest of the map (ground, other models) isn't written for such a map.

### Benilla ports first · owner decision 2026-10-15
- Question: where do the ports from Benilla go in the loop's order?
- Choice: **first** (since the move to issues: the `benilla-port` issues, lowest number first, which
  keeps this order), in the order of the old backlog's "Benilla ports" section and BENILLA.md's table (B-172 ground
  tufts, B-166 sun/sky/fog, B-173 baked shadows, B-167 WDL horizon, B-168 particles, then the rest), ahead of
  the usual DESIGN.md priority and value order, starting in a fresh session. Bugs still come first.
- Decided by the owner, 2026-10-15.


### B-172 Tuft density levels · the client's Ground Clutter stops
- The loop's call (2026-10-15, B-172), from Benilla's `clutter.rs` and the client's `SetWorldDetail` (0x488dd0).
  The client's density is `frillDensity`, the cells of a chunk that grow tufts (drawn with repeats), not a
  share per cell: its options panel writes 16, 32 or 48. **Ours**: View › Sparse, Normal and Full tufts are
  those stops (16, 32, 48), with Normal (32, the panel's Medium) as the default, as Benilla defaults to it.
  The pref keeps its values, so a saved choice carries over. The range is the client's 70 yd from the
  camera; the client's fade over its last part is left for B-178.

### B-166 The client's sun, sky and fog · scope
- The loop's call (2026-10-15, B-166). Ported from Benilla: DayNight's lighting sun (it never sets; night is
  its colours), the visible sun, moon and stars on the client's tables, the five-stop sky dome with the dawn
  and dusk warp, the scene fog rule (end = the light's fog end or the far clip, start = its share, a storm's
  negative), and the client's band walk (keys as a cycle in stored order). The clouds (Benilla's `clouds/`,
  a module of its own) are left for B-179, and the bodies are drawn as before rather than from the client's
  moon and star textures. three's fog is a smoothstep between its distances where the client's is linear.

### B-173 Baked terrain shadows · shown, not kept
- The loop's call (2026-10-15, B-173). A region's baked shadows (MCSH) are read from the client for the open
  block and drawn as the client draws them (70% of the light in shadow), behind View › Baked Shadows, on by
  default since the game always draws them. They are not saved in the `.wmap` (no format change): a region
  save keeps the client's MCSH as before, so what the preview shows is what the game will show. Storing and
  editing them is B-057's to decide. Sculpting doesn't move them, in the editor or in the game.

### B-167 Far horizon · Benilla's ring, in the fog colour
- The loop's call (2026-10-15, B-167). The client draws the WDL past its loaded tiles as a flat silhouette in
  the fog colour, ±3 tiles; Benilla draws ±5, since hills further out still rise above the horizon. **Ours**:
  around an open region, the map's WDL tiles within five tiles of the block, in the horizon colour (the
  editor's own, or the client's fog colour with Client Lighting), on by default behind View › Far Horizon,
  hidden in the top-down view. Where the client shows a bare white hull with fog off, Meld keeps the
  horizon colour, since fog off is only a viewing choice in the editor. A map of its own has no map around it.

### B-168 split · the loop's call
- The loop's call (2026-10-15, B-168). Benilla's particles, ribbons, texture and material animation are about
  7000 lines of Rust, too much for one item that finishes cleanly. The texture (UV) animation was done as
  B-168; the colour and transparency animation (B-181), the particles (B-182, with B-154) and the ribbons
  (B-183) are their own items, in that order after B-168's place in the Benilla ports.
