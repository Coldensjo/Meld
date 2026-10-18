# Terrain and maps

The ground, its paint and chunk data, the map file and the dialogs that make or describe a map.

- `internal/mapfile`: the `.wmap` format is gzip(magic "WMAP" + version + JSON header + raw height
  float32 + weights + chunkSlots + holes + liquids + areaIds + chunkFlags + noEffect + shadows). Blobs
  cross the bridge as base64 strings. If you change the format, bump `Version` and update the tests.
  Older versions stay readable (a version 5 map has no shadows, a version 4 map no chunk data, a
  version 3 map no liquids blob, a version 2 map no holes blob either).

- **Terrain** (`lib/terrain/Terrain.ts`):
  - Heights are a `Float32Array` of `(size+1)^2` vertices; `CELL_SIZE` = 2 world units.
  - The mesh is split into 32×32-cell chunks. Edits call `markDirty(rect)`, and `update()` rewrites
    only the touched chunks.
  - Picking ray-marches the heightmap (`raycast`). Don't use triangle raycasts on the terrain.
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
  alpha), mipmapped (trilinear, anisotropic) so distant ground doesn't shimmer (#225). Where the
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
  The tool draws its overlay through `Terrain.setMapDataOverlay`. The export sends every chunk's
  `HeaderSpec` (`TileSpec.Headers`, `RegionEdit.Headers`) and Go sets the area ID and the 0x2 flag
  (`adt/header.go`); a map saved before version 5 (`MapDocument.chunkDataKnown` false) sends none,
  so a region keeps the client's.

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
    Left out: gameobjects and the liquids inside WMOs.
  - `navLiquids.ts` is the liquid as the server's map file has it, per chunk: the type of the layer
    covering the most cells, each vertex the highest surface, the editor's sea as ocean where the
    export writes it, and a chunk with dark water (ocean as deep as a depth byte goes, the export's
    fatigue flag) dropped from the navmesh, ground and all, as the server's builder does.
  - `navGeometry.ts` gathers a tile's triangles: the terrain's cells (holes left out through
    `writeCellIndex`) and the placed models' collision faces (`/wow/collision`: an M2's hull, a WMO's
    walking faces and its doodads' hulls), dropping model faces below the ground as the server does.
  - `NavPreview.ts` keeps the tiles within `RANGE` (160 yd), builds the nearest first within 6 ms a
    frame, and builds them again 400 ms after the terrain's height or holes, the objects, the
    loaded collision, the liquids (`LiquidMap.version`) or the sea stop changing. `Engine.updateNav` calls it only while the view is on and
    `clear()`s it (frees the WASM navmesh) when it goes off. View › Test a Path arms `Engine.navPick`:
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

- **Default map** is `'ocean'`: a flat seabed at `OCEAN_FLOOR` (-12), with water at 0. The camera
  target rides on `max(ground, water)`. `Water.floor` is a dark plane below the water that hides
  the map edge.

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
  unless the map ends there), closes the old tab and keeps the camera's view. It refuses a dirty map,
  since the bigger block is read from the client.

- **Start dialog** (`components/NewMapDialog.svelte`, `ui.showNewDialog` + `ui.newMapMode`): every
  map is for the 1.12 client (folder + map ID). "New world" picks a size in tiles and a preset from
  `terrain/presets.ts` (`PRESETS`, `presetHeight`; all but Flat land are islands, so a world is
  bounded by sea); the cards are drawn by `drawPresetPreview`. "Part of Azeroth" picks a square of
  tiles on `MapPicker.svelte`, a continent overview stitched by the Go side from the client's
  minimap (`/wow/overview?map=`, `internal/wow/minimap.go`, cached in the user's cache dir), with
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
  `NewAreaRow`, `SaveAreas`). Save writes AreaTable.dbc into Meld's patch (the game closed around it) and
  the rows into the world database's `area_template`, which is where VMaNGOS reads areas from (not the
  DBC). A form saved with Save, not undo steps, like creature templates. A zone's Weather (#185) is its
  `game_weather` row (`vmangos/weather.go`, `ZoneWeather` binding): the chance of rain, snow and storm
  in each season as sliders, a subzone showing its zone's; Save sends the changed zones' weather with
  the rows (`SaveAreas`' second argument), and a zone with no chance left loses its row. The server
  reads the table at start or on `.reload game_weather`.
- **World map** (`components/WorldMapDialog.svelte`, World › World Map…, `ui.dialog = 'worldMap'`, #181): a
  zone's map for the game's M key. `Engine.renderTopDown` draws the zone's rectangle from above (the
  minimap's shot, any size), `io/worldMap.ts` gives the rectangle (the client's WorldMapArea row, or the
  zone's chunks grown to 3:2), the parchment look and the feathered paste over a zone the client already
  maps; Go (`vmangos/worldmap.go`, `WriteWorldMap`) cuts the 1002x668 picture into twelve DXT1 tiles and
  sets the WorldMapArea.dbc row, written into Meld's patch with the game closed. Exploration overlays
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
