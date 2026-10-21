# Export, the client and the game

What Meld writes for the client and server, and launching the game. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first.

## Launch where the camera is (character placement)

Checks: Launch puts the Game Login's character on the ground below the camera, on the open map,
facing the camera's way. Unit tests: `internal/vmangos/character_test.go` (waits for the logout,
the UPDATE it writes), `internal/game/session_test.go` (`WOW_REALM`, `WOW_CHAR`, `StopGame`),
`tests/portCoords.test.ts` (`serverSpot`: position and facing). Against the real server, read the
row before and after: `mariadb -h 127.0.0.1 -P 3307 -u root -e "select map, zone, position_x,
position_y, position_z, orientation, online from characters.characters where name = 'Sizaro'"`.
Once in the world, close the game: the server saves the character on logout, and the row then shows
where it really stood (the zone too, which only the server sets).
- Trap: a character still in the world is saved over its row when it leaves, which undoes the
  placement. So the row is only written once `online` is 0. Benilla logs out as it closes, but a
  killed client (`taskkill /F`) leaves the character in for two minutes (ForceLogoutDelay).
- Trap: without `WOW_REALM` Benilla stops at the realm list, so `WOW_CHAR` never applies.

## Play here: move the character in the world (#13)

Checks: Game › Play Here moves the Game Login's character, in the world, to the spot Launch would
use, without closing the game. Unit tests: `internal/vmangos/soap_test.go` (mangosd.conf's SOAP
settings, the SOAP envelope, a fault and a refused login against an `httptest` server, the
`game_tele` SQL and the two commands). Live: needs `SOAP.Enabled = 1` in mangosd.conf and a world
server restart (the owner's call; it is off on this machine), then the character in the world and
Play here at open ground, inside a building and on another map; the character must stand there.
Without the game, the console can be driven alone: `curl -u <account>:<password> -d @envelope.xml
http://127.0.0.1:7878/` with the envelope in `soap.go` and the command `server info`.
- Trap: the world server reads `game_tele` only at start, so the row is useless until `reload
  game_tele`. `tele name` matches names by substring when no name is exact, so keep `meld_here` unique.
- Trap: the SOAP account needs GM level 3 (`realmd.account.gmlevel`); a lower one gets HTTP 403.
- Trap: the key is `SOAP.Enabled`, though mangosd.conf's comment block calls it `SOAP.Enable`.

## Benilla launcher: nothing on screen until the world (benilla-launcher)

Checks: started by Meld with a login and a character, `meld-benilla.exe` shows no console and no
window until the character is in the world, then its game window in front. Unit tests: `cargo test
--release` in `benilla-launcher` (when the window hides and shows), `internal/game/session_test.go`
(`BenillaExe` prefers the launcher; it's started through `StartLogged`, not `cmd /c start`). Live: run
the session's `StopGame`, `vmangos.PlaceCharacter` and `StartGame` from a scratch program, and sample
the launcher's windows every 50 ms with user32's `EnumWindows`, `IsWindowVisible` and `GetClassName`
(PowerShell `Add-Type`): the game's window is class `Window Class`, created hidden; `ConsoleWindowClass`
must never appear. Its log is `C:\WoW\benilla\benilla-config\meld-benilla.log`, with
`meld-benilla: in the world, showing the window` at the reveal.
- Trap: winit's `Winit Thread Event Target` counts as visible but is never on screen; leave it out.
- Trap: a launcher started from a script that isn't in front can't take the foreground, so it opens
  behind; Meld, in front when Launch is clicked, hands it the right (`AllowSetForegroundWindow`). Judge
  the foreground only from a real click.
- Trap: a running launcher locks `meld-benilla.exe`, so a rebuild fails with "access denied".

## The game's template cache after an editor's Save (#234)

Checks: a creature or game object template saved in its editor is taken out of the game's caches
(`WDB\creaturecache.wdb`, `WDB\gameobjectcache.wdb`, Benilla's `benilla-config\cache\<realm>.tsv`
`C` lines) at once when the game is closed, else when Meld next starts the game. Unit tests:
`internal/game/cache_test.go`. Against the real files, compare the caches with the database: parse
each WDB file (a 20-byte header, then entry, size and data records, ended by 8 zero bytes; a game
object's data starts type, display id, four names; a creature's starts four names) and select the
same entries' `name`, `type`, `displayId` from the newest patch row of the template table. In the
game: rename an object, Save with the game closed, start it from Meld and look at the object.
- Items (#353): the item editor's Save and Import take the items out of `WDB\itemcache.wdb` (the whole
  template, 513-byte records here) and `WDB\itemnamecache.wdb` (the name), both keyed by the item's
  entry like the others (`TestForgetPrunesTheClientCaches`). In the game: rename an item you carry,
  Save with the game closed, restart the world server, start the game from Meld and hover the item.
- Trap: the game writes its caches back as it exits, so pruning while it runs is undone. That is
  why a Save with the game open waits for Meld's next start (`Session.Start`). A game started
  outside Meld after such a Save still shows the old template; the entries are kept in memory only,
  so closing Meld first loses them too.

## Minimap tiles for the client (B-129, #17)

Checks: Import/Export › Write Minimap Tiles to the Client draws each tile from above and writes it
into the client's minimap (BLP plus md5translate.trs in Meld's patch).
- Go: `TestEncodeMinimapBLPReadsBack`; with `WOW_DIR=C:/WoW/client`, `TestClientMinimapReencoded`
  (Northshire's own tile, decoded and written again: the header equals the client's byte for byte,
  33940 bytes, BLP2 DXT1 one mip) and `TestMinimapFilesSetTheTiles` (index rows set, every other row
  kept, identical tiles share one file, and a patch written to a temp folder reads back).
- Render: on Northshire, `__engine.renderMinimapTile(0, 0, 'buildings')` gives 256x256 RGBA, row 0
  north. Compare with the client's tile through `/wow/texture?path=textures\Minimap\ea283abc0bf9637c3fad5e840a65b38b.blp`
  (Azeroth 32_48; the reply is "RGBA", width, height, then pixels from byte 12): the abbey and the
  roads land in the same place, and the mean brightness is close (89 against 84). To look at both,
  draw them on a canvas and save it with `go.main.App.SaveThumbnail(key, pngBase64)`, then read the
  newest PNG under `%LOCALAPPDATA%\Meld\thumbs`.
- The client's tiles show the buildings (WMOs) but not the trees, hence the default; their rock is
  darker and more shaded than the editor's top-down light.
- Not run against the real client in the loop: the write replaces that map's minimap tiles in the
  owner's game.
- Traps: a render target only gets three's tone mapping and sRGB output when it is the screen or an
  XR target, so the shot's target is flagged `isXRRenderTarget`; and with `colorSpace` sRGB three
  stores it as an sRGB texture, which encodes a second time (a pale picture), so its
  `internalFormat` is `'RGBA8'`.

## Server map extraction for one map (Publish, #174)
Checks: Publish runs the VMaNGOS extractors on the published map only: MapExtractor with `-m <id>`
(and `-t x_y,...` for the tiles the export wrote, when the server was current before it), VMapExtractor
with `-m <id>`, then VMapAssembler, which rebuilds only that map's `.vmtree`/`.vmtile` files.
- Go: `TestPublishServerExtractsOnlyTheMap` (the arguments, the map's old vmtree/vmtile and tile files
  removed, other maps' kept), `TestPublishServerExtractsEveryMapWithoutWholeVmaps` (no
  `vmaps\temp_gameobject_models` means vmaps were never built whole, so every map is extracted) and
  `TestChangedTiles`.
- Extractors by hand, without touching the server: run them in an empty scratch folder (VMapExtractor
  writes `.\Buildings` in the working folder and refuses a folder that already holds `Buildings\dir_bin`):
  `MapExtractor.exe -i C:\WoW\client -o . -e 1 -m 0 -t 32_48,33_48,32_49,33_49 --silent`, then
  `VMapExtractor.exe -l -d C:\WoW\client\Data -m 0 --silent`, then `VMapAssembler.exe Buildings vmaps --silent`.
  Compare with a full run in another folder (no `-m`): the `maps` files, `000.vmtree`, every
  `000_*.vmtile` and every model file came out byte for byte the same on 2026-10-16.
- Timings then (Azeroth 2x2 around Northshire against every map): maps 0 s against 14 s, vmap extract
  19 s against 51 s, assemble 9 s against 20 s.
- The extractors' sources are on vmangos's `local` branch (`contrib/extractor/System.cpp`,
  `contrib/vmap_extractor/vmapextract/vmapexport.cpp`). Rebuild them with
  `cmake -S . -B build/extractors -G "Visual Studio 17 2022" -A x64 -DBUILD_EXTRACTORS=ON -DUSE_SCRIPTS=OFF -DBUILD_FOR_HOST_CPU=OFF -DENABLE_CPPTRACE=OFF`
  and `cmake --build build/extractors --config Release --target MapExtractor VMapExtractor`; the exes land
  in `vmangos\bin\Release`, to be copied into `run\Extractors`. The old `vmangos\build` cache points at
  the folder's former place (`C:\Servers\Software\vmangos`), so it can't be reused.
- Compile All and Compile to Server (#211, #214) reuse it: `SaveRegion` returns `changedTiles`, `mapId` (0 Azeroth, 1 Kalimdor) and
  `tilesCurrent`, and with a VMaNGOS folder set `compileRegion` calls `UpdateRegionServer` (Compile to Server with the
  region's own tiles), which runs `vmangos.UpdateServerMaps` (the publish without the database
  step) in the background and reports through `servermaps:log`/`servermaps:done`. It stops and restarts mangosd, so
  not for the loop to try against the live server. Go: `TestFileTileName`.
- What a patch write closes (#469): `installClosed` (`app.go`) closes the game alone through
  `game.Session.Around`, so `SaveRegion` leaves mangosd to `UpdateRegionServer` (one restart a Compile
  All) and realmd is never closed; only SaveTaxi, Zones and Portals with a server folder close mangosd
  too, for the tables it reads at its start. Go: `TestAround*` in `internal/game/session_test.go`. The
  live path runs only on Windows outside the probe sandbox (`gameSession` refuses there), so check it by
  hand with the owner's go-ahead: Compile to Client with realmd and mangosd running leaves both PIDs
  unchanged (`tasklist /FI "IMAGENAME eq mangosd.exe"`).
- Trap: an old extractor without `-m` stops at its usage text (exit 1), so Publish then fails with
  "map extraction".

## Compile to Server and Compile All save the spawn edits (#342)
Checks: Compile to Server and Compile All write the region's spawn edits into the world database
before the server rebuild, a failed write stops the rebuild, and Compile to Client never writes them.
- Probe `compile-spawns` (`bun run probe compile-spawns`, about 8 s): opens Azeroth 31_50 and swaps the
  bindings the compile calls (`VmangosPath`, `SaveRegion`, `ApplySpawnEdits`, `UpdateRegionServer` on
  `window.go.main.App`) and `Engine.spawnEdits` for stand-ins that record the call order, so it writes
  nothing and never restarts mangosd. The wailsjs wrappers look the binding up at call time, which is
  what makes the swap work; restore them in a `finally`.
- Trap: the rebuild flag (`serverMapsRunning`) stays set until Go sends `servermaps:done`, so a second
  compile in the same page says "still being rebuilt" and skips `UpdateRegionServer`. The probe sends
  the event itself (`window.runtime.EventsEmit('servermaps:done', '')`) after each compile.
- Against the live database, by hand with the owner's go-ahead (it restarts mangosd): move a spawn,
  Compile to Server, read the row back with mariadb (port 3307), then move it back and compile again.

## Compile to Client, Server, All and Launch's check for uncompiled edits (#214)
Checks: the File menu's three compile entries, and that Launch asks before starting the game while the
open region has edits the client lacks, and only then.
- Probe `compile-launch` (`bun run probe compile-launch`, about 5 s): opens Azeroth 31_50, checks the menu,
  that the region counts as compiled as it opens, that a history step changing no compile input (as a
  spawn edit is) keeps it so, that a raised vertex makes it uncompiled and its undo compiled again, that
  Launch then opens the Compile and Launch dialog without starting anything, that growing the region
  (`extendRegion`, #318) with the raised vertex or with a spawn edit counted is refused with a status
  line naming Compile to Client or Save Spawns and keeps the 1×1 tab, and that the Go side's
  `RegionPending` (used for a region opened from a file) finds the raised tile.
- It never compiles: Compile to Client writes the owner's `patch-3.MPQ` (closing the game), and Compile
  to Server or All restart mangosd. Check those by hand, with the owner's go-ahead: after Compile to
  Client the patch's time changes and `ReadRegion` of the tile gives the edited heights.
- Trap: an unedited block built by `BuildRegion` is not byte-equal to a tile the client has never had
  compiled (the builder orders an MCNK's subchunks its own way), so `RegionPending` says "changed" for
  any such tile. That's why Launch trusts the fingerprint and asks Go only when there is none.
- `go test ./internal/vmangos/ -run TestRegionPending` (with `WOW_DIR`): a raised vertex makes the tile differ.

## A map's own loading screen (Map Properties › Picture…, #218)
Checks: a PNG becomes a map's loading screen: the BLP, its LoadingScreens.dbc row and the map's
Map.dbc row pointing at it.
- The client's own (surveyed 2026-10-17): LoadingScreens.dbc has 40 rows of 3 fields (ID, name, path);
  all 39 pictures are BLP2 DXT1 512x512 with alpha depth 0, some with mips (175948 bytes) and some
  without (132244 bytes, which `EncodeMinimapBLP` writes byte for byte in size). Map.dbc field 38 is
  the row (Deadmines 36 shows 142).
- Go: `TestSetLoadingScreenRowAddsAndReplaces`, `TestLoadingScreenNameKeepsToTheFolder`,
  `TestSetMapLoadingScreen`; with `WOW_DIR=C:/WoW/client`, `TestLoadingScreenFromClient` reads the
  Deadmines' picture, writes it again as map 36's own (row 206, within 0.1 a channel), the client's
  rows unchanged and Map.dbc's row 36 pointing at it.
- Probe `loading-screen`: a map made for the client (the probe sets `doc.meta.vmangos`) lists the
  41 choices, previews the Deadmines' picture and shows Picture…, then presses it in the throwaway
  client (`P.sandboxClient`, #382) with a blue PNG made in the page: a 42nd choice named ProbeMap
  (row 206) is chosen and previewed blue, and the real client still lists 40. The file dialog is
  stubbed (`window.go.main.App.OpenImageDialog`); wait for the list to change, not for the button,
  which reads Picture… again before Svelte has drawn Writing….
- In the game: not checked by the loop; the owner's check is the picture on entering the map.

## World map of a zone (World › World Map, #181; exploration overlays, #219)
Checks: a zone's map for the game's World Map (M): the WorldMapArea.dbc row and the twelve 256x256
tiles of the 1002x668 picture at `Interface\WorldMap\<Name>\<Name>1..12.blp`, and its exploration
overlays: WorldMapOverlay.dbc rows (17 fields: ID, the WorldMapArea row, four AreaTable IDs, two
unused, the texture name, width, height, offset x and y, hit rectangle top, left, bottom, right, in
picture pixels) and their art at `Interface\WorldMap\<Zone>\<NAME><n>.blp`, DXT3 with mips, cut into
256 tiles with the last column and row the power of two past what is left (WorldMapFrame.lua).
- Go: `TestSetWorldMapOverlaysReplacesTheZones`, `TestWorldOverlayFilesCutAsTheClient`,
  `wow.TestEncodeOverlayBLPReadsBack`; with `WOW_DIR=C:/WoW/client`, `TestWorldMapOverlaysFromClient`
  reads Elwynn's twelve (Goldshire: row 122, area 87, 240x220 at 250, 270, hit 400 370 465 455) and
  writes Goldshire back through `WorldMapFiles`, the other rows kept.
- Go: `TestSetWorldMapRowAddsAndReplaces`, `TestSetWorldMapRowRefusesBadRows`; with
  `WOW_DIR=C:/WoW/client`, `TestWorldMapFromClient` reads Elwynn (row 30, map 0, area 12, Left 1535.4,
  Right -1935.4, Top -7939.6, Bottom -10254.2; its art DXT1 256x256), writes it again through
  `WorldMapFiles` (tiles within 0.04 a channel of the picture) and finds the row unchanged.
- Frontend: `frontend/tests/worldMap.test.ts` (Elwynn's extent on its tiles 29.1..35.6 by 46.9..51.2
  and back through a region's first tile; zone bounds and the 3:2 fit; pixel boxes; the look; feather;
  the overlays: a subzone's own piece with a soft edge and parchment under it in the base, a piece
  redrawn in part keeping its art outside the block, a subzone drawn into the piece whose art covers it,
  a piece whose subzone is no longer painted in the block cleared there or dropped, #278).
- Probe `world-map`: on Northshire, Elwynn's twelve overlays listed and previewed over the base, and
  Generate redraws Northshire Valley's ("12 overlays, 1 drawn": Echo Ridge Mine and Northshire
  Vineyards, which no overlay names, go into Northshire's piece, whose art covers them). More than 1
  drawn means a neighbour was rewritten: Stormwind's, Goldshire's, Tower of Azora's and Stonecairn
  Lake's soft edges spill over the block's band, which #278's clearing must leave alone. Then Write to
  Client in the throwaway client (#382), and the dialog opened again reads it back: within 0.11 a
  channel of the generated preview, 1.34 from the client's. Trap: wait for the button to read Working…
  before waiting for Write to Client again; checked at once, it still reads Write to Client, and
  closing the dialog then reads the map back before it is written. To see the
  preview, copy the probe into `probes/scratch/`, return `canvas.toDataURL()` and decode it.
- Dev page, Northshire (Azeroth 32_48): wait for the models, then `ed.ui.dialog = 'worldMap'`. The zone
  list is Elwynn Forest (12), "3471 × 2315 yd · the client's (row 30)", the canvas shows the client's
  base art with its overlays over it (Preview explored; off, the base alone is mostly parchment).
  Click the dialog's `Generate` button: the open tile is drawn just north of the map's middle, where
  Northshire Valley is, into Northshire's overlay (with Overlays off, feathered into the base art). Write to Client is not run from the loop (it writes
  the owner's patch); `TestWorldMapFromClient` covers the files it writes.
- In the game: not checked by the loop. A zone of a new map needs its AreaTable row (World › Zones)
  painted on its chunks; whether 1.12's World Map opens a zone of a map that isn't a continent
  (WorldMapContinent.dbc lists only Kalimdor and Azeroth) is for the owner to check.

## Icons from PNG files and back (#364, probe `icons`)
Checks: Import PNG… in the spell and item editors' icon grid adds square PNG files to the client as
`Interface\Icons\<file name>.blp` in Meld's patch, and Export … as PNG… saves the icons the grid shows
as `<name>.png` files.
- The client's own (surveyed 2026-10-20): 2684 icons, every one 64x64; 1474 DXT3 with mips (alpha
  depth 8, type 1, what `IconFromPNG` writes), 689 DXT1, 512 DXT1 with 1-bit alpha, 9 palettized.
- Go: `wow.TestIconFromPNG` (64, 128 and 40 px PNGs made in the test come back as 64x64 DXT3 with a
  full mip chain, colours and a transparent corner kept, and out again as a PNG),
  `TestIconFromPNGRefuses` (not square, not a PNG); `vmangos.TestIconName`, `TestPlanIconImport` (a
  temporary client: the client's own name refused in any case, one Meld added replaced, a name given
  twice and a bad PNG refused; installed, the list has it and the export writes it, a missing name and
  `..\up` reported), `TestPendingIcons` (an icon waiting for the game to close is listed, previewed
  through `PendingIcon` and exported).
- Probe `icons` (the real client left alone): Fireball's Change icon… shows Import PNG… and Export all as PNG…;
  searching Spell_Fire_FlameBolt leaves one icon and Export 1 as PNG…; `ImportIcons` with a missing
  file refuses it under its name (`Probe_Icon`, from "Probe Icon.png") and `ExportIcons` refuses a
  missing folder. Then, in the throwaway client (`P.sandboxClient`, #368), Import PNG… with the file
  dialog stubbed takes a red 64 px PNG drawn in the page ("Meld Probe Icon.png"): the note says it was
  added, the grid shows `Meld_Probe_Icon` alone and its preview is red; after `P.endSandbox()` the real
  patch has its size and time and the real icon list hasn't the icon. About 7 s.
- Export of every icon, by a scratch probe calling `ExportIcons(await ListItemIcons(), <a temp
  folder>)`: 2684 written in 5.3 s on 2026-10-20, none failed.
- In the game (the owner): an imported icon set on a spell (Save) or an item (Change icon…, Save)
  shows on the action bar or in the bags after the game restarts. Not checked by the loop.
- Trap: the import refuses a PNG named as one of the client's icons (rename the file); the client
  caches nothing by icon name across a restart, but Meld's own previews do (`forgetIconImages`,
  `forgetSpellIcons` drop them after an import).

## The asset server across a patch write (#471, probe `patch-cache`)
Checks: a write into Meld's patch closes the asset server's archives (`wow.Client`) only for the
rename in `vmangos.InstallPatch` (through `vmangos.SetClientReader`), keeps what it decoded, forgets
only the files the write changed (and the minimap tiles it dropped), and lists the archives' files
again only when one changed.
- Go: `wow.TestResumeKeepsCache` (a temporary client: two textures read once, a nested Suspend and
  Resume serves them from the cache, counted through the overlay; a patch rewritten while suspended
  adds a file to `List` and, after `Forget` of one in another case and slash, only that one is read
  again; `Open` drops it all), `vmangos.TestInstallPatchHoldsReader` (a fake reader sees suspend,
  resume, forget, with the written names and the dropped minimap tile, not the carried tile; `AddPending`
  forgets the waiting file), `TestInstallPatchWithClientOpen` (the rename succeeds while a real
  `wow.Client` holds the patch; on Windows it fails without the reader set).
- Probe `patch-cache` (the throwaway client, the real one left alone): Stormwind's WMO from
  `/wow/model` cold, then an icon imported red, an `InstallMapPatch` of a file of its own, the WMO
  again, and the icon imported again in blue. On 2026-10-21: cold 1239 ms, after the write 49 ms (the
  code before #471 rebuilt it, 1167 ms); the file count 79890 to 79892; the icon read back red, then
  blue. About 6 s.
- Trap: `P.endSandbox()` (and any `Open`, a change of client) still drops the whole cache, so measure
  inside one sandbox.
