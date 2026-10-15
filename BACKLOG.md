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

- [x] B-180 **The key light isn't aimed with Shadows off**: only the shadow fit (`Environment.fitCascade`) places the key light, so with Shadows off the props' sun stays straight overhead whatever the hour · Source: loop: B-166 · M/S · done 2026-10-15
- [x] B-177 **Ground effect slots name the wrong models**: Meld matched a GroundEffectTexture slot against GroundEffectDoodad's row ID, where the client uses its internal ID (one less), so the tuft preview grew the neighbouring row's model and a new effect was written with IDs the client read as other models (and its empty slots as 0, ElwFlo01) · Source: loop: B-172 · H/S · done 2026-10-15
- [x] B-118 **Re-home what the dropped dock panels did** · Source: owner · M/S · decided and done 2026-10-15: growing a region is File › Grow region (four actions); Save Spawns to Database and Export Spawn SQL are File actions with the unsaved count as a status bar chip; the placement numbers are a floating Inspector on the I key; no spawn list (the creature editor opens from a click); the region's facts stay in Map Properties

## Terrain sculpting and painting

- [x] B-111 **Paint while sculpting, and texture roles**: Sculpt paints one texture or the map's rock and dirt by slope as it shapes the ground; roles are guessed from texture names and set in Map Properties · Source: owner · H/M · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-112 **Photoshop brush size controls**: [ ] and Ctrl+scroll in size bands, Shift+[ ] for falloff, Alt+right-drag on the spot · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [x] B-116 **Sculpt strength up to 10** · Source: owner · M/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session)

## Water

- [x] B-020 **Multiple liquid types** with a liquid ID each · gap §3 · M/M · done: the Water tool's Paint mode paints LiquidType IDs (water, ocean, magma, slime) into per-chunk layers, `.wmap` version 4 (see CLAUDE.md, Water)
- [x] B-021 **Crop water** in a region · gap §3 · M/S · done: Crop water in the Water tool's options bar (`Engine.cropWater`)
- [x] B-022 **Cursor intersects liquids** (brush picks the water surface) · gap §3 · M/S · done: the Water tool's "On liquids" switch
- [x] B-023 **Lock setting** for the liquid layer · gap §3 · L/S · done: Lock with Alt+click in the Water tool
- [x] B-024 **Angled river mode** for flowing water · gap §3 · M/M · done: Angled with angle and direction in the Water tool
- [x] B-025 **Opacity modes** (auto, river, ocean, custom) · gap §3 · L/M · done: the Water tool's Opacity select
- [ ] B-026 **Water layers** with a current-layer selector · gap §3 · L/L · approved by the owner 2026-10-15, decided in IDEAS.md

## Objects (props)

- [x] B-110 **Doodad brush**: a brush of weighted models scattered like paint, with scale, sink, tilt and spacing per model, a full-screen editor with its own model picker, a hover preview that the press puts down (Ctrl+scroll spins it, Shift stacks), Ctrl erases, TOML import and export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)

## Map, client and server

- [ ] B-050 **Chunk streaming** or at least tile-level load and save for large maps · gap §5 & priority 3 · H/L · needs-approval (large) · on the back burner by the owner's decision 2026-10-15: not now; when it comes, as a second document kind beside the block editor (see PROGRESS.md 2026-10-15 B-118 entry)
- [x] B-056 **Holes tool** for caves · gap §5 · M/M · done: Sculpt › Hole cuts and fills triangles, holes are in the `.wmap` (version 3) and in the clipboard, with wall handles; not yet exported to client tiles (see CLAUDE.md)
- [x] B-113 **Grow a region by a tile**: a plus on each side of the open block in the Map panel opens the block one tile bigger (square, so a row or column comes along) · Source: owner · M/S · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session) · no longer reachable since B-115 dropped the Map panel; see B-118
- [x] B-114 **Ground effects (grass tufts)**: the client's GroundEffectTexture and GroundEffectDoodad tables, the texture-to-effect pairs learned from its tiles, tufts drawn around the camera by the texture on top of each cell, a per-map effect choice per texture, and the effect per layer plus the predominant map written on export · Source: owner · H/L · done 2026-10-14 (PROGRESS.md 2026-10-15 owner session)
- [ ] B-057 **Shadows editor** (baked shadows) · gap §5 · L/L · approved by the owner 2026-10-15, decided in IDEAS.md
- [ ] B-129 **Write the client's minimap textures**: render each tile top-down into the client's `Textures\Minimap` BLPs (and md5translate.trs) on export, as Noggit Red's Minimap Editor does (with a resolution, what to draw, and model filters), so the in-game minimap shows the edited ground · Source: loop: B-059, gap §5 · L/L · a client write, checked against the client's own reader
- [ ] B-150 **Area trigger display and editor**: the map's AreaTrigger.dbc boxes and spheres, added, moved and resized · gap §11 · L/L · approved by the owner 2026-10-15, decided in IDEAS.md

