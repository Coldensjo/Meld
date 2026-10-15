# BACKLOG.md: every improvement idea, with its source

Each item is one line: `- [ ] ID **Title**: what · source · value/effort · reason`.

- **Source**: `gap §N` (noggit3-feature-gap.md section N), `loop: <item>` (found while working on
  another item), or `owner` (the owner asked for it).
- **Value**: H, M or L. How much it advances DESIGN.md's priorities.
- **Effort**: S (under a day), M, or L.
- **Tag `needs-approval`**: the loop must not pick this item. Use it for large, format-level or
  non-goal work.
- Mark done with `[x]` and a PROGRESS.md link. Do not delete done items until the next cleanup pass.

Value and effort were first estimated by the agent that seeded this file. The owner should correct
them. Fixed-section numbers refer to noggit3-feature-gap.md.

## Bugs and broken things (always first)

- [x] B-118 **Re-home what the dropped dock panels did** · Source: owner · M/S · decided and done 2026-10-15: growing a region is File › Grow region (four actions); Save Spawns to Database and Export Spawn SQL are File actions with the unsaved count as a status bar chip; the placement numbers are a floating Inspector on the I key; no spawn list (the creature editor opens from a click); the region's facts stay in Map Properties

## Terrain sculpting and painting

- [ ] B-004 **Separate Blur tool** · gap §1 · L/S · Smooth already covers most of it
- [ ] B-006 **Chunk Mover**: drag a chunk with its heights and objects · gap §1 · M/L · effort L (confirmed in the 2026-10-12 loop run): moves chunk data and objects across the grid, too large to finish in one loop item
- [ ] B-007 **Clear tool: height, liquids, holes, shadows, vertex colours, impassable** · gap §1 · M/L · models and textures are done, these are not · left open in the 2026-10-12 loop run: liquids have no per-cell data to clear, and holes, shadows, vertex colours and impassable need format fields (see B-055 to B-058)
- [ ] B-009 **Terrain-projected and sphere cursor shapes** · gap §1 · L/M · unverified against the current outline
- [ ] B-013 **Show unpaintable chunks** overlay · gap §2 · L/S
- [ ] B-014 **Animated texture layers** with speed · gap §2 · L/M
- [ ] B-015 **Overbright** option · gap §2 · L/S · unverified: effect unclear
- [ ] B-017 **Undockable quick texture palette** · gap §2 · L/M
- [x] B-111 **Paint while sculpting, and texture roles**: Sculpt paints one texture or the map's rock and dirt by slope as it shapes the ground; roles are guessed from texture names and set in Map Properties · Source: owner · H/M · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-112 **Photoshop brush size controls**: [ ] and Ctrl+scroll in size bands, Shift+[ ] for falloff, Alt+right-drag on the spot · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-116 **Sculpt strength up to 10** · Source: owner · M/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session)
- [ ] B-119 **By-slope painting: restore the base on ground that flattens again**: lowering a hill leaves its rock painted; an option to paint the base role back under the dirt angle · Source: loop: B-111 · L/S · off by default, since it would erase roads and details under the brush

## Water

- [x] B-020 **Multiple liquid types** with a liquid ID each · gap §3 · M/M · done: the Water tool's Paint mode paints LiquidType IDs (water, ocean, magma, slime) into per-chunk layers, `.wmap` version 4 (see CLAUDE.md, Water)
- [x] B-021 **Crop water** in a region · gap §3 · M/S · done: Crop water in the Water tool's options bar (`Engine.cropWater`)
- [x] B-022 **Cursor intersects liquids** (brush picks the water surface) · gap §3 · M/S · done: the Water tool's "On liquids" switch
- [x] B-023 **Lock setting** for the liquid layer · gap §3 · L/S · done: Lock with Alt+click in the Water tool
- [x] B-024 **Angled river mode** for flowing water · gap §3 · M/M · done: Angled with angle and direction in the Water tool
- [x] B-025 **Opacity modes** (auto, river, ocean, custom) · gap §3 · L/M · done: the Water tool's Opacity select
- [ ] B-026 **Water layers** with a current-layer selector · gap §3 · L/L · needs-approval

## Objects (props)

