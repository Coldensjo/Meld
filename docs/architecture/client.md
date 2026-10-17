# The WoW client and spawns

Reading the client's assets, and the server's creatures and objects: looks, editing, paths, pools, names and the creature and game object editors.

- The asset source is the user's **local** WoW 1.12 client. `internal/mpq` reads the archives
  (our own reader; `Gophercraft/mpq` is GPL, so don't add it). `internal/wow` decodes BLP, M2 and
  WMO files.
- `wow.Client.Handler()` serves `/wow/{status,list,texture,model}` (and `wmonav`, a WMO's room data,
  and `collision`, a model's collision faces for the walkable-ground view, `wow/collision.go`). The handler is mounted via
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
  spawn's database state before its first edit, so `edits()` lists what changed; File › Save Spawns to
  Database… saves them with `ApplySpawnEdits` (SQL from `vmangos.SpawnSQL`, run through mariadb's stdin in
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
  `pool_template` rows (insert if missing, then update every patch row). Mother pools are read only;
  pools by entry (`pool_gameobject_template`) are not read. View › Spawn pools (`prefs.showPools`)
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
- **Creature editor** (`components/CreatureEditor.svelte`, `ui.creatureEditor`): full screen, opened
  by the right-click menu's Edit creature, the Inspector's Open editor, or a template's Edit. `CreaturePreview` draws the creature in its own renderer with
  any of its model's animations (`ModelAnimations`). Tabs: This spawn (`SpawnFields`, also shown in
  the game object editor; undo steps), Creature (every `creature_template` column: Go reads the columns
  and their types from the table and validates each value, `creatureFields.ts` only labels and
  groups them, and unknown columns land under Other), Looks (`DisplayPicker.svelte`: every display
  from `ListDisplays`, dressed and cached in Go, with the creature type and names of the templates
  using it, shown as asset-browser thumbnails in a virtualised grid with type chips, a model filter
  and search; hovering previews). New creature (this tab; World › Creatures… opens the same guide) opens
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
  caches them). Save checks each spell against the server's `spell_template` and writes the whole
  row (`creatureSpellsSQL`): a list other templates share is never edited, the creature gets a new
  one (`freeSpellList`: entry*10 to entry*10+9 as VMaNGOS numbers them, else one past the highest),
  as does a creature with none; an emptied list deletes its own row and sets `spell_list_id` to 0.
  Like the Shop, a form with its own Save and Revert, not undo steps; the editor's `spell_list_id`
  follows the save. A list a script switches to (`creature_ai_scripts`) is not counted as shared.
- **Game object editor** (`components/ObjectEditor.svelte`, `ui.objectEditor`, #136): the creature
  editor's counterpart, opened by the right-click menu's Edit object or the Inspector's Open editor.
  Tabs: This spawn (a list of the object templates, `loadObjectTemplates`, opened on the spawn's
  category such as Ore, whose click turns the spawn into that object as an undo step, then
  `SpawnFields`), Object (every `gameobject_template` column through the same Go code as creatures,
  `ReadObject`/`SaveObject`; `objectFields.ts` names data0 to data23 by the object's type, after
  mangos' GameObjectInfo), and New object (`CreateObject`). The Object tab follows the spawn's entry
  (an entry change or its undo). Save calls `Engine.applyObjectTemplate` (name, type, model through
  `ObjectModel`, size as scale) and forgets the Go and frontend object lists, so they are read again.
- **Quest editor** (`components/QuestEditor.svelte`, `ui.questEditor`, #259): full screen (over the
  creature editor, z-index 160; the creature and object editors ignore Esc while it is open), opened
  by World › Quests… (`entry: 0`, find one), a quest's Edit in the creature editor's Quests tab, or
  that tab's New quest… (`entry: -1`, with the creature as `giver`). The left finds quests
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
  SkillLine.dbc and QuestSort.dbc; `Areas`; `SpawnEmotes`) and Find. `ReqCreatureOrGOId` is a
  creature when positive and an object when negative, `ZoneOrSort` a zone or (negative) a quest sort.
  `SaveQuest` holds the row to `questRules` (after the server's `ObjectMgr::LoadQuests`: Method,
  SpecialFlags, a thing with its count, a reputation with its faction, no gap in the reward choices,
  which crashes the 1.12.1 client) and checks that what each changed reference names exists (the
  world database for templates and `spell_template`, the client for the rest); only the rules whose
  columns changed run, so an old quest's own problems don't block an unrelated edit. The Givers tab
  (`components/QuestGiversTab.svelte`) lists `creature_questrelation`, `gameobject_questrelation`
  and the two `*_involvedrelation` tables for the quest (`ReadQuestGivers`, with spawn counts), and
  gives a creature without the Quest giver flag that flag on Save unless its box is cleared. The one
  Save writes the row first, then the givers; `ui.questsVersion` then makes the creature editor's
  Quests tab read its lists again. The server reads quests at start or on `.reload all_quest`.
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
