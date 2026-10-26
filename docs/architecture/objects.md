# Placed models

Attachments, the object layer (instancing, picking, LOD, WMO culling and rooms), and model animation, lights, flames, particles and ribbons.

- **Attachments**: a `WorldObject` with `parent` is attached.
  - Its x/yOff/z/rotY/scale are local to the parent (`matrixOf` walks the chain). Roots use
    world x/z and yOff above the terrain.
  - Always move objects through `ObjectLayer.place(o, parentId, worldPlacement)`, which converts
    to the parent's local space, plus `worldPlacement()`. Never write world values into an
    attached object's fields.
  - Placement and dragging use `ToolContext.surface()`: the nearest terrain or object hit.
  - Ids and parents are saved in map files and preserved by copy/paste.
- **Objects** (`lib/world/ObjectLayer.ts`):
  - One `InstancedMesh` per model type, so draw calls scale with the number of types, not
    instances.
  - The instance batch both this layer and `SpawnLayer` draw through is `world/instanceBatch.ts`
    (#517): `InstanceBatch` holds a batch's rows (`items`, `matrices`, `spheres`; `setRow` writes one),
    `cull` finds the rows in view (`packed`, through `cullSpheres`; `repack` forces a change after the
    rows were rewritten), `pack` writes them to the front of a mesh with the item each instance draws
    in its `ids` (the mesh's `userData.ids`, which `hitId` reads), and `patch` writes moved rows in
    place (both layers: ObjectLayer's `movedIdx`, SpawnLayer's `moved` from `refresh`, #697; `repack`
    is then only for a rebuild). `instancedMesh` makes the meshes (skinned with a skeleton, `cullForShadows`, `watchUploads`).
    What stays in the layers is what they batch: ObjectLayer's object tree, LOD split and WMO
    liquid and group culling; SpawnLayer's grouping by kind and marker. A fix to culling, packing,
    uploads or picking of instances goes there, once.
  - A mesh with nothing packed (`count` 0) is hidden (`InstanceBatch.pack`; `SpawnLayer.cull` also
    hides the spawn kinds not shown): three would still set up each of its groups in every pass, since `cullForShadows`
    passes every frustum but a point light's and the near cascade's (#323).
  - Our own cull packs what any frustum needs, so three culls a batch mesh only per shadow pass
    (`world/shadowReach.ts`, `cullForShadows`): a point light's cube face draws it when one of its
    packed instances meets the light's reach and the face (#133), and the sun's near cascade (registered
    each frame by `Engine.cullInstances` through `setNearCascade`) when one meets the
    cascade's box (#325). The far cascade (registered through `setFarCascade`) keeps every packed batch. So `visible` on a batch mesh means "drawn now".
  - The scene pass draws only the instances in the camera's frustum (#15). `cullSpheres` (with
    `InstanceBatch.split`) packs those first and the ones only a shadow's box or a light's reach holds
    after them, each part ascending; `splitLod` keeps that order in `near` and `far` and counts each
    list's lead (`Batch.nearFar`). `pack` sets the mesh's `count` to the ones in view
    (`shadowReach.setPacked`), and `cullForShadows`' `onBeforeShadow`/`onAfterShadow` swap in every
    packed instance for a shadow pass and back. So `count`, picking and the mesh's bounding sphere
    mean "in view"; `packedCount(mesh)` is what the shadows draw, and the readers that mean "drawn
    anywhere" use it (`hasVisible`, which poses a model, the WMO group cull's one-instance test, a
    spawn kind's `visible`). A scene-pass frustum (any one not registered) passes a batch only with
    `count` above 0. A mesh that sets shadow hooks of its own must call `cullForShadows`' too
    (`ObjectLayer.makeMesh` chains them for the WMO group cull). In the Elwynn world view this took
    the scene pass from 1,993 calls to 1,017: the far box (up to 5,000 yd across) packed 5,989
    instances, 979 of them in view.
  - Each loaded model gets a three-mesh-bvh bounds tree (`world/bvh.ts`), which `pick` and
    `raycastSurface` cast through. Both read a hit's object through `hitId` (`world/instanceHit.ts`)
    and go on past a hit whose instance has no id (a mesh repacked or swapped since the last pack, #524).
    `raycastFloor` (#660) casts the same meshes with `firstHitOnly` off, since a building's own
    ceiling comes before its floor, and takes the nearest hit whose world normal faces up
    (`FLOOR_MIN_UP`): ceilings and walls are passed. Only packed instances are hit, so a layer that
    was never `update`d and `cull`ed (a unit test's) hits nothing.
  - Each loaded model may also get a meshoptimizer LOD (`models/lod.ts`): a second index over the
    same vertices, drawn by a second InstancedMesh for instances under `LOD_PX` on screen
    (`splitLod` in `instanceCull.ts`). The LOD shares the full model's bounds tree, so picking
    always hits the full model.
  - A WMO's LOD merges its groups by class (#691, `models/farLayers.ts`), so a far building costs a
    few draw calls instead of one a texture (Elwynn's world view: 4,070 calls to 1,990). `farPlan`
    gives each of the model's materials a class (lit or unlit, blend, sides; a group whose texture or
    colour moves gets -1 and keeps its own material), the worker's `farMerge` (`lod.ts`) concatenates
    each class's LOD triangles and picks their vertices out of the model's (a vertex two groups share
    is copied for each), and `farLod` copies those vertices into buffers of the LOD's own with a
    `farLayer` attribute: the layer of one shared `WebGLArrayRenderTarget` (64 px a layer, mipmapped,
    repeating, sRGB) that the group's texture is drawn into, times the tint `wowMaterial` gives its
    material (a dim interior, a grey untextured group). `drawFarLayers` draws the layers waiting at the
    start of each frame, 96 at most (a grey fill until the texture comes); the array doubles from 256
    layers as they are taken, up to 2,048 or the GPU's limit, past which a LOD keeps its groups.
    `releaseWowAsset` gives the layers back. The class materials are shared by every far WMO, patched
    for the cascades and the room gate like a group's, and sample the array where three samples
    `map`. The LOD mesh's materials are the model's, then the classes' (`ModelAsset.lodMaterial`), so
    a pick through the full model's bounds tree finds the group's own material. Its shadow is drawn
    with `farDepthMaterial`, where a cut-out's triangles (a negative layer) test the layer's alpha.
  - A WMO with liquids (MLIQ, #287) has a third InstancedMesh in its batch, `liquid`, packed with
    every instance in view (`docs/architecture/water.md`, "A WMO's liquids"); `intersect` leaves it
    out, so its lava and water are never picked.
  - A big WMO (20k triangles and 4 groups or more) drawn once is culled by group for the scene pass
    and the near shadow cascade (#198, #215, `world/wmoGroupCull.ts`): its batch mesh draws a twin of
    the model's geometry (the same vertex buffers, an index of the model's triangles sorted by WMO
    group, then a half rewritten with the runs of the groups whose boxes meet the camera's frustum or
    the near cascade's, `CullView.shadowFrustum`). `onBeforeRender` points each material's draw at that
    half for the view camera, and `onBeforeShadow` for the near cascade's shadow camera (told apart by
    its `shadowCamera` argument; its `camera` is the view's). The far cascade, redrawn only when its fit
    changes, and the point lights' cubes keep the whole model. The near cascade lies mostly in view, so
    the two share one half instead of a third (16 MB for Stormwind). The twin shares the model's bounds
    tree, as the LOD does, since picking and the names' sight lines raycast the batch mesh: without it a
    ray walked every triangle, over a second for Blackrock Depths (#286, probe `brd-fly`).
  - The bounds tree, the LOD's index and the group cull's twin index are built in the model workers,
    off the main thread (#507): for Stormwind they took 1.2 s of one frame there. `loadAsset`
    (`models/assets.ts`) builds the asset (so its textures start loading), then `buildModel`
    (`models/modelBuild.ts`) posts copies of its positions, index and rooms to one of up to three
    workers (`models/modelWorker.ts`, bundled by Vite from `new Worker(new URL(...))`), which run
    `buildModelData` (`models/modelData.ts`): the tree first, since it reorders the index within each
    group, then the LOD (`lodIndex`) and the twin (`cullData` in `wmoGroupCull.ts`) from the reordered
    index. `adoptModel` puts them on the geometry: the reordered index, the tree through
    `MeshBVH.deserialize`, the LOD geometry, and the cull through `WmoGroupCull.adopt`, which
    `WmoGroupCull.of` then finds. Without workers (Bun's tests) or once one fails to start, the same
    build runs on the main thread. Probe `model-worker` measures the stall and compares the results
    with a main-thread build.
  - Objects store `x, z, yOff, rotY, scale`. Y is always `terrain height + yOff`, re-snapped after
    sculpting. A tilted one also has `tiltX`/`tiltZ`, the MDDF/MODF record's first and third angles,
    turned in the client's order by `world/placement.ts` (`placementEuler`); build every model
    rotation through it.
  - A batch is rebuilt (`update`) only when dirty: an object of its type was added, removed, changed
    type or hidden, or its model loaded. Each batch keeps the ids of its type (`members`),
    and the layer keeps each object's children (`kids`, filed by `add`, `remove` and `touch`, since
    every change to `parent` is followed by one of them), so a rebuild and `markTree` (a touch, a
    sculpt stamp's `markRegionDirty`) never walk every object (#329). `descendantsOf` (a breadth-first
    walk over `kids`, skipping a child whose `parent` no longer names the id it is filed under) and
    `childrenOf` read it too, and `place` checks for a cycle by walking the new parent's chain
    (`hangsOn`), so the gizmo's per-move `place` and the Clear and Doodad tools' "what hangs on these"
    cost the tree's size, not the map's (#512). `matrixAt` builds the matrices in module scratch, a
    parent's in `parentM[depth]`.
  - "What stands near here" reads cells, not every object (#512): the layer files each root by its
    ground point in a `CellGrid` (`world/cellGrid.ts`, 32 yd cells) and keeps the roots that reach
    further than `WIDE` (64 yd, the buildings) from their spot in `wide`: `reachOf`, the box's
    farthest corner from the model's origin, which bounds the footprint (`groundReach`, half the box's
    diagonal across the ground) and any turn or tilt. Both are kept by `file` with `kids` (`add`,
    `touch`, `setType`, a model loading, which changes its box) and by `remove` and `clear`.
    `rootsNear(x, z, r, out, sized)` gives the roots within `r` (`sized`: within `r` of their
    footprint), `rootsIn` those in a rect, `rootsTouching` those whose model may reach a rect (a
    superset, for a box test: the selection's prop test, #551), and `attachedObjects` the attached
    ones, which callers place by `worldPosition` (they are few). The Clear tool's models under the
    brush, the Select brush, the Doodad brush's spacing neighbours, prop list and erase,
    `objectsInRect` (the area's objects), `markRegionDirty` and the selection outline use them,
    filling the caller's scratch array. A move that writes `x`/`z` without a `touch` leaves the object in its
    old cell, as it leaves its drawn row: always touch. Probe `objects-near` checks them against a scan
    of every object.
  - Selection groups are indexed too (#630): `groupIds` holds each group's ids, kept by `file` (`add`,
    `touch`), `setGroup` (the Group and Ungroup commands and their undo), `remove` and `clear`, so
    `withGroups` (the Select brush, once per grouped model under it, a click, the area, Select All),
    Ungroup and the Inspector's group sizes read `groupMembers(g)` instead of scanning every object.
    Write `group` through `setGroup`, or follow the write with a `touch`. Probe `select-groups` checks
    it against a scan.
  - A move is not a rebuild (#510): `markTree` (a touch, a re-snap) only notes the ids in their batch's
    `moved`, unless the batch is dirty anyway, and `update` recomputes those rows alone, found through
    `index` (each id's place in `rows.items`). `cull` then writes them in place (`InstanceBatch.patch`) into the meshes that
    draw them, when the packing is otherwise the same, uploading only their rows (a range each, or the
    whole buffer past `RANGES_MAX` rows or while a `pack`'s whole upload is still pending, which a
    range would cut short: `wholePending`, cleared by the buffer's `onUpload`), and grows the mesh's
    bounding sphere over them for picking. A move that changes what is in view or the LOD split repacks
    as before. Adding, removing, hiding or retyping an object, or a model loading, still rebuilds the
    batch. Probe `object-move` checks it.
  - The layer's counters (#511): `version` moves on any change, what is placed or where, and is what
    a consumer needing either reads (the shadow maps' scene key, the nav preview, the group boxes,
    the tools' caches). `shapeVersion` moves only when what is placed changes (added, removed,
    retyped, hidden, a model loaded, the view's kinds or hidden set). A move leaves it and is logged
    instead: `markTree` pushes each moved id (children after their parent) and `movedSince(seq)`
    returns those since a reader's `moveSeq`, or null once the log (cut at `MOVE_LOG` entries) no
    longer reaches back, when the reader rebuilds. `PropEffects`, `ParticleLayer`, `WmoRooms` and
    `ModelBoxes` read the two, so a drag or a sculpt stroke's re-snap updates only the moved objects'
    lights, flames, particle pools and boxes, and the WMO probe runs again only for a moved WMO
    (`WmoRooms` keeps each placed WMO's matrix, inverse and world box, #523, recomputing a moved one's,
    so `update`, `collide`, `floorAt` and `outside` invert no matrix per frame); this
    is `SpawnLayer`'s `version`/`moveSeq` pattern. Probe `effects-drag` checks it.
  - `SpawnLayer` notes the creature models that load and its next `cull` redraws only the batches they
    change (`regroup`): the model's own and the marker cones holding a spawn of it. A change to the
    spawns themselves (`set`, `add`, `remove`, the events shown) still rebuilds every batch (#329).
  - **WMO rooms** (#8, from Benilla's `wmo_portal`): `world/WmoRooms.ts` finds the room (group) of the
    placed WMO the camera is in with the client's down-ray (`wmoRoom.ts`, room data from `/wow/wmonav`),
    `wmoFlood.ts` runs the portal flood from it each frame and `wmoFog.ts` picks the room's MFOG fog
    and its 4 s fade. `roomGate.ts` applies both in the shared WMO materials: WMO vertices carry their
    group (`wmoRoom` attribute, Go's `Mesh.Room`), and the instance at the room's origin hides the
    groups the flood didn't reach and fogs the reached interiors with the room fog. The 15 nearest
    other WMOs with portals in view are flooded from outside (`WmoRooms.outside`, every exterior group
    a root, but never a WMO-only map's building, whose groups are all interior and which then draws
    whole from outside, #271, nor one the camera is over, below), each in its own row of the gate's mask, so an interior shows only through a doorway; a
    doodad carries up to two groups (`Mesh.Room` has two a vertex). From inside, the open world shows only
    through the flood's exterior windows (#116, `CullView.gate`, `Terrain.gate`, the particles): a
    model, spawn, terrain chunk or emitter must meet a doorway's narrowed frustum, and a sealed room
    shows none, as in the client. What stands in a room the flood reached passes anyway (#156,
    `world/roomAdmit.ts`: its room by the camera's down-ray from its sphere's centre, cached per
    position), so the creatures and models in the camera's room stay drawn. Spawns are left out of the gate while View › Creatures and objects through
    walls is on (`prefs.spawnsThroughWalls`, the default, #150). The liquids, the sea and the grass tufts are gated too (#119: `LiquidRenderer.gate`,
    `Water.gate`, `GroundEffectLayer.gate`, which packs from the last build's full set). The weather
    preview has its own windows (#244, `RoomFlood.skyWindows`): the doorways onto any group with 0x8,
    0x40 or 0x100 (`SKY_GROUP`, the client's weather flag), since Stormwind's shops open onto streets
    lit as outdoors (0x40), which leave no exterior window.
    Meld's own departure from the client (#300): the eye is in a room only inside the box of the room
    the down-ray finds. Over a building's footprint otherwise (no room found, above that room's box, or
    above the whole building) the WMO goes in `WmoRooms.over` and is drawn whole, since the client's
    camera never goes there and its flood then left holes: Stormwind's streets are lit interiors (0x40)
    a few yards tall, reached from outside only through one exterior shell.
    The client's camera also collides with a WMO and stays off its walls. Meld's flying camera does
    so only with View › Camera Collision on (#305; off, the author flies through walls into buildings):
    each frame `CameraController.update` hands the move from the last settled eye to the new target
    to `cameraMove.ts` `moveStep` (a pure function, unit-tested in `tests/cameraMove.test.ts`, #434),
    which calls `Engine`'s `collideWalls` hook, `WmoRooms.collide`, which runs `wmoRoom.ts` `collideSphere` in
    each nearby WMO's model space: the path is swept against the collision faces (`sweepFaces`, so a
    fast flight can't tunnel through a thin wall), stops the near plane's corner reach (0.5 yd times
    `cameraMove.ts` `cornerFactor`) off a face and slides along it, then is pushed out of any face it ended
    nearer to. It runs after the 3 yd floor clamp, which in a low room can put the eye in a ceiling. A
    teleport, a mode change or a tab switch (`CameraController.jump`) is not collided.
    The clamp keeps the eye 3 yd above the floor the `collisionFloor` hook gives (#310): in a WMO's
    room (`WmoRooms.current`; after a jump the probe runs for the new eye first) the highest walking
    face at or below the eye (`WmoRooms.floorAt`, `wmoRoom.ts` `walkFloorZ`, Leg A of the down-ray),
    not the terrain, which in Stormwind runs yards above and below the streets; elsewhere the higher
    of the terrain and a WMO floor, so a roof is a floor too (`cameraMove.ts` `roomFloor`). The Walk camera stands on the same floor
    (#312, `cameraMove.ts` `walkFloor`), searched from `WALK_STEP` (2 yd) above the floor it stood on,
    so stairs are climbed and a roof or bridge above is walked under; a jump into the walk searches
    from the eye. Walk always stops at the WMOs' walls (#313), whatever Camera Collision says, as the
    client's player does: its move is swept level at the eye through `collideWalls` (only x/z kept), and
    the sphere's reach down to `WALK_STEP` over the floor stops a wall too high to step over.
    Without it a wall closer than the near plane (0.5 yd) would be clipped away and, gated, show the sky.
    `WmoRooms.wallDist` is the eye's distance to the nearest collision face of any WMO within 2 yd
    (`wmoRoom.ts` `nearestFaceDist`, through the column index), and `Engine.updateNear` pulls the near
    plane in to that distance over the frustum's corner factor (down to 0.05 yd) while it is that
    close (#304). An eye inside a wall's thickness still sees past it; collision keeps it from getting there.

## Prop animation, lights & flames

- Go side (`internal/wow/m2anim.go`): `parseM2Extras` reads the following, all converted to
  editor space and sent in the mesh header (`bones`, `effects`) plus per-vertex bone data after
  the indices:
  - Bones with keyframes for the "Stand" loop (or a global sequence).
  - Lights: 212 bytes each in vanilla.
  - Particle emitters: **504 bytes in vanilla**. Their positions are flame anchors (a fire effect,
    for the lights) when the texture or model name looks like fire, and each is also sent whole as
    an `Emitter` (`internal/wow/particles.go`, header `emitters`, below).
  - WMOs add their doodads' effects, emitters, ribbons and their own MOLT lights.
- **Particles** (B-182, ported from Benilla's `particles/`): `parseEmitters` reads each record (rate,
  gate and nine parameter tracks baked for the loop by `bakeTrack`, the client's key-window rule, not
  `readTrack`'s; over-life ramps, flipbook, twinkle, spin, tail, spline points) with a `Frame` from
  spawn space (WoW axes, before the client's 90° turn about +Z) to model space, moved with a WMO's
  doodad placement. `world/particles.ts` is the simulation (`ParticlePool`: spawn kernels, integrator,
  quad writer; world-space particles stay where born, flag 0x10 ones ride the emitter) and
  `world/ParticleLayer.ts` runs a pool per emitter of each placed object within `RANGE` and in view,
  frozen otherwise (an emitter whose object's origin is farther than `RANGE` plus its `reach`, the
  emitter's rest offset and the model's bounding diameter, is skipped before its bone math, #330), and draws one dynamic mesh per texture, blend, lighting and fog. Graphics › Particles
  (`prefs.particles`); with it on, `PropEffects` draws no procedural flame on a model that has
  emitters (its fire effects only light). With animations off the tracks hold at time 0 but the
  particles still fly. Spawns and the tools' previews run particles too (#110); a geometry emitter draws each particle as its model (`ModelCloud`, tumbling), a recursion emitter drives up to four child emitters of another model at its particles, and alpha draws are sorted back to front (#118). In 1.12's world models the geometry and recursion emitters are silent in the idle loop the editor plays.
- **Ribbons** (B-183, Benilla's `ribbons.rs`): `parseRibbons` (`internal/wow/ribbons.go`, header
  `ribbons`) reads the 0xDC records the same way (colour, alpha, heights and gate baked by
  `bakeTrack`, which takes n components). `world/ribbons.ts` (`RibbonTrail`) lays edges spanning the
  frame's +Y behind the point at `edgesPerSecond`, keeps each `edgeLifetime` in world space, raises
  them by gravity and draws the strip back from the point; `ParticleLayer` runs a trail per ribbon
  of each placed object beside the pools and in the same batches (unlit). A ribbon on a still bone
  draws nothing, as in the client, so with Prop animations off every ribbon is dark.
- Texture animation (B-168): each M2 batch's texture transform (header 0x74, lookup 0xAC, the batch's
  combo at +22) is read for the same loop as the bones into `Group.UV` (`UVAnim`: translation, raw
  quaternion, scaling; `Consolidate` keeps such groups apart). The frontend gives an animated group a
  material of its own with a copy of its texture (`assets.ts`, one GPU texture still) and sets the
  copy's matrix each frame from the client's law (`world/uvAnim.ts`; `updateMaterialAnimations` in
  `models/assets.ts`, called from `Engine.animateModels`): waterfalls and lava scroll as in the game. A batch's colour (0x54, by its
  colour index) and transparency weight (0x64 through 0xA4) work the same way (B-181, `Group.Color`,
  `ColorAnim`): Go drops a batch whose alpha times weight is a constant 0 or less (the client never
  draws it), and the frontend tints the group's own material and sets its opacity, hiding it at 0
  (`updateMaterialAnimations`). Those own materials are never cached, so an asset that is not kept
  (a thumbnail, the asset browser's and creature editor's previews) is handed to `releaseWowAsset`
  when done: it takes them out of the animated lists and disposes them with their texture copies
  (#506; a preview keeps them, and so animates, for as long as it shows the model). The kept models
  of a closed map go the same way through `releaseAssets` (#505, client.md).
- `world/Animator.ts` (`ModelAnimation`) poses the bones on the CPU per model type, and the shader
  skins the shared geometry from its skeleton's bone texture. All instances animate in sync. The
  Engine (`animateModels`) poses each frame only the types in `animatedAssets` that are drawn: a placed
  object or spawn the cull kept (`ObjectLayer.hasVisible`, `SpawnLayer.drawsType`; the cull keeps
  what is in a shadow camera's frustum too), or a placement, brush or paste preview (#328). A bone
  whose tracks hold one value, under parents that don't move either, keeps its first pose's matrix,
  and a model with no moving bone is posed once. The skeleton is a `PosedSkeleton`: its bones are
  already in model space, so its `update` (three calls it once a frame per skeleton drawn) skips
  three's multiply by the identity inverses and uploads the bone texture only after a new pose.
- `world/PropEffects.ts` draws the flames (instanced upright billboards with a procedural fire
  shader) and assigns a pool of `LIGHT_POOL` (8) `PointLight`s to the nearest light sources,
  with flicker. `selectNearest` finds those eight in one pass over the sources (a bounded
  insertion, ties to the lower index), not a sort of them all.
  - A prop's coincident light and flames merge into one light.
  - The nearest `SHADOW_LIGHTS` (3) cast cube shadows (even with the Shadows pref off) so they don't shine through walls. Their maps
    redraw only when a light gets another source or the objects or terrain change, one map a frame (a new
    light's first, ties round robin, so a drag or sculpt stroke redraws the three in turn), and culling keeps
    every model within their reach (`CullView.spheres`). The terrain shader applies them per light
    and reads the sun's shadow alone (`keyShadow`), not `getShadowMask`.
  - Lights inside a WMO's interior groups (`Effect.Interior`) get flames but no light: interiors are
    lit by their baked colours, so such a light would only show through the walls.
  - The terrain shader adds the point lights with three's falloff.
  - `ObjectLayer.shapeVersion` tells it when to rebuild; a move only (`movedSince`) rewrites the
    moved objects' sources and flames in place (`emit`, through each object's `Span`), since a move
    keeps how many each object gives. A rebuild reuses the `Source` objects and points each pooled light
    at its source's new index (`keepSlots`, by owner id and place), so a shadowed light keeps its map,
    marked out of date, rather than going dark for a frame (#511).
