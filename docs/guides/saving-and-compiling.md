# Saving, compiling and playing

A map can exist in three places: your `.wmap` working file, the client's patch, and the server's
map data and database. Updating one does not necessarily update the others.

::: info Platform scope
The editor runs on Windows and Linux, but Meld's integrated VMaNGOS process management and map
extraction use Windows tooling. Do not assume that publishing, server map rebuilds or Play Here
are available on Linux. Client-only editing and writing a patch are separate from that automation.
:::

## Choose the right operation

| Operation | What it updates | When to use it |
| --- | --- | --- |
| **Save As** | A `.wmap` working file | Keep an editable copy without publishing |
| **Save**, on an existing region | Its `.wmap` working file | Save your editing session; compile separately |
| **Save**, on a new client world | Opens the publish confirmation | Publish a new world after saving its working file |
| **Compile to Client** | The open region's client map files in `Data/patch-3.MPQ` | See terrain, texture, model and water changes in the game |
| **Compile to Server** | Server map data built from the client's tiles, plus the region's spawn edits | Bring server collision/navigation data and spawns up to date |
| **Compile All** | Client map files, server map data and the region's spawn edits | Update both sides after editing a region |
| **Save Spawns to Database** | Creature and game object edits in the world database | Save spawn changes without rebuilding terrain |
| **Export Spawn SQL…** | An SQL file of the region's spawn edits, for VMaNGOS or CMaNGOS classic | Import the spawns into another server's world database yourself |

**Export Spawn SQL…** writes for the server core chosen under **Edit › Preferences… › Compile and
export › Spawn SQL for**. For **CMaNGOS classic**, the file uses CMaNGOS's tables and lists at the
top what they cannot hold: a spawn's display and equipment, formations, and a waypoint's wander
distance and script are left out. Meld still reads spawns from, and saves them to, the VMaNGOS
database only, so a new spawn's guid is one the VMaNGOS database had free; if your CMaNGOS database
already uses it, the import stops on that row instead of replacing the other spawn. The client
patch is the same for every core.

**File › Review Changes…** lists what these writes would change before you run one, and writes
nothing itself: for an open region, the client files Compile puts into the patch (each tile, with
whether the region's edits changed it, it is rewritten only because a neighbour's heights move the
normals along its edge, or it sits beside the region for a model or the normals by its edge, and the
far horizon) and each spawn Save Spawns adds, changes (with the fields) or deletes, with **Go there**
and its SQL; for a new client world, the files and the `map_template` row Publish writes. Files an
earlier write left waiting for the game to close are listed apart. The Publish and Save Spawns
confirmations open the same list with **Review changes…**.

For an open region, untick a tile or a spawn in that list to leave it out of the next Compile, Save
Spawns or Export Spawn SQL: it stays pending, and stays unticked until you tick it again (or close the
map). Spawns of one formation or pool whose grouping you changed tick together. Leaving out a tile next
to one that is written warns you, since the ground steps where they meet. **Copy** beside a spawn or
row, **Copy ticked SQL** and **Copy all SQL** put the SQL on the clipboard, to run elsewhere or keep.

**Compile acts on the open region**, not every edited tab. Switch to each region you intend to
compile. A whole-continent world view is for browsing: use **Edit Here** to open an editable block.

::: warning Writes affect your installation
Use a development client and server. Back up the client patch, your `.wmap` files and the databases
before a substantial editing session. Undo history is not a rollback for client files or database writes.
Keep independent copies outside the client/server folders; the automatic previous-patch copy is only
one generation and contains no database backup.
:::

## Prepare server compilation or publishing

Client-only compilation does not need a server. Before **Compile to Server**, **Compile All** or
publishing a new world, use a configured Windows VMaNGOS development installation:

1. Set its root folder in **Edit › Preferences… › Folders**. Meld expects
   `run/mangosd.conf` and a `data` directory beneath that root, not a path to `mangosd.exe`.
