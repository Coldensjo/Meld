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
  - Each loaded model gets a three-mesh-bvh bounds tree (`world/bvh.ts`), which `pick` and
    `raycastSurface` cast through.
  - Each loaded model may also get a meshoptimizer LOD (`models/lod.ts`): a second index over the
    same vertices, drawn by a second InstancedMesh for instances under `LOD_PX` on screen
    (`splitLod` in `instanceCull.ts`). The LOD shares the full model's bounds tree, so picking
    always hits the full model.
  - A big WMO (20k triangles and 4 groups or more) drawn once is culled by group for the scene pass
    and the near shadow cascade (#198, #215, `world/wmoGroupCull.ts`): its batch mesh draws a twin of
    the model's geometry (the same vertex buffers, an index of the model's triangles sorted by WMO
    group, then a half rewritten with the runs of the groups whose boxes meet the camera's frustum or
    the near cascade's, `CullView.shadowFrustum`). `onBeforeRender` points each material's draw at that
    half for the view camera, and `onBeforeShadow` for the near cascade's shadow camera (told apart by
    its `shadowCamera` argument; its `camera` is the view's). The far cascade, redrawn only when its fit
    changes, and the point lights' cubes keep the whole model. The near cascade lies mostly in view, so
    the two share one half instead of a third (16 MB for Stormwind).
  - Objects store `x, z, yOff, rotY, scale`. Y is always `terrain height + yOff`, re-snapped after
    sculpting. A tilted one also has `tiltX`/`tiltZ`, the MDDF/MODF record's first and third angles,
    turned in the client's order by `world/placement.ts` (`placementEuler`); build every model
    rotation through it.
  - **WMO rooms** (#8, from Benilla's `wmo_portal`): `world/WmoRooms.ts` finds the room (group) of the
    placed WMO the camera is in with the client's down-ray (`wmoRoom.ts`, room data from `/wow/wmonav`),
    `wmoFlood.ts` runs the portal flood from it each frame and `wmoFog.ts` picks the room's MFOG fog
    and its 4 s fade. `roomGate.ts` applies both in the shared WMO materials: WMO vertices carry their
    group (`wmoRoom` attribute, Go's `Mesh.Room`), and the instance at the room's origin hides the
    groups the flood didn't reach and fogs the reached interiors with the room fog. The 15 nearest
    other WMOs with portals in view are flooded from outside (`WmoRooms.outside`, every exterior group
    a root, but never a WMO-only map's building, whose groups are all interior and which then draws
    whole from outside, #271), each in its own row of the gate's mask, so an interior shows only through a doorway; a
    doodad carries up to two groups (`Mesh.Room` has two a vertex). From inside, the open world shows only
    through the flood's exterior windows (#116, `CullView.gate`, `Terrain.gate`, the particles): a
    model, spawn, terrain chunk or emitter must meet a doorway's narrowed frustum, and a sealed room
    shows none, as in the client. What stands in a room the flood reached passes anyway (#156,
    `world/roomAdmit.ts`: its room by the camera's down-ray from its sphere's centre, cached per
    position), so the creatures and models in the camera's room stay drawn. Spawns are left out of the gate while View › Creatures and objects through
    walls is on (`prefs.spawnsThroughWalls`, the default, #150). The liquids, the sea and the grass tufts are gated too (#119: `LiquidRenderer.gate`,
    `Water.gate`, `GroundEffectLayer.gate`, which packs from the last build's full set).

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
  frozen otherwise, and draws one dynamic mesh per texture, blend, lighting and fog. Graphics › Particles
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
  copy's matrix each frame from the client's law (`world/uvAnim.ts`, `updateUVAnimations`, called from
  `Engine.animateModels`): waterfalls and lava scroll as in the game. A batch's colour (0x54, by its
  colour index) and transparency weight (0x64 through 0xA4) work the same way (B-181, `Group.Color`,
  `ColorAnim`): Go drops a batch whose alpha times weight is a constant 0 or less (the client never
  draws it), and the frontend tints the group's own material and sets its opacity, hiding it at 0
  (`updateMaterialAnimations`).
- `world/Animator.ts` (`ModelAnimation`) CPU-skins the shared geometry per model type. All
  instances animate in sync. The Engine drives `animatedAssets` each frame.
- `world/PropEffects.ts` draws the flames (instanced upright billboards with a procedural fire
  shader) and assigns a pool of `LIGHT_POOL` (8) `PointLight`s to the nearest light sources,
  with flicker.
  - A prop's coincident light and flames merge into one light.
  - The nearest `SHADOW_LIGHTS` (3) cast cube shadows (even with the Shadows pref off) so they don't shine through walls. Their maps
    redraw only when a light gets another source or the objects or terrain change, and culling keeps
    every model within their reach (`CullView.spheres`). The terrain shader applies them per light
    and reads the sun's shadow alone (`keyShadow`), not `getShadowMask`.
  - Lights inside a WMO's interior groups (`Effect.Interior`) get flames but no light: interiors are
    lit by their baked colours, so such a light would only show through the walls.
  - The terrain shader adds the point lights with three's falloff.
  - `ObjectLayer.version` tells it when to rebuild.
