# Water

Liquids, the sea and how both are drawn and exported.

- **Water** follows noggit3 (`lib/water/`):
  - `liquids.ts`: a `LiquidMap` per document holds liquid layers per 8x8-cell chunk (an MCNK). A
    layer has a LiquidType.dbc ID (1 water, 2 ocean, 3 magma, 4 slime are the base rows; the
    client's own table, read by the `LiquidTypes` binding into `LIQUID_TYPES` through
    `setLiquidTypes`, adds rows such as Naxxramas's slime, each drawn as its kind), 9x9 surface
    heights, 9x9 depths (0..1) and an 8x8 cell mask. A tile stores a chunk's liquid by kind, so
    the export writes the base row of the layer's kind (`tileLiquidType`); the `.wmap` keeps the ID
    (one byte, so `setLiquidTypes` leaves out rows past 255), and the header's optional
    `liquidKinds` keeps the kind of each ID past the base four (`liquidKindsOf` on save,
    `rememberLiquidKinds` on open, #540), which `liquidType` falls back to when the client's table
    lacks the row or hasn't been read yet; an ID with neither still reads as water. `paintLiquid`, `cropLiquids` and `regenOpacity` port
    noggit's `liquid_chunk`/`liquid_layer` logic. Edits go through `LiquidStroke` for undo.
  - The Water tool's Paint mode is noggit's water brush (`editor.water`: lock, angled mode,
    overrides, opacity mode, cursor on liquids). Dig lake and Raise shore shape the ground around
    the sea.
  - A River path (the Path tool, #167, `tools/pathApply.ts` `fillRiver`) writes layers too: every
    cell whose centre is within half its width gets the path's liquid (the chunk's other layers
    leave the cell), each corner at the curve's nearest surface height, so the surface slopes down
    the river within and across chunks, and the depth from the carved bed by the brush's rule.
  - The sea (`editor.waterEnabled`/`waterLevel`, `Water.ts`) is a map-wide ocean plane, built as a grid of cells about a tile wide (up to 256 a side), never one quad: on a real GPU (D3D11 through ANGLE) a quad that size, clipped round the camera, came out at a slightly different depth each frame in flight, and the shore swapped sea and land back and forth (#747; SwiftShader, which the probes run on, draws it steady). Mind the same for any other huge surface that meets the ground. Its shader
    reads the ground's depth from `Terrain.heightTexture()`. Past the map (the plane is 10 map widths across) the ground carries on from the edge's height and falls to the depth where the swatch reaches its last row over `SEA_FADE` yd (`groundAt`, #748), so the colour fades out from the edge instead of stepping there. The export writes it as ocean in the
    cells that no painted layer covers. The terrain shader tints the ground under it and draws a foam
    line at the waterline (`TerrainMaterial.ts`), 0.35 yd either side but never thinner than about a
    pixel (`fwidth`), dimmed as it widens: thinner, it sparkled along every coast in flight (#747).
    Mind the same for any thin line a shader draws from a height or distance.
  - `liquidMaterial.ts` draws both as the client's `ocean0_s` program does (B-174, Benilla's
    `liquid.wgsl`): in gamma space, the lit depth swatch (the light's shallow and deep colours and
    alphas in the client's 64 byte rows, the ocean's last row darker and opaque; a river's depth
    reaches the deep row at byte 42, the ocean's at 255) plus the animated `XTextures` frame (24 a
    second) plus `(sun sheen + 0.25) · frame alpha`, the ripple. The light is the client's where the
    camera is (Client Lighting) or Azeroth's default (LightParams 12: bands 0, 1, 9 and 14 to 17 by
    hour). Magma and slime are their frame, opaque and unlit.
  - The world view (#15) draws the client's liquids of each streamed tile with the same material
    (`world/worldLiquid.ts`, `WorldStream.water`; terrain.md, the world view).
  - **A WMO's liquids** (#287, Benilla's `wmo_group_liquid_mesh` and `liquid.wgsl`, MIT/Apache): Go
    reads each group's MLIQ (`internal/wow/wmoliquid.go`: `GroupLiquid`, `LiquidSurface`): two
    triangles a tile whose nibble isn't 0xf, one class for the surface (MOGP groupLiquid at 0x34, or
    else the first wet tile's nibble: 0, 4, 8 water, 1 ocean, 2, 6 magma, 3, 7 slime), the path by
    the group's flags (`& 0x48` exterior, else interior), types 6 and 7 scrolling, and an interior
    pool's body colour from its MOMT diffColor. `wmoMesh` sends them after the mesh (`Mesh.Liquid`,
    model space, each vertex tagged with its group for the room gate). The frontend builds
    `ModelAsset.liquid`, and `ObjectLayer` draws it per batch as a third InstancedMesh beside the
    model and its LOD, packed with the instances in view, with `wmoLiquidMaterial` (the liquid shader
    under `WMO`, patched with the room gate): magma and slime their frame; an interior pool the body
    colour plus the frame, unlit; an exterior one (Stormwind's canals) the lit deep river colour plus
    the frame and the sheen; the opacity the vertex's byte between the light's shallow and deep
    alphas. It casts no shadow, is never picked, follows View › Water, and is never exported (the WMO
    is the client's).
  - Go: `adt.Liquid` is one layer. `ParseLiquids` reads every MCLQ layer, and `Changes.Liquids`
    rewrites chunks in the client's flag order (`internal/adt/water.go`). The client reads one MCLQ
    entry per MCNK liquid flag, so `MergeLiquids` first joins a chunk's layers of one type (two
    LiquidType.dbc rows of one kind, or a painted ocean beside the sea): the cells OR'd, each vertex
    from the first layer with a covered cell at it (#527). A region save only rewrites chunks whose
    liquids differ from the client's, comparing the joined layers (`liquidsByChunk`).
