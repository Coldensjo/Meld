# The WoW client and spawns

Reading the client's assets, and the server's creatures and objects: looks, editing, paths, pools, names and the creature and game object editors.

- The asset source is the user's **local** WoW 1.12 client. `internal/mpq` reads the archives
  (our own reader; `Gophercraft/mpq` is GPL, so don't add it). `internal/wow` decodes BLP, M2 and
  WMO files.
- `wow.Client.Handler()` serves `/wow/{status,list,texture,model}`. The handler is mounted via
  Wails `AssetServer.Middleware` in `main.go`, so it works in dev and prod. Responses are binary:
  - Textures: `"RGBA" w h pixels`; with `fmt=dxt` (#178) a DXT BLP comes as `"DXT1"`/`"DXT3"`/`"DXT5"`
    w h, the mip count and each level's size and blocks (`Client.TextureDXT`), which `loadTexture`
    uploads as a `CompressedTexture` where the renderer has S3TC with sRGB.
  - Meshes: `Mesh.Encode()` = JSON header + pos/normal/uv/[color]/u32 index.

- The client path is persisted by `internal/config` (`os.UserConfigDir()/Meld/config.json`).
- Coordinates: WoW model space is Z-up. `toEditor(x,y,z) = (x, z, -y)` is a proper rotation, so
  triangle winding is unchanged. 1 world unit ≈ 1 yard.
- Frontend: `lib/models/assets.ts` is the registry for all placeable types.
  - `getAsset(type)` returns the asset immediately, or a placeholder while a WoW model loads.
  - `onAssetLoaded` lets `ObjectLayer` and the place-tool ghost swap the placeholder for the real
    mesh.
  - WoW meshes are one geometry with groups plus a material array, which keeps it at one
    `InstancedMesh` per type.
  - A placed WMO's doodad set rides in its type, `wmo:<path>?set=<n>` (`models/wmoSet.ts`): the model
    endpoint bakes set 0 and that set (`WMORoot.DoodadsOf`), and the export writes it as the MODF doodad
    set (`vmangos/modeltype.go`). A bare `wmo:` type in a region keeps the client's set on save. A WMO group flagged interior (`Group.Interior`, from MOGP flag
    0x2000) gets an unlit `MeshBasicMaterial` lit by its baked MOCV vertex colours, as in the game,
    so the sun, sky and shadows never reach the inside of a cave or building.

- **Spawn looks** (`internal/vmangos/looks.go`, `internal/wow/look.go`): a creature spawn's
  display is resolved in Go into a `wow.Look`: textures per replaceable M2 texture type (bake,
  hair, fur, creature skins), the character geosets shown (hair, facial hair, gear from
  ItemDisplayInfo, hidden under a helmet by HelmetGeosetVisData's race masks), item models at
  attachment points (helm, shoulders, weapons by sheath state) and the pose's animation
  (creature_addon stand state or emote, via Emotes.dbc). It travels as the model endpoint's query
  (`spawnType` in `world/spawnInfo.ts`), so each look is one cached mesh and one InstancedMesh.
  Items are welded on in Go (`Mesh.Attach`) and bound to the attachment's bone, so GPU skinning
  carries them.
- **Spawn editing** (`world/spawnEdits.ts`): spawns are edited in place in the `SpawnLayer`
  (keyed `kind/guid`), and every change is a `History` command. `SpawnLayer.touch` keeps a
  spawn's database state before its first edit, so `edits()` lists what changed; the Spawns panel
  saves them with `ApplySpawnEdits` (SQL from `vmangos.SpawnSQL`, run through mariadb's stdin in
  one transaction, a copy kept in `<user cache>/Meld/spawn-sql`) or exports the SQL. A
  changed display, equipment or pose is re-dressed by `SpawnLook` in Go. A game object's entry can
  change (#136, `objectEntryFields`: entry, name, type, display, model and the template's size as
  its scale); the SQL then writes `gameobject.id`. `editor.selectedSpawn`
  is always a copy (`cloneSpawn`), never the drawn spawn, since Svelte's proxy would not see edits
  to it. Select spawns through `selectSpawn`.
- **Pools** (`internal/vmangos/pools.go`): `ReadSpawns` gives each spawn its pool by guid
  (`pool_creature`, `pool_gameobject`, with `pool_template`'s limit and description: `Pool`,
  `PoolLimit`, `PoolName`). The veins that share a spot are one pool with a limit of 1, the server
  spawning one of them at a time. `SpawnFields` lists the region's other spawns of the pool, a click
  selecting one. Pools by entry (`pool_gameobject_template`) and mother pools (`pool_pool`) are not read.
- **Waypoints**: `WorldSpawn.waypoints` is a creature's main path (`creature_movement`,
  `path_id` 0), or its template's (`creature_movement_template`, `pathFromTemplate`) when it walks
  waypoints without its own. `world/SpawnPaths.ts` draws the selected creature's path (and all
  paths with View › All creature paths) with pickable point markers. With `ui.pathEdit` on, the
  Select tool adds points on the ground after `editor.selectedWaypoint`, drags them, and Delete
  removes one. Paths are replaced immutably (`withPoint`), so undo can keep the old array. A
  changed path is saved as the spawn's own `creature_movement` rows.