## Benilla (see BENILLA.md)

- [ ] B-164 **Check a round trip in Benilla by hand**: a region save and a published map, walked in Benilla, with the SoloCraft install as its data · Source: owner · M/S
- [ ] B-165 **Write the patch without closing Benilla**: test whether Benilla's shared file handles let Meld replace patch-3.MPQ while it runs, and if so skip the close (Benilla still needs a restart or a reload to show it) · Source: owner · L/S
- [ ] B-171 **Play here**: teleport the logged-in character to the camera's spot from Meld · Source: owner · L/M · needs-approval (a server-side command)

## Benilla ports (see BENILLA.md, "Porting from Benilla")

The client's own behaviour, ported from Benilla's MIT/Apache Rust into Meld's Go and TypeScript. The owner
wants these worked first, in this order, starting in a fresh session (2026-10-15).

- [x] B-172 **Ground tufts placed as the client places them**: port `scatter_ground_doodads` (the client's `CMapChunk::CreateDetailDoodads`: Blizzard's randomizer seeded per chunk, the cell pass and the doodad pass, the predominant layer, the no-tuft mask, the 70 yd range) over Meld's hash-based `cellTufts`/`tuftsPerCell` · Source: owner · M/S · done 2026-10-15, density levels decided in IDEAS.md
- [x] B-166 **The client's sun, sky and fog**: port the DayNight sun direction, the five-stop sky gradient (bands 2 to 6), the cloud bands and the scene fog rule (end = zone fog or far clip, start = fraction, storms negative) into Client Lighting, replacing Meld's own sun path and Preetham sky while it is on · Source: owner · M/M · done 2026-10-15 but the clouds (B-179), scope in IDEAS.md
- [ ] B-173 **Baked terrain shadows (MCSH) read and drawn**: read each chunk's 64x64 shadow bits as Benilla does and shade the terrain with them as the client does (lit where a chunk has none); the groundwork for the shadows editor B-057 · Source: owner · M/M
- [ ] B-167 **Far horizon from the WDL**: mesh the map's WDL beyond the open block and draw it unlit under its own fog that fades to the scene fog, after Benilla's `wdl.rs`/`wdl.wgsl` (with B-155) · Source: owner · L/M
- [ ] B-168 **M2 particles, ribbons and texture animation**: CPU particle emitters with their over-life colour, size and texture cells, ribbons, and UV and material-alpha animation, after Benilla's `particles/`, `ribbons.rs`, `tex_anim.rs`, `mat_anim.rs` (with B-154) · Source: owner · L/L
- [ ] B-170 **Terrain look checked against the client's**: texture repeats per chunk, layer blending, alpha filtering at chunk edges, and exact overbright and scrolling (Meld's overbright is a x1.5 guess), after Benilla's `terrain.wgsl`/`terrain.rs` · Source: owner · L/S
- [ ] B-174 **Water look checked against the client's**: surface, depth colour, shore and flow against Benilla's `liquid/` and `liquid.wgsl` · Source: owner · L/S
- [ ] B-169 **Minimap textures as the client finds them** (`md5translate.trs`), after Benilla's `minimap_translate.rs` (with B-129) · Source: owner · L/M
- [ ] B-175 **Footstep sounds by terrain type**: name TerrainType rows in the ground effect editor (B-151 picks them by number), after Benilla's `footsteps.rs`/`terrain.rs` · Source: owner · L/S
- [ ] B-176 **WMO interiors after Benilla's portal culling and interior fog**, for big buildings' speed and look · Source: owner · L/M
- [ ] B-179 **The client's clouds under Client Lighting**: port Benilla's `clouds/` (the cloud dome builder 0x6cfb00: density band 3 as the coverage threshold, the sun-glow, slope and base colour bands 10 to 12, the glow track) onto the client sky dome, which has no clouds yet · Source: loop: B-166 · L/M · a module of its own (about 1000 lines of Rust)
- [ ] B-178 **Tufts fade out by view depth as the client's do**: the client fades detail doodads over the last part of the 70 yd (alpha from about 52.6 yd to zero at 69.9, on view depth, with its own alpha-test ref 128/255); Meld cuts them off at 70 yd from the camera, so the edge of the grass shows · Source: loop: B-172 · L/S · after Benilla's `clutter.rs` and `wow_model.wgsl`

