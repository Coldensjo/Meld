# Water

Liquids, the sea and how both are drawn and exported.

- **Water** follows noggit3 (`lib/water/`):
  - `liquids.ts`: a `LiquidMap` per document holds liquid layers per 8x8-cell chunk (an MCNK). A
    layer has a LiquidType.dbc ID (1 water, 2 ocean, 3 magma, 4 slime are the base rows; the
    client's own table, read by the `LiquidTypes` binding into `LIQUID_TYPES` through
    `setLiquidTypes`, adds rows such as Naxxramas's slime, each drawn as its kind), 9x9 surface
    heights, 9x9 depths (0..1) and an 8x8 cell mask. A tile stores a chunk's liquid by kind, so
    the export writes the base row of the layer's kind (`tileLiquidType`); the `.wmap` keeps the ID. `paintLiquid`, `cropLiquids` and `regenOpacity` port
    noggit's `liquid_chunk`/`liquid_layer` logic. Edits go through `LiquidStroke` for undo.
  - The Water tool's Paint mode is noggit's water brush (`editor.water`: lock, angled mode,
    overrides, opacity mode, cursor on liquids). Dig lake and Raise shore shape the ground around
    the sea.
  - The sea (`editor.waterEnabled`/`waterLevel`, `Water.ts`) is a map-wide ocean plane. Its shader
    reads the ground's depth from `Terrain.heightTexture()`. The export writes it as ocean in the
    cells that no painted layer covers.
  - `liquidMaterial.ts` draws both as the client's `ocean0_s` program does (B-174, Benilla's
    `liquid.wgsl`): in gamma space, the lit depth swatch (the light's shallow and deep colours and
    alphas in the client's 64 byte rows, the ocean's last row darker and opaque; a river's depth
    reaches the deep row at byte 42, the ocean's at 255) plus the animated `XTextures` frame (24 a
    second) plus `(sun sheen + 0.25) · frame alpha`, the ripple. The light is the client's where the
    camera is (Client Lighting) or Azeroth's default (LightParams 12: bands 0, 1, 9 and 14 to 17 by
    hour). Magma and slime are their frame, opaque and unlit.
  - Go: `adt.Liquid` is one layer. `ParseLiquids` reads every MCLQ layer, and `Changes.Liquids`
    rewrites chunks in the client's flag order (`internal/adt/water.go`). A region save only
    rewrites chunks whose liquids differ from the client's.