- [ ] B-031 **Rotate around a pivot** for single and multi-selection · gap §4 · M/M · left open in the 2026-10-11 loop run: decided in IDEAS.md: pivot is the mean position of the selection, behind a "Rotate around pivot point" checkbox, on by default · needs multi-selection (B-032) first: a single model always turns about its own origin, so there is nothing to pivot yet
- [ ] B-032 **Multi-selection move mode** with local or world gizmo · gap §4 · M/L · effort re-estimated to L in the 2026-10-12 loop run: the selection is one object (`editor.selected`) through the Engine, tools, gizmo and nudging, so a selection set touches all of them
- [ ] B-105 **Hide a model with its attachments**: H hides only the selected object, so props attached to it stay drawn in mid-air · Source: loop: B-034 · L/S · may be what an author expects; check with the owner
- [ ] B-036 **Reset rotation** menu item (Ctrl+R) · gap §4 · L/S · unverified: may already exist
- [ ] B-037 **Mouse-move snap**: two checkboxes, follow cursor for a single model and snap to ground for a group · gap §4 · M/S · decided in IDEAS.md (noggit3) · left open in the 2026-10-12 loop run: the "off" single-model drag needs a camera-facing plane and the owner's rule for a parented model, and the group checkbox needs multi-selection (B-032), which the app doesn't have yet
- [ ] B-038 **Bounding box display**, one box per model · gap §4 · L/S
- [ ] B-040 **Helper models**: reference models as visual aids · gap §4 · L/M
- [x] B-110 **Doodad brush**: a brush of weighted models scattered like paint, with scale, sink, tilt and spacing per model, a full-screen editor with its own model picker, a hover preview that the press puts down (Ctrl+scroll spins it, Shift stacks), Ctrl erases, TOML import and export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)

## Map, client and server

- [ ] B-050 **Chunk streaming** or at least tile-level load and save for large maps · gap §5 & priority 3 · H/L · needs-approval (large) · on the back burner by the owner's decision 2026-10-15: not now; when it comes, as a second document kind beside the block editor (see PROGRESS.md 2026-10-15 B-118 entry)
- [ ] B-051 **Tile-level save**: current tile or changed tiles only · gap §5 · H/M · left open in the 2026-10-12 loop run (2nd): the save is one `.wmap` file, so per-tile or changed-tile saves change the file format, which needs the owner's decision on the format first
- [ ] B-054 **Area ID painting** with a zone ID browser · gap §5 · M/M · left open in the 2026-10-12 loop run (2nd): the area ID is a format field the `.wmap` doesn't have, so it needs the owner's format decision (like B-055 to B-056)
- [ ] B-055 **Impassable flag** tool · gap §5 · M/M · left open in the 2026-10-12 loop run (2nd): needs a format field the `.wmap` doesn't have, so it waits for the owner's format decision
- [x] B-056 **Holes tool** for caves · gap §5 · M/M · done: Sculpt › Hole cuts and fills triangles, holes are in the `.wmap` (version 3) and in the clipboard, with wall handles; not yet exported to client tiles (see CLAUDE.md)
- [x] B-113 **Grow a region by a tile**: a plus on each side of the open block in the Map panel opens the block one tile bigger (square, so a row or column comes along) · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session) · no longer reachable since B-115 dropped the Map panel; see B-118
- [x] B-114 **Ground effects (grass tufts)**: the client's GroundEffectTexture and GroundEffectDoodad tables, the texture-to-effect pairs learned from its tiles, tufts drawn around the camera by the texture on top of each cell, a per-map effect choice per texture, and the effect per layer plus the predominant map written on export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [ ] B-123 **Painted no-doodad cells, kept in the map file**: a brush that marks cells as growing no tufts (noggit has none; Blizzard's roads have the bits), and the client's bits saved in the `.wmap` so a reopened region draws them; both need a per-cell field in the format · Source: loop: B-117 · L/M · the export already ORs into the client's bits, so nothing is lost without it
- [ ] B-057 **Shadows editor** (baked shadows) · gap §5 · L/L · needs-approval
- [ ] B-058 **Vertex colour editor** · gap §5 · L/L · needs-approval
- [ ] B-059 **Save minimap image** (Ctrl+Shift+P) · gap §5 · L/S
- [ ] B-060 **Minimap window**: click to jump, with tile borders · gap §6 & priority 5 · H/L · the Map dock panel drew the continent's tiles with the open block outlined, but had no jump, and was dropped from the dock (B-115); a click-to-jump map needs a new home
- [ ] B-124 **Doodad brush On props: footprint at world scale and a cheaper prop lookup**: a model standing on a prop is spaced by its own scale, not its world scale, and each attempt casts a ray through every model's bounds tree (up to 256 a frame); a chunk-bucketed lookup would keep a dense map smooth · Source: loop: B-120 · L/S
- [ ] B-108 **Port commands: area name and ADT header**: noggit's port file starts each entry with `Map: <area> on ADT x y` · Source: loop: B-053 · L/M · the editor has no area names, so this waits on B-054

