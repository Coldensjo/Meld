# BACKLOG.md: every improvement idea, with its source

Each item is one line: `- [ ] ID **Title**: what · source · value/effort · reason`.

- **Source**: `gap §N` (noggit-red-feature-gap.md section N), `loop: <item>` (found while working on
  another item), or `owner` (the owner asked for it).
- **Value**: H, M or L. How much it advances DESIGN.md's priorities.
- **Effort**: S (under a day), M, or L.
- **Tag `needs-approval`**: the loop must not pick this item. Use it for large, format-level or
  non-goal work.
- Mark done with `[x]` and a PROGRESS.md link. Do not delete done items until the next cleanup pass.

Value and effort were first estimated by the agent that seeded this file. The owner should correct
them. Fixed-section numbers refer to noggit-red-feature-gap.md.

## Bugs and broken things (always first)

- [x] B-118 **Re-home what the dropped dock panels did** · Source: owner · M/S · decided and done 2026-10-15: growing a region is File › Grow region (four actions); Save Spawns to Database and Export Spawn SQL are File actions with the unsaved count as a status bar chip; the placement numbers are a floating Inspector on the I key; no spawn list (the creature editor opens from a click); the region's facts stay in Map Properties

## Terrain sculpting and painting

- [ ] B-004 **Separate Blur tool** · gap §1 · L/S · Smooth already covers most of it
- [ ] B-013 **Show unpaintable chunks** overlay · gap §2 · L/S
- [ ] B-014 **Animated texture layers** with speed and direction (Noggit Red adds a rotation dial) · gap §2 · L/M
- [ ] B-015 **Overbright** option · gap §2 · L/S · defined from Noggit Red: it sets the layer's glow flag in MCLY, next to the animation settings, so do it with B-014
- [ ] B-017 **Undockable quick texture palette** · gap §2 · L/M
- [x] B-111 **Paint while sculpting, and texture roles**: Sculpt paints one texture or the map's rock and dirt by slope as it shapes the ground; roles are guessed from texture names and set in Map Properties · Source: owner · H/M · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-112 **Photoshop brush size controls**: [ ] and Ctrl+scroll in size bands, Shift+[ ] for falloff, Alt+right-drag on the spot · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-116 **Sculpt strength up to 10** · Source: owner · M/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session)
- [ ] B-119 **By-slope painting: restore the base on ground that flattens again**: lowering a hill leaves its rock painted; an option to paint the base role back under the dirt angle · Source: loop: B-111 · L/S · off by default, since it would erase roads and details under the brush
- [ ] B-159 **Brush image on the cursor**: the brush ring shows the image brush's shape and turn, so a stroke can be aimed · Source: loop: B-131 · L/S
- [ ] B-132 **Stamp tool with brush stacks**: one press applies a saved, reorderable stack of sculpt, flatten and paint brushes, each inheriting or overriding the radius, speed and rotation · gap §1 · L/L · needs-approval · builds on B-131
- [ ] B-134 **Remove empty texture layers** across the map: drop a chunk's layer whose weight is zero everywhere · gap §2 · L/S
- [ ] B-135 **Alphamap image export and import**: a texture's weights as an image, read back into a chosen texture · gap §9 · L/M
- [ ] B-136 **Heightmap import modes**: Set, Add, Subtract and Multiply, with a min and max height, as Noggit Red's importer · gap §9 · L/S

## Water

- [x] B-020 **Multiple liquid types** with a liquid ID each · gap §3 · M/M · done: the Water tool's Paint mode paints LiquidType IDs (water, ocean, magma, slime) into per-chunk layers, `.wmap` version 4 (see CLAUDE.md, Water)
- [x] B-021 **Crop water** in a region · gap §3 · M/S · done: Crop water in the Water tool's options bar (`Engine.cropWater`)
- [x] B-022 **Cursor intersects liquids** (brush picks the water surface) · gap §3 · M/S · done: the Water tool's "On liquids" switch
- [x] B-023 **Lock setting** for the liquid layer · gap §3 · L/S · done: Lock with Alt+click in the Water tool
- [x] B-024 **Angled river mode** for flowing water · gap §3 · M/M · done: Angled with angle and direction in the Water tool
- [x] B-025 **Opacity modes** (auto, river, ocean, custom) · gap §3 · L/M · done: the Water tool's Opacity select
- [ ] B-026 **Water layers** with a current-layer selector · gap §3 · L/L · needs-approval
- [ ] B-137 **Watermap import**: painted water heights from a PNG between a min and max height · gap §3 · L/S

## Objects (props)