## Navigation, view and display

- [ ] B-071 **Locked cursor mode** while the camera moves · gap §6 · L/S
- [ ] B-073 **Pause and speed keys for the day cycle** (Noggit Red: N faster, B slower, J pause) · gap §6 · L/S · unverified
- [ ] B-074 **FPS camera mode**, with a debug camera to return to · gap §6 · L/M · Noggit Red's FPS camera stays 3 yards above the ground, so it walks the map as a player would
- [ ] B-078 **Height contour lines** · gap §7 · L/M
- [ ] B-154 **M2 particles and ribbons** drawn from the emitters, beyond the procedural flames · gap §7 · L/L
- [ ] B-155 **Far horizon** from the map's WDL beyond the open block · gap §7 · L/M · after B-146 for a new map
- [ ] B-079 **Skybox toggle**, separate from the sky · gap §7 · L/S
- [ ] B-080 **Anti-aliasing, VSync, an FPS limit and full-screen** settings · gap §7 · L/S
- [ ] B-081 **Flight bounds** display · gap §7 · L/S
- [ ] B-082 **Light zone display** · gap §7 · L/M

## Settings, UI and help

- [x] B-093 **Asset browser search** improvements · gap §10 · L/S · done: the search-first asset browser with synonyms, kinds, zones and category facets (CLAUDE.md, Asset browser)
- [x] B-115 **Dock reduced to Layers**: the Map, Spawns and Properties panels are no longer mounted · Source: owner · -/S · done 2026-10-15 (PROGRESS.md 2026-10-15 owner session); their functions are B-118
- [ ] B-094 **Undockable tool properties** panel · gap §10 · L/L · needs-approval · not approved by the owner 2026-10-15 (IDEAS.md)

## Scripting (needs approval before any work)

- [ ] B-100 **Lua 5.1 scripting engine** with a script editor · gap §8 · H/L · needs-approval · not approved by the owner 2026-10-15 (IDEAS.md)
- [ ] B-101 **Script brushes**, procedural placement, noise and image import on top of B-100 · gap §8 · H/L · needs-approval · not approved by the owner 2026-10-15 (IDEAS.md)
- [ ] B-157 **Node editor**: visual scripting graphs over the map's chunks, textures and models, a second way to script · gap §8 · L/L · needs-approval · not approved by the owner 2026-10-15 (IDEAS.md)

## Tooling

- [ ] B-161 **Sound and music pickers in the zone editor**: name the ZoneMusic, SoundAmbience, SoundProviderPreferences and Light rows (and play them, as Noggit Red does) instead of bare IDs · Source: loop: B-148 · L/M
- [ ] B-160 **Unit tests for History**: `History` imports the runes state (`editor`, `ui`), which the node tests cannot load, so `goTo` and the step list have no test; handing it a small state sink would make it testable · Source: loop: B-156 · L/S
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
- B-070 **Reset camera roll** (End): Meld's camera has only yaw and pitch, so there is no roll to reset (parked by the loop 2026-10-15; Noggit Red keeps a roll it only sets through a camera reset).
