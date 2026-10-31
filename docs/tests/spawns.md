# Creatures, objects and the server database

Spawns, the creature editor, paths, vendors and portals. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Spawn save: the edit list (#199, #432)

No probe: the unit test below.

Checks: `SpawnLayer.edits()`, built through `spawnEdits.ts`'s commands (`spawnAdd`, `spawnChange`,
`spawnDelete`), gives one edit per spawn, and a DELETE only for a row the document loaded or saved,
keyed by that row's own guid and entry (never a created spawn's, nor the entry a retype gave it).
Unit: `bun test tests/spawnLayerEdits.test.ts`: fixed cases plus 300 seeded random sequences of add,
move, retype, delete, undo, redo and save, each save applied to a model database that must end as the
editor shows it. A failure prints the seed and the sequence. The Go half (a created guid taken in the
database before the save) is `TestCreatedGUIDLive` in `internal/vmangos`, which needs the database.
- Trap: `SpawnLayer` reaches `editor.svelte.ts`, so the test sets `globalThis.$state` before a dynamic
  import, as `objectLayer.test.ts` does.

## Spawn actions: new guids and pool entries (#557)

No probe of its own: the unit test below; the probes listed below run it in the app.

Checks: `engine/SpawnActions.ts`, the spawn editing out of Engine. A new spawn's guid is above every
open tab's spawns of its kind (monsters and NPCs share creature guids, objects have their own) and at
least the database's next one (`nextFreeGuid`); a new pool's entry likewise (`nextFreePoolEntry`).
Unit: `bun test tests/spawnActions.test.ts`, which also runs pool picking, the spawn keys and the
spawn's right-click menu on a fake `SpawnHost`. Live: the `spawn-groups`, `creature-spells`, `compile-spawns`,
`teleport-trigger` and `place-spawn-size` probes, which name the file in their `// touches:` lines.
- Trap: the actions that read the world database (placing, the brush's first guid, a new pool, the
  menu's Teleport items) call Go bindings, which `bun test` lacks; don't define `window` to stub them,
  since `modelBuild.ts` and `navJobs.ts` check `typeof window` when loaded. They are the probes' part.

## Gear picker (a spawn's main hand, off hand and ranged items)

Hand check: in the dev page against the world database, as below.

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

- Traps: thumbnails only render while frames run (`__engine.debug.frame()` in a loop with short
  waits). `EquipmentFor` writes a creature_equip_template row for a new item combination, after
  the highest entry (987002 on this database; refused with the sandbox on, like every world-database write): delete it again after a test, with its items in
  the WHERE clause. `editor.spawns` is a snapshot; read the layer's spawn for the edited state.

## Spawn tabs of the asset browser (Creatures, NPCs, Objects)

Hand check: in the dev page against the world database, as below.

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

## Sorting the creature tabs by level (#659)

Hand check: in the dev page against the world database, as below.

Checks: the Creatures and NPCs tabs' sort menu (the browser header's `select[aria-label=Sort]`, #651) orders by level. In the dev page
on Creatures: set the select's value to `level`, `level-desc` and `''` and dispatch `change`; the first
tiles' `.badge` levels read all 1s, all 63s, then the database's order again, and
`.spawn-browser .grid-wrap`'s scrollTop is 0 after each. The choice is in `prefs.browserViews.creature.sort`.
Unit: `tests/browserViews.test.ts` (`byLevel`, the stored `sort`).

## Spawns on cave and dungeon floors (#660)

No probe: the unit tests below, and a hand check in the dev page.

Checks: the Place tool (a creature or object template), dragging a spawn or a waypoint, and the spawn
brush stand spawns on the first upward-facing surface under the cursor (`ctx.floor()`), not on the
ground above a cave or in the air.
- Unit: `tests/raycastFloor.test.ts` (a helper cube: the top is a floor; the bottom seen from below and
  a wall are not). The layer must be `update`d and `cull`ed first, or nothing is packed and nothing is hit.
- Live (not run yet): a mine under the ground, such as Fargodeep in Elwynn (save the view with
  `window.__sceneText()` once found). Fly the camera into it, pick a creature in the Creatures tab, click the
  floor: the spawn's `y` equals the floor's height, not the ground's (`__engine.terrain.heightAt(x, z)`).
  Brush a few with the Doodad tool's Creatures mode; none land on the ground overhead.
- Trap: from above the ground, the grass over a cave is still the ground (only an underground camera or
  Show › Terrain off looks through it).
- Trap: the brush's Max slope and Avoid water rules still read the terrain at the point, the ground
  above a cave.

## Game object editor: turning a spawn into another object, pools (#136)

Probe: `object-entry`.

Checks: `ObjectEditor.svelte`'s Which object list, `objectEntryFields`, the `gameobject.id` the SQL
writes, and the pool rows in `SpawnFields`. The probe `object-entry` does it on a flat map with two
veins of one pool laid down by hand (Small Thorium Vein 324 and Truesilver Deposit 2047, as guids
23510 and 23539 are in Silithus): the list opens on Ore, a click on the Truesilver row changes the
spawn (name, model; `SpawnEditSQL` sets the row's `id` to 2047), undo turns it back and the
editor's title follows; then it runs Find object (#351, below). It needs the world database up, and takes about 7 s.

- In the real world: pool 22973 is the stack at server (-6420.68, 717.69) on map 1 (Silithus).
- The Object tab, New object and Save write to the world database: make a copy of 324, change its
  size, save, then check the spawn's scale and delete the row (`DELETE FROM gameobject_template WHERE
  entry = …`); the next free entry was 182122 on this database.
- Traps: `layer.get(key)` is the drawn spawn itself, which an undo changes in place; copy it before
  comparing. After adding a binding while `make dev` runs, the page may fail with "does not provide
  an export named …" (the stale `lib/wails/App.ts` trap in docs/TESTS.md).

## Game object editor: Find object, with no spawn (#351)

Probe: `object-entry`, after its entry change (once the probe `object-find`).

Checks: Tools › Game Objects… opens the editor on Find object (tabs Find object and New object), the
search finds by name (Small Thorium, entry 324) and by entry (1731, Copper Vein), a click opens the
object on its Object tab with Find object kept as a tab (its search kept, the open object marked),
and New object still shows its form. The probe `object-entry` runs it after its own checks, a second
or two on its flat map; it needs the world database and writes nothing. It sets `ui.objectEditor = { key: null, entry: 0 }`
as the menu does (there is no probe helper that clicks a menu entry).

## Game object editor: Contents, Make it a chest, respawn (#220)

Probe: `object-loot`.

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

## Game object editor: Display, picking a display from thumbnails (#230)

Probe: `object-display`.

Checks: the Display tab (`DisplayPicker.svelte` with `kind="object"`, `ListObjectDisplays`) lists
GameObjectDisplayInfo's displays with a model (1622 on this client) as thumbnails, opens on the
template's own display marked, in its object type (the Small Thorium Vein, 324: display 3951, Chest),
previews a hovered tile on the left, and a click sets `displayId` as one unsaved change that Revert
drops. The probe `object-display` does it in about 6 s, writing nothing; it needs the client, and the
world database for the types and names (without it every display is Unused). Unit:
`TestObjectDisplays` in `internal/vmangos/templates_test.go`.

- By hand: pick another display, Save object, and the spawns of that entry change model
  (`SpawnActions.applyObjectTemplate`, through Engine's forwarder); set it back after.
- The folder filter groups by the model's folder (TradeskillNodes, Chests), since most object
  models are used by one display each, so a file-name family would be one tile a family.

## Game object editor: Sounds, a display's sound slots (#674)

Probe: `object-sounds`.

Checks: the Sounds tab (`ObjectSoundsTab.svelte`, `SoundPicker.svelte`) shows the ten sound slots of
the template's display, named by SoundEntries, with Play; Add or Change opens the shared sound
picker on that slot (search by name, file or ID), a click sets it as one unsaved change (Save object
(1), Sounds (1)) that Revert drops, and Save object writes GameObjectDisplayInfo.dbc into Meld's
patch. The probe `object-sounds` does it on the Forge (1743, display 197, UndeadCampfireSmall in
Custom 0) in about 15 s: it saves on a throwaway client (`P.sandboxClient`), reads the slots back
with `ObjectDisplaySounds`, and checks the real patch is untouched; nothing goes to the world
database. Unit: `TestObjectDisplaySounds`, `TestSetObjectDisplaySounds` and, with the client,
`TestClientObjectDisplaySounds` (the real table rewritten: same rows, string block and fields but the
one row's slots) in `internal/vmangos/objectsounds_test.go`.

A display of its own (#723): the probe then clears Custom 0, clicks Give this object a display of its
own (shown while other templates share the display), and checks the copy (6915 on this client) reads
back with 197's model and slots, 197 keeps its own, the cleared slot moved to the copy and the
template's display is a second unsaved change (Save object (2)) that Revert drops. The server's copy
of the table is never written in the sandbox (the throwaway client's server tables are the real
ones): `TestCopyObjectDisplay` (an ID above both tables, the other rows kept),
`TestInstallServerObjectDisplays` and, with the client, `TestClientCopyObjectDisplay` cover it.
In the game (the owner's check): give one Forge a display of its own, a sound on it, Save object,
restart the world server and the game; that forge plays it and the other braziers do not, and the
world server's log has no "invalid displayId" for it.

- In the game (the owner's check): give a display a sound in Stand, Loop or Custom 0 (a loop such as
  CampFireLargeLoop, 3244), save, restart the game and walk up to an object of that display; the
  sound should fade in near it. Which slot the client plays for which object state is only known
  from the client's own displays (fires use Loop, lamps Stand, forges Custom 0), so try the slot the
  display's own sound already sits in first.
- Traps: the slots belong to the display, so a change reaches every object that shares it (the
  Forge's display 197 is used by 156 templates); the tab names them. The sound list has thousands of
  rows: the picker draws the first 200 matches. The slots arrive before the sound names (two reads),
  and a slot shows `Sound <id> (<id>)` until the names do: wait for the name, not for the `(`, or a
  fast page (`PROBE_GPU=1`) reads the fallback (#852).

## Game object editor: Text, a readable object's pages (#139)

Probe: `object-text`.

Checks: the Text tab (`PagesTab.svelte`) reads a readable object's `page_text` chain into one
textarea a page, names what else reads the pages, gives the object a copy of its own, adds, moves and
removes pages, and makes another type readable; the right-click menu's Edit text… opens it. The
probe `object-text` does it in about 10 s without writing: "Missing: Corporal Keeshan" (1726, page
245) from its menu item, an edited page and an added one (Save object (1), the new page marked
`new`) that Revert drops; A Treatise on Military Ranks (179706, pages 2654 on, 7 pages) is read by
item 18664 too, and its copy moves it to the next free page; Make it readable on a generic object.
Unit: `internal/vmangos/pages_test.go` (the chain, the SQL for more, fewer and new pages, the
refusals, the users) and `TestForgetPrunesTheClientCaches` (`pagetextcache.wdb`).

- Saving, by hand: `SavePages` on a throwaway entry (900000 and up, past the table's 2974), read it
  back with `ReadObjectPages(0, 900000)`, save fewer pages and check the dropped ones are gone, then
  `DELETE FROM page_text WHERE entry >= 900000`.
- In the game (the owner's check): edit Keeshan's poster in Redridge, Save, restart the world server
  (the server reads `page_text` at start) and read it. The game keeps pages it has read in
  `WDB\pagetextcache.wdb`; Meld prunes the rewritten ones when the game is closed, so a poster read
  before the edit with the game open still shows the old text until the game restarts.

## Tilted game objects (#229)

No probe: the unit tests below (the probe `object-tilt` was dropped for them, #424).

Checks: a game object's tilt (`gameobject.rotation0..3`) is read into `WorldSpawn.tilt`, drawn
(`spawnQuaternion`) and written back. Unit tests: `TestTiltedObjectKeepsItsTilt` in
`internal/vmangos/spawns_test.go` (read, JSON round trip, a move keeps the four values, a turn
turns them about Z) and `frontend/tests/spawnTilt.test.ts` (the drawn rotation turns each model
axis where the server's quaternion does). To see one in the app: the real Sunken Chest (guid 42485,
Azeroth tile (36, 49), tilted about 16 degrees); a move's SQL (`SpawnEditSQL`) keeps its
`rotation0..3`.

- About 1400 of the 56644 objects on this database are tilted:
  `SELECT COUNT(*) FROM gameobject WHERE rotation0 <> 0 OR rotation1 <> 0`.
- Traps: Go reads the orientation as a float32 and the tilt is relative to that value, so the round
  trip is exact; computing a tilt from the float64 orientation would drift the sixth decimal.
  508 objects have rotation 0, 0, 0, 0; they count as untilted and are written as `facing(O)`.

## Names over spawns (#125)

Probe: `brd-fly` (names over the spawns while flying over Blackrock Depths); the rest is a hand check.

Checks: `world/SpawnLabels.ts` puts names over the nearest drawn spawns (Show › Names over creatures
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
- Probe: `brd-fly` (#286) flies 40 frames through Blackrock Depths with the names on and times the
  sight tests (0.08 ms each) and the longest frame (under 100 ms on SwiftShader). Trap: a big WMO's
  batch mesh draws its group cull's twin geometry (#198), and a ray through a geometry without a bounds
  tree falls back to three's brute-force raycast: 33 ms a test there, frames of 1.2 to 2.4 s every
  second or third frame, which looked like stutter from the creatures (hiding them hid their names).
- Trap (#903): on the GPU (`PROBE_GPU=1`) the longest frame was a shader compile, not the sight tests:
  three compiles a model's program at its first draw and waits for the driver (100 to 600 ms each on
  D3D11). Wrap `gl.getProgramInfoLog` and count `renderer.info.programs` per frame to see it. The probe
  flies only once the dungeon has loaded (`P.settle`): a model that first shows during the flight
  compiles then, which is the load, not the flight. It fails when a program is made in the flight
  (`programsMade`, #904), on SwiftShader too: the particle draws' were, until `readyAhead` had them
  compiled ahead.
- Trap: a scene whose camera stands inside a building's wall (the abbey at `"target":[182,80,353]`,
  pitch 0.35, distance 45 does) hides every name, correctly; check the camera first.
- Setting `ed.prefs.spawnNames = false` from the page module hides them all.

## Right-click near the selected creature (#205)

No probe: the unit tests below, and a hand check in the dev page.

Checks: `Engine.openContextMenu` falls back to the selected spawn when the click hits nothing within
`CONTEXT_MARGIN` (24) px of its screen box (`world/screenBox.ts`, unit test `screenBox.test.ts`). In the
dev page on Northshire, hide every placed model first (the abbey fills the view and takes the clicks:
`for (const id of e.objects.objects.keys()) e.objects.hidden.add(id); e.objects.markAllDirty()`), take
creatures from `e.doc.spawnLayer.forEachDrawn`, project `boundsOf(s, box)`'s corners, `selectSpawn(s)`
and call `e.openContextMenu({ clientX, clientY, pointerType: 'mouse', pressure: 0 })` 15 px right of the
box: `ui.contextMenu.title` is the creature's; 200 px right: no menu.

## Formations and spawn pools (#172)

Probe: `spawn-groups`.

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

## Spawn SQL for CMaNGOS classic (#894)

No probe: the Go tests below, and a run against a real CMaNGOS schema by hand.

Checks: File › Export Spawn SQL… with Preferences › Compile and export › Spawn SQL for set to CMaNGOS
classic writes CMaNGOS's columns, and lists in the header what its tables can't hold.
- Unit: `go test ./internal/vmangos/ -run CMaNGOS`. `TestCMaNGOSSpawnSQLMatchesTheSchema` checks every
  table and column each statement names against `internal/vmangos/testdata/cmangos-classic-spawns.sql`
  (the spawn tables' columns, written out by hand from cmangos/mangos-classic's `sql/base/mangos.sql`;
  no data), so a VMaNGOS column slipping into the CMaNGOS writer fails without a database.
- By hand, against the real schema (no CMaNGOS server needed, nothing touches the VMaNGOS database):
  `mariadb-install-db --datadir=<scratch>/db --port=3399`, start `mariadbd --defaults-file=<scratch>/db/my.ini
  --console` in the background, `CREATE DATABASE cm`, load CMaNGOS's `sql/base/mangos.sql` (download it
  to the scratch folder, never into the repo: it is GPL), then run an export twice
  (`ExportSQLFor(CMaNGOSClassic, cmangosEdits(), fixedTime)` written to a file from a throwaway test)
  and read the rows back; `mariadb-admin -P 3399 -u root shutdown` ends it. Done for #894: both runs
  passed, and a spawn group row of the same guid but the other type survived the delete.
- Trap: the VMaNGOS world database's own user (`mangos` in `run/mangosd.conf`) may not create
  databases, hence the scratch server. When CMaNGOS's schema moves on (its `db_version` column names
  the last update, `required_z2836_...`), compare the tables in the fixture with the new base file.

## Creature path editing on the map (#138)

Hand check: in the dev page, as below; no probe covers it.

Checks: the right-click "Edit path" / "Give it a path" on a creature and the floating `PathEditBar`.
In the dev page: `e.editPath('npc/<guid>')` (a key from `e.doc.spawnLayer.spawns`, `kind/guid`) shows
`.pathbar`; a ground press through `e.selectTool.onDown(e.ctx, e.hit, ev)` / `onUp` after setting
`e.ndc` and `e.raycaster` adds a point, and the bar's buttons are plain DOM clicks
(`[...document.querySelectorAll('.pathbar button')]`). A second press near the first point picks
it instead of adding one (`ctx.paths.pickPoint`), so space test presses apart.

## A spawn's scripts on the This spawn tab (#137)

Probe: `spawn-scripts`.

Checks: the Scripts list under the pool on the creature and game object editors' This spawn tab.
Probe `spawn-scripts` (needs the world database) opens three spawns on a flat map and reads the
list: the Shadowfang Keep lever (object 18901, guid 34006) has an On use script, the Altar of the
Tides (2576) event 364, creature 6175 at guid 108 scripts at path points 1, 4, 7, 12 and 16. The
Go side alone: `go test ./internal/vmangos/ -run SpawnScriptsReal -v` (skipped under `-short`, so
`make test-full` runs it; `-v` logs the rows). Other spawns with scripts:
`select g.guid, g.id from gameobject_scripts s join gameobject g on g.guid = s.id`, a creature with
`ai_name = 'EventAI'` (2240, Syndicate Footpad). The list also has the scripts reached through other tables (#736): gossip options (creature 295, script 342), quests started and ended (197, script 54; 234, script 166) and a spell list's slots (4064, script 3019). A row with commands opens on click to list them (`ScriptCommands`, a lazy binding by table and id); the probe opens 197's Quest start and reads three. EventAI events do not open (an event runs up to three scripts). Trap: the list comes from a new binding, so the
running `make dev` must have rebuilt its Go side (`/wow/status`'s `started` changes); before that the
page logs `SpawnScripts is not a function`.

## World event spawns (#143)

Hand check: against the world database, as below.

Checks: spawns of a world event (`WorldSpawn.events`, from `game_event_creature`/`_gameobject`) are
left out of `SpawnLayer`'s batches unless Show › World events shows their event (`prefs.shownEvents`).
- Go against the real database: Azeroth 32_49 (Goldshire) has spawns of events 2 (Winter Veil),
  4 (Darkmoon Faire Elwynn), 12 and 28; 32_48 of 28 and 78. A throwaway test calling
  `ReadSpawns("C:/WoW/vmangos", "C:/WoW/client/Data", "Azeroth", 32, 49, 1)` lists them.
- Frontend in the dev page: set `events` on a few of `e.doc.spawnLayer.spawns`, call the layer's
  `rebuild()`, then `setEvents([...])`, and count `batches[].all.length`: a positive event's spawn
  shows only with it, a negative one leaves with it.
- `make dev-page` regenerates the bindings and rebuilds the Go side when a Go file changes, so a new
  binding usually works in the dev page after a reload; if it doesn't, see the stale
  `lib/wails/App.ts` trap in `docs/TESTS.md`.

## Creature editor: Looks opens on the creature's display (#206)

Hand check: in the dev page, as below; no probe covers it.

Checks: `DisplayPicker.svelte` picks the selected display's type and model family and scrolls its
tile into view once the displays are read. In the dev page on Northshire, set
`ui.creatureEditor = { key: spawnKey(s), entry: s.entry }` for a drawn creature, click the Looks button
(retry until `.picker` exists: the record loads first), wait for
`[aria-label="Creature displays"] .virtual`, then read the two `.picker select`s and the `.active`
tile's rect against the grid's. A Northshire Guard opens on Humanoid / HumanMale, the wolves on
Beast / Wolf, each with its tile in view. The first read of the displays takes several seconds.
The tiles grow to fill the row (#389): `bun test tests/displayTiles.test.ts` (it was the probe `display-tiles`, #423)
runs `gridCols` and `gridTile` (`lib/ui/virtualGrid.ts`) at every width up to 1400 px and checks a row of tiles,
104 to 140 px wide, ends within a pixel a column of the grid's inner edge and never past it; it reads the
picker's `TILE`, `MAX_TILE`, `GAP` and `PAD` and its `.grid-wrap` padding from `DisplayPicker.svelte`, so a
padding that no longer matches `PAD` fails too. The editor's 560 px panel should show 4 tiles of about 126 px.

## A character creature's hair (#965, probe `creature-hair`)

Checks: a humanoid display is dressed with the hair the client draws (`modelTables.dress`). Go:
`TestCreatureLookShowsTheScalp` (tables made in the test) and `TestCreatureLooksLiveShowHair`
(the client: every CreatureDisplayInfoExtra row shows exactly one hair submesh). Probe:
`bun run probe creature-hair --shot <dir>` dresses display 1276 (a bald human man) and 1363 (a bald
dwarf with a beard) through `SpawnLook`, checks the scalp (1) and a hair texture are in the look,
that the scalp adds triangles to the human (whose model has one) and none to the dwarf (whose
model has none), and saves a close shot of each placed as the Place tool's preview.

Traps: not every character model has submesh 1 (the orc, night elf and scourge men and women, the
dwarf man, the tauren, troll and goblin women lack it), so a hair submesh in the look does not mean
triangles; the client draws those bald too. Goblins have no hair rows in CharSections, so their
looks have no hair texture, as in the client.

## Creature editor: Shop tab (npc_vendor, #145)

Probe: `creature-shop` (#577); a save is a hand check on a creature with no shop.

Checks: the Shop tab lists, adds, reorders and saves what a creature sells. Unit: `vendor_test.go`
(the SQL, slots, duplicates). Live, in the dev page: `ui.creatureEditor = { key: null, entry: 66 }`
(Tharynn Bouden, 17 items), click the Shop tab. To test a save without changing the user's world
database for good, use a creature with no shop (805, Cameron): add an item, Save shop, read it back
with `await window.go.main.App.ReadVendor(805)`, then remove it and save again (the table is back as
it was; `select count(*) from npc_vendor where entry=805` is 0). Probe: `bun run probe
creature-shop` (#577: Brother Danil, 152, a row moved down and Revert, a row removed and the editor's
Discard, reopened unchanged; nothing written). The tabs' shared dirty logic is unit-tested in
`frontend/tests/rowList.test.ts`.
- Trap: saving renumbers the slots 0..n in list order, so re-saving a real vendor's list as it was
  can still change its `slot` values. Test saves on a creature with no shop.
- Trap: the tab keeps its list while other tabs are shown (it stays mounted, hidden); its unsaved
  edits count in the editor's "unsaved changes" bar.
## Creature editor: Quests and Messages tabs (#158)

Hand check: against the world database (no probe writes it); the probe `messages-conditions` reads
the texts under a condition (next heading).

Checks: the Quests tab's starts and ends and the Messages tab's greeting and gossip options, saved and
read back on a creature with none (805, Cameron).
- The Quests tab (creature_questrelation / creature_involvedrelation) the same way: entry 197 (Marshal
  McBride) starts 10 and ends 4; test a save on 805 with Kobold Camp Cleanup (7) as start and end,
  read back with `ReadCreatureQuests(805)`, remove both and save again.
- Trap: after `make bindings` the dev page can fail to mount (the body stays empty) because
  Vite keeps serving the old `src/lib/wails/App.ts` without the new exports, even after an in-place
  rewrite. Deleting the file and copying it back (an add event for the watcher) fixed it; check with
  `curl localhost:34115/src/lib/wails/App.ts | grep <NewBinding>`.
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
- Trap: a menu can be left with no `gossip_menu` rows (805 above after the delete) while a creature
  still names it, so a new menu's number must look past `creature_template.gossip_menu_id` and
  `gossip_menu_option` too, not only `max(gossip_menu.entry)` (`lastMenuSQL`); the first try gave
  931's copy 805's menu number, and the two shared it.
- Trap: GossipDef.h's comments give later clients' npc flag values (vendor 128, flight 8192); 1.12's
  are in UnitDefines.h (vendor 4, flight 8), which the world database uses.

## Creature editor: texts shown under a condition (#160, probe `messages-conditions`)

Checks: the Messages tab's texts shown under a condition (`SaveConditionText`, `DeleteConditionText`).
- Probe: `bun run probe messages-conditions` checks the rows on Sputtervalve (3442, text 519 under condition 315; nothing
  written). A write test, by the bindings in a scratch probe, with the maxima noted as for the Messages tab (previous heading): on 805
  add a text under condition 315 (a new menu holding only that row), change only its condition to 316
  (the row keeps its npc_text), change its text (a new npc_text), try condition 999999 (refused: not
  in `conditions`), delete it; then add one on 931 (a copied menu, shared by 1, with 6944's two
  options; 6944 keeps its one row). Clean up as there. Of the texts whose condition holds, VMaNGOS
  shows the one with the highest condition_id (`Player::GetGossipTextId`).
- The menu traps under the previous heading apply here too.

## Creature editor: what it says on its own (#160, probe `messages-ai-lines`)

Checks: the Messages tab's AI lines (`SaveAILine`: a talk command's broadcast text, run by a
`creature_ai_events` row's action script).
- Probe: `bun run probe messages-ai-lines` edits and reverts one of Crushridge Ogre's (2252) three
  aggro lines; nothing written.
- Write test (by hand, a scratch Go test calling `SaveAILine` with `t.Setenv(testDatabaseEnv, "1")`,
  since the test guard (#885) panics on a real mariadb call otherwise): note `max(entry)` of
  broadcast_text and `max(id)` of creature_ai_scripts. On 2252 (event and script 225201, run by no
  other event) change "I'll crush you!" (1925): the script row's `dataint` becomes the new text, and
  2253 still says 1925. On 4701 (event 470103) change text 7302 of script 470003, which 4700, 4701
  and 4702's events all run: 4701's event now runs a copy (one past the highest script id, all three
  rows copied), 4700 and 4702 keep 470003. Clean up: delete the rows above the maxima, set 225201's
  `dataint` back to 1925 and event 470103's `action1_script` back to 470003.
- Trap: a talk command picks one of up to four texts (`dataint` to `dataint4`), so one script row
  can be three lines in the tab; they are listed in slot order.

## Flight paths (#180)

Probe: `flight-paths`.

Checks: World › Flight Paths lists the open map's stops (TaxiNodes.dbc) and their routes (TaxiPath.dbc
through TaxiPathNode.dbc's points), draws them, edits them on the map and saves them to the client's
patch, the server's `data/5875/dbc` and `taxi_nodes`.
- Unit: `internal/vmangos/taxi_test.go` (read a map's network, unchanged write identical, edit, add and
  remove stops and routes, point IDs reused, the refusals, the SQL); `tests/taxiRoute.test.ts` (the
  curve through every point, the 32 yd/s timing, a new route's shape, where a drawn point goes, the
  red under the ground, a ray near a segment). Against the client: `WOW_DIR=C:/WoW/client go test ./internal/vmangos/ -run
  TestClientTaxi` writes the three tables back byte for byte and finds Stormwind's stop 2 with the
  gryphon (Eastern Kingdoms: 43 stops, 132 routes; next stop 88, next route 501).
- Live: probe `flight-paths` (Azeroth 36_49, Lakeshire is stop 5, its first listed route is 8 to
  Stormwind, 23 points, about 1 min 46 s). It closes the window through `ui.flightPaths`, which skips Close's
  question about unsaved changes. It also clicks a route's curve (through its middle point) and checks the route is picked.
- In the game (the owner's check): save a stop and a route, talk to a creature made flight master next
  to the stop (the server picks the stop nearest the flight master for the player's side, at any
  distance), learn the stop, and fly. A stop needs a route that starts there, or VMaNGOS leaves it
  out of its taxi mask (`sTaxiNodesMask`) and no flight master offers it. The server reads `taxi_nodes` and the route tables only at
  start; Save says to restart it when it runs (#661: Meld restarts nothing).
- Trap: a live Save writes Meld's patch-3.MPQ (or queues it while the game runs) and the server's
  taxi tables (keeping `.before-meld` copies); don't run it in a check unless the owner wants that. The Go tests cover the write.

## Boats and zeppelins (#954)

Probe: `transports`.

Checks: World › Transports and Show › Transports list and draw the transports (type 15 game objects)
whose route has a leg on the open map, their docks and names, and Sail plays a model along the route.
Read only.
- Unit: `internal/vmangos/transports_test.go` (a path split into legs as the server keys them, the
  end points and the point after a map change dropped, flag 1; the rows read, a transport without a
  path or a leg on the map left out, the query's patch and build); `tests/transportRoute.test.ts` (the
  speed-up, cruise and slow-down between docks, the waits, the jump between legs, the stretches on a
  map and the preview's play of them).
- Live: probe `transports` (Azeroth 33_39, Menethil Harbor: Eastern Kingdoms has 7 transports, 8
  docks; Proudmore's Treasure is 176231 on path 292, docking at server (-3905, -586) for 60 s). At 16×
  the ship reaches the pier in about 3 s. A screenshot of it docked (`--shot`) shows it alongside the
  pier, bow north, the way it came in.
- Trap: the preview's mesh is replaced when its model loads (`GhostPool.show`): read
  `engine.transports.model` afresh rather than keeping it. The speed select is a Svelte `onchange`,
  delegated: a probe's synthetic `change` event must bubble.
- Needs the server's world database (the rows) and the client (the paths and the model).
- Trap: the client's own data has odd stops: Northshire Abbey (1) and Programmer Isle (3) carry a
  Riding Horse (308) in the Horde slot, so they draw red; that's the table, not a bug.

## Portals and area triggers (#141, #18)

Probes: `teleport-trigger` (#306) and `portals-fit` (#718); a write is a hand check.

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
- Trap: a live Save writes Meld's patch-3.MPQ (or queues it while the game runs) and the world
  database (as Zones does); don't run it in a check unless the owner wants that. The Go tests cover the write.
- Layout (#718): probe `portals-fit`. With trigger 78 picked (as a sphere, then a box), at 100 % and
  150 % interface size and in both themes, the dialog has no horizontal scrollbar and no field row
  runs past it. Trap: a grid track of plain `1fr` grows to its widest child (the destination map
  select with long map names pushed the form 117 px past the dialog); use `minmax(0, 1fr)` and give
  the select `width: 100%`.
- Teleport to destination (#306): probe `teleport-trigger`. With Show › Area triggers on, a
  right-click on trigger 78 selects it (`__engine.triggerLayer.selected`) and its menu's Teleport to
  destination opens `DeadminesInstance 31_31 3` with the camera on the areatrigger_teleport spot
  (-14.6, -385.5, 62.5); `SpawnTeleports('object', 176296, 0)` (Portal to Stormwind, type 22)
  gives (-9003.5, 870.0) on map 0, and Lothos Riftwaker's (creature 14387) gossip teleport becomes
  the item `Teleport: Gossip: Transport me to the Molten Core, Lothos.` above Focus (#308; the probe
  calls `SpawnActions.addTeleports`, `P.e.spawnActions.addTeleports`, on a menu it opens). Unit: `tests/teleport.test.ts` (ray against
  spheres and turned boxes, which hit wins, the block opened round a spot),
  `internal/vmangos/teleport_test.go`. Other spawns with teleports, for a check by hand: Unstable
  Rift Crystal (object 180601, gossip to Molten Core), Morridune (creature 6729, gossip to
  Darnassus), Johnny McWeaksauce (16999, Naxxramas), Archmage Arugal (4275, three Shadow Port spots
  from AI scripts), Magistrate Barthilas (10435, a waypoint script with map 0, shown on Stratholme's
  map 329). Trap: a new Go binding needs the Go side of `make dev-page` rebuilt; when it isn't, stub the
  binding in the page (`window.go.main.App.X = async () => ...`, restored in a `finally`) to check
  the frontend, and run the SQL itself against the database. Spawned
  portals to test by hand: `SELECT entry, type, name FROM gameobject_template WHERE type IN (10, 22)`
  joined to `gameobject` (the city portals are summoned by mages, not spawned; Inner Maraudon's
  178404 and the Naxxramas portals are).
- Left click (#307): with the Select tool and the triggers drawn, a click (not a drag) on a trigger selects it (`ui.pickedTrigger`, which the Portals dialog follows and sets), a click away lets go; the probe covers it.
- Trap: the default camera flies, so its target is the camera itself: a probe that sets the view on
  a trigger's centre puts the camera inside it, and a trigger the camera is inside is never picked.
  Place the camera outside it (the probe backs off radius + 4 yd). Cameras that follow the ground
  lift the target onto the terrain over the Deadmines' cave, 25 yd above the trigger.

## Creatures workspace and the new-creature guide (#132)

Checks: Tools › Creatures… (`ui.creatures = true`): the search opens a creature in the editor, and
the guide's four steps make a working `creature_template` row. Unit: `factions_test.go` (reactions;
with `WOW_DIR`, the client's FactionTemplate.dbc: 14 hostile to both, 35 friendly to both, 12
Stormwind Alliance-only), `TestParseClassLevelStats`.
- Probe: `creatures-lazy` (#586): the guide calls `Factions` and `ClassLevelStats` only once opened, `Factions` once.
- Live: name it, level 10 to 12, rank Elite (multipliers 3, 2, 1), side Alliance (Stormwind, 11),
  click a display tile, then step 4 shows level 10 at 594 health, 30 damage, 492 armour (warrior:
  198, 15.2 and 492 from `creature_classlevelstats`). Make creature writes one row; check it with
  `ReadCreature(entry)` and delete it afterwards (`DELETE FROM creature_template WHERE entry = …`).
- Probe: `creature-spells`, after its Spells checks (once the probes `creature-new` and `creature-looks`): in the creature editor, Copy this creature shows its name bar (Cancel leaves; nothing is written) and New creature closes it and opens the guide (#260); then it walks the guide to step 3 and checks the preview stays in view while the page scrolls past the pickers (#221: it is sticky; the row once shrank to 520px and the pickers spilled over it).
- Trap: held items go through `EquipmentFor`, which may add a `creature_equip_template` row; leave
  the hands empty in a check, or delete that row too.

## The database editors' shared frame (#576)

Probes: the editors' own, listed below; unit test `templateEditor.test.ts`.

Checks: the creature, game object, quest, item and spell editors open, read, leave, close, discard
and save through one `TemplateEditor` (`lib/ui/templateEditor.svelte.ts`) inside `EditorFrame.svelte`.
Unit: `cd frontend && bun test tests/templateEditor.test.ts` (a read overtaken by another opening or
a close is dropped, leave and Discard, reopen after an import, a refused save's column). Live: the
editors' probes run the flow end to end: `bun run probe quest-editor item-editor spell-editor
creature-shop creature-spells object-entry object-quests` (Esc from a field, the Discard bar, Revert, Esc
closing only the quest editor over the creature editor).
- Trap: the frame's `:global` rules reach only the bars and `.body` that are the frame's direct
  children, and `nav.tabs`; a class an editor's body shares with a component inside it (`.dim`,
  `h3`, `.scroll`) stays in the editor's own styles, or the frame's rule would win inside that component.
- Trap: the editors' `values` is a `$derived` alias of `ed.values`: assigning to it would not reach
  the editor (svelte-check refuses it, since the alias is a `const`).

## Quest editor (#259)

Checks: Tools › Quests… finds and opens a quest, names every number that stands for something, and
writes `quest_template` and the four relation tables only on Save, after Go's checks.
- Probe: `quest-editor` (about 12 s; nothing written): Wolves Across the Border (33) shows Northshire
  Valley, Tough Wolf Meat (750), the choices Soft Fur-lined Shoes and Wolfskin Bracers, Stormwind
  and the quest before it (Eagan Peltskinner, 5261), started and ended by Eagan Peltskinner (196);
  a level of 300 and item 16000000 are refused (the second jumps to the Objectives tab); Revert;
  the Quest tab's text areas list the client's `$` codes (`lib/wow/textCodes.ts`, the same list as
  `TemplateFields`' `codes` prop) and a code button inserts at the cursor (counted as one change);
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

## Game object quests (#293)

Checks: the game object editor's Quests tab reads and edits `gameobject_questrelation` and
`gameobject_involvedrelation`, and an object that is not a Quest giver (type 2) gets no new quests,
there or in the quest editor's Givers tab.
- Probe: `object-quests` (about 13 s; nothing written): the Wanted Poster (68) starts Wanted: "Hogger"
  (176); an added quest is an unsaved edit (`Quests (1)`) that Revert drops; Edit opens the quest
  over the object editor and Esc closes only the quest editor; the Solid Chest (2855, type 3) shows
  the refusal with its search and New quest disabled, the Givers tab disables its Starts and Ends,
  and `SaveObjectQuests` and `SaveQuestGivers` both refuse it.
- Unit: `questrel_test.go` (`checkObjectQuests`, `checkGiverObjects`: a non-giver keeps or drops the
  rows it already has but gets no new one).
- A write, by hand (a scratch probe): `SaveObjectQuests(68, { starts: [176, 7], ends: [7] })`, read
  back with `ReadObjectQuests(68)` and `ReadQuestGivers(7)` (the poster shows as a ready object
  giver), then save the lists read before to put it back.
- In the game (the owner): restart mangosd, the poster in Goldshire shows the quest marker and offers
  the quest.
- Trap: the object editor's header reads the old object for a frame after `ui.objectEditor` changes;
  a probe waits for `entry <n>` in the header before clicking its tabs.

## Name colours by reaction (#134)

No probe: the Go unit test below, and a hand check on Northshire.

Checks: a creature's name over its head is red, yellow or green by how its faction treats the side
picked under View (Alliance or Horde). Go: `TestReaction` (the two-way rule: a player's template is
hostile to the monster group, so a kobold whose own template attacks no one is still hostile).
Live on Northshire (Azeroth 32_48), `__engine.debug.spawnLabels.nameColor(spawn)` for spawns found by name
in `doc.spawnLayer.spawns`: Alliance: Northshire Guard and Deputy Willem green, Kobold Vermin red,
Young Wolf and Rabbit yellow; Horde: the guard and Willem red too.

## Spawn colours by level, reaction or rank (#949, probe `spawn-colors`)

Unit: `tests/spawnColors.test.ts` (each mode's colour, the level range's percentiles, the legend, and the
layer painting its markers and repainting a creature whose level changed). Probe `spawn-colors` loads
the spawns of Azeroth 31_48 (size 2: Northshire, Goldshire and part of Stormwind) into a flat map and
checks that each mode paints only the colours it gives a spawn (`layer.spawnTint`), that the level
range is the monsters' (1 to 8.5 there; the city's level 55 to 62 NPCs left out), and that the legend
shows and goes. By eye: `P.BENCH` with its target moved onto the nearest monster (the Rabbit at 214,
81, 357), distance 22, pitch 1.2 and Show › Objects off: the rabbit is white by kind and blue by level.

Traps: a probe that loads spawns into a flat map (`newDocument` + `LoadSpawns`) has them at the
client's heights, above or below its flat ground, so the camera rarely sees one (`mesh.count`, the
ones in view, stays 0); count the packed instances (`mesh.userData.ids.length`, which the shadow
passes draw) instead, or load the client's region with `P.scene`. From afar a tinted model is a few
pixels: the colours read best on the markers, or close up.

## Creature editor: Spells tab (creature_spells, #243)

Probes: `creature-spells` and `creature-spell-fields`.

Checks: the Spells tab lists a creature's spell list with the client's names, icons and text, finds
spells by name or ID, and adds, reorders and saves them. Probe: `bun run probe creature-spells`
(Scarlet Commander Mograine, 3976, list 39760: Crusader Strike and Hammer of Justice; a Fireball
search and add, the unsaved bar, Revert; nothing written; about 25 s in the headless page, 2 to 7
minutes before `P.frames` waited for the GPU, #233). Unit: `creaturespells_test.go` (the SQL for an own,
a shared, a new and an emptied list, the checks, the free list number) and, with `WOW_DIR` set,
`TestSpellRefsFromClient` (Spell.dbc's name, rank and icon fields).
- The Add spells list (#340) browses by category and school: the probe checks the creature
  abilities list at once (200 rows, "Showing 200 of ..."), Mage: Fire (`skill:8`) holds Fire Blast,
  the Frost school empties it, and the search narrows inside it. Unit: `spelllist_test.go`
  (`TestSpellNoise`; with `WOW_DIR`, `TestListSpellsFromClient`: SkillLine, SkillLineAbility and
  SkillRaceClassInfo layouts, the category names and counts, school and ID lookups). Trap: the chosen
  category and school are kept in a module variable while the app runs, so a probe sets both first.
- To test a save without changing the world database for good, use a creature with no list (805,
  Cameron): add a spell, Save spells, read it back with
  `await window.go.main.App.ReadCreatureSpells(805)` (list 8050), then remove it and save again (the
  row is deleted and `spell_list_id` is 0 again).
- A shared list: 35020 is used by 4 templates (`select entry from creature_template where
  spell_list_id = 35020`); a save on one of them gives it a new list and leaves 35020 alone.
- Trap: the world database's `creature_template` here has no `spell_id1..4` columns, so there are no
  legacy spell fields to show; `creatureFields.ts` labels only the ones present.

The Creature tab's spell columns (#255): `auras` lists each spell's icon and name under its text (`AuraField.svelte`), `spawn_spell_id` and `totem_spell_id` are RefFields. Probe: `bun run probe creature-spell-fields` (creature 215 has aura 6408, 2887 has spawn spell 10389). Since #367 it also opens the spawn spell's Find (a `SpellPicker`: category and school selects), picks Fire Blast (2136) from Mage: Fire, and adds 2136 through the aura field's Find; wait for the row with the ID, not the first row, since the picker lists its category before the search answers.

## Shop tab: item icons and tooltips (#202)

Probe: `item-editor` (the item's tooltip); the rest is a hand check.

Checks: every item in the creature editor's Shop tab (the shop's list, the search results, the shared
vendor list) has its inventory icon, and hovering one shows the game-style tooltip.
- Go: `TestParseVendorItems`, `TestParseItemRow`; with `WOW_DIR=C:/WoW/client`,
  `TestItemLooksLive` (display 8690, the Battleworn Hammer, is `INV_Hammer_15`).
- Frontend: `frontend/tests/itemTooltip.test.ts` (lines for a weapon, armour with stats, a bag; money;
  #355, a set piece's set block).
- Item sets (#355): `TestParseItemSetSkipsEmptySlots`; with `WOW_DIR=C:/WoW/client`,
  `TestItemSetsFromClient` (Defias Leather, 161: five pieces, bonuses at 2 to 5). The `item-editor`
  probe opens the Blackened Defias Belt (10403) and reads `Defias Leather (0/5)`, five members and the
  `(2) Set: ` bonuses. Trap: the probe's `tooltip()` helper trims each span, so the members' two-space
  indent is read from the spans themselves.
- Dev page: `const ed = await import(<the editor.svelte.ts resource URL>); ed.ui.creatureEditor = { key: null, entry: 152 }`
  (Brother Danil, Northshire's general supplies), click the button whose text is `Shop`, wait for
  `td.item` (6 rows, 6 `img`). Hover: dispatch `new PointerEvent('pointerenter', { clientX, clientY })`
  on a `td.item` or a `.results button`, then read `.tip`'s text. Searching: set `input.search`'s value
  and dispatch `input` (bubbling); 100 results for "hammer", each with an icon.
- Effects show the spell's own text (#217): Tough Hunk of Bread (4540, spell 433) reads "Use: Restores 61 health over 18 sec.  Must remain seated while eating." Go: with `WOW_DIR=C:/WoW/client`, `TestSpellRefsFromClient` checks Spell.dbc's field layout (description at field 138). Trap: an aura with no period of its own counts every 5 sec for `$o1` (17 per tick over 18 sec is 61).

## Item editor (#353)

Checks: Tools › Items… finds and opens an item, shows its tooltip as the game does (following the
unsaved values) and the item held or worn by a character, and writes `item_template` only on Save,
Import or New item.
- Probe: `item-editor` (about 10 s; nothing written): the Stats tab holds one stat a row, and
  Equip bonuses adds Healing +22 (spell 9408) into effect slot 1 as Equip, read in the tooltip as
  "Equip: Increases healing done by spells and effects by up to 22.", then Remove; the Worn Shortsword's search result
  right-clicked shows Open and Copy .additem 25, and the copy puts `.additem 25` on the clipboard
  (read back with `window.runtime.ClipboardGetText()`, lib/wails/runtime.ts's, which works on the dev
  page; the probe overwrites the system clipboard); the Worn Shortsword (25) reads Main Hand | Sword,
  1 - 3 Damage | Speed 1.90 and its damage per second, is held in hand and shown alone; a typed name,
  quality and damage change the tooltip; a chest slot gives the armour note; the probe enters level
  300 as an unsaved edit, inspects the Save label and uses Revert without pressing Save. It does
  not verify a live refusal or tab jump. Backend range refusal is covered separately by
  TestEditorSavesRefuseOutOfRangeValues in internal/vmangos/templates_test.go;
  tests/templateEditor.test.ts checks the shared refusal callback, not a rendered tab switch.
  Change look… replaces the field tabs with the item large
  over the looks; the search for the Battleworn Hammer finds display 8690, whose tile previews it on
  hover (the item's display_id unchanged), is picked by a click and applied by Change look, back on
  the fields, held; Change icon… marks INV_Axe_01 to be made on Save (Save item (3)), and Esc leaves a
  second Change icon view; Revert; "sword" sorted by Item level, high to low (#677), lists 100
  results with `ilvl N` on the right and falling levels (100 first), then Name again shows entries;
  the probe puts the user's sort prefs back. `TestItemOrder` (the whitelisted ORDER BY) and, with
  the world database, `TestSearchItemsSortedFromDatabase`.
- Delete (#676): `TestDeleteItemSQL` checks the SQL (quest columns cleared with their counts, the
  shop and loot rows, a loot reference row left, `item_template` last); with the world database,
  `TestPlanItemDeleteLive` plans Linen Cloth (2589: creature loot, quests, nothing written). The
  probe `item-editor` opens Delete item… on the Blackened Defias Belt (10403), reads the plan's bar
  (1 row of `reference_loot_template`, `locales_item`, `item_template`) and presses Keep it; the
  sandbox refuses `DeleteItem` (`app_sandbox_test.go`), so a probe can't delete. A real delete by a
  scratch Go test (not kept): `CreateItem`, a `npc_vendor` and `creature_loot_template` row under the
  unused creature 9999999, `PlanItemDelete` listed both, `DeleteItem` left no row, `SearchItems`
  found nothing, and a second `DeleteItem` was refused. Test with a made item only: the delete is real.
- New item from a kind: the probe opens New item…, picks Weapon › "Bow · Ranged (bow) (124)" and reads
  its explanation (it makes nothing). `TestUsualItemValues` (a tie takes the lower, delay and
  durability the middle, the INSERT); with `VMANGOS_DIR`, `TestItemKindsLive` (117 kinds; a bow:
  arrows, range 100, sheath 0, wood). A real make by a scratch Go test (not kept), cleaned up by
  entry: a bow got display 32079, delay 2300, durability 65; a cloth chest 24546, cloth, 70; a bag
  1183, 10 slots; none had damage, armour, stats, level or price.
  Trap: editing a Go file while `make dev` runs rebuilds it; when that build fails (Meld-dev.exe
  locked) it can leave `frontend/bindings` half written, so `make check` reports every binding import
  missing and probes say "the page never set up __engine": stop the dev server and run `wails
  generate module`.
- Shot visuals: the probe makes the Worn Shortsword a bow (slot 15, subclass 2) on display 35578
  and reads "This look shoots like a crossbow (its shot visual 743)…", Make it shoot like a bow
  (visual 5, Save item (4)), and Change look's "Fits it: shoots like a bow" with bow shooters only.
  `TestShotVisuals` checks the subclass vote and a variant with the bow's visual. Found on
  2026-10-20: an owner-made bow on display 38287 (a copy of 35578 with another icon) fired like a
  crossbow in Benilla while the Worn Shortbow didn't; Benilla takes a basic shot's fire clip from the
  ranged weapon's display visual (`weapon_src.caster` in `creature_anim/spell_visual.rs`), as the
  client does. Live counts: 166 bow displays use visual 5, 30 crossbow 743, 140 gun 224.
- Trap: in the Icons grid the tile is `.icon-btn`; `.icon` is the ItemIcon span inside it. A probe's
  synthetic hover must bubble (`pointerover` with `bubbles: true`), or the look tiles' `pointerenter`
  for PaletteTile.
- Picker pictures: a probe of your own in `probes/scratch/` (git-ignored, so none is kept) that
  opens `ui.itemEditor` on an entry, clicks Change look… or Change icon… and hovers a tile, run
  with `--shot`; probe `item-editor` checks the same views. Seen on 2026-10-19: 3687 weapon looks for the Worn Shortsword, a
  hovered axe alone in the middle; the Icons view with a hovered icon large beside the tooltip.
- Equip bonuses: `TestEquipBonuses` (a used spell wins an amount, two auras only as a pair, a
  talent and an old spell left out). Live on 2026-10-20: 20 bonuses, such as Healing 52 amounts 2 to
  300, Spell damage and healing 61 (1 to 150), Attack power 48, Mana every 5 sec 16; picture with
  a scratch probe of your own (Stats, Spell damage and healing +12 and crit +1% added, unsaved;
  probe `item-editor` adds Healing +22 the same way). Trap: a slot found by a reactive "first free" must be read once before writing
  it, or the trigger lands in the next slot (the first try wrote "Use:" for an Equip).
- A new display: `TestItemIconDisplay` (an icon a display already has, one another display pairs
  with the same model, a new row past the last ID, an icon alone); with `WOW_DIR`,
  `TestItemLooksLive` (29604 displays, 2684 icons, the Battleworn Hammer's 8690 a weapon with
  INV_Hammer_15). Writing one into the real patch was not run on 2026-10-19: it changes the owner's
  client (a row it keeps); while the game runs it waits for it to close (#661). To try it: pick an icon, Save,
  then `ListItemDisplays` has the new ID and the item's tooltip shows the icon; in the game the
  item shows it once the game restarts.
- Pictures: `bun run probe probes/scratch/item-look.js --shot <dir>` with `PROBE_ITEM=<entry>` (and
  `PROBE_RACE=1..8`) leaves the editor open on an item (the scratch file is git-ignored; it is the
  four lines that set `ui.itemEditor = { entry }` and wait for `.tooltip .line`). Seen on 2026-10-19:
  the Battleworn Hammer (2361) in a human's hand, the Skullsplitter Helm (1624) on an orc's head, the
  Fire Hardened Buckler (1276) on the shield arm.
- Unit: `items_test.go` (`parseInserts` on comments, quoting and other statements; `planScript` with
  a column the server lacks and rows without a column list; an exported row read back; `createItemSQL`)
  and `frontend/tests/itemTooltip.test.ts` (the client's stat and resistance order, all resistances in
  one line, the biased damage rounding, a gun's type alone, ammunition, classes and requirements).
  With `VMANGOS_DIR` and `WOW_DIR`, `TestItemsLive` reads item 25, exports 25 and 2092 and plans the
  script back (both rows exist, nothing unknown), and dresses a human holding the sword.
- A write, by a scratch Go test (not kept): `CreateItem(dir, 25, "x")`, `SaveItem` a level and a
  description with a quote and a line break, `ExportItems`, rename in the script, `PlanItemImport`
  (the row exists) and `ImportItems`, then `ReadItemTemplate` has the new name, the level, the text
  and the copied display. Clean up with `DELETE FROM item_template WHERE entry > <the max before>`.
- In the game (the owner): restart mangosd (it reads items at start), start the game from Meld,
  `.additem <entry>` as a GM and hover it.
- Body armour (#356): `TestItemLookPaintsBodyArmour` (the stand-in's face and underwear and a
  robe's textures over the skin, a hand texture its slot doesn't paint and a `_F` texture on a man
  left out, the robe's skirt, a cloak's geoset and cape texture), `TestComposedTextureRoundTrip` and
  `TestPaintRegion` in `internal/wow`; with `WOW_DIR` and `VMANGOS_DIR`, `TestItemsLive` paints the
  Robes of Arcana's look (12695). Probe `item-editor` types 12695 on a chest piece and waits for
  "Worn on the body". Pictures with `probes/scratch/item-look.js` (above): seen on 2026-10-20 the
  Robes of Arcana (5770), Judgement Breastplate (16958), Crimson Silk Cloak (7056, on the back) and
  Recruit's Boots (40) on a human man. To see a composed texture flat, fetch
  `/wow/texture?path=compose%3A0%3D<skin>%7C<region>%3D<path>` from the dev server (RGBA reply).
- Trap: the stand-in is the humanoid NPC display of that race and sex that wears the least
  (`standIn`), but only its skin, face and hair are kept (`plainLook`): its baked texture and clothes
  would cover the item.
- Trap: `item_template` is keyed by (entry, patch); the editor writes the newest patch row it read,
  and a new item is patch 0. `other_team_entry` defaults to 1 in VMaNGOS, which names no item.

## Spell editor (#294)

Checks: Tools › Spells… finds and opens a spell, shows its tooltip, effects and visual as the game
would (following the unsaved values), and writes `spell_template` and Spell.dbc (SpellIcon.dbc for a
new icon) in Meld's patch only on Save or New spell.
- Probe: `spell-editor` (about 12 s; nothing written): Fireball's result right-clicked copies
  `.cast 133`; Fireball (133) reads Fireball | Rank 1, 30 Mana | 35 yd range, 1.5 sec cast and its
  description with 14 to 22 and 2 over 4 sec filled in; its effects read Damage 14 to 22 · Enemy target
  and Apply aura: Periodic damage; its visual (67) is named by Firebolt and others; a typed name and
  base points 99 give 100 to 108 in the tooltip; a cost of 99999999999 is refused and jumps to the
  Spell tab; Change icon… previews the hovered icon (the bar keeps naming the current one) and marks
  a picked one Set on Save; Take the visual of Frost Nova changes the visual; Revert; New spell offers
  the six starters and Copy of Fireball, the copy picked, under its name. It also runs the icon grid's
  Import and Export checks and the Icons tool (docs/tests/client.md, "Icons from PNG files and back").
- Starters (#360): with `WOW_DIR` and `VMANGOS_DIR`, `TestSpellStartersLive` plans a spell from each
  starter and reads its planned Spell.dbc row back (name, a visual, an icon other than Temp, a range
  and cast time row, an effect, the locale mask, the text filled in, such as "Causes 50 Shadow
  damage over 15 sec." and "within 10 yards"), and runs each INSERT into a temporary copy of
  `spell_template` (`CREATE TEMPORARY TABLE ... LIKE`; the table is MyISAM, so a transaction can't
  be rolled back), so nothing is written.
- Visual composer (#361), probe `spell-visual` (nothing written): Blizzard (10)'s Compose… lists its
  stages with names (Area: Blizzard Impact Base, a channel); Rain of Fire's area taken by the stage's
  spell search makes the lava blizzard (Area: Rain Of Fire Impact Base), whose model plays in the
  preview (`RainOfFire_Impact_Base.m2`); a hovered effect model previews and a clicked one goes on
  the Cast stage's left hand; Use this visual leaves "composed: set on Save" with a stage summary and
  Save spell (1); Esc leaves a reopened composer; Revert.
- Visual tables: `TestPlanVisual` (unchanged gives the same ID and no files; an added area a new
  visual only; a changed attachment point a new kit copying its animation; an effect on an empty
  stage a new kit of that stage's kind; nothing at all no visual). With `WOW_DIR`,
  `TestSpellVisualsLive` checks the layouts on the client's rows (4460 of 4461 stage fields name a
  kit, 455 of 460 missile and area fields and 1887 of 1890 attachment points name an effect model on
  2026-10-19) and plans the lava blizzard: Blizzard's visual 259 with Rain of Fire's (329) area
  fields 11 to 13, one new SpellVisual row, no new kit.
- Trap: SpellVisual's field 9 (the attachment a missile flies to) is set on most visuals, with a
  missile or not (1459 of 2165), so a visual without a missile keeps it; clearing it changed
  Blizzard's row in the first plan.
- Trap: many spells share a name. "Rain of Fire" finds 19, and the first Rank 1 (3354) is a helper
  with no area; the warlock's is 5740 (visual 329). The composer shows each hit's ID and refuses to
  take an empty stage rather than clearing it (the probe checks the refusal).
- In the game (the owner): a spell saved with a composed visual, then cast; the stages should play
  as in the composer. Not run on 2026-10-19.
- Trap: a starter's look comes from the lowest-ID client spell of its name with a visual; some early
  rows of a name have the Temp icon (1), as Lesser Heal's did, so `spellLook` also skips icon 1.
- The column map: with `WOW_DIR` and `VMANGOS_DIR`, `TestSpellColumnsMatchClient` writes every
  server row as Spell.dbc fields and compares them with the client's (22357 spells in both on
  2026-10-19, each mapped field the same in at least 95%; the locale masks, `nameFlags` and the rest,
  matched in only the 1003 build-5875 rows, so they stay the client's). `TestPlanSpellLive` plans a copy
  of Fireball and a save with base points 99 and a new icon against the real client and database,
  and reads the planned Spell.dbc back: the copy's name in every locale, Fireball's rank, icon,
  visual and filled-in text, the new SpellIcon row, and every other spell's row unchanged. Neither
  writes anything.
- Export and import (#357): `TestSpellScriptRoundTrip` (an exported row with a quote and a
  backslash read back under its entry and build, its REPLACE, a row without a build taking 5875, an
  entry or build past 65535 refused). With `VMANGOS_DIR` and `WOW_DIR`, `TestSpellScriptsLive`
  exports Fireball (133), plans the script back (its three builds' rows exist, its icon, visual and kits carried as `-- meld` lines and found under their own IDs, the client has the
  spell, icon and visual; nothing unknown) and makes its Spell.dbc record from the row the server
  uses; nothing written. `TestSpellScriptLooks` (#381): the `-- meld` lines an export writes for a
  Meld-added icon and a visual with its kit, read back without counting as statements; on the same
  client nothing changes; on another client the icon (its ID another texture there) and the visual
  and kit (other rows under their IDs) are added at the end and the rows' IDs rewritten; a visual the
  client holds under another ID is found, not added. Probe `spell-editor` checks the Import… and Export… buttons are there; they
  open native dialogs, which a probe can't drive. An import's write was not run on 2026-10-20: it
  changes the owner's world database and patch. To try it: export a spell, change its name in the
  script, Import it, and `ReadSpell` and `SearchSpells` show the new name.
- Unit: `spells_test.go` (`putRecord`, `spellIconRow`, `spellClientRow` with a float, a negative and
  a 64-bit value, the build-keyed UPDATE) and `frontend/tests/spellFields.test.ts` (the description's
  tokens, the tooltip's cost, range, cast and cooldown, an effect's line, the tabs).
- Waiting client files (#365): `TestPendingFiles` (a later save replaces a file of its name, another
  client's folder is apart, a file given with the patch write replaces a waiting one, clearing keeps
  a file saved again meanwhile), `TestInstallWithPending` (the waiting files go into the write and are
  dropped; nothing written when nothing waits), `TestPatchWritesOneAtATime` (eight `InstallPatch` and
  `InstallWithPending` writes at once all land, with the waiting Spell.dbc; it fails without
  `patchMu`, #657) and `TestReloadSpells` (nothing sent with SOAP off; `reload
  spell_template` with it on). With `WOW_DIR` and `VMANGOS_DIR`, `TestPendingSpellLive` queues a new
  spell's planned Spell.dbc in a temporary folder and finds it through `SpellRefs` and `SearchSpells`.
  The watcher and a Save while the game runs were not run: they write the owner's patch.
- A write was not run on 2026-10-19: it changes the owner's world database and client patch. To try it: open Fireball, New spell, name it, change its
  base points and icon, Save; `ReadSpell` reads it back and `SearchSpells` finds it (the client's
  Spell.dbc through the patch). In the game: `.learn <id>` or `.cast <id>` as a GM; the tooltip shows
  the text and icon. Clean up with `DELETE FROM spell_template WHERE entry = <id>` (the patch's row
  stays until the patch is rebuilt).
- Trap: the server reads `spell_template` at start, or on `.reload spell_template` (GM level 5),
  which Save sends through the SOAP console; with `SOAP.Enabled = 0` in mangosd.conf (this machine on
  2026-10-20) it can't, and a saved spell reaches the server at its next start. The game reads the
  patch only when it starts, and a file saved while it runs waits until it has closed.
- Trap: in a heredoc (quoted or not) or sed, `Interface\Icons` and regexes lose their backslashes; edit them with
  the Edit tool (a probe's `\w` became `w` that way).

## Characters and accounts (#855, probe `characters`)

Checks: Tools › Characters and Accounts… lists the accounts, opens an account's characters and a
character's fields, and writes the login and character databases only on Make account, Save
account, Delete account, Save character and Delete character.
- Probe: `characters` (about 4 s; nothing written): the accounts list, the first account with
  characters and its character list (Delete account… is offered with characters too, #876), a character's level
  as an unsaved edit (Save character (1)), a refused value outlining its field (`SaveCharacter`
  stood in through `window.go.main.App`), Revert, Delete character… (asks, Keep it backs out, Delete
  sends the guid and goes back to the account; `DeleteCharacter` stood in), the New account form,
  Close. It skips when the
  server's databases can't be read or no account has a character.
- Unit: `accounts_test.go`: the SRP6 verifier against the server's own self-test vector
  (`InitializeCrypto.cpp`, VMANGOS / 4EVER), `CreateAccount`'s SQL (upper case, no password stored,
  the `realmcharacters` row), Delete's refusal of an account with characters, `characterSet`'s
  rules and carry-alongs, and `SaveCharacter`'s refusals (in the world while mangosd runs, a rename
  while it runs).
- A write, by hand in the dev page (a scratch probe, `bun run probe probes/scratch/<name>.js`):
  `CreateAccount('meldprobe', 'secret', 0)`, `SetAccount(id, 3, 'other')`; copy a character into it
  in SQL (`CREATE TEMPORARY TABLE t SELECT * FROM characters WHERE guid = 1; UPDATE t SET guid =
  9001, account = <id>, name = 'Meldprobe'; INSERT INTO characters SELECT * FROM t`), then
  `SaveCharacter(9001, { name: 'probezug', level: '12', race: '2', gender: '1', map: '1', ... })`
  and read the row back (name Probezug, xp 0, skin and face 0, instance 0); `SaveCharacter(9001, {
  race: '1', class: '11' })` is refused (no Human Druid). Clean up: `DELETE FROM characters WHERE
  guid = 9001`, then `DeleteAccount(id)` (refused while the character is there). Done on 2026-10-29
  with the world server stopped.
- Character delete (#876): `chardelete_test.go`. `TestDeleteCharacterSQLLive` (needs the server's
  database; about 2 s) copies the character tables' structure into a scratch `test_meld_chardelete`
  database (the server's mariadb lets any user make `test_` databases), sets up a guild, a group with
  instance binds, cash-on-delivery and other mail, a pet and petitions around two characters, runs
  `deleteCharacterSQL` and checks every table; the others check the refusal while mangosd runs, the
  `realmcharacters` recount and Delete account's script per character. By hand on 2026-10-29
  (mangosd stopped): an account MELDPROBE with two copies of a character (guid 9001 leading a guild,
  9002 in it) in the real databases; a scratch probe ran `DeleteCharacter(9001)` (9002 then led),
  then `DeleteAccount(id)`, and no row of either, the guild, the home or `realmcharacters` was left.
- Trap: `characterServer` (the Go tests' server folder) names the databases on port 1, where nothing
  answers. A test that stands in `runSQL` but not `pipeMariadb` (or the reverse) talked to the
  machine's real databases through it while it named port 3307, and deleted a character and an
  account there (#876). Stand in both, or neither. Since #885 the runners (`runSQL`, `pipeMariadb`,
  `shutdownDatabase`) panic in a Go test that did not ask for the database (`testclient.AllowDatabase`,
  which `ServerDir` calls), so a forgotten stand-in fails the test instead of writing.
- In the game (the owner): log in with a made account and its password (the verifier is checked
  only against the server's test vector here), and enter the world with an edited character.
- Trap: the probe's page runs without the client sandbox, so writes from a scratch probe go to the
  real databases; `serverSession` refuses them only while a probe has the sandbox on.
- One page (#931): the probe clicks through every tab of the character's page and fails when the
  page (`.scroll.page`) scrolls either way at the runner's window (1400x900, 1384x805 inside); a
  list scrolling in place is fine. To look at a tab, a scratch probe that opens the character and
  clicks the tab, run with `--shot <dir>`.
- Equipment and bags (#874): the probe also opens the character's Equipment and bags tab, checks
  that it shows as many items as `ReadInventory` reads, drags an item to an empty backpack square
  (synthetic `DragEvent`s with a `new DataTransfer()` work in the headless page; the squares carry
  `data-place="container:slot"`), outlines a place a stood-in `SaveInventory` refuses, adds an item
  found by its entry (a `.sq.new` square) and reverts. Unit: `inventory_test.go` (which rows the
  editor reaches, `checkInventory`'s refusals, `equipmentCache` against a cache the server wrote,
  `inventoryScript`'s deletes, moves, inserts and a new bag's contents, the refusals of a character
  in the world and of a new item while mangosd runs) and `frontend/tests/inventory.test.ts` (moves,
  bags taking their contents along, special bags, where an added item goes).
- The character's picture (#880): the probe waits for the canvas between the equipment columns,
  calls `CharacterModelLook` with the slots' displays (a `Character\...` model back), then on the
  Character tab changes the skin and checks the Look section's picture asks again with the new skin
  and the tab's equipment. Unit: `TestCharacterModelWearsItsEquipment` in `looks_test.go` (the
  character's own hair and skin, none of the stand-in NPC's clothes, a sword and shield drawn, a bow
  alone). To look at it: a scratch probe that opens a character on Equipment and bags and waits a few
  seconds, run with `--shot <dir>` (the runner captures the page as the probe ends).
- The picture holds its size (#889): the probe sets Interface size to 1.25, reopens Equipment and
  bags and checks the canvas's height is the same a second later. Trap: at Interface size 1 (the
  dev page's default) it never grew, so the probe must set the zoom before the canvas mounts (the
  preview takes its pixel ratio then). A preview canvas in a box of no fixed height grows that box a
  pixel a frame under a zoom; give the box a height or `contain: size`.
- Bank, keyring and random properties (#879): the probe checks the Bank grid's 24 squares, the
  keyring's (at least 4), the dashed bank bag slots (6 less `bankBagSlots`), and adds item 727
  (Notched Shortsword, `random_property` 5168) into a picked free bank square: it rolls a property,
  the details' Random property select offers the template's choices and None, and the title carries
  the suffix. Unit: `inventory_test.go` (the bank, bank bag, keyring and buyback refusals,
  `withRandomProperty`, a kept property not needing the DBC) and `TestInventoryScriptLive` (needs
  the server's database; under a second): it copies the character tables' structure into a scratch
  `test_meld_inventory` database, writes the fixture's rows, runs `inventoryScript` (moves into a
  bank bag, a new key, a new sword with a property) and reads them back as the editor does, so no
  real character is written; `frontend/tests/inventory.test.ts` (bank moves, bags swapped between
  a bag slot and a bank bag slot, `rollRandomProperty`).
- Trap: a random property's stats are the enchantments in slots 3 to 5 of `enchantments`;
  `Item::LoadFromDB` reads `random_property_id` as is and doesn't fill them from it, so a write
  that sets only the id gives the suffix without the stats.
- An inventory write, by hand (mangosd stopped): copy a character to guid 9001 as above, then a
  scratch probe with `SaveInventory(9001, [...])` of new items (`guid: 0`, each with its
  `InventoryItemTemplate(entry)`): a sword at `0:15`, a shield at `0:16`, a Small Brown Pouch (4496)
  at `0:19` and jerky (117) at `19:0`; read it back (`ReadInventory`), move the jerky to `0:23`,
  enchant the sword, take the pouch out, and check `item_instance` and `character_inventory` (the
  contents' `bag` is the pouch's guid, `charges` and `enchantments` in the server's spaced format).
  Clean up: `DELETE FROM item_instance WHERE owner_guid = 9001`, the same from `character_inventory`
  by `guid`, then the character. Done on 2026-10-29.
- In the game (the owner): log in with an edited character and see the items where the editor put
  them; an item it can't wear arrives by mail.
- Look, skills, spells and reputation (#875): the probe also checks that the Character tab's Skin
  color offers the client's choices and shows the stored one, that the home's zone is the
  `character_homebind` row's, and that the Skills, Spells and Reputation tabs show as many rows as
  `ReadCharacterSkills`, `ReadCharacterSpells` and `ReadCharacterReputation` give (the Reputation tab
  after its "Only the ones the game lists" box is cleared), take an edit (a skill taken out, Add
  starting spells adding what `StartingSpells` gives that the character lacks, a new rank), outline
  the row a stood-in Save refuses (rows carry `data-skill`, `data-spell`, `data-faction`) and revert.
  Unit: `charsheet_test.go` (the look's check and choices, `characterSet`'s look and honor columns,
  `lookAfter`, `checkSkills`' ranges and refusals, `spellProblem`, `reputationScript`'s differences
  from the start and kept rows, `homeSQL`'s refusals) and `frontend/tests/characterSheet.test.ts`
  (reputation and honor ranks, look choices, skill ranges).
- The writes, by hand: a throwaway Go test in `internal/vmangos` that reads character 4's skills,
  reputation and spells and saves each unchanged, rewrites its home, changes its skin and face and
  back, and checks that a `mariadb` dump of those rows is the same before and after (and differs in
  the middle) passed on 2026-10-29, with the refusals of skin 40, a home on map 36 (Deadmines) and
  spell 99999. Pick a character that is out of the world.
- In the game (the owner): log in with a changed look, skill, taught spell, standing and home, and
  see each in the character frame, spell book, reputation frame and hearthstone.
- Quests, explored areas and flight paths (#881): the probe also opens the Quests, Explored and
  Flight paths tabs, checks they show as many rows as `ReadCharacterQuests`,
  `ReadCharacterExploration` (its zones) and `ReadCharacterTaxi` (its stops, once "Only the
  Alliance's/Horde's" is cleared) give, takes a quest found by its entry (rows carry `data-quest`,
  the search's `data-add`), marks a zone and a stop (`data-zone`, `data-stop`), outlines what a
  stood-in Save refuses and reverts. Unit: `charquests_test.go` (`questsScript`'s kept and changed
  rows, timers, a new repeatable quest done, the 20-quest log, `maskBits` and `maskText` against
  rows the server wrote, `exploreZones`' grouping) and `frontend/tests/characterSheet.test.ts`
  (`questState`, `withQuestState`). `TestCharacterQuestsLive` (needs the server's database; under a
  second) copies `characters` and `character_queststatus` into a scratch `test_meld_charquests`
  database and writes and reads back quests and both masks there, so no real character is written.
- Reading a character's quests with titles: guid 4 (Kek) has quests 7 (in progress), 783 and 9666
  (done), and explored and taxi bits; guid 2 (Sizzan) has none.
- In the game (the owner): log in with a quest taken, one marked done and one taken out, an area
  marked explored and a flight path added, and check the quest log (and the givers' marks), the
  world map and the flight master's map.