- [ ] B-126 **Area paste: mirror and height modes**: noggit's chunk mover also mirrors the copied chunks and lays the heights in as min, max, add or subtract over the target; Meld's paste has the quarter turn, offset and blend only · Source: loop: B-006 · L/S
- [ ] B-128 **Area copy and paste carries the chunks' zones and flags**: the area clipboard copies heights, holes, paint, liquids and models, but not the zone, impassable flag or no-tuft cells of the chunks it covers · Source: loop: B-054 · L/S
- [ ] B-158 **Draw selection groups**: a selected group's box around all its members, and the Inspector saying a model is grouped, as Noggit Red draws its groups · Source: loop: B-138 · L/S
- [ ] B-038 **Bounding box display**, one box per model · gap §4 · L/S
- [ ] B-040 **Helper models**: reference models as visual aids (Noggit Red's: cubes, discs and spheres of set sizes and a human-scale figure) · gap §4 · L/M
- [ ] B-141 **Snap selected to ground** (Page Down): set the selected roots' height offset to the ground · gap §4 · L/S · unverified whether a one-key drop is missing
- [ ] B-142 **Object palette**: a saved list of favourite models to place from · gap §4 · L/M
- [ ] B-143 **Three-axis gizmo**: move arrows on each axis and scale handles, in world or local space · gap §4 · L/M
- [x] B-110 **Doodad brush**: a brush of weighted models scattered like paint, with scale, sink, tilt and spacing per model, a full-screen editor with its own model picker, a hover preview that the press puts down (Ctrl+scroll spins it, Shift stacks), Ctrl erases, TOML import and export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)

## Map, client and server

- [ ] B-050 **Chunk streaming** or at least tile-level load and save for large maps · gap §5 & priority 3 · H/L · needs-approval (large) · on the back burner by the owner's decision 2026-10-15: not now; when it comes, as a second document kind beside the block editor (see PROGRESS.md 2026-10-15 B-118 entry)
- [ ] B-051 **Tile-level save**: current tile or changed tiles only · gap §5 · H/M · left open in the 2026-10-12 loop run (2nd): the save is one `.wmap` file, so per-tile or changed-tile saves change the file format, which needs the owner's decision on the format first
- [x] B-056 **Holes tool** for caves · gap §5 · M/M · done: Sculpt › Hole cuts and fills triangles, holes are in the `.wmap` (version 3) and in the clipboard, with wall handles; not yet exported to client tiles (see CLAUDE.md)
- [x] B-113 **Grow a region by a tile**: a plus on each side of the open block in the Map panel opens the block one tile bigger (square, so a row or column comes along) · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session) · no longer reachable since B-115 dropped the Map panel; see B-118
- [x] B-114 **Ground effects (grass tufts)**: the client's GroundEffectTexture and GroundEffectDoodad tables, the texture-to-effect pairs learned from its tiles, tufts drawn around the camera by the texture on top of each cell, a per-map effect choice per texture, and the effect per layer plus the predominant map written on export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [ ] B-057 **Shadows editor** (baked shadows) · gap §5 · L/L · needs-approval
- [ ] B-129 **Write the client's minimap textures**: render each tile top-down into the client's `Textures\Minimap` BLPs (and md5translate.trs) on export, as Noggit Red's Minimap Editor does (with a resolution, what to draw, and model filters), so the in-game minimap shows the edited ground · Source: loop: B-059, gap §5 · L/L · a client write, checked against the client's own reader
- [x] B-146 **Generate the WDL** for an exported map, so the far horizon and the tile mask match the new tiles · gap §5 · M/M · a client write · done 2026-10-15 (PROGRESS.md), decided in IDEAS.md
- [ ] B-147 **More Map.dbc fields for a new map** (instance type, loading screen, area, corpse position, max players) and WMO-only maps, as Noggit Red's map creation wizard · gap §5 · L/M
- [ ] B-148 **Zone editor**: create zones and subzones and edit an AreaTable row (name, parent, level, faction, flags, sounds, music, liquid), written to the client's DBC · gap §11 · M/L · needs-approval (a DBC write)
- [ ] B-149 **Light editor**: edit the map's Light.dbc entries, their LightParams and colour bands by hour and weather, written to the DBCs · gap §11 · M/L · needs-approval (a DBC write) · after B-084
- [ ] B-150 **Area trigger display and editor**: the map's AreaTrigger.dbc boxes and spheres, added, moved and resized · gap §11 · L/L · needs-approval (a DBC write)
- [ ] B-151 **New ground effect sets**, and applying an effect per zone, subzone or tile rather than per map · gap §11 · L/M · needs-approval (a DBC write)
- [ ] B-124 **Doodad brush On props: footprint at world scale and a cheaper prop lookup**: a model standing on a prop is spaced by its own scale, not its world scale, and each attempt casts a ray through every model's bounds tree (up to 256 a frame); a chunk-bucketed lookup would keep a dense map smooth · Source: loop: B-120 · L/S

## Navigation, view and display

