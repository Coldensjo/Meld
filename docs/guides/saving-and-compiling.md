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

**Compile acts on the open region**, not every edited tab. Switch to each region you intend to
compile. A whole-continent world view is for browsing: use **Edit Here** to open an editable block.

::: warning Writes affect your installation
Use a development client and server. Back up the client patch, your `.wmap` files and the databases
before a substantial editing session. Undo history is not a rollback for client files or database writes.
:::

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

## Understand pending writes

Compiling, publishing and saving client data do **not** automatically stop or restart the game or
servers. Meld waits for you to close or stop them when their files are in use.

On Windows, a running game can lock the patch. Meld queues the files and displays the pending
count in the status bar. Once you close the game, the pending-write watcher installs them. Do not
assume that a successful compile message means a game that is already running has loaded new data.
On other platforms the patch may be writable while the game runs, but loaded assets can still be stale.

The server's map data is rebuilt when the world server is stopped. Start the server yourself after
the rebuild completes. If a wait or write fails, inspect **Help › Log** rather than repeatedly launching.

## Publish a new world

New worlds need more than replacement continent tiles: the client and server must also know that
the map exists.

1. Set the WoW client and VMaNGOS server folders. The server's configuration must point to working
   databases and the map-extraction tools needed by the publish process.
2. Save a working copy with **Save As** and review **File › Map Properties**.
3. Use **Save** and review the publish confirmation. The workflow saves the map before publishing it.
4. Close the game and stop the world server when asked. Watch the progress log until publishing
   finishes, then start them again yourself.

Publishing writes the client's map files and table entries and prepares the corresponding server
data. It is not the same as copying a `.wmap` into the client folder.

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

For editor crash recovery and information to include in a bug report, see [Troubleshooting](../troubleshooting.md).
