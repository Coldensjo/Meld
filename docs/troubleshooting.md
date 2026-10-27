# Troubleshooting

Start with the symptom below. Before changing client files or databases, keep a copy of the
affected files and the relevant log messages.

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

## Check Map prevents compilation

Open **File › Check Map** and inspect findings marked as errors. With **Check the Map before
Compile** enabled, errors stop Compile to Client and Compile All.

Correct the reported problem before retrying. Disabling the check only bypasses the guard; it
does not make the map valid.

## Play Here does not work

Play Here requires all of the following:

- Windows for Meld's integrated server tooling.
- A configured VMaNGOS server folder and a running world server.
- An account and character configured in **Game › Game Login**.
- That character already online in the world.
- The server's SOAP console enabled and the account at GM level 3.

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

Meld keeps recovery copies of maps with unsaved changes and offers them when it starts again.
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
