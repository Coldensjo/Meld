# The WoW client and spawns

Reading the client's assets, and the server's creatures and objects: looks, editing, paths, pools, names and the creature and game object editors.

- The asset source is the user's **local** WoW 1.12 client. `internal/mpq` reads the archives
  (our own reader; `Gophercraft/mpq` is GPL, so don't add it). `internal/wow` decodes BLP, M2 and
  WMO files. `ReadPrefix` treats the block table as untrusted (#495): a file over 256 MiB unpacked
  or packed past the archive's end, a short read, or a sector that unpacks to any length but its
  own is an error (`errCorrupt`), never a huge allocation or a zero-filled or cut file.
- `wow.Client.Handler()` serves `/wow/{status,list,texture,model}` (and `wmonav`, a WMO's room data,
  and `collision`, a model's collision faces and a WMO's liquids for the walkable-ground view, `wow/collision.go`; `main.go`
  routes `/wow/navtile`, a tile of the server's movement maps, to `App.serveNavTile`, as it needs the
  VMaNGOS folder, see terrain.md's walkable ground, and `/wow/handoff?id=` to `App.handoffs`
  (`internal/handoff`): the binary part of a bound reply, served once, such as a region's alpha maps, #636). The handler is mounted via
  Wails `AssetServer.Middleware` in `main.go`, so it works in dev and prod. Both the handler and that
  middleware are wrapped in `wow.RecoverPanics`, which answers a panicking request with a 500 and logs
  it: Wails' desktop asset server runs each request with no recover, so a parser panic on a corrupt
  file would end the app (#487). Responses are binary:
  - Textures: `"RGBA" w h pixels`; with `fmt=dxt` (#178) a DXT BLP comes as `"DXT1"`/`"DXT3"`/`"DXT5"`
    w h, the mip count and each level's size and blocks (`Client.TextureDXT`), which `loadTexture`
    uploads as a `CompressedTexture` where the renderer has S3TC with sRGB.
  - Meshes: `Mesh.Encode()` = u32 header length, JSON header (padded to 4), pos, normal, uv, [colour
    u8x4], index (u32), [bone indices u8x4, bone weights u8x4], [rooms u16x2], [liquid pos, uv, info
    u8x4, body u8x4, rooms u16x2, index (u32)]; the header's `colors`, `bones`, `rooms` and
    `liquidVerts` say which optional sections follow. `parseMesh` (`wow/meshReply.ts`) reads it;
    `parseCollision` there reads `/wow/collision`, `decodeWmoNav` (`world/wmoRoom.ts`) `/wow/wmonav`
    and `parseNavTile` (`world/nav/navServer.ts`) `/wow/navtile`. Change an encoder and its parser
    together: the wire fixtures pin them (#520, docs/tests/client.md).
- The decoded replies stay in `Client.cache` (`bytecache.go`, an LRU bounded by `cacheLimit`, 512 MB: the oldest go first, #501; `TextureDXT` keeps an empty marker for a non-DXT BLP and serves the `tex:` entry) until a client change
  (`Client.Open`). A write into Meld's patch keeps them (#471): `vmangos.InstallPatch` closes the
  archives (`Suspend`) for its rename only, as Windows won't rename over a file Meld holds open, then
  `Resume` opens them again (listing their files again only when an archive changed) and `Forget`
  drops the replies built from the files the write changed; `AddPending` forgets the files it puts
  in the overlay. The app hands the client to vmangos with `vmangos.SetClientReader` in `NewApp`; a
  binding that writes the patch needs nothing else. `Suspend` waits for the reads in flight, and a
  read that comes while the archives are closed waits for the `Resume` (up to `suspendWait`, 60 s)
  instead of failing, which the frontend would draw as a placeholder for 30 s (#472); an `Open`
  (the sandbox's switch, an unload) ends the wait too.
- The doodads a WMO bakes in (`wmoMesh`) and their collision hulls (`wmoCollision`) are parsed once
  into `Client.parts` (`m2cache.go`, #500): an LRU of up to `partsLimit` (512) undressed M2 meshes
  and hulls by lower-case path, shared read-only (`wmoMesh` copies the arrays it transforms), so the
  next building with the same furniture, another doodad set or the collision request after the model
  reuse them. `Open` empties it, and so does a `Forget` naming any `.m2` or `.mdx` (a parsed doodad
  holds its particles' recursion models too); a `Forget` of other files keeps it.
- `InstallPatch` rebuilds Meld's patch on every write, but opens the old one once and streams it
  (#476): the files it carries over are `mpq.Entry`s whose bytes `mpq.Archive.Reader` reads straight
  from the old patch while `mpq.WriteTo` writes the new one beside it, so a one-file save holds only
  that file in memory, not the whole patch. `ChangedFiles` also opens the patch once, and skips
  reading a file whose size differs.

- The client path is persisted by `internal/config` (`os.UserConfigDir()/Meld/config.json`).
- Coordinates: WoW model space is Z-up. `toEditor(x,y,z) = (x, z, -y)` is a proper rotation, so
  triangle winding is unchanged. 1 world unit ≈ 1 yard.
- The 1.12 format's sizes (tile yards, chunks, cells, slots, liquid records, shadow bytes), the
  zero point and the map-to-server axis swap live once in `lib/wow/format.ts` (`toServer`,
  `fromServer`) and in Go in `internal/adt` (`ZeroPoint`, `ToServer`, `FromServer`, used by the
  spawn reads and writes). Use them rather than writing the sum out: the server's x is the zero
  point less the editor's z, its y the zero point less the editor's x (#538). The two sides are
  checked against each other by `frontend/tests/fixtures/format.json` (docs/tests/client.md).
- Frontend: `lib/models/assets.ts` is the registry for all placeable types.
  - `getAsset(type)` returns the asset immediately, or a placeholder while a WoW model loads.
  - `onAssetLoaded` lets `ObjectLayer` and the place-tool ghost swap the placeholder for the real
    mesh.
  - WoW meshes are one geometry with groups plus a material array, which keeps it at one
    `InstancedMesh` per type.
  - A model that fails to load is not cached: `loadAsset` warns and tries it again after `RETRY_MS`.
    A WMO's room data and a model's collision faces do the same through `wow/loadCache.ts`'s
    `LoadCache` (#515): a failure, the server's or the decoder's, is warned, counted (`failed`) and
    handed to `onFail` (the Engine's status bar and Log line), and the first ask after `RETRY_MS`
    loads it again.
    An M2 the client draws nothing of (no batch shown, no light, emitter or ribbon: an open door's
    collision blocker, an invisible trigger) is not a failure (#333): `ParseM2` returns
    `wow.ErrNothingToDraw`, `Client.Model` answers it with its collision hull as vertices and
    triangles and no groups (`nothingToDraw`), and `buildWowAsset` turns that into a ready asset with
    `marker` set: a grey see-through wireframe of the hull (a small diamond without one), loaded once,
    picked like any model, casting no shadow and left out of baked shadows. A spawn of one draws its
    hull in its kind's wireframe colour, as a spawn with no model does.
  - Closing a map lets go of its models (#505): `Engine.closeDocument` (and `setSpawns`, for spawns
    read again) hands `releaseModels` the types the map holds or draws (`MapDocument.modelTypes`: its
    objects and their batches, spawns and built tufts), with the models their particles are drawn as
    (`withParticleModels`). It leaves out those another open map, the place tool's prefab, the active
    doodad brush, a brush or paste preview or the clipboard uses, and `releaseAssets` disposes the rest:
    geometry, LOD, bounds tree, skeleton, the WMO group cull twin (on the geometry's dispose event)
    and the tuft twins (on their material's), and drops them from `animatedAssets`. A shared material
    goes when no remaining asset uses it, counting those still loading (`building`) and the thumbnails
    and previews not yet released (`loose`); a client texture goes (`api.ts` `releaseTexture`) when no
    remaining material maps it and only models asked for it (`loadTexture(path, true)`; liquids,
    particles and weather pin theirs). A type still loading is dropped when it arrives unless it is
    asked for again; `WmoRooms.forget` drops the closed WMOs' room data. A later `getAsset` loads a
    released model afresh. Anything new that keeps a mesh of a registry asset outside a document
    (a preview, a tool's ghost) must add its types to `releaseModels`' keep set.
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
- **Where a spawn stands** (#660): a creature or game object goes on the floor under the cursor,
  `ctx.floor()` (`Engine.floorHit`): the nearer of the terrain and `ObjectLayer.raycastFloor`, with
  the terrain see-through while the camera is under it (the ray march reports a hit at the camera
  there) or the terrain is hidden. The Place tool's template preview and click, dragging a spawn or
  a waypoint, and the spawn brush use it (`Engine.pick` aims the brush at it, and the brush's
  per-point height casts `raycastFloor` down, skipping a point with no floor when the ground is far
  overhead). Models keep `ctx.surface()`, which takes any surface. The answer is cached for 250 ms
  while the cursor and camera stay put. From above the ground, grass over a cave is still the
  ground: only an underground camera or hidden terrain looks through it.
- **Spawn editing** (`world/spawnEdits.ts`): spawns are edited in place in the `SpawnLayer`
  (keyed `kind/guid`), and every change is a `History` command. `SpawnLayer.touch` keeps a
  spawn's database state before its first edit, so `edits()` lists what changed (`SpawnChanges` re-compares only the spawns touched since the last count); File › Save Spawns to
  Database… (and Compile to Server and Compile All, #342) saves them with `ApplySpawnEdits` (SQL from `vmangos.SpawnSQL`, run through mariadb's stdin in
  one transaction, a copy kept in `<user cache>/Meld/spawn-sql`) or exports the SQL. A
  changed display, equipment or pose is re-dressed by `SpawnLook` in Go. A game object's entry can
  change (#136, `objectEntryFields`: entry, name, type, display, model and the template's size as
  its scale); the SQL then writes `gameobject.id`. A tilted game object (`gameobject.rotation0` or
  `rotation1` not 0, #229) carries `tilt`, its quaternion relative to its facing (`tiltOf` in
  `vmangos/sql.go`): `serverSpawn` turns it about Z by the facing again, so the SQL writes the
  database's rotation back unchanged unless the facing changed, and `spawnQuaternion`
  (`world/spawnTilt.ts`) draws it tilted. An object that only turns has none and is written as
  `facing(O)`. `editor.selectedSpawn`
  is always a copy (`cloneSpawn`), never the drawn spawn, since Svelte's proxy would not see edits
  to it. Select spawns through `selectSpawn`.
- **Pools** (`internal/vmangos/pools.go`, `world/pools.ts`, #136, #172): `ReadSpawns` gives each
  spawn its pool by guid (`pool_creature`, `pool_gameobject`, with `pool_template`'s limit and
  description: `Pool`, `PoolLimit`, `PoolName`), its chance in it (`PoolChance`), the pool's members
  outside the region (`PoolElsewhere`) and the pool's mother pool (`pool_pool`: `MotherPool`,
  `MotherLimit`, `MotherSize` pools, `MotherName`), such as a zone's master pool of vein spots. The
  veins that share a spot are one pool with a limit of 1, the server spawning one of them at a time.
  `PoolFields` (in `SpawnFields` and the Inspector) says what the server spawns, edits the limit,
  description and the spawn's chance, warns where VMaNGOS would reject the chances (`chanceProblem`,
  `PoolGroup::CheckValidity`), and lists the region's other members, which `Engine.updatePoolVisuals`
  outlines in cyan (`poolOutline`, a third `SelectionOutline`). Make pool takes the next entry
  (`NextPoolEntry`, above every one the database and the open regions use; entries stop at 65535) with
  a limit of 1; Join a pool and Add spawns on the map pick spawns (`ui.spawnPick`, below). A pool
  holds creatures or game objects, not both. The pool's limit and description ride on every member
  (a change is one step over the region's members, `poolSettingChanges`). The SQL (`poolSQL`) writes
  a changed membership as an upsert of the member row (or its delete) and a new or changed pool as
  `pool_template` rows (insert if missing, then update every patch row). A pool joins a mother pool
  by a pick (Join a master pool, `ui.spawnPick` mode `joinMother`: the clicked spawn's pool's mother,
  `joinMotherChanges`) and leaves it (`leaveMotherChanges`); the mother's fields ride on every spawn of
  its pools in the region, as the pool's limit does (`MotherSize` counts pools), and its limit is
  edited the same way (`motherLimitChanges`). The SQL (`motherSQL`, #261) upserts the pool's
  `pool_pool` row (chance 0; a pool can't be its own mother) or deletes it, and writes a changed
  mother limit to its `pool_template` rows. Pools by entry (`pool_gameobject_template`) are not read. View › Spawn pools (`prefs.showPools`)
  draws a ring and a post round every pooled spawn in its top pool's colour (the mother pool's, else
  its own; `poolHue`, `world/SpawnLinks.ts`) and `PoolLegend.svelte` lists the region's pools with
  "limit of size".
- **Formations** (`internal/vmangos/formations.go`, `world/formations.ts`, #172): `creature_groups`
  rows give a member `Leader`, its slot (`FollowDist` yards at `FollowAngle` radians from the
  leader's facing, counter-clockwise from above) and `GroupFlags` (VMaNGOS's `OptionFlags`, ORed into
  the group's options); a leader gets its own guid as `Leader`, whether or not it has its own row.
  The server puts a member at leader + (cos, sin)(angle + facing) × dist in its axes
  (`CreatureGroupMember::ComputeRelativePosition`), which is `slotPosition` in a region's. With a
  creature of a formation selected, `SpawnLinks` draws a line from the leader to each slot, a marker
  on it and a faint line on to the member when it stands elsewhere (a group without the walk flag has
  no slots: its lines go to the members). `FormationFields` lists the group and its flags; Lead a
  formation and Add followers on the map make each clicked creature follow in a slot where it stands
  (`joinChanges`), Follow another joins the clicked creature's leader, and a follower dragged (or moved
  by its fields, `slotFieldsAt` in the Select tool and `Engine.editSpawn`) takes its slot where it is
  dropped; the slot's own fields move it into the slot (`Engine.setFormationSlot`). Formations don't
  nest: a follower can't lead, and a leader with followers can't join another. The last follower
  leaving, Disband, and deleting the leader (`spawnDelete`) end the formation. The SQL
  (`formationSQL`) replaces a changed member's row, deletes a leaver's, deletes every row of a leader
  that stops leading, and a deleted creature's rows as member and leader.
- **Picking spawns on the map** (`ui.spawnPick`, `Engine.startSpawnPick`, `Engine.pickSpawn`): like
  path editing, the Select tool's click on a spawn goes to `pickSpawn` instead of selecting
  (`ObjectTools` hook), each click one undo step through `spawnsChange` (several spawns, one
  command); `SpawnPickBar.svelte` says what a click does, Esc or Done stops, and selecting another
  spawn ends it. There is no multi-spawn selection: building a formation or pool by clicks stands in
  for "select several, then Make".
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
  `SpawnLayer.version` changes only with the spawns, their models and the kinds shown; a spawn changed
  in place (`refresh`: a drag, a nudge) goes to the `moveSeq` log instead (`movedSince`, `changeStamp`
  for those that need either), so the labels, particles, paths and links update only what moved.
- **Creature editor** (`components/CreatureEditor.svelte`, `ui.creatureEditor`): full screen, opened
  by the right-click menu's Edit creature, the Inspector's Open editor, or a template's Edit. `CreaturePreview` draws the creature in its own renderer with
  any of its model's animations (`ModelAnimations`). Tabs: This spawn (`SpawnFields`, also shown in
  the game object editor; undo steps), Creature (every `creature_template` column: Go reads the columns
  and their types from the table and validates each value, `creatureFields.ts` only labels and
  groups them, and unknown columns land under Other), Looks (`DisplayPicker.svelte`: every display
  from `ListDisplays`, dressed and cached in Go, with the creature type and names of the templates
  using it, shown as asset-browser thumbnails in a virtualised grid with type chips, a model filter
  and search; hovering previews). New creature (this tab; Tools › Creatures… opens the same guide) opens
  the guide of `CreaturesWorkspace` (#260); Copy this creature in the header asks for a name and
  makes a copy (`CreateCreature`: the first free entry). Template edits are a form
  saved with Save (`SaveCreature`, the newest patch row), not undo steps;
  `Engine.applyCreatureTemplate` then brings that creature's spawns up to date through
  `SpawnLayer.rebase`, which changes their saved state too. A template's columns are drawn by
  `TemplateFields.svelte`, shared with the game object editor.
- **Spells** (`components/SpellsTab.svelte`, #243): the creature editor's tab for what the creature
  casts in combat, the eight slots of the `creature_spells` row its `spell_list_id` names
  (`internal/vmangos/creaturespells.go`: `ReadCreatureSpells`, `SaveCreatureSpells`), each with its
  chance, target (`lib/wow/creatureSpellNames.ts`, VMaNGOS's `TARGET_T_*` and `CF_*`), first and
  repeat delays in seconds and cast flags; `scriptId` and unknown targets are kept as read. Spells
  are found by name or ID in the client's Spell.dbc (`SearchSpells`, `SpellRefs` in `spelltext.go`:
  name, rank, SpellIcon.dbc's icon and the description with its tokens filled in; `lib/wow/spells.ts`
  caches them). The Add spells list (#340) shows a category's spells at once, 200 a page with Show
  more, narrowed by a school and the search (`ListSpells`, `SpellCategories` in `spelllist.go`):
  the creature abilities (spells in no `SkillLineAbility.dbc` row, the default), all spells, and each
  class skill line (named with its class from `SkillRaceClassInfo.dbc`, "Mage: Fire"), pet, profession
  and secondary skill line. Unnamed and leftover spells (test, OLD, zz, DND: `spellNoise`) are left
  out except by ID; the category `every`, which `SpellCategories` doesn't list, keeps them. The list is
  `components/SpellPicker.svelte` (#367), which every spell field shares: `onpick`, or a `row` snippet
  for a row of its own, a `memoryKey` under which the last category and school are kept a session,
  `start` (the first category) and `leftovers` (offers `every`). Save checks each spell against the server's `spell_template` and writes the whole
  row (`creatureSpellsSQL`): a list other templates share is never edited, the creature gets a new
  one (`freeSpellList`: entry*10 to entry*10+9 as VMaNGOS numbers them, else one past the highest),
  as does a creature with none; an emptied list deletes its own row and sets `spell_list_id` to 0.
  Like the Shop, a form with its own Save and Revert, not undo steps; the editor's `spell_list_id`
  follows the save. A list a script switches to (`creature_ai_scripts`) is not counted as shared.
- **Area triggers and teleporters** (#141, #306): `world/areaTriggers.ts` `AreaTriggerLayer` draws the
  open map's AreaTrigger.dbc volumes (`AreaTriggers` binding, with the world database's names and
  `areatrigger_teleport` rows) while View › Area triggers is on or the Portals dialog edits them, and
  keeps what it drew, so `Engine.openContextMenu` can pick a trigger with `world/teleport.ts`
  `pickTrigger` (only while drawn; one the camera is inside is skipped). `triggerWins` settles it
  against `pickNearest`'s hit: a placed model wins only in front of the trigger (a dungeon portal
  stands in its building), a spawn inside it too. The menu's Teleport to destination, and a
  spawn's Teleport items, call `io/mapio.ts` `teleportTo`. A spawn's items (#308) join its open menu
  above Focus when `SpawnTeleports` answers (`Engine.addSpawnTeleports`; `menuSeq` and the title
  drop an answer whose menu is gone): `internal/vmangos/teleport.go` gathers in one query every
  destination of a spell with a teleport effect (5) and a `spell_target_position` row, and every
  `TELEPORT_TO` (script command 6; a creature's own scripts with map 0 stay on its spawn's map) and
  cast of such a spell (command 15) in the scripts the spawn runs: its gossip menus and the menus
  they open (`gossip_scripts`), the quests it starts and ends, a creature's spell list, AI events
  and waypoints, an object's spell (spellcaster data0, goober data10), use (`gameobject_scripts`,
  by guid) and event (`event_scripts`). C++ scripts and scripts started by other scripts are out of
  reach. `teleportTo`: switch
  to a tab whose map and block hold the spot, else open the map (`blockAround`: up to 3x3 tiles
  round it, or `LoadBuildingMap` for a map with no tiles), then `Engine.viewSpot`. It moves Meld's
  view, not the game's character (Play here does that).
  A Select-tool left click that does not drag picks a trigger by the same rule (`Engine.triggerUnderPointer`,
  `finishTriggerClick`), and `ui.pickedTrigger` is the pick the Portals dialog follows and sets (#307).
- **Flight paths** (#180): `internal/vmangos/taxi.go` reads and writes the client's three taxi tables
  (`LoadTaxiTables`, `ReadTaxiNetwork`, `SetTaxi`; 1.12 layouts: TaxiNodes 16 fields with the Horde
  mount at 14 and the Alliance one at 15, TaxiPath 4, TaxiPathNode 9). VMaNGOS reads the stops from
  the world database's `taxi_nodes` (the row of the highest build up to 5875; `TaxiSQL` writes 5875)
  and the routes and their points from its own `data/5875/dbc` copies of TaxiPath.dbc and
  TaxiPathNode.dbc (`InstallServerTaxi`), so `App.SaveTaxi` writes all three: SQL first, then the
  patch (or the files waiting for the game, #661) and the server's tables, closing nothing; the
  result's `restart` tells the author to restart a running world server, which reads them only at
  its start. A stop's ID is 1 to 256 (the client's taxi mask); a route's points are rewritten
  whole, reusing its old point IDs. `components/FlightPathsWindow.svelte` (World › Flight Paths,
  `ui.flightPaths`) is a floating window, not a dialog, so the map stays in reach, and a form saved
  with Save, not undo steps (as Zones and Portals, decision #83). It hands its stops and routes to
  `Engine.showTaxi` with `TaxiHooks`; `world/TaxiLayer.ts` draws them (also for View › Flight paths,
  `prefs.showFlightPaths`) and picks markers, and `Engine.taxiPress` takes a left press before the
  tool: a stop's marker drags over the ground, the picked route's points drag level (Shift: up and
  down), and with Draw points a click adds a point after the picked one at its height
  (`taxiRoute.ts` `airPoint`); with Draw points off, a click on a route's drawn curve picks that route
  (`TaxiLayer.pickRoute`, `rayNearSegment`: the segment nearest the ray in angle, within a tolerance
  that grows with distance). A drag moves the layer's copy and the window hears of it once, on
  release. The window hands its whole network to `showTaxi` on every pick and edit, so
  `TaxiLayer.set` compares it with what it drew (`sameStops`, `sameRoute`) and redraws only the
  stops, the picked route or all routes as needed: a release after a drag redraws nothing (#588). `taxiRoute.ts` is the server's curve (uniform Catmull-Rom with the ends doubled, timed at
  32 yd/s segment by segment); the layer colours it red where it runs under the ground, and
  `Engine.flyTaxi` rides the camera along it (`ui.taxiFlying`, Esc stops). Make flight master sets
  npc_flags 8 on the selected creature's template through `SaveCreature`.
- **Game object editor** (`components/ObjectEditor.svelte`, `ui.objectEditor`, #136): the creature
  editor's counterpart, opened by the right-click menu's Edit object or the Inspector's Open editor,
  or by Tools › Game Objects… (`entry: 0`, no spawn), which opens on Find object (#351): the same
  template list and search as This spawn, shown whenever no spawn is selected, whose click opens that
  object (`{ key: null, entry }`) on its Object tab. New object on `entry: 0` sets `wantNew`, so the
  editor opens on its form instead. Tabs: This spawn (a list of the object templates, `loadObjectTemplates`, opened on the spawn's
  category such as Ore, whose click turns the spawn into that object as an undo step, then
  `SpawnFields`), Object (every `gameobject_template` column through the same Go code as creatures,
  `ReadObject`/`SaveObject`; `objectFields.ts` names data0 to data23 by the object's type, after
  mangos' GameObjectInfo), Display (#230: `DisplayPicker` with `kind="object"`, every
  GameObjectDisplayInfo row with a model from `ListObjectDisplays`, cached in Go with the object type
  and names of the templates using it, families by the model's folder; a click sets `displayId`,
  hovering previews it; the Go and frontend lists are forgotten on Save and New object, as their uses
  change), and New object (`CreateObject`). The Object tab follows the spawn's entry
  (an entry change or its undo). Save calls `Engine.applyObjectTemplate` (name, type, model through
  `ObjectModel`, size as scale) and forgets the Go and frontend object lists, so they are read again.
- **Quest editor** (`components/QuestEditor.svelte`, `ui.questEditor`, #259): full screen (over the
  creature editor, z-index 160; the creature and object editors ignore Esc while it is open), opened
  by Tools › Quests… (`entry: 0`, find one), a quest's Edit in the creature or game object editor's
  Quests tab, or that tab's New quest… (`entry: -1`, with the creature or object as `giver`). The left finds quests
  (`SearchQuests`); New quest makes a blank level 1 quest or a copy of the open one without its
  givers (`CreateQuest` in `internal/vmangos/quests.go`: patch 0, the first entry past
  `quest_template` and the four relation tables, so an orphan relation row can't offer it), and
  for a giver also saves it as the starter and ender (`SaveQuestGivers`). Every `quest_template`
  column goes through the template path (`ReadQuest`, `templateUpdateSQL`; `parseColumns` gives
  whole numbers their type's range, which `sqlValue` enforces for every template editor), laid out
  on tabs by `world/questFields.ts` (Quest, Objectives, Rewards, Requirements, Emotes and map, then
  Other for unlisted columns). A column that names something is a `ref` field
  (`components/RefField.svelte`): its number, the name (`lib/wow/refNames.ts`: `TemplateNames` in
  batches for items, creatures, objects and quests; `SpellRefs`; `QuestTables` for Faction.dbc,
  SkillLine.dbc and QuestSort.dbc; `Areas`; `SpawnEmotes`) and Find, which for a spell is a
  `SpellPicker` (#367; the creature's aura field, `AuraField.svelte`, has one too and adds the
  spell clicked). `ReqCreatureOrGOId` is a
  creature when positive and an object when negative, `ZoneOrSort` a zone or (negative) a quest sort.
  `SaveQuest` holds the row to `questRules` (after the server's `ObjectMgr::LoadQuests`: Method,
  SpecialFlags, a thing with its count, a reputation with its faction, no gap in the reward choices,
  which crashes the 1.12.1 client) and checks that what each changed reference names exists (the
  world database for templates and `spell_template`, the client for the rest); only the rules whose
  columns changed run, so an old quest's own problems don't block an unrelated edit. The Givers tab
  (`components/QuestGiversTab.svelte`) lists `creature_questrelation`, `gameobject_questrelation`
  and the two `*_involvedrelation` tables for the quest (`ReadQuestGivers`, with spawn counts), and
  gives a creature without the Quest giver flag that flag on Save unless its box is cleared. A game
  object must be of the Quest giver type (2; the server ignores the rows of any other type): another
  is refused, in the tab and in Go (`checkGiverObjects`), unless the quest already had it, and Meld
  never changes an object's type for the author (#293's decision). The one Save writes the row
  first, then the givers; `ui.questsVersion` then makes the creature and object editors' Quests tabs
  read their lists again.
- **Item editor** (`components/ItemEditor.svelte`, `ui.itemEditor`, #353): full screen (z-index 165),
  opened by Tools › Items… (`entry: 0`, find one; `-1`, a new item). The left finds items
  (`SearchItems`); a result's right-click opens `ui.contextMenu` (z-index 180, over the editor, whose
  Esc then leaves it to the menu) with Open and Copy `.additem <entry>`, the GM command that gives the
  item to the player selected or to yourself (`ClipboardSetText`); New item starts from a kind of item, a blank junk item or a copy of the open one: a kind is a
  (class, subclass, inventory type) group the world database has at least 3 of (`ListItemKinds` in
  `internal/vmangos/itemkinds.go`), shown as Class › Type (Weapon › Bow · Ranged (bow)), and
  `CreateItemOfKind` gives the new item those items' usual basics (`usualItemValues`: the most common
  look, sheath, material, ammo, range modifier, stacks and bag fields, the middle speed and
  durability) and no damage, armour, stats, effects, binding, level or price; every way makes patch
  0, the first entry past the table's (`CreateItem`). Every `item_template`
  column goes through the template path (`ReadItemTemplate`, `SaveItem`, `templateUpdateSQL`), laid
  out on tabs by `world/itemFields.ts` (Item, Combat, Stats, Effects, Requirements, More, then Other),
  whose subclass names follow the class; a group may set its grid's `columns` (Stats: 2, a stat's
  type beside its amount). The ten stat slots hold only 1.12's ITEM_MOD types (mana, health, the five
  attributes), so the Stats tab's Equip bonuses (`components/EquipBonuses.svelte`) give the rest
  (healing, spell damage, crit, hit, dodge, attack power, mana per 5…) as an Equip effect in a free
  `spellid_N` slot: `EquipBonuses` in `internal/vmangos/equipbonus.go` lists, per bonus, the
  client's item bonus spells by amount (passive, the generic icon 1, one aura, or two of the same
  amount for damage and healing (13 and 135) and attack power (99 and 124); the spells the world
  database's items already use win an amount). The right shows the item: `ItemModelLook` dresses a stand-in
  character of the chosen race and sex (`standIn`: the humanoid NPC display that wears the least;
  `plainLook` keeps only its skin, face and hair, without its bake or clothes) holding the item as
  `holdWeapons` holds a creature's (`gear`), or wearing it as `dress` does (a helm, shoulders, body
  armour or a cloak), and gives the item's model alone. Body armour has no model: the game paints it
  into the body texture, and so does Meld (#356, `internal/vmangos/bodyskin.go`): a character without
  a baked texture gets `bodyLayers` (face, underwear, facial hair and scalp from CharSections, then
  each worn item's ItemDisplayInfo fields 14-21 from `Item\TextureComponents\<Region>Texture\`,
  `_M`/`_F` before `_U`, in WoW Model Viewer's slot order and regions per slot), named as one texture
  path, `wow.ComposedTexture` (`compose:<region>=<path>|...`), which `/wow/texture` draws
  (`internal/wow/charskin.go`, the 256x256 layout's regions). A cloak is geoset 1501 plus its first
  group with its texture (field 3, `Item\ObjectComponents\Cape\`) in texture slot 2. Below it the tooltip (`components/ItemTooltipBox.svelte`, shared with the Shop
  tab's `ItemTooltip`) is `tooltipLines` over the unsaved values, so it follows every change;
  `itemTooltip.ts` follows the order of the client's tooltip builder as Benilla documents it
  (`benilla-ui/src/script/tooltip_item/render.rs`), and `items.ts` `itemTooltipNames` names the
  effects' spells and the required skill, spell and faction, and `itemSet` reads `set_id`'s set
  (`ItemSets`, `internal/vmangos/itemsets.go` over ItemSet.dbc; #355) with its members' names and
  its bonus spells' texts, which `tooltipLines` puts after the charges as the client's set block (all
  gray, since nothing is worn in an editor). The look is `display_id`, typed or picked
  with the right pane's Change look… and Change icon…, which turn the middle (in place of the field
  tabs, `changing`) into the item large over a grid (`components/ItemLookPicker.svelte`, virtualised
  as the creature editor's `DisplayPicker`): hovering a tile previews it there and in the tooltip, a
  click picks it, the bar's Change look or Change icon (or a double click) applies it and goes back,
  Cancel or Esc goes back without it. Change look shows the item alone (the stand-in again when
  leaving). Looks is every row of the client's ItemDisplayInfo.dbc (`ListItemDisplays` in
  `internal/vmangos/itemlooks.go`, with the items using each and a kind from their slots, or from the
  model's name for an unused one, and the model's path and skin, `displayModel`, for a rendered
  `PaletteTile`; a display without a model, such as body armour, is its icon), filtered to the item's
  slot (`itemFields.ts` `slotKind`, Go's `invKind`). Icons is every `Interface\Icons` file the client
  lists (`ListItemIcons`), item icons first. A ranged weapon's basic shot fires as its display's
  shot visual (ItemDisplayInfo field 10, which the game takes for Auto Shot: 5 a bow's, 743 a
  crossbow's, 224 a gun's), so each listed look has `visual` and `shoots`, the weapon subclass most of
  the database's items with that visual are (`shotSubclasses`); for a ranged item Fits it shows only
  looks that shoot like its subclass, and the right pane warns when the item's look shoots like
  another (Blizzard's display 35578 is a bow model with the crossbow's visual) with Make it shoot like
  a bow, a shot visual that waits for Save with the icon. A picked icon waits for Save, where `ItemDisplayVariant` finds the display that pairs the item's model
  and everything else with that icon and shot visual, or adds one (a copy of the item's display with the new icon,
  the next ID) to ItemDisplayInfo.dbc in Meld's patch (`installClientFiles`, waiting for a running game, #661), then
  `ForgetItemDisplays` drops the Go caches built from that table. Item tiles load their icons only
  once on screen (`ItemIcon` `lazy`).
  The icon grid (`components/IconGrid.svelte`, which `ItemLookPicker` shows for its icons; the same
  in the spell editor and the Icons tool, #683) has Import PNG… and Export … as PNG… (#364,
  `app_icons.go`, `internal/vmangos/icons.go`, `internal/wow/icon.go`). Import takes square PNG files,
  each named after its file (letters, digits, `_` and `-`, spaces as `_`), scaled to 64x64 by area
  (`resample`) and written as most of the client's icons are, DXT3 with mips (`EncodeOverlayBLP`), to
  `Interface\Icons\<name>.blp` in Meld's patch through `saveClientFiles` (at once, or once the game has
  closed, #365); a name the client has outside Meld's patch is refused, one Meld added before is
  replaced. A waiting icon is listed (`ListItemIcons` adds the pending files) and previewed: the asset
  server reads waiting `Interface\Icons` files first (`wow.Client.SetOverlay`, `vmangos.PendingIcon`).
  The imported icon is picked; a spell or item that takes it adds its SpellIcon.dbc or
  ItemDisplayInfo.dbc row on Save as for any icon. Export saves the icons the grid shows (all, or the
  search's matches) as `<name>.png` in a folder (`ExportIcons`, alpha kept).
  Export writes the item's every patch row to an SQL script of `REPLACE INTO item_template` with
  named columns (`ExportItems`); Import reads one back without running it (`sqlparse.go`
  `parseInserts`: only `INSERT`/`REPLACE INTO item_template` rows, other statements counted and
  skipped, columns the server lacks dropped), shows the plan (`PlanItemImport`: which rows replace
  existing ones) and writes it on confirmation (`ImportItems`, each value checked by `sqlValue`).
  The script code is shared with the spell editor's (`internal/vmangos/sqlscript.go`: a
  `scriptTable` names the table and its second key, `patch` or `build`).
  Save and Import mark the items stale (`game.Stale.AddItem`), so the client's `itemcache.wdb` and
  `itemnamecache.wdb` drop them, and forget the session's rows and names (`forgetItemRow`, `forgetName`).
- **Icons beside names** (#682): an item shows `ItemIcon` (its display, or an icon by name), a spell
  `SpellIcon` (its SpellIcon.dbc path), and a thing known only by its number `RefIcon` (looks the name
  up through `refNames` first). A field with `ref: 'item'` or `ref: 'spell'` gets its icon from
  `RefField`, so naming a column in `*Fields.ts` is how an editor field gets one (the spell editor's
  reagents and tools, an object's spell data columns: a `DATA_NAMES` name ending in "spell" or "aura").
  Classes: `ClassIcon` cuts a cell of the 1.12 client's only class atlas,
  `Interface\Glues\CharacterCreate\UI-CharacterCreate-Classes.blp` (`UI-Classes-Circles` is 2.x),
  where GlueXML's `CLASS_ICON_TCOORDS` cuts it (`lib/wow/classes.ts`, `classIcons.ts`, alpha kept). A
  field with `classes: 'mask'` (flag ticks, a ClassMask bit) or `classes: 'id'` (a select of class
  IDs) shows it in `TemplateFields`. A `<select>`'s options cannot hold images, so a select shows the
  picked value's icon beside it.
- **Icons tool** (`components/IconsWindow.svelte`, `ui.iconsTool`, #683): full screen (z-index 165),
  opened by Tools › Icons… (`{ icon: '' }`; a name opens it on that icon). The shared `IconGrid`
  (every icon by name, `iconsFirst="none"`, with Import PNG… and Export … as PNG…), and on the right
  the picked (or hovered) icon at 128 px, its name and path, Copy name, Copy spell icon ID and Export
  as PNG… of that one. An icon has no number of its own (it is a file): the owner's decision on #683
  (1A) is that the only ID copied is its SpellIcon.dbc row (`SpellsWithIcon`, `internal/vmangos/spells.go`:
  the lowest row naming `Interface\Icons\<name>` in any case, how many spells show it and a few by
  name), disabled when no row has it yet (the spell editor adds one when a spell first takes it).
  Items reach an icon through their ItemDisplayInfo.dbc display, so the tool only lists the items
  whose displays show it (from `ListItemDisplays`' `uses` and `names`; none without the world
  database). It writes nothing but the PNG import, through #364's path.
- **Spell editor** (`components/SpellEditor.svelte`, `ui.spellEditor`, #294): full screen (z-index 165),
  opened by Tools › Spells… (`entry: 0`, find one; `-1`, a new spell). A spell lives in two places:
  the server reads `spell_template` (VMaNGOS keeps no Spell.dbc; a row per entry and client build,
  the newest build up to 5875 used, `spellBuild`), the client draws it from Spell.dbc. The left
  browses the client's spells (`SpellPicker`, starting at `every`, leftovers included); a result's right-click copies `.cast <id>` or
  `.learn <id>`. `ReadSpell` (`internal/vmangos/spells.go`) reads the row the server uses, every
  column, laid out by `world/spellFields.ts` on tabs (Spell: text, casting, levels, rules; Effect 1-3;
  Other), with the effects, auras and targets named from VMaNGOS' `SpellDefines.h` and
  `SpellAuraDefines.h` and the cast time, duration, range and radius indexes from the client's
  tables (`ReadSpellTables`, `spelltables.go`). The right shows the icon (Change icon… turns the
  middle into the shared `IconGrid`, `iconsFirst="spells"`; the picked name waits for Save),
  the tooltip (`spellTooltip`: name and rank, cost and range, cast time and cooldown, the description
  with `expandSpellText`, the TypeScript twin of Go's), the effects in a line each and the visual
  (`spellVisual1`, typed or taken from a browsed spell's `SpellRef.Visual`, its other users named by
  `SpellsWithVisual`), or composed (#361, `components/SpellVisualComposer.svelte`, Compose… turning
  the middle into the composer as Change icon… does): the stages of a cast (precast, cast, channel,
  missile, impact, state, area), each taken from any spell (`ReadSpellVisual` gives a visual as a
  `VisualDesign`: each stage's kit and the effect on its ten attachment points, the missile's and the
  area's effect and the visual each came from) or changed one attachment point at a time from the
  client's effect models (`ListVisualEffects`: SpellVisualEffectName.dbc rows whose .m2 the client has),
  the hovered or picked model playing in a `CreaturePreview` (`m2:` type, with its particles). Use this
  visual leaves the design waiting (`pendingVisual`) for Save, where `planVisual`
  (`internal/vmangos/spellvisuals.go`) keeps a stage's kit when its effects are unchanged, else adds
  a kit (a copy of its own, or for an empty stage a new one of that stage's kind and animation), and
  keeps the visual when nothing changed, else reuses a client visual with the same fields, else adds
  one (a copy of the visual it was read from with the stages, missile and area set; a missile or area
  taken from another visual brings its path, attachment and sound). Rows other spells use are never
  changed. The layouts (SpellVisual 16 fields, SpellVisualKit 35, SpellVisualEffectName 5) are in the
  file's comment; `TestSpellVisualsLive` checks them against the client. `SaveSpell` (`app.go`) plans first (`PlanSpellSave`: the UPDATE by entry and
  build, a picked icon's SpellIcon.dbc row found or added by `spellIconRow`, then the whole row as it
  will be written into Spell.dbc by `spellClientRow` over the client's record), runs the SQL, has the
  running world server `.reload spell_template` through its SOAP console when it's on
  (`reloadSpells`, `vmangos.ReloadSpells`; else the server reads it at its next start), then writes
  the tables without closing anything (#365, `app_pending.go` `saveClientFiles`): into Meld's patch at
  once when the game isn't running, else into the waiting files in the user's cache
  (`internal/vmangos/pending.go`), which a watcher (`watchPending`, also started at Meld's start)
  writes once the game has closed, and which any patch write takes along
  (`vmangos.InstallWithPending`). Since #661 every client write goes this way (`installClient`): no
  save closes the game. Patch writes run one at a time
  (`patchMu` in `install.go`, held by `InstallPatch` and by `InstallWithPending` around reading,
  writing and dropping the waiting files), so the watcher never rebuilds the patch beside another
  write and drops its files (#657). Meld's own reads of the client's tables (`readOverlay`, through `readClientFile`,
  `loadSpellData` and the visual tables) see the waiting files first, so the editor shows the saved
  spell and the next save builds on it. The game reads Spell.dbc only at start, so it has the spell
  the next time it starts. `ForgetSpells` drops the Go caches. Export and Import (#357,
  `internal/vmangos/spellscripts.go`) work as the item editor's: Export writes every build's row of
  the spell as `REPLACE INTO spell_template` (`ExportSpells`), with `-- meld icon`, `-- meld visual`
  and `-- meld kit` comment lines after the header that carry what the rows' `spellIconId` and
  `spellVisual1` hold in the exporting client (the icon's texture path, the SpellVisual and
  SpellVisualKit records; #381, `spelllooks.go`), which a server running the script ignores. Import
  plans the script (`PlanSpellImport`: which rows replace existing ones, which spells the client's
  Spell.dbc already has, a build newer than 5875 that the server won't use, the icon and visual each
  row comes to (`planScriptLooks`: a carried icon or visual is the client's row of that ID when it
  holds the same, else any row that does, else a new row at the end; the effect, sound and missile
  IDs inside are taken as stock), and an icon or visual ID this client lacks that the script doesn't
  carry), then `ImportSpells` (`app.go`) rewrites the rows' IDs, runs them (`ImportSpellRows`),
  reloads the server's spells, and writes the added SpellIcon, SpellVisualKit and SpellVisual rows
  with each imported spell's Spell.dbc record, made from the row the server now uses
  (`SpellClientFiles`), through `saveClientFiles` as Save does. `spellDBCColumns`
  maps the 173 fields to columns: strings take all 8 locales, `spellFamilyFlags` two fields, the
  locale masks stay the client's (the server's are older builds'), and the server's own columns
  (`effectBonusCoefficient1-3`, `minTargetLevel`, `customFlags`, `script_name`) have none;
  `TestSpellColumnsMatchClient` checks it against every spell both have. New spell (`PlanCreateSpell`,
  the first entry neither side uses, the row and its Spell.dbc record written at once) copies the
  open spell (its build kept, `script_name` cleared) or starts from a starter (#360,
  `spellstarters.go`): Bolt, Instant strike, Heal, Damage over time, Buff or Area damage, every column
  filled in by `starterValues` (the columns' zeros, -1 for the spell power coefficients, the parts
  every spell shares, the starter's own values), its cast time, range, duration and radius rows
  picked by value from the client's tables (`pickOption`, never a scaled row; an index of 0 has no
  row, and some VMaNGOS code reads a range row without a check), its visual and icon those of a
  client spell of its kind found by name (`spellLook`), and the client record's locale masks the
  commonest of the client's (`commonSpellFields`). There is no all-zero spell: it would have no
  effect, target or range row. `putRecord` (`dbc.go`) replaces or adds a record and appends its
  strings, leaving every other row's.
- **Quests tab** (`components/QuestsTab.svelte`, #145, #293): the creature editor's and the game
  object editor's (`kind`), the quests the template starts and ends from its own side
  (`ReadCreatureQuests`/`SaveCreatureQuests`, `ReadObjectQuests`/`SaveObjectQuests` in
  `internal/vmangos/questrel.go`), a form with its own Save quests apart from the template's Save. A
  creature without the Quest giver flag is warned, with a button setting the flag; an object that is
  not a Quest giver (by its saved type) gets no new quests (`checkObjectQuests`) and says why. The server reads quests at start or on `.reload all_quest`.
- **The game's template cache** (#234): the 1.12 client asks for a template once and keeps it across
  sessions in `WDB\creaturecache.wdb` / `gameobjectcache.wdb`, never asking again. `SaveCreature` and
  `SaveObject` mark the entry in `App.stale` (`game.Stale`, `internal/game/cache.go`), which takes its
  records out of those files (and Benilla's name cache) while the game is closed: at once when it
  is, else in `Session.Start` before Meld starts the game. `SaveQuest` does the same for
  `WDB\questcache.wdb` (#259).
- **Contents** (`components/LootTab.svelte`, #220): the game object editor's tab for what a chest
  (type 3; veins and herbs are chests) or fishing hole (25) holds: the `gameobject_loot_template`
  rows of the list its `data1` names (`internal/vmangos/loot.go`: `ReadObjectLoot`, `SaveObjectLoot`,
  `NextObjectLoot`), with item search, icons and tooltips as in the Shop tab. It names the other
  templates holding the same list, with their spawn counts, and gives this object a copy of its own
  on asking (a new loot id, the rows kept). Make it a chest turns another type into a chest: type 3,
  lock 57 (Open and Treasure, an ordinary chest's), taken when looted (`data3`), a new empty list,
  the other data columns cleared. Like the template, the rows are a form: the editor's one Save
  writes the template first and then the rows (delete and insert, `lootSQL`); Revert reads them
  again. Respawn time is the spawn's own (`gameobject.spawntimesecsmin/max`), so the tab edits it
  through `editSpawn` as an undo step, as `SpawnFields` does; the template's restock time (`data2`)
  only counts for a chest that isn't taken when looted.
- Integration test: `WOW_DIR=/path/to/client go test ./internal/wow/ -v`.
