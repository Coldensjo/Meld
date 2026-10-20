# Tools, selection and the clipboard

How the tools take input and record undo, the brushes, and selection, clipboard and nudging.

- **Tools** implement `Tool` (`lib/tools/Tool.ts`):
  - LMB goes to the active tool; RMB and MMB belong to the camera.
  - `tick(dt)` runs every frame while the button is held, so scale effects by `dt`.
  - Brush size follows Photoshop (`tools/brushSize.ts`): `[` `]` and Ctrl+scroll step the radius
    through size bands (`stepRadius`, via `Engine.stepBrush`), Shift+`[` `]` step the falloff, and
    Alt+right-drag (`Engine.sizeDrag`, which the camera leaves alone through `rightBlocked`) sizes
    the brush on the spot: sideways doubles the radius every `DRAG_DOUBLE` px, up and down set the
    falloff, and the ring stays on the ground point it started on.
  - Terrain brush tools extend `BrushTool` and record undo through `TerrainStroke`, which stores only
    the dirty sub-rect.
  - **Image brushes** (`tools/brushImage.ts`): a greyscale image from the user's folder
    (`prefs.brushImageDir`, read by Go into grey levels) multiplies the brush weight inside
    `forEachVertex`/`forEachTexel`. `BrushTool.tick` switches `brushImage.active` on only for tools
    whose `imageShaped()` says so (Sculpt's shaping modes, Paint's texture brush), and off again after.
  - Sculpt's **painting while shaping** (`editor.sculptPaint`: 'off', 'texture' or 'slope') paints
    under the brush in the shaping modes as the ground moves, in the same stroke and undo step.
    'texture' paints `editor.sculptPaintLayer` (per map in `DocMeta`; a texture picked in the
    browser while it is on becomes that layer instead of switching to Paint). 'slope' paints the
    map's **texture roles** (`terrain/roles.ts`, `editor.roles`, per map, saved in the map file's
    `roles` header field, guessed from the texture names of a map without one): the rock from
    `slopePaint.rockDeg` and the dirt on the moderate slopes below it (`slopeWeights`), which is how
    Blizzard's zones are painted (rock mountains rimmed with dirt over a grass base). The roles are
    set in Map Properties, and the preview-only cliff rock in the shader uses the rock role too.
  - Sculpt's **Erode** mode (#165, `SculptTool.erode`) copies the heights under the brush into a
    patch in cell units, runs `terrain/erosion.ts` over it (`Eroder`: water drops after Sebastian
    Lague's droplet model, `editor.erode.kind` 'hydraulic', strength in drops a cell a second; or one
    thermal slide past `editor.erode.talus`), and blends the change back by the brush weight, so the
    falloff, the brush image and the edit limit apply and nothing outside the brush's reserved rect
    changes. Each stroke reseeds the drops from `editor.erode.seed`. Terrain › Erode
    (`Engine.erodeArea`, `ErodeDialog.svelte`) runs drops and thermal passes over the selected area
    (vertices whose cells are all in it, `terrain/erodeArea.ts`) or the whole map, a 30 ms slice at a
    time between frames with a progress bar and Cancel, then writes the result as one undo step.
    Its "Mask where sediment settled" option (#242, `editor.erode.mask`) replaces the paint mask, in
    the same step, with each vertex's rise (dropped sediment and slid scree, bilinear to the mask's
    texels, full at `SETTLED_FULL` = 1 yd; `settledMask`), so Fill Mask lays dirt or gravel there.
  - Object tools push `Command`s (`addCommand`, `removeCommand`, `transformCommand`).
  - **Every edit must be undoable** through `History`.
- **Stamp** (`tools/StampTool.ts`, tool `stamp`, key 0) applies a brush stack (`tools/brushStack.ts`,
  `prefs.brushStacks`, edited in `BrushStackDialog.svelte`): each brush of the stack runs a pooled Sculpt or
  Paint tool on one shared `TerrainStroke` (`useStroke`/`releaseStroke`), one undo step a stroke. The brush
  tools in `TerrainTools.ts` read their settings from a module binding named `editor`, which
  `withSettings` points at a brush's own copy of the editor state for the call, so a stack never writes
  the reactive editor each frame; keep new settings reads in that module going through it.
