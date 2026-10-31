# Troubleshooting

Start with the symptom below. Before changing client files or databases, keep a copy of the
affected files and the relevant log messages.

For settings/log/recovery locations and safe backup precautions, see
[Settings, local data and backups](guides/settings-and-data.md). Do not delete the whole cache:
it can contain pending client writes and the only copy of unsaved edits.

## Database features cannot connect

Use this checklist for creature/object/quest/item/spell editors, spawn reads and saves, SQL
import/export and publish database steps. These use the configured server's databases, not a
standalone database embedded in the map. Opening a picker, query, preview or export can contact
and, on Windows, start the local database; Save is not the only trigger.

### Check the prerequisites

1. In Edit › Preferences… › Folders, set the VMaNGOS server folder containing `run/mangosd.conf`
   and `data`, and the WoW client folder. Many database editor bindings require both, even for
   SQL-related actions. A portable project or `.wmap` does not supply either installation.
2. Make the executable named `mariadb` available on the PATH inherited by Meld. Restart Meld if
   its process has an older PATH. Check discovery without connecting:

   PowerShell:

   ```powershell
   Get-Command mariadb
   mariadb --version
   ```

   Linux shell:

   ```sh
   command -v mariadb
   mariadb --version
   ```

3. Check the connection in the selected server's `run/mangosd.conf`. The parser expects five
   semicolon-separated fields in quotes: host, numeric port, database user, password, database name.
   This shape example contains placeholders, not credentials to copy into a working installation:

   ```ini
   WorldDatabase.Info = "127.0.0.1;3306;YOUR_DB_USER;REDACTED;YOUR_WORLD_DB"
   ```

4. Ask the server/database administrator to verify the account and access to the intended schema.
   Read operations need query access; writes need the relevant table permissions. Do not solve an
   authentication or missing-table error by granting unrestricted privileges or using production
   credentials. Back up the databases before authoring.

`CharacterDatabase.Info` and `LoginDatabase.Info` are separate connection entries used by relevant
character/account operations. Game › Game Login is a game account/character selection, **not** the
SQL username and password. Changing Game Login will not fix database authentication.
Never paste the real connection line into a public log or bug report; redact it as described in
[Settings, local data and backups](guides/settings-and-data.md).

### Follow the actual error

