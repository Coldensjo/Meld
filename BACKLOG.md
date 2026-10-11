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

_None logged yet. Add items here when found, whatever their size._

## Terrain sculpting and painting

- [ ] B-001 **Edit-mode limits**: only above or only below the cursor · gap §1 · M/S · stops over-sculpting
- [x] B-002 **Flatten variants**: flat (average target), raise-only and lower-only done; linear, smooth and smooth-inner moved to B-018 · gap §1 · H/M · the most-used sculpt missing piece · logged in PROGRESS.md
- [ ] B-003 **Vertex edit mode**: raise or lower one vertex · gap §1 · M/M · fine detail
- [ ] B-004 **Separate Blur tool** · gap §1 · L/S · Smooth already covers most of it
- [ ] B-005 **Tablet pressure** mapped to radius or speed · gap §1 · M/M · opt-in setting
- [ ] B-006 **Chunk Mover**: drag a chunk with its heights and objects · gap §1 · M/L
- [ ] B-007 **Clear tool: height, liquids, holes, shadows, vertex colours, impassable** · gap §1 · M/L · models and textures are done, these are not
- [ ] B-008 **Seam fix** for gaps between chunks · gap §1 · M/M · check whether a gap still shows first
- [ ] B-009 **Terrain-projected and sphere cursor shapes** · gap §1 · L/M · unverified against the current outline
- [ ] B-010 **Spray mode**: pressure-based brush · gap §2 · M/S
- [ ] B-011 **Brushed texture swap** (whole-map replace is done) · gap §2 · M/M
- [ ] B-012 **Remove duplicate texture layers** per tile · gap §2 · M/S
- [ ] B-013 **Show unpaintable chunks** overlay · gap §2 · L/S
- [ ] B-014 **Animated texture layers** with speed · gap §2 · L/M
- [ ] B-015 **Overbright** option · gap §2 · L/S · unverified: effect unclear
- [ ] B-016 **Alphamap 8-bit / 4-bit conversion** · gap §2 · L/L · client format, check the 1.12 path covers it · needs-approval
- [ ] B-017 **Undockable quick texture palette** · gap §2 · L/M
- [ ] B-018 **Flatten: linear, smooth and smooth-inner targets**: the rest of the gap §1 flatten variants · Source: loop: B-002 · M/M · left out of B-002 to keep it to the variants the current flatten mode can hold

## Water

- [ ] B-020 **Multiple liquid types** with a liquid ID each · gap §3 · M/M · the 1.12 writer already writes water
- [ ] B-021 **Crop water** in a region · gap §3 · M/S
- [ ] B-022 **Cursor intersects liquids** (brush picks the water surface) · gap §3 · M/S
- [ ] B-023 **Lock setting** for the liquid layer · gap §3 · L/S
- [ ] B-024 **Angled river mode** for flowing water · gap §3 · M/M
- [ ] B-025 **Opacity modes** (auto, river, ocean, custom) · gap §3 · L/M
- [ ] B-026 **Water layers** with a current-layer selector · gap §3 · L/L · needs-approval
- [ ] B-027 **MCLQ export**: check first whether the tile writer already covers it · gap §3 · M/S

## Objects (props)

- [ ] B-030 **Follow-ground rotation**: tilt to the terrain normal · gap §4 · M/M
- [ ] B-031 **Rotate around a pivot** for single and multi-selection · gap §4 · M/M
- [ ] B-032 **Multi-selection move mode** with local or world gizmo · gap §4 · M/M
- [ ] B-033 **Selective paste** (only rotation, tilt or scale) · gap §4 · M/S
- [ ] B-034 **Hide models**, with a toggle to show hidden ones · gap §4 · M/M
- [ ] B-035 **Tilt and roll in the text object list** (currently missing) · loop-seeded from owner commit c039c93 · M/S
- [ ] B-036 **Reset rotation** menu item (Ctrl+R) · gap §4 · L/S · unverified: may already exist
- [ ] B-037 **Mouse-move snap modes**: follow cursor vs snap to ground · gap §4 · M/S
- [ ] B-038 **Bounding box display**, one box per model · gap §4 · L/S
- [ ] B-039 **Rotate-following-cursor** mode · gap §4 · L/M
- [ ] B-040 **Helper models**: reference models as visual aids · gap §4 · L/M

## Map, client and server

- [ ] B-050 **Chunk streaming** or at least tile-level load and save for large maps · gap §5 & priority 3 · H/L · needs-approval (large)
- [ ] B-051 **Tile-level save**: current tile or changed tiles only · gap §5 · H/M
- [ ] B-052 **Reload tile from disk** · gap §5 · M/S
- [ ] B-053 **Port coordinates export** (TrinityCore / ArcEmu / VMaNGOS style) · gap §5 · M/S
- [ ] B-054 **Area ID painting** with a zone ID browser · gap §5 · M/M
- [ ] B-055 **Impassable flag** tool · gap §5 · M/M
- [ ] B-056 **Holes tool** for caves · gap §5 · M/M
- [ ] B-057 **Shadows editor** (baked shadows) · gap §5 · L/L · needs-approval
- [ ] B-058 **Vertex colour editor** · gap §5 · L/L · needs-approval
- [ ] B-059 **Save minimap image** (Ctrl+Shift+P) · gap §5 · L/S
- [ ] B-060 **Minimap window**: click to jump, with tile borders · gap §6 & priority 5 · H/L
- [ ] B-061 **Map entry list** (continents, dungeons, raids) from the client's map table · gap §6 · M/M

## Navigation, view and display

- [ ] B-070 **Reset camera roll** (End) · gap §6 · L/S
- [ ] B-071 **Locked cursor mode** while the camera moves · gap §6 · L/S
- [ ] B-072 **Top-down 2D tile mode** · gap §6 · M/M
- [ ] B-073 **Pause and speed keys for the day cycle** · gap §6 · L/S · unverified
- [ ] B-074 **FPS camera mode**, with a debug camera to return to · gap §6 · L/M
- [ ] B-075 **Tile and chunk grid lines**, with hole lines always on · gap §7 · M/S
- [ ] B-076 **Toggle UI (Tab)** to hide all panels · gap §7 · M/S
- [ ] B-077 **Detail info panel** per tile or chunk · gap §7 · M/M
- [ ] B-078 **Height contour lines** · gap §7 · L/M
- [ ] B-079 **Skybox toggle**, separate from the sky · gap §7 · L/S
- [ ] B-080 **Anti-aliasing, VSync and full-screen** settings · gap §7 · L/S
- [ ] B-081 **Flight bounds** display · gap §7 · L/S
- [ ] B-082 **Light zone display** · gap §7 · L/M
- [ ] B-083 **Vertex colour display** · gap §7 · L/M
- [ ] B-084 **Client lighting data** for the preview · gap §7 · L/L · needs-approval

## Settings, UI and help

- [ ] B-090 **Settings panel**: game path, import path, project path, MCLQ path · gap §10 · M/M
- [ ] B-091 **Log window** with a file-loading log setting · gap §10 · M/M
- [ ] B-092 **Help window** and manual links · gap §10 · M/S
- [ ] B-093 **Asset browser search** improvements · gap §10 · L/S · unverified: palette may already cover this
- [ ] B-094 **Undockable tool properties** panel · gap §10 · L/L · needs-approval

## Scripting (needs approval before any work)

- [ ] B-100 **Lua 5.1 scripting engine** with a script editor · gap §8 · H/L · needs-approval
- [ ] B-101 **Script brushes**, procedural placement, noise and image import on top of B-100 · gap §8 · H/L · needs-approval