## Navigation, view and display

- [ ] B-070 **Reset camera roll** (End) · gap §6 · L/S
- [ ] B-071 **Locked cursor mode** while the camera moves · gap §6 · L/S
- [ ] B-072 **Top-down 2D tile mode** · gap §6 · M/M
- [ ] B-073 **Pause and speed keys for the day cycle** · gap §6 · L/S · unverified
- [ ] B-074 **FPS camera mode**, with a debug camera to return to · gap §6 · L/M
- [ ] B-078 **Height contour lines** · gap §7 · L/M
- [ ] B-079 **Skybox toggle**, separate from the sky · gap §7 · L/S
- [ ] B-080 **Anti-aliasing, VSync and full-screen** settings · gap §7 · L/S
- [ ] B-081 **Flight bounds** display · gap §7 · L/S
- [ ] B-082 **Light zone display** · gap §7 · L/M
- [ ] B-083 **Vertex colour display** · gap §7 · L/M
- [ ] B-084 **Client lighting data** for the preview · gap §7 · L/L · approved by the owner 2026-10-15: read the client's Light, LightParams and LightIntBand tables so the editor's sky, fog and ambient follow the zone the camera is in

## Settings, UI and help

- [ ] B-125 **Config fields other than the preferences written whole**: the client folder, server folder, window size and login are still saved from one instance's copy, so two windows can overwrite each other's; the same patch-and-merge as B-122 per field · Source: loop: B-122 · L/S
- [ ] B-091 **Log window** with a file-loading log setting · gap §10 · M/M
- [x] B-093 **Asset browser search** improvements · gap §10 · L/S · done: the search-first asset browser with synonyms, kinds, zones and category facets (CLAUDE.md, Asset browser)
- [x] B-115 **Dock reduced to Layers**: the Map, Spawns and Properties panels are no longer mounted · Source: owner · -/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session); their functions are B-118
- [ ] B-094 **Undockable tool properties** panel · gap §10 · L/L · needs-approval

## Scripting (needs approval before any work)

- [ ] B-100 **Lua 5.1 scripting engine** with a script editor · gap §8 · H/L · needs-approval
- [ ] B-101 **Script brushes**, procedural placement, noise and image import on top of B-100 · gap §8 · H/L · needs-approval

## Tooling

- [x] B-121 **Dev page must not write the user's preferences**: the dev browser page and the desktop window share config.json and each wrote all of it, so a test in the page overwrote the owner's doodad brushes; `?nosave` makes the page read-only (TESTS.md) · Source: loop: B-110 · H/S · done 2026-10-14


## Parked

Items moved here by the owner decisions in IDEAS.md, with the reason.

- B-008 **Seam fix**: Meld keeps one height array with no tile border, so there is no seam to fix. Revisit only if an in-app check shows one.
- B-012 **Remove duplicate texture layers**: the paint model and the `.wmap` loader never create a duplicate slot. A duplicate on load would be a loader bug.
- B-018 (part) **Flatten smooth-inner**: noggit3 labels it "wip", and it needs cell-centre vertices, which Meld's grid doesn't have. Its meaning here is not settled.
- B-016 **Alphamap 8-bit / 4-bit conversion**: disapproved by the owner 2026-10-15; Meld targets the 1.12 client only, which stores 4-bit alpha maps, and Meld already reads every form. Revisit only with a later client.
- B-033 **Selective paste**: noggit3 has no per-field paste, only one copy option for rotation, tilt and scale together.