| Message or symptom | What to check next |
| --- | --- |
| `mariadb` not found / not on PATH | Install or expose the query client named mariadb, then check the PATH of the Meld process. Finding mysql alone is not enough: the query and script transports execute mariadb. |
| Missing `run/mangosd.conf` / no WorldDatabase.Info | Verify the selected server root, key spelling, quotes, five fields and numeric port. Do not edit the client folder's configuration instead. |
| Access denied / authentication failure | Verify the database credentials, host and permissions with the administrator. Meld does not fix a wrong password by starting another database. |
| Connection errors 2002/2003 / Can't connect | Confirm the configured host/port and that its service is running. See the platform-specific startup behavior below; do not assume every connection error means a local daemon should be started. |
| Missing table/column or rejected query | Check the server schema/version and selected database. A successful connection does not certify every editor's schema support; preserve the error before changing tables. |
| Database saved, client patch failed | The SQL may already be persistent. Fix the patch error and follow the Save-again message; see [partial-write recovery](#a-write-failed-after-some-changes-were-saved). |

### Understand automatic startup

On **Windows**, a connection-refused result can make Meld attempt to start the database bundled
with the configured server. It needs `<server>/database/my.ini` and `mariadbd.exe` or `mysqld.exe`
next to the discovered command-line client. Meld starts it with that defaults file and a console,
then retries connections for about 30 seconds. Missing my.ini/daemon and a daemon that never
answers have different errors. Do not point this fallback at an unrelated installation; verify
the server root and host before opening database workflows.

Daemon discovery can fall back to finding mysql, but query execution still requires mariadb.
An installed mysql executable is not a supported substitute for that query-client prerequisite.
This database startup is distinct from starting the world server or rebuilding map data.

On **Linux**, start and manage the configured database service yourself. Meld does not start the
Windows-style bundled database there; working SQL features do not imply that Windows map
extractors or integrated server process management are available.

These are source-verified prerequisites and error branches. Native service installation, grants
and actual Windows/Linux database startup were not executed for this documentation update.

## Models or textures are missing

1. Check the **WoW client folder** under **Edit › Preferences… › Folders**. Meld needs your own 1.12.1 installation,
   not just a `.wmap` from someone else.
2. Look in the asset browser. If it has no client assets, choose the installation folder or its
   `Data` folder again and inspect **Help › Log** for archive-loading errors.
3. If only one map has placeholders, check that the client contains the asset paths that map uses.

Maps store asset paths, not the models or textures themselves. Copying a project does not copy
its client installation. The first thumbnail pass also takes longer than subsequent cached loads.

## My saved changes do not appear in the game

Saving an existing region to `.wmap` does not update the client. Use **Compile to Client** or
**Compile All**, and make sure the intended region is the active tab.

If files are pending, close the game and wait for the status bar to report that the write is
finished. Then start the game again. A running client may still hold old assets even when its
patch can be replaced.

If the ground looks right but movement, collision or creatures are wrong, the client and server
may be out of sync. Rebuild the server's map data and save the spawn edits as appropriate; stop
the world server when requested and restart it after completion. See
[Saving, compiling and playing](guides/saving-and-compiling.md).

## A compile or publish seems to be waiting

Read the progress messages and pending-file count. Meld does not close the game or stop the world
server for these operations. Close the game to release its patch, and stop the world server for
its map rebuild when asked.

Do not repeatedly launch or compile while a write is waiting. If the operation fails or pending
files do not clear, inspect **Help › Log** for the actual file-lock, permission or server error.

## A write failed after some changes were saved

Read the entire error, especially any message that data is already saved and to Save again.
Client patches, world-database rows, server DBC copies and extracted map data are not one
transaction. Map Undo and editor Revert do not reverse those external writes.

1. Stop editing and preserve the log, current patch, pending cache, working file and database/data
   backups. Do not delete the whole cache or assume a failed operation changed nothing.
2. Identify the failed destination: patch lock/ownership/permission, SQL connection/validation,
   server DBC copy or extractor. Correct that error before retrying.
3. If the error says the database was saved but the patch failed, use Save again to retry the
   client portion. Creating a new template again can create an extra database entry instead.
4. After recovery, check both client and server state and follow the restart messages. A previous
   patch restores no database rows or server map data.

Extraction staging protects old map/vmap output when an extractor fails before installation;
it does not make the later replacement of all files atomic. Optional movement-map generation
can fail with only a log warning. See [write order and recovery limits](guides/saving-and-compiling.md).

## An item or object still has its old name or appearance

First verify that its template Save succeeded; compiling terrain does not save every template.
If client files are pending, close the game and wait for installation before starting it again.
Restart the world server when the save message requires it.

Meld tracks changed item/object IDs in memory and prunes their game-cache entries during its
managed launch sequence. A game started outside Meld may still use its cached template. Close the
game, then use Launch from the same Meld session after saving; exiting Meld first loses that
in-memory ID list. Cache-pruning failures are logged and do not prevent launch, so inspect
Help › Log if the old data remains. Do not delete recovery or pending-client data to fix a game cache.
Contributor details are in [template-cache checks](tests/client.md).

## Check Map prevents compilation

Open **File › Check Map** and inspect findings marked as errors. With **Check the Map before
Compile** enabled, errors stop Compile to Client and Compile All.

Correct the reported problem before retrying. Disabling the check only bypasses the guard; it
does not make the map valid.

Use the [Check Map workflow](MANUAL.md#check-a-map-before-compiling) for focusing findings,
undoable fixes and Check again. Unloaded models and unavailable client/database checks limit the
scan; an empty list is not game or publish verification.

## Play Here does not work

Play Here requires all of the following:

- Windows for Meld's integrated server tooling.
- A configured VMaNGOS server folder and a running world server.
- An account and character configured in **Game › Game Login**.
- That character already online in the world.
- The server's SOAP console enabled and the account at GM level 6 (Administrator) in realmd's
  `account_access`.

Enable `SOAP.Enabled = 1` in `mangosd.conf` and restart the world server if needed. Use **Launch**
instead when the character is offline or SOAP is unavailable. Launch can close the game and wait
for the previous session to log out before placing the character; this is separate from compiling.

## Benilla does not launch or shows different results

Follow the [Benilla setup guide](BENILLA.md), especially the release-build location and launcher
layout. Check `benilla-config/meld-benilla.log` when using Meld's launcher.

If the same compiled map looks different in Benilla and Wow.exe, compare both before deciding
the export is wrong. They read the same client data but do not necessarily render every feature
identically. Do not change a map format just to compensate for an unverified client difference.

## Meld crashed with unsaved work

With autosave enabled, Meld periodically keeps recovery copies of maps with unsaved changes and
offers copies left by earlier sessions when it starts again. The latest stroke may not be in a
copy; a busy operation can postpone it. A very recent crashed session can take a short time to
be recognized as no longer running.
If a recovery is offered, open it and save a separate `.wmap` before making more changes.
Recovery is not a substitute for regular saves or independent backups.

If the problem is lost content in the client patch rather than unsaved editor work, use the
[previous-patch recovery procedure](guides/saving-and-compiling.md#recover-the-previous-client-patch).
That procedure does not restore server database changes.

## Linux: Wayland protocol error or poor rendering performance

For `Error 71 (Protocol error) dispatching to Wayland display`, Meld already sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` to work around the WebKitGTK DMA-BUF issue. If the crash persists,
try an X11 backend, for example from a terminal:

```sh
GDK_BACKEND=x11 ./build/bin/Meld
```

For low FPS, verify that hardware acceleration works in WebKitGTK. Meld requests an accelerated
webview, but that cannot correct missing graphics drivers. Record render scale, view distance,
shadows and the scene you were viewing when reporting performance problems.

## Write a useful bug report

Include:

1. Your OS, Meld revision/build and whether this is the desktop app or a development browser page.
2. The shortest sequence of actions that reproduces the problem, plus expected and actual behavior.
3. The relevant messages from **Help › Log** and a screenshot if the problem is visual.
4. **Help › Copy Scene** output, when available, so another person can reproduce the map and camera.
5. Whether the problem affects the `.wmap`, the client patch, server map data or database spawns.

Review logs and scene descriptions before sharing them: remove account information, private paths
or connection details you do not want public. Do not attach Blizzard assets or a client installation.