- **Spawn names** (`world/SpawnLabels.ts`, View › Names over creatures and objects, `prefs.spawnNames`):
  DOM labels over the canvas for the 48 nearest spawns the cull drew (`SpawnLayer.forEachDrawn`), with
  the name in the kind's colour, the subname and a creature's level and rank, picked four times a second
  and left out where the ground or a building hides them (`Engine.sightBlocked`, `ObjectLayer.wmoBlocks`).
- **Creature editor** (`components/CreatureEditor.svelte`, `ui.creatureEditor`): full screen, opened
  by the right-click menu's Edit creature, the panel's Open editor, or a template's Edit. `CreaturePreview` draws the creature in its own renderer with
  any of its model's animations (`ModelAnimations`). Tabs: This spawn (`SpawnFields`, shared with
  the Spawns panel; undo steps), Creature (every `creature_template` column: Go reads the columns
  and their types from the table and validates each value, `creatureFields.ts` only labels and
  groups them, and unknown columns land under Other), Looks (`DisplayPicker.svelte`: every display
  from `ListDisplays`, dressed and cached in Go, with the creature type and names of the templates
  using it, shown as asset-browser thumbnails in a virtualised grid with type chips, a model filter
  and search; hovering previews), and New creature
  (`CreateCreature`: the first free entry, from scratch or a copy). Template edits are a form
  saved with Save (`SaveCreature`, the newest patch row), not undo steps;
  `Engine.applyCreatureTemplate` then brings that creature's spawns up to date through
  `SpawnLayer.rebase`, which changes their saved state too. A template's columns are drawn by
  `TemplateFields.svelte`, shared with the game object editor.
- **Game object editor** (`components/ObjectEditor.svelte`, `ui.objectEditor`, #136): the creature
  editor's counterpart, opened by the right-click menu's Edit object or the panel's Open editor.
  Tabs: This spawn (a list of the object templates, `loadObjectTemplates`, opened on the spawn's
  category such as Ore, whose click turns the spawn into that object as an undo step, then
  `SpawnFields`), Object (every `gameobject_template` column through the same Go code as creatures,
  `ReadObject`/`SaveObject`; `objectFields.ts` names data0 to data23 by the object's type, after
  mangos' GameObjectInfo), and New object (`CreateObject`). The Object tab follows the spawn's entry
  (an entry change or its undo). Save calls `Engine.applyObjectTemplate` (name, type, model through
  `ObjectModel`, size as scale) and forgets the Go and frontend object lists, so they are read again.
- Integration test: `WOW_DIR=/path/to/client go test ./internal/wow/ -v`.
