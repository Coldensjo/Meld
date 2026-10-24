# Cube worlds

The game's worlds (3dgame, `../../docs/world-format.md`): cubes in chunks of 16 x 16, on 31 layers,
saved as `.world` files that the server and client load. The editor opens and saves them (#29), draws
them (#30) and edits them with the Cubes tool (#31); they are the only documents it has since Meld's
`.wmap` maps, their terrain and their models went (#61).

## Files: Go

- `internal/worldfile` reads and writes the format: `Read`/`Write`, `Load`/`Save` (through a
  `.tmp` file and a rename, as `mapfile`), `ReadChunk`/`ChunkBody`. A `World` is the bounds in
  chunks and the stored chunks, each with its cubes as 768 bytes of planes (256 kinds, 256 shapes,
  256 rotations, index `z * 16 + x`), the CUBES record's layout once inflated, and the textures
  painted on their faces (`Chunk.Paint`, the PAINT record's 1536 texture ids of planes, 16 bits each
  since 3dgame #217 (`readPaint`, `paintBody`: the byte encodings when every id fits, the wide ones
  otherwise), nil when none is painted; normalized as the game does by `normalizePaint`, #76), and which edges of their faces
  blend into the texture beside them (`Chunk.Blend`, the BLEND record's 1536 bytes laid out as paint,
  nil when none does; `checkBlend` refuses a bit that is no edge of its face, `normalizeBlend` clears
  an empty cube's, #84). It also holds the
  spawn point, the monsters' spawn points (`MonsterSpawn`, the MONSTERS record: a kind's name and a
  cube, in order, checked by `checkMonsters`, #79), the NPCs (`Npc`, the NPCS record: a name, a
  cube and a route of cubes, in order, checked by `checkNpcs`, #98), the groups of joined cubes (`Join`, the JOINS record) and the objects attached to
  cubes (`Object`: door, window, lever, button, with its targets and its state from OBJECT_STATE),
  checked as the Rust reader checks them (`checkJoinsAndObjects`) on reading and writing, and the
  props (`Prop`, the PROPS record, tag 9: a model's name, a place in metres, a turn and a scale, as
  float32s, in order, checked by `checkProps` as `read_props` checks them, #133), and the mood
  regions (`MoodRegion`, the MOODS record, tag 10: a mood's name and the cubes at a box's two
  corners, in order, checked by `checkMoods` as `read_moods` and `World::set_mood_regions` check
  them, 3dgame #143), and the texture hints (`TextureHint`, the TEXTURE_HINTS record, tag 11: a
  name and a colour for a texture id the game does not have yet, checked by `checkHints`, 3dgame
  #218). The optional
  top-level records it does not know are kept as raw bytes in file order (`World.Kept`, a `Record`
  of tag, flags and body) and written back unchanged right after MOODS, so a saved world loses
  nothing (#147); a record over the 16 MiB read limit is still skipped.
- It normalizes cubes as the game does (`Normalize`, from the shape table's `turns`/`flips`) and
  refuses what the Rust reader refuses; the writer refuses a world the game would refuse (unknown
  ids, a chunk outside the bounds or given twice), leaves out all-empty chunks and writes uniform
  chunks as uniform.
- Its tests read the Rust side's fixtures, `crates/world/tests/fixtures/small.world` and
  `small-go.world` (the same world as Go writes it, which the Rust test reads back), so the two
  sides cannot drift. Go's zlib output differs from Rust's: compare worlds, never bytes.
- `app_world.go` binds it: `SaveWorldDialog`, `LoadWorld`, `SaveWorld`, with `WorldData` (each
  chunk's planes as one base64 string, and its paint as another, "" when none). `OpenMapDialog` (app.go) offers `.world` files.

## Importing a Tibia map (3dgame #218)

File › Import Tibia Map (`importTibiaMap` in `mapio.ts`, `App.ImportTibiaMap` in `app_otbm.go`) asks
for an Open Tibia map (`.otbm`, as Remere's Map Editor saves it), the `items.otb` it was made with
(`items.xml` beside it names the items) and where to save. Then `internal/otbm` makes the cube world,
and an `.items.csv` beside it lists every item id: its texture, its name, how often it is on a tile and
what it became each time. `cmd/otbm2world` does the same from the command line
(`go run ./cmd/otbm2world -items <items.otb> [-out <world>] <map.otbm>`).

- Both files are OTB node streams (`walk` in `nodes.go`). `LoadItems` keeps each item's group, its
  flags and its minimap colour.
- A tile on floor z at Tibia (x, y) becomes the cube at (x - MinX, y - MinY) of layer z + 2
  (`FloorLayer`). Floor 7, Tibia's ground floor, lands on layer 9, where the game's players stand on
  the ground layer. Floors 0 to 15 use layers 2 to 17, so the world's 31 layers are enough.
- Which cube a tile becomes (`Convert`), in this order:
  - a ground that blocks walking and sight (earth, mountain, cave wall) is a full stone cube;
  - an item that does (a wall) is a full stone cube;
  - one that only blocks walking (a tree, a bush, a statue, furniture) is a full wooden cube, which is
    easier to replace with a model or rework than a half one;
  - any other ground (grass, water, a floor) is a dirt floor slab, which the floor above's walls stand on.
- Borders, loose items, item attributes, houses, waypoints and every town but the first are dropped.
  The first town's temple is the spawn point.
- Every face of the cube is painted texture `32768 + item id` (`TextureBase`). The world gets a hint for
  each such id: the item's name, and its minimap colour (one of Tibia's 216). An item without one gets
  a muted colour made from its id; earth (item 101, the underground's filler) is dark brown.
  The mesher draws a hinted id it does not know with the plain tile (`PLAIN_TILE`) in that colour, so
  the map reads as its minimap. Edit › Textures in This World names the ids, most used first, and
  replaces them with a texture the game has (`TextureIdsDialog`, 3dgame #223): rows are picked by
  click, Ctrl+click, Shift+click or their tick box, the target from a grid of swatches with its own
  search, and the bar under both shows the picked swatches → the target before Replace changes them
  all as one undo step (`Engine.replaceTexture(ids, to)`).
- Item sprites (3dgame #224): the dialog's Load item images (`App.LoadItemSprites`,
  `otbm.ItemSprites`) reads a .zip of sprites named by item id (`0102_item_image.png`) and keeps those
  of the world's unknown ids that lie flat on a cube face: 32 x 32 and opaque, so grounds and floors,
  and the walls' faces (3dgame #225). Trees, monsters, objects, posts and archways keep their colour.
  - Tibia draws a point at tile position (x, y) and height z at screen (x - z, y - z), 32 px a tile:
    an oblique projection, a sprite's bottom-right corner on its tile's.
  - `otbm.WallFace` unshears a wall's sprite back into its flat, one-tile-tall face (`Unshear`), for
    each item that blocks walking and sight and is not a ground (walls, mountain edges). It reads the
    run from the sprite: an east-west wall is a band with level edges, a north-south one has upright
    sides, and only the right run fills the face.
  - The items.otb flags are no guide: TVP's say the opposite of Ironcore's.
  - A wall face's or flat sprite's few clear pixels are filled from the nearest solid ones
    (`fillClear`): on an opaque cube a clear pixel draws black. The mountain sprites 874 and 875 left
    a clear last column, a black line down every mountain cube (3dgame #228).
  - The sprite sheet (`sprites.ts`) builds its own mip levels cell by cell, with an 8-pixel frame
    (`SPRITE_PAD`, `SPRITE_LEVELS`), as the atlas does, so a far cube's edge never samples the next
    cell.
  - The binding asks for items.otb once and remembers it in the config (`TibiaItemsPath`).
- Import Tibia textures (3dgame #227):
  - The dialog's Import Tibia textures (`App.LoadItemSprites`) reads the sprites both for the world's
    own ids and for every ground, floor, wall and border of the map's items.otb (`otbm.TextureItems`).
  - It gives each a hint named from items.xml with its id, "grass (item 4526)" (`otbm.Hint`, which the
    import uses too).
  - It sets the world's pictures and names in one undo step (`Engine.setWorldTextures`).
  - The dialog's grid offers the world's pictured textures after the game's, filtered by "All, the
    game's, Tibia's".
  - Both searches take a number (or "item <n>") as a texture id or Tibia item id from its start, and
    words as part of a name.
  - "Paint with it" puts the picked texture in the Cubes tool's Paint mode.
  - `CubeWorld.textureName` and `paintable` let the tool's label, pipette and texture box (an extra
    option, `OptionsBar`) take the world's own textures.
- Borders (3dgame #226):
  - The import keeps a tile's topmost border (`Item.Border`: drawn on top of the ground, top order 1,
    blocking nothing) as the overlay over its cube's top: `Chunk.Overlay`, the OVERLAY chunk record
    (tag 4, optional).
  - The frontend holds it in `CubeWorld.overlay`, a `Uint16Array` per chunk. `CubeChanges` keeps it in
    each step, and `textureUse` and `replaceTexture` count and replace it with paint.
  - Load item images keeps a border's sprite as it is, see-through.
  - The mesher copies a kept top face into `PART_OVERLAY` with the picture's sheet coordinates, for
    every overlay that has a picture. `CubeLayer` draws it with the world's sprite sheet, alpha-tested
    and pulled towards the eye, as the blended edges are.
  - The sheet starts clear rather than white, so the see-through pixels stay so.
  - An overlay without a picture, or replaced with one of the game's own textures, is not drawn.
  - Copying and pasting cubes does not carry overlays yet. They go in the world
  (`CubeWorld.images`, the TEXTURE_IMAGES record, tag 12) as one undo step (`Engine.setWorldImages`).
  Each world draws them from a sprite sheet of its own (`sprites.ts`, `SPRITE_COLS` pictures a row, each
  framed by `SPRITE_PAD` pixels of itself), placed by `CubeWorld.spriteSlot`. The mesher puts a solid
  face with a picture in `PART_SPRITE`, whose material `CubeLayer` makes per world. `spritesChanged`
  makes the sheet again and meshes every chunk again through the build queue, a few a frame.

## Sprite to 3D Model

Tools › Sprite to 3D Model (`SpriteModelDialog.svelte`; `App.OpenSpriteFolder`, `ListSprites`,
`SpriteThumb`, `OpenSprite`, `ConvertSprite` and `SaveSpriteModel` in `app_spritemodel.go`) makes
a 3D model of a sprite drawn slanted: a Tibia item
(tile (x, y) at height z drawn at (x - z, y - z)) or a 2:1 isometric one. `internal/spritemodel` does
it; `cmd/sprite2glb` does the same from the command line, with `-preview` writing the model drawn from
its four sides as the sprite was (the first must look like the sprite).

- One picture gives no depth: every pixel is a ray along (1, 1, 1). A reading (`readings.go`)
  guesses it:
  - Box and Round (`mirrored`): the thing is the same mirrored east to west and north to south about
    its axis, so its mirrorings, the thing seen from the other diagonals, must all fall on the
    silhouette (a visual hull). Quarter turns would do as much for depth but force square
    footprints. Each level is then a box (or a circle, for Round) as wide as the hull reaches along
    the diagonals, the one width the sides show; a box takes its length over depth from the nearest
    level whose top the sprite shows (`shapeLevels`; the hull alone makes diamonds). `peel` takes
    off, top down, the pieces with nothing on them whose every pixel another cell still draws: the
    pyramid the hull leaves over a flat top and the steps round a foot drawn as a flat plate.
  - Wall (`wall`): the cross-sections drawn at every step along the tile's run, east to west, north
    to south, or both for a corner when together they draw 10 points more.
  - Cutout (`cutout`): each pixel on the plane through the axis facing the eye, filled behind as deep
    as it is far from the edge (a ball's section), only where the sprite is drawn, so the front
    stays exact.
  - Auto (`choose`) tries the axis at the tile's centre, the centres of the two or four tiles a big
    sprite may stand on, and where its foot is drawn (`footCentre`: the bottom row's run and the
    rightmost column's), keeping the one that draws most. An outline with few straight runs
    (`straightness` under 0.45) grew: Round, never Wall. Otherwise Wall must beat Box by 8 points;
    either under 55% leaves the sprite to Cutout. 64 x 32 sprites are often the top half of a
    two-part item, cut off at their foot: no reading can stand them up.
  - Outfit (`outfit.go`): a creature's outfit sheet, four columns facing north, east, south and
    west (rows: the frames of its walk). Tibia draws every direction from the same eye, so the four
    columns are four real views from the four diagonals: a cell is kept when every view draws it
    (view k is the model turned k quarter turns, `outfitColumn`), nothing guessed but where the
    foot is drawn, searched over the frame (`view.ox`, `oy`: the grid is centred on the axis, or
    the creature's far side falls off it). `peelViews` is peel over the four views; a face takes
    the colour the views that show it agree on most (`medoid`: a top is seen by all four). Auto
    takes any picture of four 32 or 64 pixel columns for one (`IsOutfitSheet`). The troll (outfit
    15, 32 pixel frames) comes out a hunched figure 21 cells tall whose views agree on 94% of their
    pixels: coarse, as its frames are.
  - Measured on Tibia's 691 sprites 64 wide (100 to 3134): 328 box, 137 wall, 111 round, 115
    cutout, in 20 s for all. Creatures and corpses read worst; the game has models of its own for
    those.
- Pixels the reading leaves undrawn become one-cell plates at the depth of their neighbours
  (`attachDetail`; not for Cutout), not on the silhouette's edge, where the hull's aliasing would
  make them run off.
- A model stands on the ground: its lowest cell at height 0 (`Model.ground`).
- A cell's sides are drawn at its pixel and its top at the pixel of the cell above (`render`); a
  south face also half covers the pixel to its left and an east face the one above, which fill only
  where nothing nearer is (a staircase's enclosed steps). Faces the sprite shows take that pixel's
  colour; hidden ones that of the same face mirrored, else a back face that of the front face at the
  other end of its row, else the cell's own pixel. The dark outline is filled from inside unless kept.
- The mesh merges each plane's faces into rectangles regardless of colour and packs their texels into
  one power-of-two atlas with a texel of padding, drawn with nearest filtering. One tile is one unit,
  the origin where the axis meets the ground. The pillar (Tibia item 1514) is 92 triangles.
- The dialog is a workbench: a folder's sprites on the left (`ListSprites` reads only their PNG
  headers; the pictures load as they scroll into sight, `SpriteThumb`), the model in its own
  three.js view in the middle with the sprite and the model drawn back from its four sides
  (`Model.Preview`, the `sides` of `ConvertSprite`'s reply) under it, the options and stats on the
  right, with the reading made, its centre and every reading's score. The folder and options are
  prefs (`spriteFolder`, `spriteProjection`, `spriteReading`, `spriteOutline`, `spriteBigOnly`). It converts again on every change, and a later conversion
  wins over one still running. It saves into the repository's
  `assets/models/props/sprites` when the editor runs from it. A model there still needs a
  `models.toml` entry and a `CREDITS.md` line, and Tibia's sprites are CipSoft's, not CC0.

## The frontend

- `lib/cubes/world.ts`: `CubeWorld` holds the cubes (a `Map` from chunk key to its planes; a chunk
  not stored is empty), with `get`/`set` (normalizing), `fillLayer`, `toData`/`fromData` for the
  bridge and `create` for a new world, empty or filled by the layer themes (`baseFill`, as the
  game's generator starts). It mirrors crates/world's kind and shape tables and layer themes; ids
  are rows of those tables, so keep the lists in step with the Rust ones. The doorway and window
  shapes (openings, #8) are shapes like the others. `CubeWorld.joins` and `objects` keep the file's
  groups and objects through `toData`/`fromData` (`WorldData.joins`, `objects`) so a saved world
  keeps its doors; the Cubes tool and the Select tool edit them (#32, below), and the Select tool's
  box edits carry them with the cubes (#101, below). `CubeWorld.monsters` keeps the monster spawn points the same way
  (`WorldData.monsters`; the Cubes tool's Monster mode edits them, #91, below), and `CubeWorld.npcs` the NPCs
  (`WorldData.npcs`; the Cubes tool's NPC mode edits them, #99, below), and `CubeWorld.props` the props
  (`WorldData.props`, numbers as float64s that come back as the same float32s when unchanged; the Cubes
  tool's Prop mode edits them, #133, below), and `CubeWorld.moods` the mood regions (`WorldData.moods`;
  the Cubes tool's Mood mode edits them, 3dgame #143, below). `CubeWorld.kept` carries the records Go does not know (`WorldData.kept`, each tag, flags and body as base64) unread, so Save,
  Save As, the autosaved copy and a reopened tab keep them (#147). `CubeWorld.paint` keeps the textures painted on faces the same way (a `Map`
  from chunk key to its paint planes, `paintAt`; `TEXTURES` and `KIND_TEXTURE` mirror crates/world's
  tables). A cube's paint is also handled packed in one number (`paintOf`/`setPaint`, `paintFaceOf`,
  `withPaintFace`: face f's texture times 256^f), normalized as `Cube::painted` (`normalizePaint`: none
  on an empty cube, a face painted its kind's own texture unpainted). `set` keeps a cube's paint
  (dropping faces that match the new kind's texture) and clears it only when it empties the cube;
  `fillLayer` drops a layer's. Drawn and edited since #83 (below). `CubeWorld.blend` keeps which edges
  blend (#84) the same way (`blendAt`, `blendOf`/`setBlend`, packed as paint, each face's byte with bit
  e for its edge towards face e; `normalizeBlend` keeps only a face's own edges, `BLEND_EDGES`, and
  none on an empty cube); the bridge carries it as `WorldChunkData.blend`, "" when none.
- A tab is a `MapDocument` (`lib/engine/MapDocument.ts`): its `world`, the `CubeLayer` that draws it
  (`cubes`), its `History`, its `meta` (name, file, dirty, bookmarks, swapped in and out of `editor` on
  a tab switch by `Engine.stashActive` and `activate`) and its camera. `Engine.openWorld` opens one; the
  editor starts on an empty 4 x 4 world (`START_CHUNKS`), as it does when the last tab closes. The
  camera's bounds, fog and focus come from the world's size (`Engine.extent`), and its ground (where
  `focus` sets the target, and the walking camera walks) is level with the ground layer's top
  (`GROUND_TOP`). Its tab shows the world's size in chunks (`syncTabs`, `docs.tabs[].world`).
- `io/mapio.ts` `openPath` opens a `.world` file (Open, Revert, the session restore and scenes use it);
  `saveMap` saves with `SaveWorld`, always to a `.world` file.
- File › New Cube World… (`Ctrl+N`, the tabs' +) opens the Start dialog
  (`components/NewMapDialog.svelte`, #62), whose fields are
  `components/CubeWorldFields.svelte` (`createCubeWorld`): a name, the size in chunks (up to
  `MAX_NEW_CHUNKS` a side) and whether to fill the layers by their themes.
- Autosave (#65, `io/recovery.ts`): a dirty world tab's recovery copy is a `.world` file
  (`SaveRecoveryWorld`, `recovery.Store.SaveWorld`; its info has `world` set, and `List` drops an older
  editor's copies of `.wmap` maps, which have it unset), sent whole since a world's cubes are small; Recover opens it with `LoadRecoveryWorld` and `openWorld`, in place of the
  world's clean tab. Help › Copy Scene writes a dirty or untitled world to a `.world` copy in the
  scenes cache (`SaveSceneWorld`), which the scene opens again as an untitled world.
- The tools are the Select tool (V, `CubeSelectTool`, #70) and the Cubes tool (Y, `CubeTool`), the
  `Tool` interface of `lib/tools/Tool.ts`: the Engine resolves a press, a move and a release to the
  point where the ray meets the cubes (`hit`, from `pickUnder`) and calls the active tool with a
  `ToolContext` (the active tab's `history` and `cubes`, the scene and the ray, `ctx.raycaster`).

## Play World (#33)

- Game › Play World (a world tab only) saves the world (a dirty or untitled one asks first, `saveMap`),
  then `PlayWorld` (`app_world.go`, `internal/play`) starts `3dgame-client <file> --at x,y,z --look
  yaw,pitch` with the camera's eyes and view (`lib/cubes/play.ts` `playSpot`). The client plays alone,
  on a server it starts inside itself, so no server is run here. Editor and game share coordinates.
- The client is `config.WorldClientPath` (a file or its folder), else `target/release` or
  `target/debug` of the repository above the editor's exe, else the PATH (`play.FindClient`). Its
  output goes to `<user cache>/Meld/client.log`. The client saves its changes to the world's `.save`
  folder, never to the `.world`.
- Check: `go test ./internal/play`, `bun test tests/playSpot.test.ts`; by hand, build the client
  (`cargo build --release -p client`), open a world, move the camera and choose Play World.

## Drawing (#30)

- `lib/cubes/shapes.ts` reads every shape's flags, hulls and full faces in every rotation from
  `lib/cubes/shapes.generated.ts`, which `cargo run -p world --bin export-shapes` writes from
  crates/world's `SHAPES` (#154; never edit it by hand, rerun it after changing a shape: `make check`
  runs it with `--check` and fails while the file is stale; `world.ts` builds its `SHAPES` (name, turns,
  flips) from it, so a new shape needs no editor row, #156); it ports the rotations and the client's `hull_faces`; `lib/cubes/mesher.ts` ports `crates/client/src/mesher.rs`: a shape's own faces (less
  those against another of its hulls, between a staircase's steps), a boundary face left out when the
  neighbour is solid or the same liquid and covers it with a full face or a partial face of its own
  that holds all of it (two slopes side by side; a ladder hides only with a full face), worked out
  once per pair of shape and rotation in `ShapeFace.hiddenBy`, the world's edge always drawn, colours per vertex from the kind's look tinted by the layer's theme
  (`kind_look`, `theme_tint`, converted from sRGB to linear as Bevy does; `cubeColour`, still what the
  minimap and the palette's pictures use). Keep both in step with the Rust; `tests/cubeMesher.test.ts` repeats the client's mesher tests with the same triangle counts.
  The client makes one mesh a kind; here the kinds are grouped into four parts (opaque, see-through
  liquids, glowing lava, and the blended edges' overlays, #84), so a chunk is at most four meshes.
- Textures (#83): every face shows a texture of the atlas, as the client draws it. The mesher gives
  each vertex a UV (`MeshPart.uvs`): the texture painted on the cube face the shape's face belongs to
  (`ShapeFace.paintFace`, `shapes.ts` `paintSideOf`, the client's `paint_face`: its boundary, or for a
  face inside the cube the side its normal points most towards, up or down on a tie), else the kind's
  own, projected onto that side's plane (`faceUv`, `face_uv`) and placed in the atlas (`atlasUv`,
  `atlas_uv`: the textures stacked top to bottom in id order, v down, each tile framed by 8 texels of
  its own image wrapped round, `ATLAS_PAD`, `PAD`). Vertex
  colours are then the theme's tint with the kind's alpha (`faceColour`, `face_colour`), which the
  texture is multiplied by. `lib/cubes/textures.ts` builds the atlas (`cubeAtlas`, a canvas and one
  more for each of its five mip levels, `flipY` off so v runs down as in Bevy; sampled linear with the
  mipmaps and 4x anisotropic, or nearest with Graphics › Smooth Textures off, `prefs.smoothTextures` and
  `setCubeFiltering`, as the game's `--crisp-textures` and F9, 3dgame #123) from the game's own images in
  `../assets/textures`, imported by Vite rather than copied: the build inlines them, and `make dev`
  serves them because `vite.config.ts` adds that folder to `server.fs.allow`. The three part materials
  share it (`CubeLayer` `partMaterials`); the cubes show plain white until the images load. Where there
  is no `document` (the unit tests) there is no atlas.
  A texture id the editor does not know (past `TEXTURES`, as from a newer game's world) is not refused
  (3dgame #215): `worldfile` reads and writes it back as it is, and the mesher draws it with the
  atlas's last tile (`MISSING_TILE`, `atlasTile`), a magenta and black checker. The pipette won't
  pick it and a prefab leaves that face unpainted, since it has no name. The game still refuses it.
  Edit › Textures in This World (`TextureIdsDialog`, 3dgame #216) lists every id, known or not, with
  its count of painted faces (`textureUse`, `lib/cubes/textureIds.ts`), and replaces one id with
  another across the world (`replaceTexture` through `CubeChanges`, `Engine.replaceTexture`, one
  History step); faces in the metal layers (`editBlock`) are left as they are.
  The liquids' textures (water, sea, lava) are animated (#108): their image is 16 frames one under
  the other, and `animateCubeAtlas`, which `CubeLayer.update` calls every frame, draws the frame due
  into the atlas's tile, each texture at its own pace (`FRAME_SECS`, the client's `frame_secs`), so
  every face showing it, painted or not, flows together without meshing anything again. The Paint
  mode's swatch shows the first frame.
  Some textures glow (3dgame #125: `window_lit`, `glow_moss`, `runes`): `<name>_glow.png` beside the
  image holds what of it glows. `cubeGlowAtlas` stacks them in the atlas's layout, black for the
  others (`GLOW_URLS`, the client's `GLOWS`), and the lit part's material takes it as its emissive map
  at full strength, so a painted lit window shows bright; there is no bloom here.
  Blended edges (#84): for each edge of a drawn face of a solid cube that blends, where the solid cube
  across that edge shows another texture on the same side, the mesher adds an overlay copy of the face
  in that texture and that cube's tint to a fourth part (`PART_BLEND`, `emitBlend`), as the client's
  `blend_faces`. Its `uv1` places each point on the blend mask (`blendMask`,
  `../assets/textures/blend_mask.png`): along the edge in `BLEND_SPAN` cubes, running on from cube to
  cube, and across it from 0 at the edge; the part's material takes the mask as its `alphaMap` on uv
  channel 1, transparent without depth writes and pulled forward by a polygon offset, so the face fades
  from fully the neighbour's texture at the edge to its own on a ragged line a quarter to a third in.
  The cube across lies in the chunk or a neighbour, so `chunksAround` rebuilds cover it, and a repaint
  rebuilds the neighbours that have blend planes too (`paintChunks`).
- `CubeLayer` (`MapDocument.cubes`) holds a group a layer and builds the stored chunks into it, the
  ground layer first, `CUBE_BUILD_MS` a frame (`Engine.simulate` calls `update`), so a large world opens
  without a stall. Positions are metres: x and z are cube index times `CUBE_SIZE` (3), a layer's bottom
  is `(10 - layer) * CUBE_HEIGHT` (5, 3dgame #221: a cube is taller than it is wide; `CUBE_DIMS` per
  axis). The shapes stretch to it, picking walks cells of that size, and the mesher scales normals by
  the inverse stretch (`worldNormal`). The game still makes layers 3 m tall until #222.
- The chunks are drawn in batches (#67): `BATCH` x `BATCH` (4 x 4) chunks of one layer make one mesh a
  part, merged from the chunks' parts as the mesher gave them (kept per chunk in `Batches`), so a
  themed 32 x 32 world is 656 meshes rather than 6608. The build queue keeps a batch's chunks together
  and merges the batch after its last one; a batch stays within a layer, so the slice still hides
  whole layer groups. The slice's caps are batched the same way.
- The layer slice (`ui.cubeSlice`, `lib/cubes/slice.ts`; View › Layer slice, `,` up a layer and `.`
  down): shows only layer N and those below it (or above it) by hiding the other layers' groups, and
  caps the cut: layer N's up (or down) faces that the hidden layer covered are built for that layer
  alone (mesher `CAP_TOP`, `CAP_BOTTOM`) when the slice changes. It is one view setting for every
  world tab, not saved.
- `CubeWorld.chunk` returns undefined outside the world: a chunk key out of range names another chunk.
- `CubeLayer.rebuild(keys)` rebuilds chunks now, after an edit, with their caps where they are in the
  slice layer: it meshes those chunks again and merges their batches (`built`, `capsBuilt`) from the
  kept parts, so an edit re-meshes only the chunks it touches; a chunk an edit makes builds there too.
  The build queue may build a chunk an edit already rebuilt: harmless.

## Editing (#31)

- The Cubes tool (`lib/tools/CubeTool.ts`, tool `cube`, key Y; `editor.cubeMode`, `cubeKind`,
  `cubeShape`, `cubeRotation`, `cubeBoxExtra`): Place puts the picked cube in the cell beside the face
  clicked (Ctrl+click removes), Remove and Replace change the cubes clicked or dragged over on the layer
  the drag began on, Box fills (Ctrl: empties) the box between the press and the release, reaching
  `cubeBoxExtra` layers higher. R turns the cube a quarter, Shift+R upside down, Alt+click copies the
  cube under the cursor. An outline shows the cell or box (green place, red remove, yellow replace,
  grey where nothing would change).
- `lib/cubes/pick.ts` `pickCube` walks the ray through the grid cell by cell to the first cube that is
  not empty in a layer the slice shows (whole cells, whatever the shape); with none it meets the bottom
  of the slice layer (the ground layer with the slice off), so an empty world can be built on. The tool
  reads the ray the engine set (`ctx.raycaster`).
- `lib/cubes/edit.ts`: `CubeChanges` sets cubes and keeps each one's state, paint and blend before and
  after (so undoing an erase brings them back; `set` takes the paint and blend to give or keeps the
  cube's, `paint` repaints a cube, `blend` sets its edges), so a press
  is one History step whose undo and redo rebuild the chunks it touched (`chunksAround`: the cube's
  chunk, the layers above and below, and the chunks across an edge it lies on). Nothing changes outside
  the world or in the metal layers (`FIRST_METAL_LAYER`, 26 to 30; `editBlock` says why), and a box is
  at most `MAX_BOX_CUBES`.

- Paint mode (#83, `editor.cubeMode = 'paint'`, the texture `editor.cubeTexture`, chosen in the options
  bar with a swatch): a click paints the face of the shape under the cursor (`pickCube` with
  `byShape`: the ray is tested against `shapeFaces`, a cube it passes through without touching counts
  as missed, and `CubePick.face` is the hit face's `paintFace`; outlined as a slab over that cube face), a drag the faces of the cubes dragged over on the layer the drag began
  on; Shift paints the whole cube, Ctrl clears the paint, Alt+click picks the texture a face shows.
  A stroke is one History step (`CubeChanges.paint`) and rebuilds the cube's own chunk and those around
  it with blend planes (`paintChunks`). With **Blend edges** ticked (`editor.cubeBlend`, #84) a click
  instead switches the edge of the face nearest the point clicked between blending and not, a drag sets
  each edge it passes within 0.3 of the way the first click did, Shift blends all four edges and Ctrl
  none (`CubeTool.blendEdges`, `CubeChanges.blend`, one History step a stroke). Copy, paste, move,
  turned and mirrored clips (`moveBlend`: faces and edge bits alike) and prefabs
  (`blend = { top = ['north', 'east'] }`) carry blend as they carry paint. Trap: Object
  mode still picks the cell's face (the game attaches by cell faces), so only Paint passes `byShape`
  (`pickUnder`); Shift paints the whole cube.

## Objects and joined cubes (#32)

- `lib/cubes/objects.ts` (pure data) edits `CubeWorld.objects` and `joins` by the game's rules
  (`worldfile.checkJoinsAndObjects`, `World::attach`/`join`): `attachObject` (one object a face of a
  cube that is not empty, outside the metal layers; a teleporter always on the top, a torch (#110) on
  any face, burning a fire colour, `WorldObject.colour` of `FIRE_COLOURS` (#137); new ids the highest
  plus one), `setFireColour` (a torch's colour), `detachObject` (also drops it from what the others act on),
  `toggleLink` (a teleporter leads to one other teleporter, so linking it replaces its target; a torch
  neither acts nor is acted on; the other kinds act on anything but a teleporter or a torch, never on
  themselves), `joinCubes` (two cubes or more; a cube joined again leaves
  its old group, which goes when left with one), `splitBox`/`splitCubes`. `editObjects` runs any of
  them as one History step from a copy of the joins and objects before and after (nothing recorded
  when nothing changed). `objectExtent` ports `Object::extent`, so a door fills its opening's hole (the shape's `hole` in
  `shapes.generated.ts`, a thin wall's doorway or window included), and an object stands on the
  surface behind its face where the shape stands back from it (`surfaceDepth`: a torch on the far
  side of a thin wall sits on the wall, #150; on an angled panel, which is not a box, rays along the
  face's normal through the object's middle and back corners find the panel, and the object, kept
  square to the face, is pushed in until a corner touches it, #191); a closed window in a hole whose corners the shape
  cuts off (the hole's `cutCorners`, `wall_octagon_window`) sits in the middle of the wall instead,
  where those corners hide its own (#200).
- The Cubes tool's Object mode (`editor.cubeMode = 'object'`, the kind `editor.cubeObject`) attaches
  to the face clicked: `pickCube` gives the face the ray came in through (`CubePick.face`), and the
  outline is a slab on that face. Ctrl+click removes the object there, Shift+click selects it, Delete
  removes the selected one. A torch is attached burning `editor.cubeFire`, the options bar's fire
  colour (shown while the kind is torch); selecting a torch shows its colour there, and changing it
  then recolours the torch, one History step (`CubeTool.syncTorchFire`, as Mood mode's region mood).
  `ObjectMarks` draws a torch in its fire's colour. Link mode: a click selects an object, each click on another toggles it as
  a target, Shift+click selects another, Esc deselects. A click on a cube means the object on the face
  clicked, else the cube's first (`objectAt`).
- The Select tool: J joins the box's cubes that are not empty (`cubesIn`), Shift+J splits the groups
  reaching into it (options bar Join and Split, `Engine.joinCubes`/`splitCubes`).
- `ObjectMarks` (owned by `CubeLayer.marks`) draws every object as a box in its kind's colour where the
  game puts it, on the layers the slice shows; for the selected object (`CubeLayer.selectedObject`,
  per world tab) an outline and a line to each target; and an outline round each cube of the groups
  that reach into the Select tool's box. `CubeLayer.update` redraws it whole when `objectsChanged()`,
  a `rebuild`, the slice, the selection or the selected object changed: objects are few.
- The Cubes tool's own cube edits (#103) take the objects and groups off a cube they empty
  (`clearCells`, a click, a drag or a Box fill that empties); a cube replaced by another full cube keeps
  them. A stroke snapshots the objects first and its History step restores them on undo and redo.
- Not yet: the palette's Objects category is empty.

## Monster spawn points (#91)

- `lib/cubes/monsters.ts` (pure data) edits `CubeWorld.monsters` (the format's MONSTERS: a kind's name
  and a cube, in order, several to a cube allowed): `placeMonster` (at the end of the list), `moveMonster`
  (keeps its place in the list, which is the order the server spawns them in), `removeMonster`,
  `monstersAt`; nothing outside the world or in the metal layers (`editBlock`). `editMonsters` runs one
  as a History step from a copy of the list before and after, written back on the world itself.
- The kinds are the game's: `lib/cubes/monsterKinds.ts` imports `crates/gameplay/monsters.toml` as
  text (`?raw`, so the build carries it; `vite.config.ts` lets `make dev` serve it) and reads the name,
  body and colour of each (`parseMonsterKinds`, smol-toml). Only those are offered: the server refuses
  a world whose spawn point names a kind it does not have ("no monster kind"). A spawn point of an
  unknown kind (from a file) is drawn grey with its name and a '?'.
- The Cubes tool's Monster mode (`editor.cubeMode = 'monster'`, the kind `editor.cubeMonster`, picked in
  the options bar): a click puts a spawn point in the cell beside the face clicked (`CubePick.place`,
  where a cube would go); a press on a spawn point (its body, `ObjectMarks.monsterHit`, else the cell it
  is in) and a drag moves it to the cell released over; a click on one without a drag only says what it
  is. Ctrl+click removes one, Shift+click adds another to its cube, Alt+click picks its kind.
- `ObjectMarks` draws each spawn point as a box of the kind's body (`width`, `height`) and colour standing
  on its cube's bottom, several in one cube side by side, with the kind's name over it (a sprite a kind),
  on the layers the slice shows; redrawn with the objects (`CubeLayer.objectsChanged`).
- Map Properties lists the count by kind. Moving, copying or removing cubes (the Select tool, the Cubes
  tool's own edits) leaves spawn points where they are.
- Checked (#91) in the live app with a scratch probe: placed, a second click not adding, Shift adding,
  dragged, Ctrl removed, undone and redone, hidden by the slice, saved and opened again; the server loaded
  the saved world and logged `monsters and NPCs spawned monsters=2`.

## NPCs and their routes (#99)

- `lib/cubes/npcs.ts` (pure data) edits `CubeWorld.npcs` (the format's NPCS: a name, the cube it starts
  in and the cubes of its route, in order): `placeNpc` (at the end of the list, with no route),
  `moveNpcPoint` (an `NpcPoint` is an NPC's index and `point`, -1 its start, else a cube of its route),
  `addRoutePoint` (after a given point, else at the end; a cube the same as the one before it is
  refused), `removeRoutePoint`, `removeNpc`; nothing outside the world or in the metal layers
  (`editBlock`). `editNpcs` runs one as a History step from a copy before and after, as `editMonsters`.
- Who an NPC is (look, speed, lines) stays in `crates/gameplay/npcs.toml`; the world only names it. The
  editor offers only those names: `lib/cubes/npcNames.ts` imports the file as text (`?raw`,
  `vite.config.ts` lets `make dev` serve it) and reads each one's name, body and colour
  (`parseNpcLooks`). The server refuses a world naming an NPC its file has not got ("no NPC named"); one
  from a file is drawn grey with a '?'. Two NPCs of one name are allowed (the server spawns both).
- An NPC walks straight from its start to each cube of its route in turn and back to its start, round
  and round (crates/server `npcs.rs`), so a route through a wall gets it stuck (it is put back home after
  8 s); `blockedLegs` (npcs.ts, #112) marks a same-layer leg crossing a full, pillar or window cube: drawn red, and said in the status line after an add or a move (legs between layers are not judged).
- The Cubes tool's NPC mode (`editor.cubeMode = 'npc'`, the name `editor.cubeNpc`): a click on an empty
  cell (`CubePick.place`) puts the NPC there and selects it (`CubeLayer.selectedNpc`, an index, cleared on
  removal); a press on an NPC's body or a route marker (`ObjectMarks.npcHit`, else the cell: a cube of the
  selected NPC's route, else an NPC starting there) selects that NPC and a drag moves that point.
  Shift+click adds the cell to the selected NPC's route, after the route cube last pressed or added
  (`CubeTool.routeAfter`), else at its end. Ctrl+click removes a route cube or an NPC, Alt+click picks the
  name, Del removes the selected NPC, Esc deselects.
- `ObjectMarks.drawNpcs` draws each NPC as a box of its body and colour with its name (several starting in
  one cube side by side), each route cube as a flat marker in its colour, both on the layers the slice
  shows, and each route as a closed loop of lines through the middles of its cubes at half the NPC's
  height: light blue, the selected NPC's yellow and over everything. Map Properties lists the NPCs with
  the length of their routes. Moving or removing cubes leaves NPCs and routes where they are.

## Props (#133)

- A prop is a model of the game standing in the world (the format's PROPS): its model's name (its path
  under `../assets/models` without `.glb`), where its origin stands in metres, its turn about the vertical
  and its scale. It is not on the grid. The game gives it a collision box from its model's `solid` in
  the model table (`../crates/gameplay/models.toml`); the editor neither shows nor needs it. `lib/cubes/props.ts` (pure data) edits
  `CubeWorld.props`: `placeProp` (at the end of the list), `moveProp`, `shapeProp` (turn and scale),
  `removeProp`; nothing outside the world or in the metal layers (`propBlock`, by the cube its origin is
  in, `propLayer`). `editProps` runs one as a History step from a copy before and after; `recordProps`
  records a change made a little at a time (a drag) from a copy taken before it.
- `lib/cubes/propModels.ts` loads the models (three's `GLTFLoader`) from `../assets/models`, imported by
  Vite as URLs (`import.meta.glob`, so the build carries them, some 20 MB in the exe, and `vite.config.ts`
  lets `make dev` serve the folder); the Kenney kit's models name their texture beside them
  (`Textures/colormap.png`), which a `LoadingManager` URL modifier maps to its imported URL, since the
  build renames files. Each model is fitted and drawn as the client draws it, from the model table
  `crates/gameplay/models.toml` (imported as text, `modelEntry`: the exact name, else the longest
  `prefix*`): offset, scale and turn (`fitMatrix`, props.rs `fit`), its colours tinted, matte (Lambert,
  as the cubes), and a bare tree's `Leaves` meshes left out. A model loads once, when first drawn, into
  its parts (geometry, material and matrix in the prop's fitted frame). Skinned models (the creatures)
  show their bind pose. `modelPicture` draws a model's palette picture once on a small WebGL renderer of
  its own (not the engine's) and keeps it as a data URL.
- `lib/cubes/PropLayer.ts` (`CubeLayer.props`) draws the props: one `InstancedMesh` a part of each model,
  holding every prop of that model on the layers the slice shows (the village's 723 props are 25
  meshes), placed again whole when the props, the slice or the selected prop change
  (`CubeLayer.propsChanged`) or a model arrives. `hit` finds the prop whose model a ray meets (three's
  instanced raycast); the selected prop (`CubeLayer.selectedProp`, an index) has a yellow box. Props cast
  no shadow. Trap: right after an edit the meshes are placed again only on the next update, so the tool
  asks no hit while `CubeLayer.propsPending`.
- The Cubes tool's Prop mode (`editor.cubeMode = 'prop'`, the model `editor.cubeProp`, the next prop's
  `editor.propTurn` and `editor.propScale`, the snap `editor.propSnap`): a ghost of the model shows where
  it would stand, where the ray meets the cubes' shapes (`pickUnder` passes `byShape`, so a prop stands
  on a slope's surface), its x and z on the snap grid (0.5 m by default; Free, 0.25 m, half a cube or a
  cube in the options bar); a click places it and selects it. A press on a prop's model (nearer than the
  cubes) selects it and a drag moves it, live, one History step on release (Esc puts it back). R turns
  the selected prop (else the next one) 15°, Shift+R back; Ctrl+click removes one, Alt+click picks its
  model, turn and scale, Shift+click places another over one, Del removes the selected prop, Esc
  deselects. The options bar's Turn and Scale show the selected prop's and change it (`syncPropShape`,
  one step a change). The palette's Props tab (`CubePalette.svelte`, `PropTile.svelte`) lists every
  model by folder with its picture and search; a click takes Prop mode with it. World Properties counts
  the props. Moving or removing cubes with the Cubes tool leaves props where they are; the Select
  tool's boxes carry them (#177, below).
- Checked (#133) with a scratch probe on `make dev`: the village's 723 props read and drawn, one placed
  by a click (snapped, standing on the ground layer's top), turned with R, dragged two cubes, undone,
  removed by Ctrl+click and undone, and the village saved by Go and opened again with its props equal;
  the Rust reader (`show-world`) opens the saved file.

## Mood regions (3dgame #143)

- A mood region is a place with a mood of its own (the format's MOODS): a box of cubes, from `min` (the
  least x, z and layer index, so the top layer) to `max`, and the name of a mood in
  `../crates/gameplay/moods.toml`. The client wears the mood of the innermost region its camera is in
  (the one holding the fewest cubes, of those the last; `World::mood_region_at`) instead of its layer's,
  eased in as between layers; a region of a surface mood shows that mood whole whatever the hour, one
  of any other mood (the file's place moods, `swamp`, `graveyard`, `lake`) takes the keys it leaves out
  from the hour's surface mood. The camera is at a player's eyes, a layer above the ground cubes it
  stands on, so a region over the ground is painted in the cells above it (and Higher for the layers
  it should reach up).
- `lib/cubes/moodRegions.ts` (pure data) edits `CubeWorld.moods`: `paintRegion` (at the end of the
  list, from a `CubeBox`; anywhere inside the world, the metal layers too, since it only changes the
  look), `setRegionMood`, `removeRegion`, and `moodRegionAt` ports `World::mood_region_at`.
  `editRegions` runs one as a History step from a copy before and after, as `editMonsters`.
- The Cubes tool's Mood mode (`editor.cubeMode = 'mood'`, the mood `editor.cubeMood`, picked in the
  options bar from the moods file's names: places, surface moods, then the underground ones): a drag
  from cell to cell (`CubePick.place`, else the cube) paints the box between them, reaching
  `editor.cubeBoxExtra` layers higher (the options bar's Higher, shared with Box), and selects it.
  Shift+click selects the innermost region at the cell (`CubeLayer.selectedMood`), and the options
  bar's mood then changes it (`syncRegionMood`, one step a change); Ctrl+click removes the region
  there, Alt+click picks its mood, Del removes the selected one, Esc deselects.
- `lib/cubes/MoodMarks.ts` (`CubeLayer.moodMarks`) draws each region reaching a layer the slice shows
  as its box's outline in a colour of its mood (`moods.ts` `regionColour`) over a faint fill, with the
  mood's name above it (grey with a '?' for a mood the file has not got), the selected one yellow;
  only while Mood mode is on (`CubeLayer.moodsShown`, set by the tool each frame), redrawn when
  `moodsChanged`, the slice or the selection change. The viewport wears the region's mood
  (`lighting.md`). World Properties counts the regions by mood. Moving or removing cubes leaves the
  regions where they are; the Select tool's boxes and prefabs do not carry them.
- Checked (3dgame #143) with a scratch probe on `make dev`: regions painted by drags, nested, selected,
  changed and removed with their undos, drawn only in Mood mode, the viewport wearing the swamp's mood
  in layer 9, and saved and opened again; a world with regions round-trips through Go equal
  (`compare-world`).

## Selecting, copying and moving boxes of cubes (#70)

- The Select tool (V) is `lib/tools/CubeSelectTool.ts`. A drag from cube to cube (`pickUnder`,
  the cube hit or else the floor cell) selects the box between them reaching `editor.cubeBoxExtra` layers
  higher (the options bar's Higher, shared with the Cubes tool's Box); a click selects one cube, a click on
  nothing deselects. The box is the world's own, `CubeLayer.selection`, so each world tab keeps its own;
  the tool mirrors the active one into `ui.cubeSelection` when it changes (the Edit menu and options bar).
- `lib/cubes/clip.ts` (pure data): `CubeBox`, `copyBox` (a `CubeClip`, packed cubes relative to the corner,
  empty ones too), `turnClip` (a quarter clockwise seen from above: the place `(x, z)` to `(d - 1 - z, x)`
  and each cube's rotation a quarter, as `shapes.ts` `rotatePoint` turns a point, so the box turns rigidly),
  `pasteClip` (the clip's empty cubes leave the world's be; cubes outside or in the metal layers are counted
  as refused), `moveBox` (empties the box and puts its cubes that are not empty at the new place; refused,
  with nothing changed, when one would land outside or in the metal, so a move never loses cubes) and
  `boxBlock` (`MAX_BOX_CUBES`).
- Paint goes with the cubes (#83): a `CubeClip` carries each cube's packed paint (`paint`, a
  `Float64Array` beside `cubes`), turned (`rotateFace(1, f)`) and mirrored (east and west, or north and
  south, swapped) with the box; a paste and a move give the cubes put down the clip's paint.
- Objects and groups go with the cubes (#101). A `CubeClip` carries `objects` (`ClipObject`: kind, face,
  state, the place in the clip and its targets as indices into the clip's objects, so links to objects
  outside are dropped) and `joins` (the part of each group made of the box's cubes, kept with two or
  more), both only on cubes that are not empty. `turnClip` turns an object's face a quarter
  (`rotateFace(1, face)`), `mirrorClip` swaps east and west (or north and south). `pasteClip` clears
  every cell it puts a cube in (`clearCells`: the objects there go, the cell leaves its group) and adds
  the clip's objects and groups with new ids. `moveBox` keeps ids: the objects on the moved cubes and
  their places in groups shift with them, so a lever outside the box still opens the moved door; what
  is landed on is cleared. `emptyBox` clears the box's cells. `CubeSelectTool.push` records the
  groups and objects (`snapshotObjects`) before and after with the `CubeChanges`, so one undo puts both
  back; a run of moves keeps the run's first snapshot.
- Monster spawn points go with the box (#109). A `CubeClip` carries `monsters` (`ClipMonster`: kind and the
  place in the clip), those in any cell of the box, empty or not; `turnClip` and `mirrorClip` move them with
  the box. `pasteClip` appends them (new ones at the end of `CubeWorld.monsters`, the world's own stay; one
  outside the world or in the metal is left out), `moveBox` shifts them (refused when one would land
  outside), `emptyBox` removes them. `ObjectsSnapshot` holds `monsters` too, so one undo restores them.
  A cube prefab file lists them as `[[monster]]` tables (`at` = [x, z, y], `kind`); a kind the game does not
  have is reported and left out on reading (`parseCubePrefab`'s `knownKind`).
- Props go with the box (#177), those whose origin stands in a cell of it (`propsIn`: the cell
  `floor(x / 3)`, `floor(z / 3)`, `propLayer`). A `CubeClip` carries `props` (`ClipProp`: model, turn,
  scale and the origin in metres from the box's north-west corner and its lowest layer's bottom).
  `turnClip` turns the place in metres as a cell's and the turn by -π/2 (the turn is counter-clockwise);
  a model cannot be mirrored, so `mirrorClip` turns it to face the mirrored way, `-turn` east to west and
  `π - turn` north to south, since every model faces north at turn 0 once fitted (`models.toml`).
  `pasteClip` appends them (one outside or in the metal left out), `moveBox` shifts them by whole cubes
  (refused when one would land outside), `emptyBox` removes them. `ObjectsSnapshot` holds `props`, and
  `CubeSelectTool.push` redraws them (`propsChanged`) and drops `CubeLayer.selectedProp` (its index may
  have moved) when a step changed them. A prefab lists them as `[[prop]]` tables (`model`, `at` =
  [x, z, y] in those metres, `turn` in radians, `scale`). Checked with a scratch probe on `make dev`
  (props in a box moved, undone, deleted and undone, pasted into a second world and pasted turned, and
  a prefab's props through the file).
- Ctrl+C (`Engine.copySelection`) copies into the tool's `clip`, which is outside any document, so Ctrl+V
  (`Engine.startPaste`) pastes into this or another world tab: the clip's outline follows the floor cell
  under the cursor (its bottom layer there, centred on it; orange where part falls outside), R turns it, a
  click or Enter puts it down and selects it, Esc cancels. The arrows move the selection a column the way
  the camera faces (the nearer axis; `arrowsBlocked` keeps the camera still), PgUp/PgDn a layer, Shift
  four; a run of moves within 1.5 s is one step (`History.replaceTop` over one `CubeChanges`). Delete
  empties the box. Every step's undo and redo rebuild the chunks and put the selection back.
- Cut and mirror (#74): Ctrl+X (`Engine.cutSelection`, `CubeSelectTool.cut`) is the copy, then the Delete, one
  History step. While pasting, M mirrors the clip east to west and Shift+M north to south (`mirrorClip` in
  `clip.ts`; the options bar has buttons): a shape mirrored east to west is a shape turned, its `mirror` in
  `shapes.generated.ts` (crates/world `ShapeInfo::mirror`: itself, or a mirrored twin such as
  `wall_diagonal_inner_mirrored`, turned t quarter turns), so a cube at quarter turn k becomes that shape at
  t - k (east-west) or t + 2 - k (north-south), upside down untouched (#151; `cubeClip.test.ts` checks every
  shape and turn against its hulls mirrored, and fails on `wall_inner_corner` and `wall_middle_corner`, whose
  mirror is the same solid split into other hulls).
- The Edit menu has Copy Cubes, Cut Cubes, Paste Cubes, Delete Selected Cubes and Deselect.

## The cube palette (#63)

- The asset browser (`AssetBrowser.svelte`, which keeps the frame: the resizer, the height, the
  fold, the tile size and Names) shows `components/CubePalette.svelte`. `lib/cubes/palette.ts` lists its tiles
  (`CUBE_ITEMS`: every shape, then every kind but empty as Materials or Liquids, keys `shape:<id>` and
  `kind:<id>`), searches them by name and by the words an author types (`searchCubes`) and draws a
  cube's picture as isometric faces (`thumbFaces`), which `CubeTile.svelte` paints on a 2D canvas: no
  WebGL context, no thumbnail cache. A shape's tile shows it in the tool's kind, a kind's a whole cube,
  tinted by the theme of the slice's layer, else the camera's (`stats.cameraLayer`).
- A click sets `editor.cubeShape` or `editor.cubeKind` and takes the Cubes tool; the picks are
  `prefs.cubeRecent` and the category `prefs.cubeCategory`. The preview shows the hovered tile with the
  tool's other half of the cube (else the tool's cube). The pipette is the tool's Alt+click; the
  palette marks the copied shape and kind.
- Sets (#73): the Sets tab (`prefs.cubeTab`) shows the author's named lists of tiles,
  `prefs.cubeSets` (`lib/cubes/cubeSets.ts`, palette keys; the shown one `prefs.cubeSet`), shared by
  every world. A right-click on a tile in either tab adds it to a set, a new one or takes it out; the
  tab's facets list the sets, its bar renames and deletes the shown one. A click picks as in the Cubes
  tab.
- Prefabs (#73): a box of cubes kept as a TOML file in the prefab folder (`prefs.prefabDir`,
  `lib/io/prefabFiles.ts`). `lib/cubes/prefabs.ts` writes and reads it: `name`,
  `size = [across, deep, high]` and a `[[cube]]` table per cube that is not empty (`at = [x, z, y]`, y
  up from the box's lowest layer, `kind` and `shape` by name, `turn` 0 to 3, `upside_down`, `paint` an
  inline table of face name to texture name, `{ top = 'grass' }`, #83), then an
  `[[object]]` table per attached object (`id`, `at`, `kind`, `face` by name, `on`, `fire` a torch's colour by name when not orange, `acts_on` the ids
  of the prefab's objects it acts on), a `[[join]]` per group (`cubes`, a list of places), a
  `[[monster]]` per spawn point (#109) and a `[[prop]]` per prop (#177, above). It is the
  editor's own file, not the game's world format (no approval needed). A file with `[[cube]]` tables
  is a cube prefab (`isCubePrefabText`); the Prefabs tab lists only those (an older Meld prefab of
  models in the folder is left out). Save selection writes the Select tool's box (`Engine.cubeSelectionClip`); a click on a
  prefab pastes it as a Ctrl+V of cubes (`Engine.placeCubeClip` → `CubeSelectTool.startPaste(clip)`,
  which makes it the cube clipboard), so R turns it, M mirrors it and a click puts it down as one
  History step. Its picture is the whole box drawn the same way as a tile (`clipThumbFaces`, faces
  between cubes hidden as the mesher hides them).
- Not yet: the Objects category is empty; objects are attached with the Cubes tool's Object mode (#32).

## Camera, minimap and menus (#62)

- The camera always flies free, to reach the layers below the ground: Follow the Ground and Camera
  Collision went with the terrain they kept to (#61), and `T` says so.
- `lib/cubes/layerMap.ts`: `layerAtHeight` (the layer a height lies in, held to 0..30) gives
  `stats.cameraLayer` (the status bar's Layer cell) and `stats.view.layer`;
  `drawLayerMap` draws the Minimap window's picture, a pixel a column: the cube in the
  camera's layer, or the first one below, darker the deeper. The window redraws when the layer or
  `CubeLayer.version` (bumped by every `rebuild`, so every edit, undo and redo) changes.
- World Properties shows the world's name (the file's), size, layers and stored chunks. It also edits
  the world's spawn point
  (`CubeWorld.spawn`, the format's SPAWN record; `Engine.setWorldSpawn`, one History step; Set puts it in
  the middle on layer 9, Clear drops it) and the bridge carries it (`WorldData.spawn`, #78).
- A project (File › Project…) is a folder of cube worlds.

## Checks

- `go test ./internal/worldfile/` and `go test .` (`app_world_test.go`); `bun test tests/cubeWorld.test.ts tests/cubeMesher.test.ts tests/cubeEdit.test.ts tests/cubeClip.test.ts tests/cubePalette.test.ts tests/cubePrefabs.test.ts`.
- The probe `cube-world`: opens the fixture, checks its cubes, saves it, opens the copy, reverts it
  and makes a new world.
- The probe `cube-build`: builds a small house by clicks with the Cubes tool, undoes and redoes it, and
  saves and reopens it.
- The probe `cube-camera`: the free camera down to layer 15, the status bar's layer, the minimap's
  picture redrawn after an edit, World Properties and the Start dialog.
- The probe `cube-copies`: an edited world's recovery copy and scene copy, loaded back, the toolbar's
  two tools and the menu bar.
- The probe `cube-palette`: the asset browser's cube palette in a world tab, its picks, search,
  categories and preview, a set made by right-clicks and used in the Sets tab, a prefab of cubes
  written to `build/bin` listed, drawn and placed.
- The probe `cube-select`: a box selected by a drag, copied, moved by the arrows and PgUp and undone, deleted,
  pasted into a second world tab and pasted turned, the Edit menu's cube items, and the drawn triangles
  against the mesher in both tabs. Trap: `openWorld` takes the place of an untouched tab, so a probe that
  opens a second world must leave an edit in the first, or the first's `cubes` is gone (null).
- The probe `cube-draw`: the drawn triangles against the mesher and the slice through every layer.
  To see the game's map, open `worlds/island.world` (`docs/editing-the-map.md`); for a scratch
  copy of the generated world, write it with `cargo run -p world --bin gen-world --
  editor/build/bin/<name>.world` (git-ignored) and open it.
