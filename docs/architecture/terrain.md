# Terrain and maps

The ground, its paint and chunk data, the map file and the dialogs that make or describe a map.

- `internal/mapfile`: the `.wmap` format is gzip(magic "WMAP" + version + JSON header + raw height
  float32 + weights + chunkSlots + holes + liquids + areaIds + chunkFlags + noEffect + shadows). Blobs
  cross the bridge as base64 strings. If you change the format, bump `Version` and update the tests.
  Older versions stay readable (a version 5 map has no shadows, a version 4 map no chunk data, a
  version 3 map no liquids blob, a version 2 map no holes blob either). Such a map opens with
  `MapDocument.holesKnown` / `liquidsKnown` / `chunkDataKnown` false, and saved again it keeps saying
  so through the header's optional `holesUnknown` / `liquidsUnknown` / `chunkDataUnknown` (#525,
  #663), since the blobs then hold only what was drawn since and an empty one would otherwise read as
  "none" and erase the client's on Compile.
  The conversion to and from the bridge's `MapData` is `io/mapData.ts` (`toMapData`, `fromMapData`),
  kept free of the runes state so `tests/mapData.test.ts` can run it; Map Properties names what a
  region leaves to the client.

- **Terrain** (`lib/terrain/Terrain.ts`):
  - Heights are a `Float32Array` of `(size+1)^2` vertices; `CELL_SIZE` = 2 world units.
  - The mesh is split into 32×32-cell chunks. Edits call `markDirty(rect)`, and `update()` rewrites
    only the touched chunks.
  - Picking ray-marches the heightmap (`raycast`, the march itself in `rayMarch.ts`). Don't use triangle raycasts on the terrain.
    A ray passes through holes and, once below the surface through one, stays under until it is above the ground again (#528), so a slanted ray into a cave mouth does not hit the ground's underside at the rim.
  - **Holes**: `Terrain.holes` is one byte per cell (`terrain/holes.ts`). A hole cell gets no
    triangles (`writeChunk` rebuilds the chunk's index and draw range) and the ray passes through it.
    Holes are edited through `TerrainStroke({ holes: true })`, copied with the clipboard and saved in
    the map file. Every hole edit works on whole 2x2-cell blocks (`HOLE_BLOCK`, `snapToBlocks`), as the
    1.12 tile keeps a chunk's holes in a 4x4 bitmap; the export sends each chunk's hole cells in its
    `HeaderSpec.Holes` and Go writes the bitmap at MCNK 0x3C (`adt.HoleBits`: a block with any hole
    cell is a hole).
- **Baked shadows** (Lighting › Baked Shadows, `prefs.bakedShadows`, B-173, B-057): a region's chunks carry
  the client's baked shadow maps (MCSH, 64x64 bits a chunk, read by `adt` into `Chunk.Shadow`). The
  `RegionShadows` binding stitches them for the open block, the Engine reads them once per terrain
  (`updateBakedShadows`) into `Terrain.shadow` (a byte per texel, 8 a cell, `shadowSide` a side,
  uploaded as `bakedShadowTex`, rows at a time through `touchShadow`); the terrain shader keeps 70% of
  the light in shadow, as the client does (`terrain/bakedShadows.ts`). They are the map's from then on:
  painted by the Map data tool's Shadow mode, baked from the ground for the client's lighting sun
  (Terrain › Bake Shadows, `bakeShadows`) or cleared, each through `ShadowStroke`; saved in the map
  file (version 6, a bit a texel) and sent on export as each chunk's `HeaderSpec.Shadow`, which Go
  writes as a 512-byte MCSH (`adt.shadowPiece`). A map with none of its own (`Terrain.shadow` null)
  sends none, so a region keeps the client's.
- **Far horizon** (View › Far Horizon, `prefs.showHorizon`, B-167): around an open region, the map's
  WDL tiles within five tiles (`RegionHorizon` binding, `vmangos.ReadRegionHorizon`), meshed as the
  client meshes them (`world/horizonMesh.ts`: chunk corners and centres, four triangles a chunk) and
  drawn by `world/HorizonLayer.ts` unlit in the horizon/fog colour, a silhouette as in the game. Read
  from the client once per document; a map of its own has none.
- **Paint mask**:
  - `Terrain.mask` holds one byte per splat texel, uploaded as `maskTex` and drawn as a red
    overlay. It isn't saved to the map file.
  - Mask strokes go through `TerrainStroke({ mask: true })`.
  - `Engine.fillMask(layer)` paints a layer over the mask, weighted by mask value.
  - With a mask present, picking a texture in the palette fills it.
  - `ui.maskActive` is refreshed after strokes, undo/redo and tab switches.
- **Splat** (`lib/terrain/chunkPaint.ts`, 1.12 style): the map is cut into paint chunks of 8x8 cells,
  and each chunk holds at most `SLOTS` (4) textures. `Terrain.chunkSlots` names a chunk's textures
  (palette indices) and `Terrain.weights` holds four weights per splat texel, always summing to 255.
  `paintPixel` (`tools/brush.ts`) acquires a slot for the brush texture: it compacts slots a stroke
  emptied, and a chunk that is still full refuses the fifth texture (`acquireSlotCompacting` returns
  -1), which the tools report in the status bar (`CHUNK_FULL`). Only Swap mode and the Layers
  panel's Replace put a texture into a full chunk (`acquireSlotReplacing`, which evicts the weakest
  or the swapped-out one). Stroke undo covers whole chunks (`settleSlots`).
- **The palette's textures** (`terrain/paletteArray.ts`): one array texture the shader samples as
  `palette`, a 256x256 layer per palette entry, the alpha the entry's sheen mask (the `_s` twin's
  alpha, asked for only when the client's `/wow/list?kind=sheen` names it, `hasSheenTwin`, #336), mipmapped (trilinear, anisotropic) so distant ground doesn't shimmer (#225). Where the
  renderer samples S3TC (`compressedTexturesOn`, #178) it is DXT3, about 85 KB a layer with its mips
  (#216): `paletteBlocks.ts` takes the base BLP's colour blocks and the `_s` twin's alpha blocks as
  they are, every level from the BLP's own mips (`chainColour`, `chainAlpha`), resamples a smaller
  power-of-two tileset block by block (exact; its level 0 fills the larger levels), refits DXT1's
  three-colour blocks into the four colours DXT3 has, and encodes only what isn't such a DXT (RGBA
  BLPs, colour entries), with box-filtered mips. Otherwise (`?nodxt`) it is RGBA, 256 KB a layer,
  the GPU making its mips. A texture that arrives re-uploads its own layer, every level
  (`addLayerUpdate`), not the array. The shader reads it with `textureGrad` and derivatives taken at
  the top of `main`, since `blend` and the rock sample it inside branches; keep it so in any new read.

- **Map data** (`terrain/chunkFlags.ts`, `tools/MapDataTool.ts`, tool `mapdata`, key 9): what a
  chunk's MCNK header says besides its ground, by mode (`editor.mapDataMode`: zone, impassable, no tufts per cell, baked shadow per texel). `Terrain.areaIds` is an AreaTable.dbc ID per paint
  chunk (the `Areas` binding lists them, `wow/areas.ts` names them) and `Terrain.chunkFlags` a byte
  per chunk (`CHUNK_IMPASSABLE`); both and `Terrain.noEffect` are read from a region, saved in the
  map file (version 5) and painted by the tool through `ChunkDataStroke` (one undo step a stroke).
  The tool draws its overlay through `Terrain.setMapDataOverlay`: a texel per chunk (`chunkDataTex`)
  and the no-tufts cells in the red of `Terrain.cellTex`, a texel per cell whose green is the selected
  area's shape (`Terrain.setAreaShape`), shared so the shader spends one sampler on both (#394).
  A dab marks only what it reached (`touchChunkData(rect, cells)`, a rect of paint chunks or of cells),
  and `Terrain.update` rewrites and uploads just those texels (#530); an undo or a paste marks all of it. The export sends every chunk's
  `HeaderSpec` (`TileSpec.Headers`, `RegionEdit.Headers`) and Go sets the area ID and the 0x2 flag
  (`adt/header.go`); a map saved before version 5 (`MapDocument.chunkDataKnown` false, kept across
  later saves by the header's `chunkDataUnknown`) sends no area ID (0), impassable flag (`nil`) or
  no-tuft rows, so a region keeps the client's, but its headers still carry the holes and the baked
  shadows (#644). A map saved before version 3 (`MapDocument.holesKnown` false, kept by
  `holesUnknown`) sends holes only for the chunks that have one, with `holesAdd`, which Go ORs into
  the chunk's own bitmap (`adt.ChunkHeader.HolesAdd`), so the client's holes are never filled (#663).

- **Walkable ground** (#175): Terrain › Climb (`prefs.climbView`, Shift+F2) tints each triangle
  steeper than `prefs.climbAngle` in the terrain shader (`climbCos`). View › Walkable ground
  (`prefs.navView`) draws the navmesh VMaNGOS's MoveMapGenerator would build, around the camera's
  target (`world/nav/`):
  - `navBuild.ts` runs Recast per 21.3 yd tile through recast-navigation-js (MIT, WASM, imported on
    first use by `loadRecast`) with TileWorker.cpp's settings (`vmangosSettings`: 0.2667 yd voxels,
    80 a tile, agent 1.5 yd tall and 0.2 wide on maps 0 and 1, climb 1.8) and its areas: ground up to
    52°, steep slope (creatures only, `NAV_STEEP`) up to 75° on the terrain and 61° on models.
    Model faces carry model areas until the server's own ledge filter has read them
    (`navFilters.ts`: 1.2 yd where terrain meets a model, so a fence can't be stepped over, 1.8 on the
    terrain), and are folded back after. The liquids go into a second heightfield, which turns the
    ground under them into swim area (`AREA_WATER`, flag `NAV_WATER`) where the surface is 0.75 yd or
    more above it, the shallow transition (`NAV_GROUND | NAV_WATER`) where less, or magma and slime.
    recast-navigation-js can't set a span's area, so `navFilters.ts` reads and writes the spans in
    the WASM heap (the layout is checked against the API, and in `tests/navmesh.test.ts`).
    Left out: gameobjects.
  - `navLiquids.ts` is the liquid as the server's map file has it, per chunk: the type of the layer
    covering the most cells, each vertex the highest surface, the editor's sea as ocean where the
    export writes it, and a chunk with dark water (ocean as deep as a depth byte goes, the export's
    fatigue flag) dropped from the navmesh, ground and all, as the server's builder does.
  - `navGeometry.ts` gathers a tile's triangles: the terrain's cells, four triangles about each
    cell's middle as the server's map has them (a half-cell hole keeps its other triangle as
    `writeCellIndex` draws it), and the
    placed models' collision faces (`/wow/collision`: an M2's hull, a WMO's faces and doodads as the
    server's vmap extractor takes them (#283: COLLISION faces and RENDER ones without DETAIL, no
    unreachable or antiportal groups, and only the doodads of the placement's own set, not set 0
    with it, that a kept group references), with each group's triangle count, and a WMO's
    liquids). A WMO's liquids (#281) are every wet tile of a kept group's MLIQ, with the type the vmap
    extractor writes (`serverLiquidType`, a LiquidType ID). The builder takes those as they are, no
    test against the ground, and picks the area by the type's low two bits (`liquidTypeArea`), so a
    WMO's magma is slime, its ocean magma and its slime water, as in the server's mmaps (Ironforge's
    forge). Their grids' vertices, dry ones too, count in the model's box and so in the tile's height
    span. The faces are cut as TerrainBuilder::loadVMap does
    (#282): ground whose nearest face above, in one of a model's groups, is an upward one within 5 yd
    lies under the model, and a triangle a yard or more under it goes (one with some corners under is
    cut back to where it meets the model), so the crawlspace under Northshire Abbey's floor is no
    ground; a model face goes when its corners lie 0.2 yd or more below the ground and inside a solid
    (`IsUnderMap`). `adtHeightSpan` gives each client tile the heights the server voxelizes it
    between (the lowest and highest vertex of its ground and of every model the tile places, which
    for Northshire is Stormwind's WMO 720 yd off), since where the voxels' steps fall decides whether
    a gap a hair over the agent's 1.5 yd is walkable; `TileBuilder` takes it as `floorY`, and
    rasterizes the triangles highest first as the server does (SortAndRasterizeTriangles), since a
    lower triangle reaching into a span takes the larger area. What still parts the two: knife-edge
    cases at the server's 1.0 and 1.5 yd thresholds, and Detour's paths over the server's larger
    tiles, which come out a few % apart.
  - **Inner heights** (#284): the grid keeps only a cell's corners, but the client's tile has a height
    at each cell's middle too (MCVT's 8x8 inner samples, up to 4 yd off the corners' mean in
    Northshire's tile, 1.5 yd near the abbey), and the server builds its four triangles about it. The
    export (`PatchTileHeights`) keeps a cell's inner sample while its four corners keep the client's
    heights, and puts it at the corners' mean, what the editor shows, once any corner has moved by
    more than `SculptedEps` (1e-3 yd; #380), so a flattened area loses the client's bumps. So an
    unsculpted cell's middle is its corners' mean plus the client's lift over that mean, and a
    sculpted one's is the mean. `RegionInner` (`vmangos.ReadRegionInner`, from the tiles a save starts
    from) sends those lifts, a float a cell, and the client's corner heights they are over;
    `Engine.updateInnerLift` reads them once per terrain into `Terrain.innerLift` and
    `Terrain.innerBase` the first time the view builds a region, the build waits for them
    (`innerPending`), and `TileGatherer.addGround` and `adtHeightSpan` add each cell's `cellLift` (0
    where a corner is off `innerBase`, as the export decides). They are not saved: a map of its own
    has none (its export writes the mean), and a region's come from the client each session.
  - **Normals** (MCNR, #492, #668): `adt.WriteHeights` works out the normals of the chunks whose
    heights changed, and of those around them, as the game's own tiles were made (`normalAt`): the
    mean of the unit normals of the triangles a sample is a corner of in the ground's mesh (eight for
    an outer sample, four for an inner one, a cell being four triangles around its inner sample),
    each part truncated toward zero (`int8(v*127)`, not rounded). That matches the client's normals
    to the byte inside a tile, steep ground included; the old central differences were up to 30
    off. `normalGrid` lays the heights out on a half-step grid padded by `adt.Ring`: the row or
    column just across each border from the neighbouring tile, and the inner samples of the cells
    along it (`NorthIn` and so on; nil means their corners' mean, as a tile Meld builds has them), so
    a border sample takes the same triangles in both tiles and the client shows no crease along the
    border. A tile's corner, which lacks the diagonal tile's cell, takes the four triangles between
    its outer neighbours instead, which all four tiles there have. `BuildRegion` gets the rings from
    `blockEdges`: the block's own heights between its tiles (a neighbour's inner samples put through
    `patchHeights`, as `PatchTileHeights` will write them), the client's tiles beyond its edge. `adt.Edges.Was` is the ring the tile's normals were made against (the tiles the
    save starts from, the client's beyond without Meld's patch); a border chunk whose ring moved has
    its normals redone though its own heights didn't change, and an unedited block stays
    byte-identical. A new map's tiles (`ExportMap`) take the ring from the map's other tiles
    (`tileRing`). A side without a tile stays one-sided. A client tile sharing a side with the block
    whose normals along it the block's line one in from its edge (or the inner samples of its cells
    there) moves gets its border chunks' normals redone too, its heights and the rest of its bytes
    kept (`blockEdges`' `beside`, #666): `Was` there is the block tile as the client reads it now when
    Meld's patch holds the outside tile, without the patch when it is still the client's own, so an
    unedited save, or the same edit again, writes no tile outside. One the save writes for its models
    too (#647) is written once, `adt.Rewrite` over the new normals.
  - `NavPreview.ts` keeps the tiles within `RANGE` (160 yd), builds the nearest first within 6 ms a
    frame, and builds them again 400 ms after the terrain's height or holes, the objects, the
    loaded collision, the liquids (`LiquidMap.version`) or the sea stop changing. A change to the
    objects or their collision alone (#509) builds again only the tiles whose bordered box meets a
    placement added, moved or dropped (`refreshModels` collects their boxes, `markChanged` marks the
    tiles), and every tile of a client tile whose height span (`adtHeightSpan`) it moved. A change
    to the ground's heights or holes does the same (#620): `Terrain.markDirty` and
    `Terrain.touchHoles(rect)` grow a vertex rect that `NavPreview.addGroundChange` takes at the
    settle (`takeGroundChange`), widens a cell all round (a cell's lift reads its neighbours) and,
    with the sea, to whole liquid chunks (the sea's cells and deep flag follow the ground), whose
    `NavLiquids` entries it forgets; `touchHoles()` with no rect counts as the whole map. A change
    to the liquids, the sea or the client's inner heights builds every tile again. Recast's build of a tile runs in up to two Web Workers (#508,
    `navJobs.ts` posts the jobs, `navWorker.ts` runs `runTileJob` with a WASM instance of its own,
    three jobs out a worker): the main thread gathers the tile's triangles (`tileJob` copies them
    out of the gatherer's reused buffers), and takes back Detour's tile bytes, which it copies into
    its own navmesh (kept there for the path test, as in server mode; added without
    `DT_TILE_FREE_DATA`, the tile's `data` freed by `dropTile`), and the surface to draw. The 6 ms
    budget then pays only for gathering. A job whose inputs a settled change made stale is dropped
    when it returns (`tile.job`); without workers (Bun's tests) or after one fails, the build runs
    on the main thread as before. `Engine.updateNav` calls it only while the view is on and
    `clear()`s it (frees the WASM navmesh and stops the workers) when it goes off. View › Test a Path arms `Engine.navPick`:
    the next two clicks are a creature's path (`NavPreview.pathPoint`, Detour's `computePath`),
    drawn as a line, its length in the status bar: a walking creature's (`NAV_GROUND`, the server's
    `PathInfo::createFilter`), or where only a swimming one gets there, that one's, said so.
  - View › Server's mmaps (`prefs.navServer`, #240) shows the navmesh the world server loads instead,
    for comparing the two: `Engine.updateNav` hands `NavPreview.update` the open map's ID and first
    client tile (`ServerSource`), and the view asks `/wow/navtile` (`App.serveNavTile`, routed in
    `main.go`; `vmangos.NavTile` in `internal/vmangos/mmaps.go`) for each client tile within `RANGE`
    of the target, nothing built. Go reads `data/mmaps/MMMYYXX.mmtile` (row before column) and the
    map's `.mmap` origin, and narrows the tile's link block from the server's 64-bit polygon refs
    (`DT_POLYREF64`, 16-byte `dtLink`s) to the WASM's 32-bit ones (12 bytes), the only difference.
    `navServer.ts` reads the tile's detail surface for drawing (colours by the polygons' flags) and
    `navPoint` turns the editor's points into the server's Detour frame and back (WoW's y, height,
    x: a half turn about the up axis); the tiles' meshes sit in a group with that transform, and the
    navmesh takes the server's origin with 64 tiles of up to 32,768 polygons. The tiles are as the
    server last built them: until Compile rebuilds them (#173), an edited tile shows the old ground.

- **Reference image** (View › Reference Image, `components/ReferenceWindow.svelte`, `ui.referenceWindow`,
  #184): the author's own plan of a zone, a PNG or JPEG of theirs. The map file keeps only its path and
  where it lies (`Header.Reference`, `mapfile.ReferenceImage`: an optional header field, no version
  bump, as the paths' `Header.Paths` (#167, tools.md) is too; `editor.reference`, per map in `DocMeta.reference`, an undo step for every change through
  `Engine.setReference`). `ReadReferenceImage` returns the file's bytes and the page decodes them
  (`io/referenceLoad.ts`, at most `REF_MAX_SIDE` 2048 a side) into the pixels the conversions read and
  a texture, held by the document (`MapDocument.referenceImage`, read again when the map opens). On
  the ground the terrain shader drapes it (`refTex` and its place, set each frame by
  `Engine.updateReference` through `Terrain.setReference`; with it and the shadow maps the shader
  samples 15 textures, one under WebGL2's least guaranteed 16, which ANGLE gives WebView2 on Windows;
  the probe `terrain-cell-tex` counts them); over the view it is an `<img>` over the top-down view
  in `Viewport.svelte`, which Lay on the ground as shown turns into a ground place
  (`Engine.referenceFromScreen`). With Place by dragging (`ui.referenceAdjust`) the top-down view's
  presses go to `Engine.referencePress`: the image moves, a corner scales it from the opposite one
  (Shift frees its shape), Ctrl+drag turns it. `terrain/referenceImage.ts` is the arithmetic: the
  image's frame (`refUV`, row 0 toward -z), the drags, its flat colours (`dominantColours`, 5-bit
  buckets merged within 40 RGB) and the conversions, each one undo step in the Engine
  (`referenceToHeights`, `referenceToZones`, `referenceToTextures`, `referenceToMask`): brightness to
  heights under the image (set or add), a zone per colour by a 4x4 vote a chunk, a palette texture per
  colour painted alone (`texturesFromImage`: a chunk keeps the slots its other texels use and a colour
  with no slot left keeps its old paint), and colours into the mask. Transparent pixels and colours
  further than the Colour match from a listed one are left alone.

- **Default map** is `'ocean'`: a flat seabed at `OCEAN_FLOOR` (-12), with water at 0. The camera
  target rides on `max(ground, water)`. `Water.floor` is a dark plane 40 yd below the water that hides
  the map edge and fills a hole in the ground. It is a backdrop (renderOrder -0.25, after the sky and
  the clouds, no depth write), so models below it, such as a dungeon's lower halls, still draw over it
  (#289).

- **Ground effects (grass tufts)**: the game grows detail doodads on each cell by the texture on top of
  it: a texture layer's GroundEffectTexture ID names up to four `World\NoDXT\Detail` models and a
  density, and the chunk's predominant-texture map picks the layer per cell. Go
  (`internal/vmangos/groundeffects.go`, `GroundEffects` binding) reads the two DBCs and learns which
  effect each tileset texture carries from the client's own tiles (a vote over every layer; cached in
  the user's cache dir, progress on "effects:log"). The frontend keeps the tables in
  `wow/groundEffectTables.ts`; `world/groundEffects.ts` is the arithmetic (`effectFor`,
  `cellTexture`, and `scatterChunk`, the client's own scatter ported from Benilla: Blizzard's
  randomizer seeded by the chunk's place in the client's map, `frill` cells drawn with repeats, the
  effect's density in each, slot (n + turn) & 3 of the row's four `slots`) and
  `world/GroundEffectLayer.ts` draws the tufts as one InstancedMesh per model, through tuft twins of
  the models' materials that fade them out by view depth as the client does (B-178, `tuftFade`: a
  ramp from 52.5 to 70 yd multiplied into the alpha, cut out at 128/255, so grass is gone by 61.1 yd).
  It builds them within `reach` of the camera (`tuftReach`: that depth out to the view's side edge,
  set by the Engine from the camera), rebuilt when the camera moves half a chunk or
  `Terrain.heightVersion`/`paintVersion` change (View › Ground effects, `prefs.showGroundEffects`).
  A map's own effect per texture (`editor.textureEffects`, World › Ground Effects…, saved as the map
  file's `textureEffects`) overrides the learned one. The export sends the effect per layer
  (`PaintSpec.Effects`) and Go writes it into MCLY and the per-cell predominant map into the MCNK
  header (`adt/effects.go`), so the client grows the same tufts. The header's `noEffectDoodad` bits
  (no tufts under a building or a road) are read from a region into `Terrain.noEffect` (kept in
  the map file since version 5) and, with the cells under the map's root WMOs (`blockedCells` in
  `GroundEffectLayer.ts`), skipped when drawing and sent on export. A map that holds its chunk data
  sends them as `HeaderSpec.NoEffect`, which replaces the chunk's bits (so a cell the Map data tool
  cleared comes off); an older one only as `PaintSpec.NoEffect`, which Go ORs into the chunk's own. View › Sparse/Normal/Full tufts (`prefs.groundEffectDensity`) is
  the client's Ground Clutter stop (`frillDensity` 16, 32, 48 cells a chunk). A GroundEffectTexture
  slot names a GroundEffectDoodad by its internal ID (field 1), not its row ID.
- **Growing a region**: the File menu's extend entries (`MenuBar.svelte`, shown for a region) call
  `extendRegion` in `mapio.ts`, which opens the block one tile bigger that way
  (`io/regionGrow.ts`, `grownBlock`: square, so one more row or column comes along, east or south
  unless the map ends there), closes the old tab and keeps the camera's view. Since the bigger block
  is read from the client and its spawns from the world database, it refuses while the region has
  edits the client lacks (`regionUncompiled`, below; Save only writes the `.wmap`) or spawn edits not
  saved (`ui.spawnChanges`), and names Compile to Client or Save Spawns to Database (#318). A map
  that is only dirty otherwise grows: what Compile writes is in the client.
- **Compiling a region** (#214): File › Compile to Client, Compile to Server and Compile All call
  `compileRegion` in `mapio.ts` with `'client'`, `'server'` or `'all'`. Client builds the active tab's
  `RegionEdit` (`regionEdit`: heights, models, paint and chunk headers, liquids) and `SaveRegion`
  writes the tiles that differ from the patch's copies; Server rebuilds the server's map data of the
  region's tiles from the patch (`UpdateRegionServer`), and refuses while the region has edits the
  patch lacks; All does both, the server only for the tiles the client compile wrote. Server and All
  also write the region's spawn edits into the world database (#342, `compileSpawns`, the same
  `writeSpawns` as Save Spawns, which stays for spawn-only changes) before the rebuild; the world
  server reads them when the author starts it again. A failed spawn write is reported and leaves the
  server's map data alone, while All's client tiles are still written. Compile to Client never
  touches the database. Compile works on the active tab only; with nothing changed it names the
  other region tabs edited since their last compile.
- **The patch's previous copy** (#475): `vmangos.InstallPatch` rebuilds Meld's patch from the one on
  disk and renames it over, so a bug in `carryOver`/`dropUnusedMinimaps` would drop entries silently,
  and the client-table rows (Spell.dbc, icons, lights, areas, taxis, world maps) exist nowhere else.
  Each write therefore first renames the patch it replaces to `patch-3.MPQ.prev`, overwriting the
  last one (`replaceKeepingPrev`, which puts it back if the new patch's rename fails). The client,
  Meld's reader and the probes' sandbox load only `*.MPQ`, so none of them reads it. An Ironforge
  patch is still also kept once as `.before-meld`.
- **Compiling never closes or starts anything** (#661, the owner's choice A/A): not the game, not
  mangosd, not realmd. A patch write (`installClient` in `app_pending.go`, used by `SaveRegion` and
  every other client write) goes in at once when the game isn't running; while it runs (Windows
  only: it holds the patch open) the files wait in the pending list (#365) for the watcher, the
  result says `waiting`, and the status bar counts them ("Close the game to apply…",
  `client:pending`, `ClientFilesWaiting`). The server map rebuild (`UpdateRegionServer`, and
  Publish) first waits for the game to close and the waiting files to reach the patch
  (`waitForGameClosed`), since the server is built from the patch, then `vmangos.UpdateServerMaps`
  waits for the author to stop mangosd (which holds its map files) before extracting; each wait
  gives up after 15 min with a message. Saves the world server reads only at its start (Zones,
  Portals, Flight Paths) set `restart` when it runs, and `lib/io/applyNote.ts` words both notes.
  Launch writes any waiting files before it starts the game (`flushPending`).
  `regionPaint` sends every chunk's paint, at the editor's 32x32 texels a chunk, half the client's
  64x64 alpha (`tilePaint` box-averages each 2x2 block). So `BuildRegion` compares each chunk with the
  client's tile without Meld's patch (`ownTextures`) through `ChunkPaint.KeepClientAlpha`
  (`internal/adt/clientalpha.go`): every texel whose weights are still those `adt.ClientWeights` reads
  from the client's alpha (a Go copy of `tilePaint`, pinned to it by a shared checksum in
  `clientalpha_test.go` and `tileImport.test.ts`; change both together) keeps the client's 2x2 alpha,
  and only painted texels are written from the weights, repeated over their block. A chunk with no
  painted texel and the client's textures sets `ClientAlpha`, so `rebuildChunk` keeps its MCLY records
  (bar a sent effect or look flags), MCAL bytes and predominant map as they are (#526). A chunk a
  compile before #526 already wrote at half resolution reads back that way, so it stays so.
  Models keep their unique IDs (a moved one is removed and re-added under its own). The client's tiles
  list a model whose bounds cross a tile border in each tile it overlaps, under one ID (910 M2s and 25
  WMOs on Azeroth 28-35 x 44-51), so `ReadRegion` hands the editor one object an ID, and `BuildRegion`
  keeps every block tile that lists an ID (`owners`): a moved or deleted model leaves all of them, and
  a moved or added one goes into every block tile its bounds reach (`blockTilesOf`, the same test
  `Rewrite` uses for a tile's chunks; `reaches.bound` reads the model's size, its `.mdx` name read as
  the archive's `.m2`), so no tile keeps a copy at the old spot (#646). On Azeroth that rule picks the
  client's own tiles for 99% of M2s and every WMO, and never fewer for a WMO. A tile outside the block
  that lists such a model, or that a moved or added one now reaches, is written too, with only its
  placements changed and starting from the tile as the client reads it now, Meld's patch included
  (`internal/vmangos/regionoutside.go`, the owner's choice on #647): the copies of a model the save
  moves or deletes leave it, and so do those of a model an earlier compile moved, deleted or added
  (which the block's tiles in Meld's patch list otherwise than the client's own do, `tileEdit.patched`),
  unless a copy already stands where the block now has it; a different model under the same ID (an ID
  a compile before #491 handed out twice) is left alone. The tiles looked at are the neighbours of the
  block tiles that list such a model (a particle emitter's client bounds reach 250 yards past its
  vertices) and those its old bounds, a chunk wider, or its new ones reach. `RegionResult.Outside`
  counts them, and `ChangedTiles` names them for the server's map data. An added model
  (one whose ID the client's tile without Meld's patch doesn't hold) takes an ID from one counter for
  the whole compile, numbered in `BuildRegion` so its copies share it, seeded above every placement of the map: the block's
  tiles without Meld's patch, the tiles outside it as they stay after the save takes its copies out,
  and every other tile as the client reads it now (`mapUIDMax`,
  `internal/vmangos/uids.go`, which reads only the start of each tile through `mpq.Set.ReadPrefix`:
  about 0.1 s for Azeroth's 687 tiles against 5 s whole). The client draws only the first loaded
  placement of an ID, and the server's vmap assembler keeps one spawn an ID a map, so IDs numbered
  per tile (as before #491) made models vanish. Publish (`ExportMap`) numbers its tiles' models
  from one counter the same way, and lists each in every tile of the map its bounds reach
  (`reachesTile`, with `reaches.bound` reading its size), under its one ID; the editor sends each
  model only in the tile its position falls in (`objectsOf`, `io/vmangosExport.ts`), and one whose
  bounds reach no tile of the map stays there (#648).
- **Uncompiled edits**: `MapDocument.compiled` is the fingerprint (`Engine.regionKey`,
  `io/regionKey.ts`) of what Compile writes, taken when the region is opened from the client and after
  each compile, with the history's change count then. `regionUncompiled` compares the active region's
  against it (the count alone says "unchanged" without hashing; a spawn step changes the count but not
  the key); a region opened from a file has no key, so the Go side's `RegionPending` builds it and
  compares with the patch (it counts a tile the client has never had compiled as changed, since the
  builder orders an MCNK's subchunks its own way). That answer is kept on the document
  (`MapDocument.pending`, `cachedPending` in `io/regionKey.ts`) with the fingerprint and change count it
  was taken at, and reused until the history reaches a state with another fingerprint, so repeated
  Launch, Play Here and grow checks don't rebuild the block (#531; 2.2 s a check for a 3×3 block).
  `RegionEdit.Heights` crosses the bridge as base64 of the float32s, as `MapData.Heights` does
  (`vmangos.EncodeHeights`, `DecodeHeights`); so do `RegionView.Heights` (LoadRegion) and Publish's
  `TileSpec.Outer`, typed `vmangos.HeightGrid`, a float slice in Go whose JSON is that string
  (`ts_type:"string"` in the bindings; the page reads it with `base64ToFloats` and writes it with
  `floatsToBase64`, `io/base64.ts`), a third of the JSON numbers' size for a 3x3 block (#632). A region's alpha maps stay out of
  LoadRegion's JSON altogether (`RegionView.Alpha` is `json:"-"`): `App.handOffAlpha` puts them in
  `App.handoffs` (`internal/handoff`) and the reply carries `alphaUrl`, which `openRegionView` fetches as
  one binary GET and slices 4096 bytes a layer, every layer but each chunk's first, in chunk order. As
  base64 strings they were 33 of a 3x3 block's 36.5 MB, and the call took 375-465 ms against 220-300 (#636). Launch (`launchGame`) opens the Compile and Launch
  dialog (`ui.dialog = 'compileBeforeLaunch'`) when it is true; Play Here says so in its status line.
  `regionKey` hashes the document's own arrays and settings, not `exportInput`, whose building
  footprints in `noEffect` change as models load: a new compile input must be added to it, or Launch
  misses its edits.

- **Start dialog** (`components/NewMapDialog.svelte`, `ui.showNewDialog` + `ui.newMapMode`): every
  map is for the 1.12 client (folder + map ID). "New world" picks a size in tiles and a preset from
  `terrain/presets.ts` (`PRESETS`, `presetHeight`; all but Flat land are islands, so a world is
  bounded by sea); the cards are drawn by `drawPresetPreview`. "Part of Azeroth" picks a square of
  tiles on `MapPicker.svelte` (only with a project open, #48: it asks for one first), a continent overview stitched by the Go side from the client's
  minimap (`/wow/overview?map=`, `internal/wow/minimap.go`, cached in the user's cache dir, keyed by the archives' sizes and times so a patch write builds a new one, #493), with
  the zones of `WorldMapArea.dbc` (`MapZones` binding, `internal/vmangos/zones.go`) as jumps. The
  tiles that exist come from the map's WDT, not the minimap (`MapTiles`, `WDTTiles`, `/wow/tiles`):
  a tile with no minimap image is drawn from its ADT's heights (`drawTileRelief`), and a block that
  takes in a tile with no ADT can't be opened (`lib/io/mapTiles.ts`: the picker's `gaps`). On an
  instance (any map but a continent) the picker selects the biggest square wholly on its tiles
  (`fullBlock`, #222). A WMO-only instance (one global building, no ADTs: Molten Core, the Stockade,
  Scholomance) has no tiles; the picker says it is a single building and Open opens it whole
  (`openWowBuilding`, binding `LoadBuildingMap`, `internal/vmangos/wmoonly.go`, #271). It is a
  region over the tiles the building's WDT bounds cover (`GlobalBlock`), so spawns load and save by
  block as on any map; `RegionView.wmoOnly` gives flat ground under the building, which the editor
  hides (`RegionRef.wmoOnly`: the terrain group is hidden and `terrainPointUnderRay` finds no ground,
  so tools land on the building), and the building as the one model, unique ID `GLOBAL_UID`
  (0xFFFFFFFF, how a saved `.wmap` is known as one: the format has no flag). The WDT's position is
  the tile files' frame less ZeroPoint on X and Z (every client WDT has 0,0,0, the world's origin,
  where the server's creatures stand). Saving (`BuildRegion` → `buildWMOOnly`) writes only the WDT,
  and only when the building's model or doodad set changed; moving, turning or scaling it, or any
  other model on the map, is refused, since a building off 0 would be placed differently by the
  client and the server's vmap extractor. `WmoRooms.outside` leaves the building out of the outside
  flood (its groups are all interior), so it draws whole from outside.
- **Zones** (`components/ZonesDialog.svelte`, World › Zones…, `ui.dialog = 'zones'`): a map's AreaTable.dbc
  rows (`vmangos/areatable.go`: `ReadAreaRows`, `NewAreaRow`, `SetAreaRows`; bindings `AreaRows`,
  `NewAreaRow`, `SaveAreas`). Save writes AreaTable.dbc into Meld's patch (waiting for a running game
  to close, #661) and
  the rows into the world database's `area_template`, which is where VMaNGOS reads areas from (not the
  DBC). A form saved with Save, not undo steps, like creature templates. A zone's Weather (#185) is its
  `game_weather` row (`vmangos/weather.go`, `ZoneWeather` binding): the chance of rain, snow and storm
  in each season as sliders, a subzone showing its zone's; Save sends the changed zones' weather with
  the rows (`SaveAreas`' second argument), and a zone with no chance left loses its row. The server
  reads the table at start or on `.reload game_weather`.
- **World map** (`components/WorldMapDialog.svelte`, World › World Map…, `ui.dialog = 'worldMap'`, #181): a
  zone's map for the game's M key. `Engine.renderTopDown` draws the zone's rectangle from above (the
  minimap's shot, any size; it runs `Engine.simulate` for the shot's ortho camera and draws only the
  shot, not a whole frame of the view, and keeps the map's highest ground until its heights change, #554), `io/worldMap.ts` gives the rectangle (the client's WorldMapArea row, or the
  zone's chunks grown to 3:2), the parchment look and the feathered paste over a zone the client already
  maps; Go (`vmangos/worldmap.go`, `WriteWorldMap`) cuts the 1002x668 picture into twelve DXT1 tiles and
  sets the WorldMapArea.dbc row, written into Meld's patch (or waiting for the game to close, #661). Exploration overlays
  (#219, Overlays: one per subzone): `io/worldMap.ts` `drawOverlays` draws each subzone painted in the
  drawn part (an area whose parent is the zone) into the overlay naming it, else the one whose art
  covers half of it or more (as Elwynn's Northshire piece holds Echo Ridge Mine), else a new one; its
  alpha is the chunks' mask with a soft edge, the art outside the drawn block is kept, and the base
  art leaves those subzones out as parchment (`blankOut`). A piece none of whose subzones is painted
  in the block any more is cleared over the block's chunks of other areas (fading over the band at the
  block's edges, #278), and dropped from the table when nothing of it is left; a neighbour whose art
  only spills over that band (Stormwind's and Goldshire's beside Northshire) keeps the client's. Go (`vmangos/worldmapoverlay.go`) reads the
  client's overlays with their art, replaces the zone's WorldMapOverlay.dbc rows (an unchanged one
  keeps the client's art) and writes the changed pieces as DXT3 tiles with mips
  (`wow.EncodeOverlayBLP`). The game shows a piece once the player has explored one of its areas (the
  AreaTable exploration bit, World › Zones).
