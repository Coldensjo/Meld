# Database and client-table authoring

Use this guide to edit creatures, game objects, quests, items, spells and world tables. These
editors write shared server or client data; they are not just another layer in a region's undo history.
The steps and write boundaries below are source-verified and covered by selected synthetic tests,
not a completed live database/UI/game walkthrough. Test gameplay separately on a disposable setup.

## Before you begin

1. Use a development database and client, not a live realm. Back up the database with your normal
   database tools and preserve the client patch before editing shared data. A patch backup cannot
   restore SQL rows. See [safe writes and recovery](saving-and-compiling.md).
2. Configure the client and server folders in Preferences and complete
   [database readiness](../troubleshooting.md#database-features-cannot-connect). Database access
   needs the executable named mariadb, the server configuration and an accessible SQL account;
   Game Login credentials are not SQL credentials. Your account needs permission for the tables
   the chosen operation changes; your OS account needs write access to the client/server output.
3. Close the game before changing client tables. On Windows Meld can queue client output while
   the game runs; that does not defer SQL. Linux does not use that Windows game-running queue
   gate. Database editing does not imply Linux support for Windows server extractors.
4. Decide whether you are editing a **template** or a **spawn**. A template entry defines a type
   shared by every placement using it. A spawn GUID identifies one placement. Changing a creature
   template's name or an object's contents can affect instances outside your open region.

::: warning Save is not one transaction
A template editor's Revert discards its unsaved form changes. Map Undo handles map/spawn history,
not already committed template rows, client-table writes, icon imports or world-table operations.
Some dialogs persist data before the parent editor is saved. SQL transaction wrappers do not
promise rollback on every supported table engine, particularly MyISAM. Read the failure message
before retrying: earlier writes may already exist.
:::

## Creatures: make a template, then configure its behavior

1. Open **Tools › Creatures…** and search for an existing creature to inspect or use as a starting
   point. To create one, enter the workspace's new-creature flow, choose its appearance and
   equipment, and review the proposed details before **Make creature**.
2. Make creates a database template immediately, then reads and updates it with the wizard's
   values. Equipment selection can already allocate an equipment row before Make. Cancelling
   the wizard is not guaranteed to remove that row; a later read/update failure can leave a
   created default template. Inspect the result before trying Make again to avoid extra entries.
3. Open the resulting template, edit its base properties and use its Save action. This changes
   the shared template, not just the creature currently selected on the map.
4. Review **Spells**, **Shop**, **Quests** and **Messages** separately. Use each tab's own Save
   action; saving the base creature does not commit all these tabs. Direct vendor rows and
   inherited vendor-template rows are different sources; a direct Shop save is not an edit of
   the shared vendor template.
5. Place or select a spawn in the map and adjust that placement. Persist its position and other
   spawn edits through **File › Save Spawns to Database…** or the server/all compile workflow,
   not by saving the template.

When editing a shared creature spell list, Meld makes a separate list for this creature. Shared
message/gossip menus are copied as needed and changed greeting text gets new text rows. Do not
assume other editors have this copy-on-edit behavior: object loot is explicitly different.
Creation selects a free entry, but IDs/previews are not reservations against another writer.

## Game objects: separate template, contents and placement

1. Open **Tools › Game Objects…**. Search and open a template. To start a similar object, open
   the original and choose **New object**; review the copied type, display, loot and lock.
2. Edit the shared template. For a container, open **Contents**; **Make it a chest** changes the
   template used by every spawn, not just one selected placement.
3. Before changing shared loot, use **Give {name} its own copy** when this object needs a private
   list. Without that explicit action, saving contents replaces the named loot list used elsewhere.
   The copy choice is pending until the object/contents save succeeds.
4. Save the object. The save sequence writes template changes, then contents, then display sounds.
   A sound failure does not roll back the template or contents. Display sounds belong to the
   display ID and can affect other objects using that display.
5. Use **Quests › Save quests** for giver relationships. Use **This spawn** for placement-specific
   edits, which follow the separate Save Spawns workflow.

## Quests: save the row and check its givers

1. Open **Tools › Quests…**, search for an existing quest or choose **New quest**. Open a quest
   first if you want to copy it. **Make quest** immediately creates a database row at a free entry;
   the default is a level-1 quest without objectives or rewards, not a complete playable quest.
2. Fill in its text, requirements, objectives and rewards, then choose who starts and ends it.
   Review item/creature references instead of assuming a numeric ID names a valid resource.
3. Save and inspect the saved result. The quest row is written before giver relationships; a later
   giver failure leaves the row saved. Retry only after checking the reported partial result.
4. If deleting, read the deletion preview and confirm only after making a database backup. The
   operation removes all patch rows for that quest entry, not just the visible revision. It also
   removes giver/event/locale relationships, removes unshared quest scripts and clears linked
   quest fields. Character quest-status records are retained, not reset or repaired.

Deletion previews are advisory, not a locked snapshot. Counts can change before confirmation;
player-count value -1 means unavailable, not zero. Recheck dependent quest chains and player
progress in your development realm. Meld does not provide a database undelete operation.

## Items: create, edit and save both identity and appearance

1. Open **Tools › Items…** and inspect an existing item, or choose **New item…**. Choose a kind
   or open an existing item first to copy it, name the item, then choose **Make item**.
   Creation writes a database row immediately; cancelling later edits does not delete it.
2. Edit requirements, stats and appearance. Check the preview, but do not treat a preview as proof
   of game compatibility. Choosing an icon/model combination can create a new item display on Save.
3. Use **Save item**. Item display writes can be installed or queued before the SQL item save;
   a later SQL error does not undo that client-table change. Revert is not a patch rollback.
4. Reopen the saved item to confirm the intended row. Export only after saving (see below).

Item-set information is a read-only view of client metadata, not a set editor. Equip-bonus controls
cover passive equip bonuses; they are not a general spell editor. For a custom icon, import the
image separately before selecting it; importing is an immediate external write.

## Spells: save database data before client tables

1. Open **Tools › Spells…**, inspect a spell, or choose **New spell…**. Select a starter kind or
   open an existing spell first to copy it, name it, then choose **Make spell**. The new database
   entry exists immediately; the client may not have that spell until Save writes it.
2. Edit the spell and choose its icon. In the visual composer, **Use this visual** selects a pending
   visual for the spell; it does not replace the parent **Save spell** action. Changed visual/kit
   combinations get new rows rather than editing the stock rows in place.
3. Choose **Save spell**. Spell SQL is written before client-table output. If that output fails,
   the database can already be changed; follow the retry message and inspect both destinations.
4. Reopen and check the saved row, then validate casting and appearance in a controlled game test.
   Editor previews do not verify server mechanics or every effect/attachment/sound combination.

Spell SQL export carries icon paths and visual-row metadata, not custom BLP image bytes or models.
Missing or broken metadata can preserve numeric IDs; that fallback does not prove the IDs exist
on the destination. Nested effect/sound IDs assume compatible stock client data. Plan asset
transfer separately rather than treating the SQL script as a portable client patch.

## Import and export item or spell SQL safely

These editors exchange their target item/spell tables, not arbitrary database migration scripts.

1. Save any edits you want to export. Export reads saved database rows, **not unsaved form values**.
   An entry export includes its patch/build variants; it is not restricted to the row on screen.
   Item SQL does not bundle item-display or icon assets.
2. Back up the destination database and inspect the script. Import accepts INSERT and REPLACE
   statements for the editor's target table. Other tables and DELETE/UPDATE statements are skipped;
   a full dump will not be replayed as a general SQL script.
3. Prefer explicit column names. Without them, values are interpreted in the **destination's**
   schema order, not necessarily the exporter's order. Unknown columns are dropped and reported;
   omitted fields use destination defaults. Schema differences can change the result.
4. Open the import action and review its preview: entries/variants to add or replace, skipped
   statements and unknown columns. Resolve unexpected replacements before confirming.
5. Confirm only when the destination is correct. Import rereads the file and revalidates against
   the current schema/data; the preview does not freeze the file or reserve IDs. Keep other writers
   out of the target during the operation, then reopen the affected entries and inspect the result.

Imports use REPLACE semantics, **not field-by-field merge**. Existing rows with matching entry and
patch/build keys are replaced, including defaults for omitted fields. Passing validation is not
an all-engine atomicity guarantee. On a partial failure, preserve the error, compare saved rows
with your backup, and repair only the affected data rather than blindly rerunning a full script.

## Import or export icons

1. Open **Tools › Icons…**, or an item/spell icon picker. Prepare square PNGs from 8 to 4096 pixels
   on each side. Meld rescales them to 64 × 64 pixels; non-square, out-of-range or invalid PNGs
   are refused. The filename without its extension
   becomes the icon name: spaces become underscores; only letters, digits, underscores and hyphens
   are allowed, with a maximum of 100 characters.
2. Use **Import PNG…** and inspect both the accepted and refused results. Duplicate names within
   a batch are refused. A name present in a non-Meld client archive cannot be replaced: rename it.
   Reimporting an icon previously added only through Meld replaces that Meld icon.
3. Successful imports write or queue BLP files under the client's Interface\Icons immediately.
   They do not wait for the item/spell to be saved. Cancelling the parent editor does not undo them.
   A batch can partly succeed; inspect the reported names rather than assuming all-or-nothing.
4. Select the imported icon in the parent editor and save that item/spell to update its references.
5. For **Export PNG…**, choose a disposable or backed-up output folder: same-name PNGs are
   overwritten. Export is an image conversion, not a database or complete client-asset backup.

## Spawn routes, formations, pools and scripts

1. Select a creature or object spawn in a region and use its placement controls. Keep template-entry
   changes separate from GUID-specific edits. Map history tracks pending spawn edits until written.
2. For routes, edit the selected creature's own route. Saving replaces its creature_movement route
   at path_id 0; it does not edit the creature-template route. Review the intended route before Save.
3. Before changing formations, inspect membership beyond the open block. Deleting a leader or
   disbanding a formation can change rows outside your region. Pool metadata is shared too: changes
   can affect every patch row and master settings, not only the selected member.
4. Save through **File › Save Spawns to Database…** or compile server/all, then inspect the result.
   GUID conflict checks are prechecks, not reservations; another writer can take an ID afterward.
5. Use the script view to inspect existing spawn scripts. It is read-only, not a general script editor.

Cached SQL records are best-effort diagnostic output; a filesystem error can leave no record even
when the SQL write succeeded. They are not a guaranteed database backup or automatic undo log.

## World dialogs: choose the destination before saving

Open the corresponding **World** menu entry. Make a small change first, review its scope, and use
the dialog's final Save/Write action. A nested picker/composer's Apply may only update the parent
form; it is not a universal save-to-disk command. Conversely, explicit table/art writes below are
external writes and are not undone by closing the dialog or using map Undo.

| Task | Steps and expected destination | Important limit |
| --- | --- | --- |
| Zones/weather/sounds | Open **Zones…**, choose the area, edit its area/sound/weather settings, then save. Changed area DBCs go to the client; weather SQL goes to the database when needed. | SQL can succeed before client output fails. Check both after an error. |
| Lights | Open **Lights…**, choose a light and change its parameters, then save. Changed light DBCs go to the client patch or pending output. | No server SQL write; preview appearance is not game certification. |
| Portals | Open **Portals and Area Triggers…**, choose/edit a trigger and its destination, then save. Changed trigger DBCs go to the client; required trigger SQL goes to the server database first. | Inspect whether the operation includes server data; it is not one cross-destination transaction. |
| Flight paths | Open **Flight Paths…**, edit nodes/routes and save. SQL is followed by client Taxi DBC output and server DBC copies. | Server copies can advance while client files wait in the queue. Copy failure can follow successful SQL/client output; no multi-file rollback. |
| World map/loading screens | Open **World Map…**, configure the map/exploration overlays or loading art, and use the relevant Write action. Generated art and DBC rows go to the client patch/pending output. | Writing art is not saving the region's working file; preserve source images and patch backups separately. |
| Ground effects | Use **Ground Effects (Grass Tufts)…** to choose an effect for terrain; that assignment follows map history/save/compile. Creating a new effect writes a GroundEffectTexture client row referring to existing client doodads. | New effect creation is independent of saving/compiling the map that uses its ID; it does not import a new doodad model. |

## Refresh, diagnose and recover

After a successful save, reopen the edited row to distinguish saved data from pending form changes.
A running server may still hold old data: use your server's appropriate reload/restart procedure;
Meld does not automatically restart it. Close the game, let pending client output install, and
launch again when checking changed client tables. Managed Launch can prune affected item/object
cache entries, but its remembered IDs are memory-only and pruning failure logs without blocking
launch. See [stale appearance diagnostics](../troubleshooting.md#an-item-or-object-still-has-its-old-name-or-appearance).

If a save fails, stop and record which destination succeeded before retrying. Restore SQL from a
database backup only after reviewing its scope; restoring a patch cannot repair rows already saved.
Restoring a patch also does not cancel pending output. Follow
[partial-write recovery](../troubleshooting.md#a-write-failed-after-some-changes-were-saved) and
[saving, compiling and recovery](saving-and-compiling.md) rather than treating Cancel or Revert as rollback.

For contributors, the [database/spawn recipes](../tests/spawns.md) and
[client-table/write recipes](../tests/client.md) identify focused checks and native prerequisites.
Synthetic SQL/PNG/patch tests verify selected contracts, not a live realm's schema, privileges,
concurrent writers, cache timing, game rendering or transaction-engine behavior.
