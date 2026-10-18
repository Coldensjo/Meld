# Creatures, objects and the server database

Spawns, the creature editor, paths, vendors and portals. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Gear picker (a spawn's main hand, off hand and ranged items)

Checks: `WeaponPicker.svelte` and the `ListWeapons` / `EquipmentFor` / `EquipmentItems` bindings. The
world database must be up (the picker reads item_template and writes creature_equip_template).

```js
const ed = await import('<editor.svelte.ts URL>'), se = await import('<spawnEdits.ts URL>')
const layer = __engine.activeDocument().spawnLayer; const s = layer.get('monster/106001')   // a Southsea Pirate
ed.editor.tool = 'select'; se.selectSpawn(s)
ed.ui.weaponPick = { key: 'monster/106001', slot: 1 }; ed.ui.dialog = 'weapon'   // 0 main hand, 1 off hand, 2 ranged
// then click a tile (or document.querySelector('[data-ui="WeaponPicker"] .tile').click())
layer.get('monster/106001').equipment, .equipItems, decodeURIComponent(look).match(/att=1:[^&]*/)
await window.go.main.App.EquipmentFor([14643, 1897, 0])   // finds or makes a template; run twice, same id
```

- Traps: thumbnails only render while frames run (`__engine.frame()` in a loop with short
  waits). `EquipmentFor` writes a creature_equip_template row for a new item combination, after
  the highest entry (987002 on this database): delete it again after a test, with its items in
  the WHERE clause. `editor.spawns` is a snapshot; read the layer's spawn for the edited state.

## Spawn tabs of the asset browser (Creatures, NPCs, Objects)

Checks: `SpawnBrowser.svelte` and the `ListCreatureTemplates` / `ListObjectTemplates` bindings (the
world database must be up). In the dev page:

```js
[...document.querySelectorAll('[data-ui="AssetBrowser"] .tab')].find(b => b.textContent.trim() === 'Creatures').click()
// drive frames for the thumbnails; then search, e.g. 'hogger', and read the tiles
const sb = document.querySelector('[data-ui="SpawnBrowser"]'); sb.querySelector('.tile').click()   // ui.placeCreature, tool 'place'
e.tools.place.onDown(e.ctx, hit, {})      // spawns it at `hit`; e.history.peek().label is 'Add Hogger'; e.undo() removes it
const pip = await import('<PipetteTool.ts URL>'); await pip.pickSpawn(editor.spawns[0])   // the pipette on a spawn
```

- Traps: a creature tile's badge is its level; the title holds entry, level, rank and type. The
  lists are cached in Go per server and client, so a changed template needs a restart to show.

## Game object editor: turning a spawn into another object, pools (#136)

Checks: `ObjectEditor.svelte`'s Which object list, `objectEntryFields`, the `gameobject.id` the SQL
writes, and the pool rows in `SpawnFields`. The probe `object-entry` does it on a flat map with two
veins of one pool laid down by hand (Small Thorium Vein 324 and Truesilver Deposit 2047, as guids
23510 and 23539 are in Silithus): the list opens on Ore, a click on the Truesilver row changes the
spawn (name, model; `SpawnEditSQL` sets the row's `id` to 2047), undo turns it back and the
editor's title follows. It needs the world database up, and takes about 6 s.

- In the real world: pool 22973 is the stack at server (-6420.68, 717.69) on map 1 (Silithus).
- The Object tab, New object and Save write to the world database: make a copy of 324, change its
  size, save, then check the spawn's scale and delete the row (`DELETE FROM gameobject_template WHERE
  entry = …`); the next free entry was 182122 on this database.
- Traps: `layer.get(key)` is the drawn spawn itself, which an undo changes in place; copy it before
  comparing. After adding a binding while `make dev` runs, the page may fail with "does not provide
  an export named …" (the stale `wailsjs` trap in docs/TESTS.md).

## Game object editor: Contents, Make it a chest, respawn (#220)

Checks: the Contents tab (`LootTab.svelte`) reads a chest's loot list with the other objects that
hold it, gives an object a copy of its own, adds items, makes another type a chest, and edits the
spawn's respawn time. Unit: `internal/vmangos/loot_test.go` (the SQL, refused rows, the parsers).
The probe `object-loot` does it all without writing: the Truesilver Deposit (2047) holds loot list
5045 (4 rows), shared with 150081 and 123309; a copy, an added Linen Cloth (searched as `2589`) and
Make it a chest on a generic object each show in Save's count and go with Revert. It takes about
30 s; it took 75 to 260 s, in stalls of 20 to 45 s, until `P.frames` waited for the GPU (#233).

- Saving, by hand: make a throwaway object (`CreateObject(0, 'Probe chest 220')`, entry 182122 on
  this database), spawn it on a flat map, Make it a chest, add 2589, Save; `ReadObject` then has
  type 3, data0 57, data1 18151 (the next free loot id), data3 1, and `ReadObjectLoot` the row.
  Clean up: `DELETE FROM gameobject_template WHERE entry >= 182122 AND name LIKE 'Probe chest%'`
  and `DELETE FROM gameobject_loot_template WHERE entry >= 18151`.
- The biggest shared list is 2283 (1074 rows, the Solid Chest 2855 and six other chests); the tab
  draws the first 150 rows until Show all.
- Traps: a save can take longer than 30 s in the headless page. The probe opens the editor from
  spawns it lays down, as `object-entry` does. An item icon (`texturePreview`) takes about 6 ms
  there on its CPU-backed canvas; on a GPU-backed one `toDataURL` waited for the viewport's frames,
  about 1 s an icon (#233).

## Tilted game objects (#229)

Checks: a game object's tilt (`gameobject.rotation0..3`) is read into `WorldSpawn.tilt`, drawn
(`spawnQuaternion`) and written back. Unit tests: `TestTiltedObjectKeepsItsTilt` in
`internal/vmangos/spawns_test.go` (read, JSON round trip, a move keeps the four values, a turn
turns them about Z) and `frontend/tests/spawnTilt.test.ts` (the drawn rotation turns each model
axis where the server's quaternion does). The probe `object-tilt` loads the real Sunken Chest
(guid 42485, Azeroth tile (36, 49), tilted about 16 degrees) onto a flat map, checks its drawn up
axis against the quaternion and that a move's SQL keeps `rotation0..3`. It needs the world database
up, and takes about 6 s.

- About 1400 of the 56644 objects on this database are tilted:
  `SELECT COUNT(*) FROM gameobject WHERE rotation0 <> 0 OR rotation1 <> 0`.
- Traps: Go reads the orientation as a float32 and the tilt is relative to that value, so the round
  trip is exact; computing a tilt from the float64 orientation would drift the sixth decimal.
  508 objects have rotation 0, 0, 0, 0; they count as untilted and are written as `facing(O)`.

## Names over spawns (#125)

Checks: `world/SpawnLabels.ts` puts names over the nearest drawn spawns (View › Names over creatures
and objects, `prefs.spawnNames`). In the dev page (GPU Chrome, as in "Minimap window (M)"), load
Azeroth 32_48, wait for the spawns (`e.doc.spawnLayer.spawns.length` is 347 with the server's
database up), then stand the camera at Deputy Willem:
`e.controller.setView(s.x, s.y, s.z, e.controller.yaw, 0.3, 28)` with
`s = e.doc.spawnLayer.spawns.find(x => x.name === 'Deputy Willem')`. After a second the visible
`.spawn-labels > div` read "Deputy Willem | Level 18", "Janos Hammerknuckle | <Weaponsmith> | Level 5"
and so on; those inside the abbey have none.
- A name the ground or a building (WMO) hides is left out (`Engine.sightBlocked`, through
  `ObjectLayer.wmoBlocks`): trees don't hide names. Wrap `e.spawnLabels.blocked` to count the tests;
  one costs about 0.04 ms, up to 96 a pick, four picks a second.
- Trap: a scene whose camera stands inside a building's wall (the abbey at `"target":[182,80,353]`,
  pitch 0.35, distance 45 does) hides every name, correctly; check the camera first.
- Setting `ed.prefs.spawnNames = false` from the page module hides them all.

## Right-click near the selected creature (#205)

Checks: `Engine.openContextMenu` falls back to the selected spawn when the click hits nothing within
`CONTEXT_MARGIN` (24) px of its screen box (`world/screenBox.ts`, unit test `screenBox.test.ts`). In the
dev page on Northshire, hide every placed model first (the abbey fills the view and takes the clicks:
`for (const id of e.objects.objects.keys()) e.objects.hidden.add(id); e.objects.markAllDirty()`), take
creatures from `e.doc.spawnLayer.forEachDrawn`, project `boundsOf(s, box)`'s corners, `selectSpawn(s)`
and call `e.openContextMenu({ clientX, clientY, pointerType: 'mouse', pressure: 0 })` 15 px right of the
box: `ui.contextMenu.title` is the creature's; 200 px right: no menu.

## Formations and spawn pools (#172)

Checks: `readFormations` and `readSpawnPools` (`go test ./internal/vmangos/ -run "Formation|Pool"`,
canned rows), `formationSQL` and `poolSQL` (`groupsql_test.go`), the slot maths and the pool rules
(`frontend/tests/formations.test.ts`), and in the app the probe `spawn-groups` (about 8 s, needs the
world database up): it reads Elwynn's patrols (tile 30, 48) and Redridge's master pools (36, 48)
through `LoadSpawns`, then on a flat map builds a formation (a real click in the viewport through
`P.click` at a creature's projected position, then `e.pickSpawn`), checks the slots and lines
(`e.links`), moves a follower by its fields, makes a pool (a real `NextPoolEntry`) and adds a vein,
puts the new pool into the master pool of a Redridge vein spot (a copy of the spot, by `pickSpawn` in
`joinMother` mode) and raises that master pool's limit (#261), reads the SQL from `SpawnEditSQL`
(`pool_pool` and the mother's `pool_template` limit among it) and undoes all seven steps. Nothing is
written. `TestMotherPoolSQL` checks the `pool_pool` SQL; it was also run on temporary copies of
`pool_pool` and `pool_template` in the `mysql` schema (MyISAM, so no rollback would undo it).

- Places in the world: tile 39, 30 (Hinterlands) has walking formations of Verdantine Boughguards
  (flags 11, slots 4 yd at 135° and 225°) and the Golden Sansam pool (7 of 18); tile 34, 46 (Burning
  Steppes) has groups with no walk flag (slots of 0 yd); tile 30, 48 (Stormwind) has the orphans'
  group of Miss Danna. `pool_pool` has master pools of up to 113 spots (Ashenvale tin and silver).
- To look: `bun run probe probes/scratch/<x>.js --shot <dir>` after `P.scene` of the region,
  `selectSpawn`, `P.e.controller.focus(x, z, 15)` and `prefs.spawnNames = false` (the names hide the
  thin lines); set `ui.dialog = null`, since the probe page may open Recover unsaved maps over the
  view. The pool outline only shows round members drawn with their model.
- Traps: in the rows checked (Stranglethorn's groups of leaders 51403, 51424 and 51427) the slots lie
  on the far side of the leader from where the members were spawned (the angle is about π off the
  spawn positions). The editor draws the server's formula, so a slot away from its member is the
  data, shown by the faint line, not a bug in `slotPosition`. `History.peek()` is null once an
  undo has run (it only sees the top of a stack with nothing to redo), so undo a known number of steps.

## Creature path editing on the map (#138)

Checks: the right-click "Edit path" / "Give it a path" on a creature and the floating `PathEditBar`.
In the dev page: `e.editPath('npc/<guid>')` (a key from `e.doc.spawnLayer.spawns`, `kind/guid`) shows
`.pathbar`; a ground press through `e.selectTool.onDown(e.ctx, e.hit, ev)` / `onUp` after setting
`e.ndc` and `e.raycaster` adds a point, and the bar's buttons are plain DOM clicks
(`[...document.querySelectorAll('.pathbar button')]`). A second press near the first point picks
it instead of adding one (`ctx.paths.pickPoint`), so space test presses apart.

## World event spawns (#143)

Checks: spawns of a world event (`WorldSpawn.events`, from `game_event_creature`/`_gameobject`) are
left out of `SpawnLayer`'s batches unless View › World events shows their event (`prefs.shownEvents`).
- Go against the real database: Azeroth 32_49 (Goldshire) has spawns of events 2 (Winter Veil),
  4 (Darkmoon Faire Elwynn), 12 and 28; 32_48 of 28 and 78. A throwaway test calling
  `ReadSpawns("C:/WoW/vmangos", "C:/WoW/client/Data", "Azeroth", 32, 49, 1)` lists them.
- Frontend in the dev page: set `events` on a few of `e.doc.spawnLayer.spawns`, call the layer's
  `rebuild()`, then `setEvents([...])`, and count `batches[].all.length`: a positive event's spawn
  shows only with it, a negative one leaves with it.
- `wails dev` rebuilds the Go side when a Go file changes, so a new binding usually works in the
  dev page after a reload; if it doesn't, see the stale `wailsjs` trap in `docs/TESTS.md`.

## Creature editor: Looks opens on the creature's display (#206)

Checks: `DisplayPicker.svelte` picks the selected display's type and model family and scrolls its
tile into view once the displays are read. In the dev page on Northshire, set
`ui.creatureEditor = { key: spawnKey(s), entry: s.entry }` for a drawn creature, click the Looks button
(retry until `.picker` exists: the record loads first), wait for
`[aria-label="Creature displays"] .virtual`, then read the two `.picker select`s and the `.active`
tile's rect against the grid's. A Northshire Guard opens on Humanoid / HumanMale, the wolves on
Beast / Wolf, each with its tile in view. The first read of the displays takes several seconds.

## Creature editor: Shop tab (npc_vendor, #145)

Checks: the Shop tab lists, adds, reorders and saves what a creature sells. Unit: `vendor_test.go`
(the SQL, slots, duplicates). Live, in the dev page: `ui.creatureEditor = { key: null, entry: 66 }`
(Tharynn Bouden, 17 items), click the Shop tab. To test a save without changing the user's world
database for good, use a creature with no shop (805, Cameron): add an item, Save shop, read it back
with `await window.go.main.App.ReadVendor(805)`, then remove it and save again (the table is back as
it was; `select count(*) from npc_vendor where entry=805` is 0).
- Trap: saving renumbers the slots 0..n in list order, so re-saving a real vendor's list as it was
  can still change its `slot` values. Test saves on a creature with no shop.
- Trap: the tab keeps its list while other tabs are shown (it stays mounted, hidden); its unsaved
  edits count in the editor's "unsaved changes" bar.
- The Quests tab (creature_questrelation / creature_involvedrelation) the same way: entry 197 (Marshal
  McBride) starts 10 and ends 4; test a save on 805 with Kobold Camp Cleanup (7) as start and end,
  read back with `ReadCreatureQuests(805)`, remove both and save again.
- Trap: after `wails generate module` the dev page can fail to mount (the body stays empty) because
  Vite keeps serving the old `wailsjs/go/main/App.js` without the new exports, even after an in-place
  rewrite. Deleting the file and copying it back (an add event for the watcher) fixed it; check with
  `curl localhost:34115/wailsjs/go/main/App.js | grep <NewBinding>`.
- The Messages tab (the greeting: gossip_menu, npc_text, broadcast_text): 931 reads gossip menu 6944,
  shared by 42 creatures ("Where would you like to fly to?", 2 options). A save adds rows to three
  tables and changes `creature_template`, so note `max(entry)` of broadcast_text and gossip_menu and
  `max(ID)` of npc_text first, save a greeting on 805, read it back with `ReadGossip(805)` (a new menu,
  shared by 1), then delete the rows above those maxima and set 805's `gossip_menu_id` and
  `npc_flags` back to 0.
- Gossip options (#158, `SaveGossipOptions`): 805 needs a greeting first (that makes its menu). Save
  two options on it and read them back; on 931 change option 1's text and save: it gets a copied menu
  (shared by 1), option 0 keeps broadcast text 12271 by ID and option 1 has its own text with ID 0.
  Clean up as above, plus `gossip_menu_option` rows of the new menus, and set 931's `gossip_menu_id`
  back to 6944 (931 has two patch rows). 931 also lists one AI line ("On aggro · yells Guards! Help
  me!") and warns that its quest option is hidden (it lacks the Quest giver flag).
- Trap: GossipDef.h's comments give later clients' npc flag values (vendor 128, flight 8192); 1.12's
  are in UnitDefines.h (vendor 4, flight 8), which the world database uses.

## Portals and area triggers (#141, #18)

Checks: World › Portals and Area Triggers… lists the open map's AreaTrigger.dbc volumes with the
server's names and teleports, draws them, and saves them to the client's patch and the world DB.
- Unit: `internal/vmangos/areatrigger_test.go` (edit, add and remove rows; IDs above the server's;
  the SQL). Against the client: `WOW_DIR=C:/WoW/client go test ./internal/vmangos/ -run TestClientAreaTriggers`
  writes the client's own table back byte for byte and finds trigger 78 (the Deadmines entrance)
  at about (-11208, 1675). The 1.12 layout (10 fields, 0x28 a row) is Benilla's `area_trigger.rs`.
- Live: the scene `{v:1,map:{region:{mapName:'Azeroth',x:28,y:53,size:1}}}`, camera on
  (-11208, 1675) in server coordinates (editor x = 32·533.33 − 1675 − 28·533.33, z = 32·533.33 +
  11208 − 53·533.33), then `ui.dialog = 'portals'`: "Eastern Kingdoms: 133 triggers", first
  "Deadmines - Entrance → 78", teleport to Deadmines (36) at level 10, and
  `__engine.triggerLayer.group` visible with the picked sphere's 192 points.
- Trap: a live Save writes Meld's patch-3.MPQ and closes the game and servers around it (as Zones
  does); don't run it in a check unless the owner wants that. The Go tests cover the write.

## Creatures workspace and the new-creature guide (#132)

Checks: World › Creatures… (`ui.creatures = true`): the search opens a creature in the editor, and
the guide's four steps make a working `creature_template` row. Unit: `factions_test.go` (reactions;
with `WOW_DIR`, the client's FactionTemplate.dbc: 14 hostile to both, 35 friendly to both, 12
Stormwind Alliance-only), `TestParseClassLevelStats`.
- Live: name it, level 10 to 12, rank Elite (multipliers 3, 2, 1), side Alliance (Stormwind, 11),
  click a display tile, then step 4 shows level 10 at 594 health, 30 damage, 492 armour (warrior:
  198, 15.2 and 492 from `creature_classlevelstats`). Make creature writes one row; check it with
  `ReadCreature(entry)` and delete it afterwards (`DELETE FROM creature_template WHERE entry = …`).
- Probe `creature-new` (#260): in the creature editor, New creature closes it and opens the guide, and Copy this creature shows its name bar (Cancel leaves; nothing is written).
- Probe `creature-looks` (#221): opens the guide to step 3 and checks the preview stays in view while the page scrolls past the pickers (it is sticky; the row once shrank to 520px and the pickers spilled over it).
- Trap: held items go through `EquipmentFor`, which may add a `creature_equip_template` row; leave
  the hands empty in a check, or delete that row too.

## Quest editor (#259)

Checks: World › Quests… finds and opens a quest, names every number that stands for something, and
writes `quest_template` and the four relation tables only on Save, after Go's checks.
- Probe `quest-editor` (about 12 s; nothing written): Wolves Across the Border (33) shows Northshire
  Valley, Tough Wolf Meat (750), the choices Soft Fur-lined Shoes and Wolfskin Bracers, Stormwind
  and the quest before it (Eagan Peltskinner, 5261), started and ended by Eagan Peltskinner (196);
  a level of 300 and item 16000000 are refused (the second jumps to the Objectives tab); Revert;
  then Edit in 196's Quests tab opens the quest over the creature editor, and Esc closes only the
  quest editor.
- Unit: `quests_test.go` (`checkQuest`'s rules on a fake lookup, `createQuestSQL`, the givers' SQL
  and the names' SQL). With `VMANGOS_DIR` and `WOW_DIR`, `TestQuestsLive` reads quest 7 (Kobold Camp
  Cleanup: 10 Kobold Vermin, given by Marshal McBride, 197) and the client's QuestSort (61 Warlock),
  SkillLine (164 Blacksmithing) and Faction (72 Stormwind) tables.
- A write, by hand in the dev page (a scratch probe): `ui.questEditor = { entry: -1, giver: { kind:
  'creature', id: 805, name: 'Cameron', ready: false } }`, a title, Make quest, then a level, a
  Details text with a line break, Target 1 = 6 with a count of 3, Save. Read it back with
  `ReadQuest(entry)`, `ReadQuestGivers(entry)` and `ReadCreatureQuests(805)` (805 has the Quest giver
  flag now), and copy it with `CreateQuest(entry, '…')` (the copy has no givers). Clean up:
  `DELETE FROM quest_template WHERE entry > <the max before>`, the same on `creature_questrelation`
  and `creature_involvedrelation` by `quest`, and `UPDATE creature_template SET npc_flags = 0 WHERE
  entry = 805` (both of its patch rows).
- Delete (#264): `TestDeleteQuestSQL` checks the SQL. Live, make a scratch quest (`CreateQuest(0,
  'x')`), add a `creature_questrelation` row and a `PrevQuestId = -<entry>` on another quest, then
  `PlanQuestDelete(entry)` lists both and `DeleteQuest(entry)` clears them (put the other quest's
  `PrevQuestId` back by hand, as the delete zeroes it). The header's Delete quest… shows the plan.
- In the game (the owner): `.reload all_quest` as a GM (or restart mangosd), talk to the giver,
  accept, complete and hand in the quest.
- Trap: quests are keyed by (entry, patch); the editor writes the newest patch row it read, and a
  new quest is patch 0, which every server patch loads.

## Name colours by reaction (#134)

Checks: a creature's name over its head is red, yellow or green by how its faction treats the side
picked under View (Alliance or Horde). Go: `TestReaction` (the two-way rule: a player's template is
hostile to the monster group, so a kobold whose own template attacks no one is still hostile).
Live on Northshire (Azeroth 32_48), `__engine.spawnLabels.nameColor(spawn)` for spawns found by name
in `doc.spawnLayer.spawns`: Alliance: Northshire Guard and Deputy Willem green, Kobold Vermin red,
Young Wolf and Rabbit yellow; Horde: the guard and Willem red too.

## Creature editor: Spells tab (creature_spells, #243)

Checks: the Spells tab lists a creature's spell list with the client's names, icons and text, finds
spells by name or ID, and adds, reorders and saves them. Probe: `bun run probe creature-spells`
(Scarlet Commander Mograine, 3976, list 39760: Crusader Strike and Hammer of Justice; a Fireball
search and add, the unsaved bar, Revert; nothing written; about 25 s in the headless page, 2 to 7
minutes before `P.frames` waited for the GPU, #233). Unit: `creaturespells_test.go` (the SQL for an own,
a shared, a new and an emptied list, the checks, the free list number) and, with `WOW_DIR` set,
`TestSpellRefsFromClient` (Spell.dbc's name, rank and icon fields).
- To test a save without changing the world database for good, use a creature with no list (805,
  Cameron): add a spell, Save spells, read it back with
  `await window.go.main.App.ReadCreatureSpells(805)` (list 8050), then remove it and save again (the
  row is deleted and `spell_list_id` is 0 again).
- A shared list: 35020 is used by 4 templates (`select entry from creature_template where
  spell_list_id = 35020`); a save on one of them gives it a new list and leaves 35020 alone.
- Trap: the world database's `creature_template` here has no `spell_id1..4` columns, so there are no
  legacy spell fields to show; `creatureFields.ts` labels only the ones present.

The Creature tab's spell columns (#255): `auras` lists each spell's icon and name under its text (`AuraField.svelte`), `spawn_spell_id` and `totem_spell_id` are RefFields. Probe: `bun run probe creature-spell-fields` (creature 215 has aura 6408, 2887 has spawn spell 10389).

## Shop tab: item icons and tooltips (#202)
Checks: every item in the creature editor's Shop tab (the shop's list, the search results, the shared
vendor list) has its inventory icon, and hovering one shows the game-style tooltip.
- Go: `TestParseVendorItems`, `TestParseItemRow`; with `WOW_DIR=C:/WoW/client`,
  `TestItemIconsFromClient` (display 8690, the Battleworn Hammer, is `INV_Hammer_15`).
- Frontend: `frontend/tests/itemTooltip.test.ts` (lines for a weapon, armour with stats, a bag; money).
- Dev page: `const ed = await import(<the editor.svelte.ts resource URL>); ed.ui.creatureEditor = { key: null, entry: 152 }`
  (Brother Danil, Northshire's general supplies), click the button whose text is `Shop`, wait for
  `td.item` (6 rows, 6 `img`). Hover: dispatch `new PointerEvent('pointerenter', { clientX, clientY })`
  on a `td.item` or a `.results button`, then read `.tip`'s text. Searching: set `input.search`'s value
  and dispatch `input` (bubbling); 100 results for "hammer", each with an icon.
- Effects show the spell's own text (#217): Tough Hunk of Bread (4540, spell 433) reads "Use: Restores 61 health over 18 sec.  Must remain seated while eating." Go: with `WOW_DIR=C:/WoW/client`, `TestSpellTextsFromClient` checks Spell.dbc's field layout (description at field 138). Trap: an aura with no period of its own counts every 5 sec for `$o1` (17 per tick over 18 sec is 61).