- [ ] B-127 **Group gizmo arrow in the top-down view**: the height arrow can't be dragged while top-down, since its drag plane is edge-on to the straight-down ray; a screen-space drag (pixels to height) would work in both views · Source: loop: B-072 · L/S
- [ ] B-070 **Reset camera roll** (End) · gap §6 · L/S
- [ ] B-071 **Locked cursor mode** while the camera moves · gap §6 · L/S
- [ ] B-073 **Pause and speed keys for the day cycle** (Noggit Red: N faster, B slower, J pause) · gap §6 · L/S · unverified
- [ ] B-074 **FPS camera mode**, with a debug camera to return to · gap §6 · L/M · Noggit Red's FPS camera stays 3 yards above the ground, so it walks the map as a player would
- [ ] B-152 **Camera collision**: keep the free camera at least 3 yards above the ground · gap §6 · L/S
- [ ] B-078 **Height contour lines** · gap §7 · L/M
- [x] B-153 **Climb view**: colour the ground too steep for a character to walk up, with a maximum climb angle · gap §7 · M/S · done 2026-10-15 (PROGRESS.md), decided in IDEAS.md
- [ ] B-154 **M2 particles and ribbons** drawn from the emitters, beyond the procedural flames · gap §7 · L/L
- [ ] B-155 **Far horizon** from the map's WDL beyond the open block · gap §7 · L/M · after B-146 for a new map
- [ ] B-079 **Skybox toggle**, separate from the sky · gap §7 · L/S
- [ ] B-080 **Anti-aliasing, VSync, an FPS limit and full-screen** settings · gap §7 · L/S
- [ ] B-081 **Flight bounds** display · gap §7 · L/S
- [ ] B-082 **Light zone display** · gap §7 · L/M
- [ ] B-084 **Client lighting data** for the preview · gap §7 · L/L · approved by the owner 2026-10-15: read the client's Light, LightParams and LightIntBand tables so the editor's sky, fog and ambient follow the zone the camera is in

## Settings, UI and help

- [ ] B-125 **Config fields other than the preferences written whole**: the client folder, server folder, window size and login are still saved from one instance's copy, so two windows can overwrite each other's; the same patch-and-merge as B-122 per field · Source: loop: B-122 · L/S
- [x] B-093 **Asset browser search** improvements · gap §10 · L/S · done: the search-first asset browser with synonyms, kinds, zones and category facets (CLAUDE.md, Asset browser)
- [x] B-115 **Dock reduced to Layers**: the Map, Spawns and Properties panels are no longer mounted · Source: owner · -/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session); their functions are B-118
- [ ] B-094 **Undockable tool properties** panel · gap §10 · L/L · needs-approval
- [x] B-156 **History panel**: the undo stack as a list, where a click goes back to any step · gap §10 · M/M · done 2026-10-15 (PROGRESS.md), decided in IDEAS.md

## Scripting (needs approval before any work)

- [ ] B-100 **Lua 5.1 scripting engine** with a script editor · gap §8 · H/L · needs-approval
- [ ] B-101 **Script brushes**, procedural placement, noise and image import on top of B-100 · gap §8 · H/L · needs-approval
- [ ] B-157 **Node editor**: visual scripting graphs over the map's chunks, textures and models, a second way to script · gap §8 · L/L · needs-approval

## Tooling

- [x] B-121 **Dev page must not write the user's preferences**: the dev browser page and the desktop window share config.json and each wrote all of it, so a test in the page overwrote the owner's doodad brushes; `?nosave` makes the page read-only (TESTS.md) · Source: loop: B-110 · H/S · done 2026-10-14


## Parked

Items moved here by the owner decisions in IDEAS.md, with the reason.

- B-008 **Seam fix**: Meld keeps one height array with no tile border, so there is no seam to fix. Revisit only if an in-app check shows one.
- B-012 **Remove duplicate texture layers**: the paint model and the `.wmap` loader never create a duplicate slot. A duplicate on load would be a loader bug.
- B-018 (part) **Flatten smooth-inner**: noggit3 labels it "wip", and it needs cell-centre vertices, which Meld's grid doesn't have. Its meaning here is not settled.
- B-016 **Alphamap 8-bit / 4-bit conversion**: disapproved by the owner 2026-10-15; Meld targets the 1.12 client only, which stores 4-bit alpha maps, and Meld already reads every form. Revisit only with a later client.
- B-033 **Selective paste**: noggit3 has no per-field paste, only one copy option for rotation, tilt and scale together.
- B-058 **Vertex colour editor** and B-083 **Vertex colour display**: vertex colours (MCCV) arrived after 1.12, and the owner wants no feature beyond the 1.12 client (2026-10-15).
- B-009 **Terrain-projected and sphere cursor shapes**: Noggit Red dropped noggit3's cursor switcher and draws a circle (or the stamp image), so there is no parity to reach.
