# Getting started

Meld edits worlds for **World of Warcraft 1.12.1** on Windows and Linux. You can create a new
world or edit part of an existing continent, then write the result to your own client and
VMaNGOS server.

This guide gets you from the first launch to a saved map. To build the application first, see
[Building and development](development.md).

## What you need

| What you want to do | What you need |
| --- | --- |
| Sculpt terrain and arrange client models | Meld and your own WoW 1.12.1 client installation |
| Edit part of Azeroth | The client, plus a project folder to keep your work in |
| Edit database spawns or play your changes | A configured VMaNGOS server and its MariaDB database |
| Use Benilla instead of Wow.exe | A separate [Benilla build](BENILLA.md) |

The integrated VMaNGOS server-management and map-extraction workflow currently requires Windows.
Linux supports the editor, but not that Windows-specific automation.

Meld does not include Blizzard's assets. It reads models, textures and tables from the client's
MPQ archives as needed. A `.wmap` stores references to those assets, not copies of them.

::: warning Before editing a client or server
Use a development client and server, and keep independent backups of their files and databases.
Saving an editor document and compiling into the game are different operations. Read
[Saving, compiling and playing](guides/saving-and-compiling.md) before writing to either.
:::

## 1. Connect your client

1. Open Meld.
2. Open **Edit › Preferences…** (`Ctrl+,`), choose **Folders**, and set your WoW client folder.
   You can also use **Select WoW folder…**
   in the asset browser; it accepts the installation folder or its `Data` folder.
3. Wait for the asset browser to populate. Open **Models** or **Textures** and search for an asset.

Assets are decoded on demand. Thumbnails are generated as they become visible and cached for
later sessions; nothing needs to be extracted into your project.

## 2. Choose a starting point

### Create a new world

Open **File › New World** (`Ctrl+N`) and choose **New world**. Enter a name and choose a size,
preset and seed. Use the preview to choose a starting shape, then create the map.

The preset is only a starting point: you can reshape the terrain, change the textures and place
your own models. Publishing a new world also requires the VMaNGOS setup described in the
[save and compile guide](guides/saving-and-compiling.md#publish-a-new-world).

### Edit part of an existing continent

1. Open **File › Project…** and choose a project folder and the client installation it edits.
2. Open **File › Open Part of Azeroth**, or choose **Part of Azeroth** in the start dialog.
3. Pick a continent. Use the zone list to find an area, or navigate the minimap.
4. Drag a square of tiles to open; a region can be up to 8 × 8 tiles.

The region opens in its own document tab with the client's terrain, textures and models. A project
keeps your working files organized and identifies the client you intend to edit; it is not a backup.

## 3. Find your way around

- **Toolbar:** chooses the tool. The **options bar** above the map holds that tool's settings.
- **Asset browser:** models and textures along the bottom. `Ctrl+F` focuses its search box.
- **Dock:** panels such as Layers and Properties. Drag the dock edge to resize it.
- **Document tabs:** each map has its own camera and undo history. `Ctrl+Tab` switches tabs.
- **Status bar:** tool hints, progress and warnings, including pending client writes.

Hold the **right mouse button** to look around and use **W A S D** to fly. **Space / X** move
up and down, **Shift** moves faster, and the wheel adjusts flight speed. Press **T** to toggle
Follow the Ground, which changes the camera to orbit and zoom around the terrain.

These are the default keys. In Preferences, open **Camera and input › Keyboard shortcuts** to
launch the Hotkey Manager. **Help › Keyboard Shortcuts** shows the bindings in your installation.

## 4. Make a small edit

Try one change at a time so you can see what each tool does:

1. Press **2** for Sculpt. Choose Raise or Lower and drag over the terrain. Use **[ / ]**
   to adjust the brush size.
2. Pick a texture in the asset browser. Meld selects Paint; brush the texture onto the ground.
3. Pick a model. Meld selects Place; move the preview over the map and click to place it.
4. Press **1** or **V** for Select and click the model. Drag it to move it, or press **I**
   to inspect its placement.
5. Use **Ctrl+Z** to undo and **Ctrl+Y** to redo.

For water, paths, selection areas, scripts and the rest of the tools, see the [manual](MANUAL.md).

## 5. Save a working copy

Use **File › Save As** (`Ctrl+Shift+S`) to save a `.wmap` working file. Reopen it with
**File › Open** (`Ctrl+O`). Keep this file even after compiling: it is your editable source.

For a map created as a new client world, ordinary **Save** opens a publish confirmation instead
of behaving as a simple file save. **Save As** saves a working copy without publishing.
For an existing region, saving its `.wmap` does **not** compile its edits into the client.

## Where to go next

- [Saving, compiling and playing](guides/saving-and-compiling.md): what gets written, where,
  and when you need to close the game or stop the world server.
- [Manual](MANUAL.md): tools, camera controls, menus and scripting.
- [Troubleshooting](troubleshooting.md): missing assets, pending writes, recovery and bug reports.
- [Building and development](development.md): build Meld or work on its code.