2. Complete the [database readiness checklist](../troubleshooting.md#database-features-cannot-connect),
   including the `mariadb` command-line client and the intended database connection.
3. Ensure the matching server tools are present at these paths beneath the server root:
   `run/Extractors/MapExtractor.exe`, `run/Extractors/VMapExtractor.exe` and
   `run/Extractors/VMapAssembler.exe`. They are invoked from that location, not found on PATH.
   Obtain them through your VMaNGOS build or distribution; Meld does not install them.
4. If using **Build movement maps on compile**, also provide
   `run/Extractors/MoveMapGenerator.exe`. If it is absent, Meld logs that movement maps were left
   unchanged; a successful map rebuild does not establish fresh navigation data.

Selecting a valid server folder only checks for its configuration and `data` directory; it does
not verify the extractors. Check these prerequisites **before** starting: client or SQL writes can
succeed before a missing extractor fails. Back up those destinations as described above.

## Compile an existing region

1. Save a `.wmap` working copy.
2. Run **File › Check Map** and resolve errors. With **Check the Map before Compile** enabled
   on the **Compile and export** page of **Edit › Preferences…**, errors stop Compile to Client
   and Compile All automatically.
3. Choose **Compile to Client** for client-only changes, or **Compile All** when the server also
   needs the updated terrain and spawns.
4. Read the status bar and progress messages. Close the game if client files are waiting, and stop
   the world server when the map rebuild asks you to.
5. Wait for completion before starting the world server and game again.

**Compile to Server reads the client's tiles**, not unsaved terrain directly from the editor.
If the client is behind your edits, use Compile All first. Otherwise you can end up seeing new
ground in the client while the server still uses old ground for movement and collision.

Spawn edits are a separate concern from client geometry. Compile to Client does not save them to
the database. Compile to Server and Compile All do, as does Save Spawns to Database. A running
server may need a restart to load the resulting changes; follow the status message.

### Read the result before retrying

Compile All is a sequence, not one transaction:

1. Queue or install the client region files.
2. Save spawn edits to the database, when a server is configured.
3. Rebuild server map data when the operation requires it.

A spawn-save error can leave the client changed and skip the rebuild. A later extraction error does
not undo the client or SQL writes. Read the log to identify the last successful step, fix its
specific error, and retry only with your backups intact. Do not assume that an error means nothing
was written.

If client files are unchanged, Compile All can still save spawn edits but does not automatically
rebuild stale server data; use Compile to Server when directed. Server-only compile refuses terrain
changes that have not reached the client. A rebuild can cover the whole map when its existing
server data is stale or the tile layout changed.

A region compile can also write neighboring tiles outside the open block: shared model bounds and
terrain normals cross tile edges. Back up more than just the visible block. The first unedited
compile may normalize tile serialization and report changes without visible edits.

## Understand pending writes

Compiling, publishing and saving client data do **not** automatically stop or restart the game or
servers. Meld waits for you to close or stop them when their files are in use.

On Windows, a running game can lock the patch. Meld queues the files and displays the pending
count in the status bar. Once you close the game, the pending-write watcher installs them. Do not
assume that a successful compile message means a game that is already running has loaded new data.
On Linux, the app does not use the Windows running-game lock check to queue files. A patch write
may happen immediately even while the game is open; close it first to avoid stale loaded data.
Linux process detection used by launch controls does not imply Windows-style pending-write waits.

Queued files persist in the user cache, separately for each client Data folder. Meld reads them
for its own previews, but the game has not received them yet. A failed watcher can stop retrying
and leave them waiting for a later patch write. Check the pending count and Help › Log; do not
delete the pending cache or repeatedly click Save. See the
[local-data and backup map](settings-and-data.md) before moving client folders or restoring patches.

The server's map data is rebuilt when the world server is stopped. Start the server yourself after
the rebuild completes. If a wait or write fails, inspect **Help › Log** rather than repeatedly launching.

## Publish a new world

New worlds need more than replacement continent tiles: the client and server must also know that
the map exists.

1. Set the WoW client folder and complete [server preparation](#prepare-server-compilation-or-publishing).
   The database connection comes from the server configuration; extractor paths use the layout above.
2. Save a working copy with **Save As** and review **File › Map Properties**.
3. Use **Save** and review the publish confirmation. The workflow saves the map before publishing it.
4. Close the game and stop the world server when asked. Watch the progress log until publishing
   finishes, then start them again yourself.

Publishing writes the client's map files and table entries and prepares the corresponding server
data. It is not the same as copying a `.wmap` into the client folder.

Cancelling the confirmation or file picker is not a rollback operation. Before publishing begins,
keep the working file with Save As. Once publishing starts, its client patch, server Map.dbc,
map-template SQL and extracted data are separate writes. A failure after one of them succeeds
leaves that result in place. Saving the working file successfully also does not mean publishing
succeeded.

### Server extraction and movement maps

The map/vmap extractors build into a staging folder before installing their results. An extractor
that fails before installation leaves the old map/vmap output in place; the client patch or SQL
may already have changed. Installing staged files afterward is not an all-or-nothing replacement
of every server file. Stop the server and preserve its complete data backup before recovery.
Meld neither restarts it after failure nor turns a failed publish into a rollback.

Build movement maps on compile, under Edit › Preferences… › Compile and export, controls the
optional navigation-data generator. Its failure is logged without failing the whole publish.
Rebuilding a whole map removes that map's previous movement-map files before generation, so a
failed run can leave missing or incomplete navigation data. Check the log even after a successful
compile. Meld does not change `mmap.enabled` in `run/mangosd.conf`; the server administrator must
decide whether to enable and validate movement maps.

### Older working files

Meld reads `.wmap` versions 1–7. Older files may not know the client's holes, liquid layers or
chunk headers. Export preserves unknown client metadata rather than treating absent data as an
instruction to erase it: legacy hole edits are additive, missing chunks in partial liquid data
are kept, and unknown headers are omitted. A newer file version alone does not mean all previously
unknown data has been recovered. Keep the original `.wmap` and client backup when upgrading an
old project; synthetic round-trip tests do not certify every map in the game.

## Launch at the camera or move a character

Set the VMaNGOS server folder and configure **Game › Game Login** with the account and character
you intend to use.

- **Launch** starts the selected client. With a configured character and server, it closes the
  game, waits for the character to log out and places the character below the editor camera before
  starting the client. Without that setup, it simply launches the client. It can offer to compile
  when the open region has changes the client does not have.
- **Play Here** moves a character that is already in the world without closing the game. It needs
  the running world server's SOAP console and an account with GM level 3.

For Play Here, set `SOAP.Enabled = 1` in the server's `mangosd.conf` and restart the world server
after changing that configuration. If SOAP is unavailable or the character is offline, use Launch.

The same console sets up the Game Login character for a test, from the right-click menus:

- **Set <character>'s level to N** on a creature spawn sets the character to the creature's level
  (the top of its range, at most 60), in the world or logged out.
- **Mail to <character>** on an item in the Item Editor's list or on a loot row mails the item (or
  the row's most, or a stack of the open item) to the character's mailbox, since the console cannot
  put an item in a bag.

The entries are greyed out, with the reason under them, while the world server is not running,
SOAP is off or Game Login has no character. Giving, completing or removing a quest is not there
yet: VMaNGOS does not allow its `.quest` commands from the console.

Explicit **Launch** is the exception to the no-automatic-close behavior of saves and compiles.
Launching the client is not a replacement for completing a pending server rebuild.

## Recover the previous client patch

Meld writes client changes to `Data/patch-3.MPQ`. Each patch write keeps the previous patch as
`Data/patch-3.MPQ.prev`. **Only the most recent previous patch is retained**; this is not a full
backup history and does not back up your server or databases.

If a patch write lost client content:

1. Close the game and Meld so no pending writer can replace the patch while you recover it.
2. Make separate copies of both `patch-3.MPQ` and `patch-3.MPQ.prev` for investigation.
3. Move the current patch aside, then rename `patch-3.MPQ.prev` to `patch-3.MPQ`.
4. Check the restored client before editing or compiling again.

Pending files can be applied by a later write after Meld restarts. Preserve their cache alongside
the patch copies and investigate the pending count before resuming; simply restoring `.prev` does
not cancel queued edits. Do not restore just the patch and assume server tables, map data, icons
or database templates have also reverted. Some item saves can write client display data before
a database error; spell and linked-table saves can persist SQL before a client error.
See [database and client-table authoring](database-editing.md) for per-editor save boundaries,
immediate icon imports and shared-row precautions.

## Recover unsaved editor work

Autosave is an interval-based recovery aid, not a copy of every keystroke. It can skip a busy
operation or an unfinished stroke, and disabling it means no new recovery copies are taken.
After a crash, choose an offered copy and immediately Save As to a separate `.wmap`. The recovered
map has unsaved changes; opening it consumes that recovery copy, so save it before closing.
A clean File › Quit removes this session's recovery copies after the author has saved or discarded
work. Session restore reopens saved tabs; it is not recovery of unsaved content.

These contracts are source-checked and supported by selected synthetic tests, not a claim that
this guide's real-client/server workflow was executed on every platform. Contributor recipes are
in [client and export checks](../tests/client.md). For storage locations and backup boundaries,
see [Settings, local data and backups](settings-and-data.md); for symptoms and redacted bug
reports, see [Troubleshooting](../troubleshooting.md).