- **Doodad brush** (`tools/DoodadBrushTool.ts`, tool `doodad`, key 8) scatters models the way Paint
  lays down textures. A brush (`tools/doodadBrush.ts`, `DoodadBrush`) is a named list of models with
  a weight, scale range, sink and tilt each, plus a spacing (a multiple of the models' footprints).
  Each attempt draws a point in the brush circle, keeps it with the falloff's weight (`candidate`),
  picks an entry by weight (`pickEntry`) and drops it when another root model stands too close
  (`fits`); the rate scales with strength and brush area (`attemptRate`). While the brush hovers, the
  next placements are drawn ahead (`plan`, redrawn when the brush or its settings change) and shown
  as ghost meshes (none for a model still loading); Ctrl+scroll or R spins the plan about the brush,
  and the press puts it down first. Shift ignores the spacing so models stack;
  Ctrl+drag erases the brush's models. A stroke is one undo step. Brushes are `prefs.doodadBrushes` (the pick is
  `prefs.doodadBrush`), edited in the brush editor (`DoodadBrushEditor.svelte`, `ui.brushEditor`), a
  full-screen window like the creature editor with its own model picker over the shared catalog
  index (`lib/wow/catalogIndex.ts`); while the tool is active, a model picked in the asset browser
  also joins the brush instead of being placed.
  Brush files are TOML (`formatBrush`/`parseBrush`, read with smol-toml), through Import/Export › Import /
  Export Doodad Brush and the `SaveBrushDialog`/`OpenBrushDialog` bindings. A brush may carry
  placement rules (`PlacementRules`, `rulesAllow`, the TOML's `[rules]`: slope and height ranges, on
  and not-on textures, liquids, holes) and each model an `align` toward the slope; Terrain › Fill
  Selection / Fill Mask with Doodad Brush runs it over a whole area as one undo step
  (`DoodadBrushTool.fill`, spaced through a `SpacingGrid`).
  Its Creatures mode (`editor.doodadMode`, #171) hands the input to the spawn brush
  (`tools/SpawnBrushTool.ts`, `tools/spawnBrush.ts`, `prefs.spawnBrush`): creature templates with weights,
  picked in the browser's Creatures tab, filled to a density (creatures per 100 by 100 yd) and spacing,
  with the brush's level, wander, respawn and facing; the Engine supplies guids and looks
  (`brushCreature`, `brushLook`). A stroke is one undo step of ordinary unsaved spawn edits.

- **Paths** (`tools/PathTool.ts`, tool `path`, key K, #167): roads, rivers and fences drawn along a spline,
  as Unreal's landscape splines. A path (`terrain/paths.ts`, `MapPath`) is control points plus its settings
  (kind, width, falloff, max grade in percent, texture, paint edge, a river's depth and liquid, a fence's model, spacing and turn), kept per map in `editor.paths`
  (`DocMeta.paths`, the map file's `paths` header) and picked by `editor.pathId`/`pathPoint`. A click
  on the ground adds a point to the picked path (on the curve's width it inserts one; with no path
  picked it starts one), a drag moves a point keeping its height above the ground, Shift+drag raises
  it; every change is an undo step that swaps in a copy of the whole list (`PathTool.record`), and a
  run of changes to one setting merges into one (`setField`). The dots are picked by their angle off
  the pointer's ray (`PICK_ANGLE`), so they are as easy to hit near or far. The curve is a centripetal
  `CatmullRomCurve3` sampled every half yard by arc length (`samplePath`), its heights graded
  (`limitGrade`), and `pathField` gives every vertex or texel near it the distance to the curve and
  the curve's height there, filling only each sample segment's box. Apply (`tools/pathApply.ts`,
  `applyPath`) levels a road's vertices with a cosine falloff (`crossWeight`), or carves a river's
  bed (`riverBed`: `depth` below the surface in the middle, `RIVER_BANK` above it at the sides) under
  a surface made to run downhill from the higher end (`downhill`) and fills it with the liquid
  (`fillRiver`, water.md), then paints the texels, or stands a fence's model in the middle of each
  equal span along the curve (`fencePieces`: spans of the spacing, or of the model's longer side,
  which `PathTool.apply` measures from the loaded model first; turned along the span's chord, a
  quarter more for a model long in Z) through `ObjectLayer.add`; it records only what it touched (heights per vertex, paint per chunk), since a diagonal road's rect
  would hold most of a region's paint. Applying again first undoes the path's last apply while it is
  live (`PathTool.applies`, per terrain, not saved), inside the new undo step, so undoing that step
  puts the old apply back; what was painted or sculpted in the chunks it covered since is lost there.

## Selection, clipboard & nudging

- **Select tool** (`tools/ObjectTools.ts`, `SelectTool`) does both kinds of selection:
  - A click on a model selects it, Shift+click adds or removes one, and a drag moves the whole
    selection (the clicked model leads, the others keep their offsets).
  - A drag on the ground selects an **area**, `editor.selection` in cell/vertex coordinates, and
    with it every model standing in it. The terrain shader draws the area (`selRect`/`selMode`,
    marching ants; a free-form shape's cells through `Terrain.setAreaShape`, the green of `cellTex`). `Engine.setHoleInSelection` cuts or fills holes in it.
  - The holes' edges show as walls (`tools/HoleWalls.ts`, also in Sculpt › Hole): ribbons along each
    straight run of hole boundary, dragged to move it or clicked through + and − badges. They draw
    over everything (depthTest off), so they fade out with the camera's distance and show only near
    the camera or round the cursor (`wallFade` in `terrain/holes.ts`, #249).
  - The lasso and polygon (`editor.selectShape`, L cycles, #183) make a free-form area: its cells are
    kept in `state/areaSelection.ts` (`setAreaCells`, `areaShape`) with `editor.selection` as their
    bounds, and count only while that rect and map are unchanged, so code that sets a plain rect needs
    no change. Cut hole, mask, the Layers chunk list, copy/paste (`MapClip.cells`), the doodad fill and
    Grow/Shrink Selected Area follow the shape; the shader draws it from a cell texture (`selMode` 3).
  - `editor.selectedIds` holds every selected object and `editor.selected` the primary one (the
    gizmo and the Properties sliders work on it). Change them through `lib/state/selection.ts`
    (`selectObjects`), never by hand. Delete, hide, nudge and focus act on the whole selection.
- **Clipboard** (`world/clipboard.ts`): `copyRegion` captures heights, holes, splat texels plus the
  source slot texture paths, and objects relative to the corner. `pasteRegion` remaps texture
  slots onto the target map and returns one undo command. `copyObjects`/`pasteObjects` copy
  models alone, relative to their mean position; Ctrl+C copies the selected models when there
  are any, else the area, and Paste places whichever was copied last (the Select tool draws
  ghost meshes for a model paste). `Engine.duplicateSelected` is copy + paste in place.
  - The clip lives on the Engine, not on a document, so it can be pasted into other tabs.
  - Undo closures must write per-map state through `editor` at call time, never through
    captured arrays, because tab switches replace those arrays.
- **Selected-prop visuals**:
  - `SelectionOutline` draws a screen-space silhouette stroke. The mask uses the model's
    alpha cut-outs, so leaves outline correctly. The stroke is yellow around a model that touches
    nothing and green around one that does (`OutlineTarget.touching`, from
    `Engine.touchesSomething`: attached to a parent, its lowest point on or under the ground across
    its footprint, or another prop's box meeting its own), so an author sees when a model is
    attached. The mask's B channel carries it per model.
  - `TransformGizmo` provides a ring (spin) and an up/down arrow (height). Gizmo drags are
    handled in `Engine` before tools get the pointer, and each drag is one undo step.
  - Red parts of the outline are decided per pixel in the mask shader: below the terrain (from
    a heightmap texture) or inside an overlapping prop's box (`Engine.overlappingBoxes`, up to
    8). The edge pass colours the stroke from the neighbouring mask pixels.
- **Object nudging** (`Engine.handleSelectionKey`): arrow keys are camera-relative and apply in
  the Select and Place tools. `CameraController.arrowsBlocked` keeps the camera from also
  moving. Bursts of nudges merge into one undo step via `History.replaceTop`.
