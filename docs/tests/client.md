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

## A new world's tiles on the 64×64 grid (#46, probe `new-world-tiles`)

Probe `new-world-tiles`: the Start dialog's grid (pointer events on its canvas: a press with
`ctrlKey` takes a tile away, `shiftKey` adds a 3×3) makes an L of three tiles at 31-32, Create world
makes it, and the probe checks the ref (`tileX`, `tileY`, `tiles`), that the tile left out is a hole,
seabed and not hit by a ray from above, the export's tile numbers (`mapToTiles` with the layout
publish builds), Launch's spot in the grid's frame, then Map Properties' grid: the tile added back as
one undo step, and a tile two west of the square answered yes to "Grow the map?" (`P.dialog`, the
`[data-confirm="yes"]` button), after which a model keeps its server spot and the ground under it
its height. Nothing is written. Traps: the grid's readout (`[data-tilegrid] .readout span`) is
what to wait on; Map Properties reads the tiles again on `ui.historyVersion`, so a check of the grid
after `e.undo()` sees the undone tiles. To see it, `scratch`-style: leave the Start dialog open on a
shape and run with `--shot`: the preset cards draw the shape (tiles left out dark).

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
- Probe `top-down-shot` (#554): the shot runs `Engine.simulate` for its ortho camera and draws only
  itself, so it draws no frame of the view, moves no clock and is the same twice; it prints the ms a
  shot (SwiftShader, Northshire: about 600 ms before #554, 250 to 350 after).
- The client's tiles show the buildings (WMOs) but not the trees, hence the default; their rock is
  darker and more shaded than the editor's top-down light.
- Not run against the real client in the loop: the write replaces that map's minimap tiles in the
  owner's game.
- Traps: a render target only gets three's tone mapping and sRGB output when it is the screen or an
  XR target, so the shot's target is flagged `isXRRenderTarget`; and with `colorSpace` sRGB three
  stores it as an sRGB texture, which encodes a second time (a pale picture), so its
  `internalFormat` is `'RGBA8'`.

## Server map extraction for one map (Publish, #174; nothing closed or started, #661)
Checks: Publish runs the VMaNGOS extractors on the published map only: MapExtractor with `-m <id>`
(and `-t x_y,...` for the tiles the export wrote, when the server was current before it), VMapExtractor
with `-m <id>`, then VMapAssembler, which rebuilds only that map's `.vmtree`/`.vmtile` files.
- Go: `TestPublishServerExtractsOnlyTheMap` (the arguments, the map's old vmtree/vmtile and tile files
  removed, other maps' kept), `TestPublishServerExtractsEveryMapWithoutWholeVmaps` (no
  `vmaps\temp_gameobject_models` means vmaps were never built whole, so every map is extracted) and
  `TestChangedTiles`.
- The extractors write into `data\meld-staging` (MapExtractor `-o meld-staging`, the assembler's
  `meld-staging\vmaps`), whose files move over `data\maps` and `data\vmaps` only once all three steps
  passed; a failed step leaves the old files and starts mangosd again on them (#466). Go:
  `TestPublishServerKeepsTheOldDataOnFailure` (each step failing in turn).
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
  step) in the background and reports through `servermaps:log`/`servermaps:done`. It rebuilds the
  live server's map data, so not for the loop to try against the live server. Go: `TestFileTileName`.
- Nothing is closed or started (#661, replacing #469 and #470): a patch write (`installClient`,
  `app_pending.go`) waits for a running game instead, and `UpdateServerMaps` waits for the author to
  stop mangosd and never starts it. Go: `TestUpdateServerMapsWaitsForTheAuthorToStopTheServer` and
  `TestUpdateServerMapsNeverStopsOrStartsTheServer` (`publish_test.go`, the fake runner's
  `stopsAfter` stops the server after that many `Running` calls). The live path runs only on Windows
  outside the probe sandbox, so check it by hand with the owner's go-ahead:
  - Compile to Client with Wow.exe open: the status says the tiles wait, the status bar shows "Close
    the game to apply N client files", and closing the game writes them within a few seconds (the
    cell goes; the patch's time changes). Wow.exe, realmd and mangosd keep their PIDs
    (`tasklist /FI "IMAGENAME eq mangosd.exe"`).
  - Compile to Server with mangosd running: the status bar says to stop the world server; stopping
    it starts the extraction, and the done message says to start it. Nothing starts it.
  - Publish with Wow.exe running waits with "Close the game…" and goes on once it is closed.
- Trap: each wait gives up after 15 min (`gameWait`, `serverStopWait`); until then the File menu's
  compile entries say "still being rebuilt" (`serverMapsRunning`), and Publish keeps `ui.busy`.
- Trap: an old extractor without `-m` stops at its usage text (exit 1), so Publish then fails with
  "map extraction".

## Movement maps on compile (#173)
Checks: after the map data is replaced, `buildMoveMaps` (`publish.go`) runs `run\Extractors\MoveMapGenerator.exe`
in `data`, one run a compiled tile (`<id> --silent --threads N --configInputPath ... --offMeshInput ... --tile x,y`),
or one run for the whole map with its own `MMM.mmap` and `MMM*.mmtile` removed first (the generator skips a
tile whose file exists). A failed run is only logged; Preferences › Build movement maps on compile
(`prefs.buildMoveMaps`, read in Go by `App.buildMoveMaps`) turns it off. `mmap.enabled` stays 0 in mangosd.conf
(the owner's choice on #173), so the server doesn't load them yet.
- Go: `TestPublishServerBuildsMoveMaps` (order after the assembler, the `--tile` arguments, the whole-map
  removal keeping other maps' and `go*.mmtile` files, a failure not failing the publish, the pref off).
- By hand, without a compile: back up `data\mmaps\0002337.mmtile` and `000.mmap`, then in `data` run
  `MoveMapGenerator.exe 0 --silent --threads 8 --configInputPath C:\WoW\vmangos\run\Extractors\config.json --offMeshInput C:\WoW\vmangos\run\Extractors\offmesh.txt --tile 37,23`:
  it writes `mmaps\0002337.mmtile` (file name map, then y, then x) in about a second, and `000.mmap` came
  out byte for byte the same (2026-10-25).
- Traps: without `--threads` the generator asks for a count on the console and hangs; without `--silent`
  it waits for a key at the end. The in-game check (a mob pathing over a raised hill) needs `mmap.enabled = 1`.

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
- Against the live database, by hand with the owner's go-ahead (it rebuilds the server's map data once mangosd is stopped): move a spawn,
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
  `RegionPending` (used for a region opened from a file) finds the raised tile, and that its answer is
  kept (#531): `cache.kept` says a second check, and one after a step that changes no compile input,
  reused it, `cache.askedAgain` that an undo asked Go again; `cache.askMs` and `cache.cachedMs` time the
  first and second checks.
- It never compiles: Compile to Client writes the owner's `patch-3.MPQ`, and Compile to Server or All
  rebuild the server's map data. Check those by hand, with the owner's go-ahead: after Compile to
  Client the patch's time changes and `ReadRegion` of the tile gives the edited heights.
- Trap: an unedited block built by `BuildRegion` is not byte-equal to a tile the client has never had
  compiled (the builder orders an MCNK's subchunks its own way), so `RegionPending` says "changed" for
  any such tile. That's why Launch trusts the fingerprint and asks Go only when there is none.
- `go test ./internal/vmangos/ -run TestRegionPending` (with `WOW_DIR`): a raised vertex makes the tile differ.
- The write chains, client-free (#405), with temp client and server folders, a fake runner and a temp
  folder for the files waiting for the game:
  - `go test ./internal/vmangos/ -run PublishChain`: `Publish` writes the map and a queued Spell.dbc
    into the patch and the server's Map.dbc before the `map_template` SQL, then runs the extractors;
    an unchanged map over current server data runs nothing, stale data rebuilds the whole map, an
    edited tile only that tile (`-t 10_10`, #211), a new tile (WDT changed) the whole map. With the
    patch held (a read-only file) it fails before any program runs and the Spell.dbc still waits.
  - `go test . -run TestClientFileChain`: through the app's `saveClientFiles`, `SaveRegion` and
    `waitForGameClosed`, with `App.gameUp` standing in for the game: a Spell.dbc saved while the game
    runs waits, a refused write keeps it waiting, the next region save takes it into the patch, and a
    region saved while the game runs reaches the patch at `waitForGameClosed` (the step before a
    server rebuild). Set `pendingWatch` so the watcher doesn't race the saves.
  - `go test . -run TestPendingWatchGivesUp` (#481): the watcher's loop (`runPendingWatch`) returns
    after one try over a patch Meld didn't write, and after its tries over a read-only patch (with
    `pendingRetry` cut to 1 ms), keeping the waiting file both times.
  - `go test . -run TestSaveAfterDatabase` (#477): `SaveAreaTriggers` over a held patch, with
    `App.runSQL` standing in for the world database, says the portals are saved in the world database
    and to Save again; without a server folder it returns the patch's own error. `SaveAreas` and
    `SaveTaxi` wrap the same way (`afterDatabase` in `app_client_tables.go`).
  - Trap: the server's "current" test compares file times, so the test sets them (`os.Chtimes`)
    rather than trusting the order of two writes a few milliseconds apart.
- `bun test tests/regionKey.test.ts` (#433): the fingerprint (`regionKey` in `io/regionKey.ts`) changes
  for an edit of every leaf of its input (walked, so a new field is covered), stays for a write of the
  same value and comes back on undo; and every `ExportInput` key is mapped to edits that change it or
  to why the region save doesn't send it (`size`, `cellSize`, `waterEnabled`, `waterLevel`). The map is
  typed over `keyof ExportInput`, so a new export key fails `make check` until it is listed.

## Compile keeps the client's alpha where nothing was painted (#526)
Checks: a region's compile writes the client's own 64x64 alpha maps back on every chunk and texel the
editor did not paint, not the editor's 32x32 weights repeated over 2x2 blocks.
- Probe `compile-alpha` (`bun run probe compile-alpha`, about 5 s): in the throwaway client
  (`P.sandboxClient`), opens Azeroth 31_50 (a tile not in the owner's patch), writes a 2x2-texel spot of
  one chunk straight into `terrain.weights` and compiles to the client. Read back with `LoadRegion`,
  `keptChunks` (255) chunks have the alpha bytes they had, and the painted chunk differs only in the
  spot's 4x4 alpha texels (`changedTexels`). The real patch is left alone.
- `go test ./internal/adt/ -run 'ClientWeights|Unpainted|PaintedTexels|Renamed'`: synthetic tiles with
  alpha that changes texel to texel. `TestClientWeightsMatchesTilePaint` and the last test in
  `frontend/tests/tileImport.test.ts` pin `adt.ClientWeights` and `tilePaint` to the same checksum:
  if either changes, `KeepClientAlpha` stops matching and every chunk is rewritten at half resolution
  again, so update both.
- `WOW_DIR=... go test ./internal/vmangos/ -run TestRegionUnpaintedChunksKeepClientAlpha`: every chunk
  of Azeroth 32_48 sent back with the client's weights builds the same bytes as a build with no paint.
- `go test ./internal/vmangos/ -run TestRegionPaintRoundTrip` (#404, no client needed): chunks of a
  made-up 2x2 block painted with three and four textures at known weights, saved with `BuildRegion`
  and read back with `adt.ParseTextures` and `adt.ClientWeights`. The region save writes 4-bit alpha,
  so weights come back within 1/255 only where each layer's blend alpha is a multiple of 17
  (`gridWeights`); off that grid (`scatterWeights`) the test checks each layer's stored alpha within
  half a 4-bit step (8.5, plus rounding) of the weights' blend instead. Unpainted chunks must read as
  a save with no paint does, not as the archive's tiles (a save flips chunk flag 0x8000 on some chunks, which changes how their alpha's last row and column read).
- Trap: the comparison is against the tile without Meld's patch, so a tile a compile before #526
  already wrote at half resolution reads back degraded and stays so; test on a tile not in the patch.

## Restore the Client's Paint (#645)
Checks: Terrain › Restore the Client's Paint puts a region's chunks (the selected area's, or all) back
to the client's paint without Meld's patch, as one undo step, so the next compile writes the client's
own alpha bytes there again.
- Probe `restore-paint` (`bun run probe restore-paint`, about 10 s): in the throwaway client, paints a
  spot of an Azeroth 31_50 chunk and compiles it into the patch, opens the region again from the
  patch, selects that chunk and restores it (undo and redo checked), compiles again and reads back
  every chunk's layers and alpha bytes as they were before the first compile.
- `bun test tests/restorePaint.test.ts`: the palette remap (textures added, case kept), only the asked
  chunks written, a full palette refused.
- `WOW_DIR=... go test ./internal/vmangos/ -run TestBaseRegionPaintSkipsMeldsPatch`: a 2x2 block's
  layers and alpha read without Meld's patch match `BaseTileRoot`'s files.
- Trap: the probe's tab must be closed before reopening the same block (`openRegion` refuses a block
  already open).

## Added models get unique IDs across the map (#491)
Checks: a compile or Publish gives every model it adds an ID no other placement of the map has, since
the client draws only the first loaded placement of an ID and the server's vmaps keep one an ID.
- `go test ./internal/adt/ -run 'NextUID|MaxPlacementUID'` and `go test ./internal/vmangos/ -run
  TestRegionAddedModelsGetMapWideIDs`: synthetic tiles in made-up archives, no client needed.
- `WOW_DIR=... go test ./internal/vmangos/ -run 'ClientTileUIDMax|ClientRegionAddedModelIDs'`: the quick
  read of a tile's highest ID (the start of the file only) against a whole parse on a quarter of
  Azeroth, and a save of Azeroth 32_48 2x2 with two models added.
- Trap: models an earlier compile added are in Meld's patch, not the client's own tiles, so a save
  renumbers them along with the new ones (the test counts them as added).
- Not checked in the game: two models added on either side of a tile border, both standing after a
  compile and a relog, would show it.

## Border models in every tile that lists them (#646)
Checks: a model the client's tiles list in each tile it overlaps reaches the editor once, and a save
moves, deletes or adds it in every block tile its bounds reach, under one ID; Publish lists each model
in every tile of the map it reaches the same way.
- `go test ./internal/vmangos/ -run TestRegionBorderModelsInEveryTile`: a made-up 2x2 block whose tiles
  0_0 and 1_0 both list three border models; one is moved off the border, one deleted, one kept, and a
  model added on the block's middle corner must land in all four tiles. No client needed.
- `WOW_DIR=... go test ./internal/vmangos/ -run TestClientRegionBorderModels`: the same on Azeroth 32_48
  2x2 (67 M2s listed by two of its tiles): one moved 3 yards, one deleted.
- `WOW_DIR=... go test ./internal/vmangos/ -run TestClientBorderTilesAgree -v`: the tile rule
  (`blockTilesOf` with `reaches.bound`) against the client's own listing, for every placement of Azeroth
  28-35 x 44-51 200 yards inside it: 99% of M2s get the client's tiles (2026-10-22: 139 of 19060 fewer,
  mostly trees and smoke whose client bounds reach past their vertices), and no WMO gets fewer.
- `go test ./internal/vmangos/ -run TestExportBorderModelsInEveryTile`: Publish (`ExportMap`) of a
  made-up 2x1 map: trees 5 yards either side of the border and a WMO 120 yards from it (sized from a
  MOHD-only root in the test's archive; the writer's 64-yard default would miss) land in both tiles under
  one ID, a rock mid-tile and a tree by the map's outer edge in their own tile only (#648). No client needed.
- Trap: models are named `.mdx` in the tiles and `.m2` in the archives; a size read that doesn't
  swap them falls back to the writer's 16-yard default reach.
- Since #647 a tile outside the block that lists a border model is written too (next entry).
- Not checked in the game: move a tree on a tile border, compile, relog and look from both tiles.


## Border models in the tiles outside the block (#647)
Checks: a compile moves, deletes or adds a model by the block's edge in the tiles outside the block that
list it or that it now reaches, changing nothing else there, and a second compile of the same edit (or
of the block read back from the patch) writes nothing.
- `go test ./internal/vmangos/ -run TestRegionBorderModelsOutsideBlock`: a made-up 2x1 map compiled as
  the 1x1 block 0_0, whose tile 1_0 lists three of its border models; it installs the first compile
  into a patch in the temp folder and compiles again from it, then moves a model back where the client
  had it and deletes one the first compile added. No client needed.
- `WOW_DIR=... go test ./internal/vmangos/ -run TestClientRegionOutsideTiles -v`: Azeroth 32_48 1x1 with
  two models a neighbour lists moved and deleted; the neighbours written keep their ground, paint,
  liquids and every other placement as the client reads them now (hard rule 5). It logs the build's
  time (about 0.17 s, 2026-10-22).
- Trap: the owner's patch has a rock under ID 352776 in 32_49 that a compile before #491 gave the ID of
  a bowl in 31_49; the save must not take the bowl out (`outsideFix.isCopy` checks the model's name).
- Not checked in the game: a tree moved off the edge of a compiled block, seen from the neighbouring
  tile after a relog, would show it gone from its old spot.
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

## Icons from PNG files and back, and the Icons tool (#364, #683, probe `icons`)
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
- Probe `icons`, the Icons tool (#683): Tools › Icons… (`ui.iconsTool`) shows the shared grid with
  Export all as PNG…; searching Spell_Fire_FlameBolt and clicking it shows its name, Copy spell icon
  ID (185) enabled and Fireball (Rank 1) among its spells, and Copy name puts the name on the
  clipboard. Go: `vmangos.TestSpellsWithIcon` (a synthetic SpellIcon map and Spell.dbc: any case, the
  lowest of two rows, one spell per name, the count past the limit, an unused icon).
- Look at it in the app: Tools › Icons…, pick an icon a spell and an item use (Spell_Fire_FlameBolt:
  81 spells, 2 items with the world database up).
- Export of every icon, by a scratch probe calling `ExportIcons(await ListItemIcons(), <a temp
  folder>)`: 2684 written in 5.3 s on 2026-10-20, none failed.
- In the game (the owner): an imported icon set on a spell (Save) or an item (Change icon…, Save)
  shows on the action bar or in the bags after the game restarts. Not checked by the loop.
- Trap: the import refuses a PNG named as one of the client's icons (rename the file); the client
  caches nothing by icon name across a restart, but Meld's own previews do (`forgetIconImages`,
  `forgetSpellIcons` drop them after an import).

## Money as gold, silver and copper (#679, probe `money-fields`)

Checks: the item editor's Buy price for the Worn Shortsword (25, 35 copper) shows three amounts with
three different coin images, 150 typed as copper is an unsaved edit that rolls over to 1s 50c when
the field is left and Revert puts back, the tooltip's Sell Price draws a coin, and the quest editor's
Money for Grime-Encrusted Ring (2945, -300) ticks Costs with 3 silver. `bun run probe money-fields`
(about 6 s, nothing written). Unit test: `bun test tests/money.test.ts` (split, join, rollover, sign,
amounts past 99 gold).
- By eye: Gnome Improvement (2948) › Rewards shows Costs 30 silver beside Money at level 60; World ›
  Flight Paths' price and the creature editor's Messages tab's option Cost use the same control; the
  probe doesn't open those.
- Trap: the coins are one atlas, `Interface\MoneyFrame\UI-MoneyIcons.blp`; the
  `UI-GoldIcon`/`UI-SilverIcon`/`UI-CopperIcon` names of later clients answer 404 in 1.12.

## The creature editor's faction, family, race, AI, mount and mask pickers (#699, probe `creature-pickers`)

Checks: Stormwind City Guard (68)'s Faction shows template 11 as "Stormwind (friendly to Alliance,
hostile to Horde)", its Find lists the client's faction templates whole and narrows on a faction
name (Darnassus, 79), a click puts the ID in; Pet family and Trainer race are selects, AI offers the
core's AI names in a datalist and still takes any text, the six immunity and flag masks are tick
lists, and the Looks tab's "A click sets" has "the mount" (a tile clicked fills `mount_display_id`).
`bun run probe creature-pickers` (about 6 s, nothing written). Unit test: `bun test
tests/creatureFields.test.ts` (the fields' pickers and each mask's bits, the top static flag
unsigned).
- Trap: the faction picker is FactionTemplate.dbc (`ref: 'faction template'`, `App.Factions`), not
  Faction.dbc (`ref: 'faction'`, a reputation, the quest editor's). Many templates share a faction
  name; the reaction text tells them apart.
- The flag names come from VMaNGOS' `CreatureDefines.h` (`CreatureStaticFlags`, `...Flags2`,
  `CreatureFlagsExtra`, `CreatureImmunityFlags`); the mechanic bits are `1 << (mechanic - 1)`.

## The game object editor's faction, cursor and data column pickers (#702, probe `object-pickers`)

Checks: the Sunken Chest (32)'s Object tab names its faction template (12, Stormwind), its lock
(43, "Open Kneeling", by what opens it) and its loot list (1683, by its row count), the Display
box's note names the model (Chest01), Cursor icon offers the client's cursor names; Lock's Find lists
every lock and a click puts its ID in (the field turns changed); Eliza's Tombstone (37, a text) names
its page by its first line with the HTML tags dropped, its language (Common) and page material
(Stone). `bun run probe object-pickers` (about 6 s, nothing written). Unit tests: `bun test
tests/objectFields.test.ts` (which data column gets which picker, the lock text), `go test
./internal/vmangos/ -run 'TestLockInfos|TestTaxiAndCinematicNames|TestWorldRefSQL|TestFirstLine'`,
and `TestLoadObjectTablesClient` with `WOW_DIR`.
- Trap: lock and loot ids aren't unique to objects, and a Lock.dbc slot of type 1 is an item (a
  key), named through the item templates; type 2 is a LockType.dbc row with the skill it needs.
- Quest list (a questgiver's data1) and Custom animation stay numbers: no world database table holds
  quest lists, and the animation would need the model's sequence names.
- The event and loot pickers search by number only (they have no text).

## The item editor's id column pickers (#701, probe `item-pickers`)

Checks: Armor of the Fang (6473)'s More tab names its item set (162, Embrace of the Viper) and its
disenchant loot by its items (3, Strange Dust…), and Item set's Find lists every set and a click puts
its ID in (the field turns changed); the Notched Shortsword (727) names its random enchantment (5168)
by its suffixes ("of the …"); the Ornate Bronze Lockbox (4632) its lock by what opens it; A Letter to
Grelin Whitebeard (2188) its page by its first line and its page material; the Gordok Inner Door Key
(18268) its map (Dire Maul); Tough Jerky (117)'s Effects tab its cooldown category by its spells;
Marshal's Satin Sandals (17607) Honor rank Marshal / General (16). `bun run probe item-pickers`
(nothing written). Unit tests: `bun test tests/itemFields.test.ts`, `go test ./internal/vmangos/ -run
'TestSpellCategoryNames|TestRandomPropertyNames|TestEnchantments|TestDisenchantSQL'`, and
`TestLoadItemTablesClient` with `WOW_DIR`.
- Trap: random_property names an item_enchantment_template entry, not an ItemRandomProperties.dbc
  row; the entry lists up to 166 of them, so the name gives the first three by chance and the search
  matches any of them (read whole in Go, `SearchItemEnchantments`, about 780 entries).
- 1.12 has no SpellCategory.dbc: a cooldown category is named by the spells in it (Spell.dbc field 2).
- 0 means none for map_bound, though map 0 is Eastern Kingdoms; other_team_entry's 1 also means none
  and shows as "No item 1".

## The creature editor's list pickers (#700, probe `creature-list-pickers`)

Checks: Hogger (448) names his loot, pickpocket loot, spell list (4480) and, on the Looks tab,
equipment by what they hold (with the weapons' icons, #707), each "(this creature's own)"; Loot's Find offers list 448 before a
search, a search for "Linen Cloth" lists other loot with "used by N creatures", and a pick puts its
number in (the field turns changed); Zaldimar Wefhellt (328) names trainer list 1 by its spells
(used by 25 creatures) and his gossip menu by its first line; Innkeeper Helbrek (1464) vendor list
100 by its items; the Stormwind City Guard's (68) Messages tab names an option's menu, map point
(Champions' Hall) and condition ("Content patch at least 2"). `bun run probe creature-list-pickers`
(about 15 s, nothing written). Unit tests: `bun test tests/creatureFields.test.ts`, `go test
./internal/vmangos/ -run 'TestWorldRefSQL|TestConditionText|TestParseConditions|TestMatchConditions'`,
and `TestCreatureListRefsLive` with `VMANGOS_DIR` (the database running) names a row of each kind.
- Trap: a template record's `values` has no `entry` (`parseColumns` drops it with `patch`), so a
  field that needs the entry gets it as a prop (`TemplateFields`' `entry`), not from `values`.
- The loot names list the first six drops by chance and the search matches only those; a negative
  mincountOrRef is a reference_loot_template entry and is named "reference loot N". A name search
  over creature_loot_template (230,000 rows) takes about a second.
- Conditions are named in Go (`conditionText`, VMaNGOS' `Conditions.h`), so a search reads the table
  whole (about 1,900 rows) and filters the words there.
- The Messages tab's pickers have their own ✕ (Clear) buttons: a probe that clicks a row's ✕ must look
  in `.row-actions`.

## The spell editor's tick lists, selects and pickers (#703, probe `spell-pickers`)

Checks: Execute (5308)'s Needs tab ticks Battle and Berserker stance, reads target aura state
"Health under 20%" and item class Weapon with its subclasses ticked, and its Flags tab ticks "Is an
ability"; Mongoose Bite (1495) needs the Defense aura state; Smelt Copper (2657) names its spell focus
(Forge); Hearthstone (8690) names cooldown category 89 by its spells and Fireball (133) global
cooldown category 133; Eye of Kilrogg (126) names its active icon with its picture, and its Find
lists icons by name and puts a picked one's ID in; Effect 1's misc value is Summon Voidwalker's (697)
creature, Frost Ward's (6143) Frost tick and Arcane Intellect's (1459) Intellect; on Fireball, item
class Weapon turns the subclasses into a tick list and unticking Dagger is a changed value that
Revert drops. `bun run probe spell-pickers` (about 15 s, nothing written). Unit tests: `bun test
tests/spellFields.test.ts` (the masks' bits, the subclasses following the class, `miscField` for
each kind) and `go test ./internal/vmangos/ -run TestSpellCategoryNames`.
- No spell in the 1.12 data has a second visual (`spellVisual2`), and only a few dozen an active
  icon, so there is no spell to check `'spell visual'` against; its Find is the spell list
  (`SpellPicker`), and a spell with no visual is ignored when picked.
- An aura's misc value counts only when the effect applies the aura (`AURA_EFFECTS`: apply aura,
  the persistent and the area auras); a Damage effect with a leftover aura number keeps the number box.

## The quest editor's pickers (#704, probe `quest-pickers`)

Checks: Call of Water (96) names its start script by its commands "(this quest's own)" and, on
Requirements, its exclusive group by its quests; Zamek's Distraction (1191) its end script and its
condition (20227) by what it tests; The Family and the Fishing Pole (1141) its mail template (87) by
the letter's first line, whose Find lists the letters whole and a pick puts its ID in (changed);
Avast Ye, Scallywag (1036) reads its reputation objective (3000) as Friendly with the eight ranks in
the datalist; A New Threat (170) ticks no spillover from factions 1 and 2; a point map typed as 1
reads Kalimdor (no quest in VMaNGOS' database has a point map). `bun run probe quest-pickers`
(nothing written). Unit tests: `bun test tests/questFields.test.ts`, `go test ./internal/vmangos/
-run TestWorldRefSQL`, `TestQuestsLive` (mail template 84) and `TestCreatureListRefsLive` with
`VMANGOS_DIR` (the scripts and a group named).
- Trap: a picker's name reads "None" until a typed value lands, so wait for the expected name, not
  for any name.

## The id boxes outside the template editors (#705, probe `id-pickers`)

Checks: World › Zones shows Stormwind City's flags as ten ticks (AreaFlags, Capital ticked) and its
liquid type as a select of LiquidType.dbc's rows (Water (1)); Map Properties' Ghost goes to, on a
map made for the client, is a select of the client's maps with This map (-1) first; the creature editor's Spells tab
(Scarlet Commander Mograine, 3976) gives the first spell's target a creature RefField for Nearest
creature of an entry (10), a spell RefField for A friend without the aura (19), the twelve
SELECT_FLAG_* ticks for a threat-list target (2) and a Not its target checkbox for Any friend (16),
and Revert drops them; a made-up Defias Thug spawn's Display › Choose… opens the creature display
picker, and a tile picked sets the spawn's own display as one undo step; World › Flight Paths in
Redridge names Lakeshire's Alliance mount creature
(541) beside its number. `bun run probe id-pickers` (about 30 s, nothing written). Unit test: `bun
test tests/creatureSpellNames.test.ts` (which parameter gets which editor, the select flag bits).
- Trap: rows held in `$state` must be plain objects. The Spells tab's rows were
  `vmangos.CreatureSpell` class instances, which the state does not proxy, so a target or chance
  changed in place neither redrew the row nor counted as unsaved; the probe's Save spells check
  catches that again.



Checks: the item and spell editors' titles carry the item's and the spell's icon, the item editor's
Requirements › Classes ticks each show a different class icon (nine cells of the class atlas), the
spell editor's Spell tab has Reagent 1–8, Tool 1–2 and Next spell as item and spell pickers, and the
creature editor's Trainer class is a select of classes with the picked class's icon. `bun run probe
editor-icons` (about 7 s, nothing written). Unit test: `bun test tests/classes.test.ts` (the ClassMask
bits and the atlas cells).
- By eye: Tools › Creatures (the guide's class step), a spawn's Gear slots in the Properties panel, and
  the item editor's Stats › Equip bonuses rows also show icons; the probe doesn't open those.
- Trap: the 1.12 client has no `Interface\TargetingFrame\UI-Classes-Circles.blp` (a 2.x file); the
  `/wow/texture` endpoint answers 404 for it. Check a path there before relying on it:
  `curl -s -o /dev/null -w '%{http_code}' "localhost:34115/wow/texture?path=<url-encoded path>"`.

## The asset server across a patch write (#471, probe `patch-cache`)
Checks: a write into Meld's patch closes the asset server's archives (`wow.Client`) only for the
rename in `vmangos.InstallPatch` (through `vmangos.SetClientReader`), keeps what it decoded, forgets
only the files the write changed (and the minimap tiles it dropped), and lists the archives' files
again only when one changed.
- Go: `wow.TestResumeKeepsCache` (a temporary client: two textures read once, a nested Suspend and
  Resume serves them from the cache, counted through the overlay; a patch rewritten while suspended
  adds a file to `List` and, after `Forget` of one in another case and slash, only that one is read
  again; `Open` drops it all), `wow.TestReadWaitsForResume` (#472: a read while suspended waits
  for the Resume and gets the file, an `Open("")` ends the wait with an error, and past
  `suspendWait` it fails rather than hangs), `vmangos.TestInstallPatchHoldsReader` (a fake reader sees suspend,
  resume, forget, with the written names and the dropped minimap tile, not the carried tile; `AddPending`
  forgets the waiting file), `wow.TestDoodadsCached` (a doodad's mesh and hull read once, again
  after a `Forget` of a model but not of a texture, and after `Open`; #500), `TestInstallPatchWithClientOpen` (the rename succeeds while a real
  `wow.Client` holds the patch; on Windows it fails without the reader set).
- Probe `patch-cache` (the throwaway client, the real one left alone): Stormwind's WMO from
  `/wow/model` cold, then an icon imported red, an `InstallMapPatch` of a file of its own, the WMO
  again, and the icon imported again in blue. On 2026-10-21: cold 1239 ms, after the write 49 ms (the
  code before #471 rebuilt it, 1167 ms); the file count 79890 to 79892; the icon read back red, then
  blue. About 6 s.
- Trap: `P.endSandbox()` (and any `Open`, a change of client) still drops the whole cache, so measure
  inside one sandbox.

## The binary replies against their parsers (#520, the wire fixtures)
Checks: the frontend's parsers of the binary `/wow/*` replies read what Go's encoders write:
`parseMesh` and `parseCollision` (`wow/meshReply.ts`) against `Mesh.Encode` and `collision.encode`,
`decodeWmoNav` against `WMONav.Encode`, and `parseNavTile` against `vmangos.NavTile`.
- Go: `wow.TestWireFixtures` and `vmangos.TestWireFixtures` encode small generated meshes (a box in
  two groups with colours, a bone, rooms and a liquid quad; two collision faces and a liquid; two
  rooms and a portal; a fake Detour tile) and compare the bytes with `frontend/tests/fixtures/*.bin`.
- Bun: `frontend/tests/wire.test.ts` decodes those files, checks counts and a value of each
  section, and that the last section ends the reply, so a section one side skips fails.
- When a layout changes on purpose (a new section), write the fixtures again with
  `go test ./internal/wow/ ./internal/vmangos/ -run TestWireFixtures -update`, then make the parser
  and `wire.test.ts` follow. Trap: the fixtures are generated geometry only; never write one from
  the client's files (CLAUDE.md, Blizzard assets).

## The format constants and the axis swap on both sides (#538, the format fixture)
Checks: `lib/wow/format.ts` and Go's `adt`/`mapfile` constants agree, and `toServer`/`fromServer`
match `adt.ToServer`/`adt.FromServer` (and `serverSpot`, `editorPoint` and the world map extent use
the same swap).
- Go: `adt.TestFormatFixture` compares `frontend/tests/fixtures/format.json` with the constants and
  a few points through `ToServer`, and checks `FromServer` inverts it.
- Bun: `frontend/tests/format.test.ts` reads the same file.
- After changing a constant on purpose, write it again with
  `go test ./internal/adt/ -run TestFormatFixture -update`. Trap: compare yards with a tolerance;
  `533 + 1/3` and `1600/3` differ in the last bit.

## The cost of a write into Meld's patch (#476, `BenchmarkInstallPatch`)
Checks: a save of one small file into a large patch (a DBC row, an imported icon) opens the patch
once in `ChangedFiles` and once in `InstallPatch`, and copies the files it carries over straight from
the old patch into the new one (`mpq.Archive.Reader`, `mpq.WriteTo`) instead of reading them all into
memory and building the archive there.
- `go test ./internal/vmangos/ -run xxx -bench InstallPatch -benchmem -count 3`: one 4 KB icon saved
  into a patch of 200 generated 512 KB tiles (100 MB, no client bytes). The figure to watch is B/op,
  which should stay about the copy buffers (~1.4 MB), not the patch's size. On 2026-10-21 (Ryzen 9
  9900X3D, NVMe): before #476 119 ms and 210 MB a save, after it 57 ms and 1.4 MB. On 2026-10-22,
  syncing the new patch to disk before the rename (#638) took it from 69 to 74 ms to 142 to 295 ms
  (B/op unchanged): the price of a rename that a power loss can't leave pointing at zeros, so don't
  drop the `Sync` in `writeArchive` to win this back.
- `mpq.TestWriteToFromArchive` copies files between archives through `Reader` and checks that a
  short reader fails the write; the `InstallPatch` tests and probes `patch-cache` and `icons` cover
  the carried files and the minimap tiles it drops.
- Trap: the time is mostly the disk copy of the carried files, so it varies with the disk cache;
  compare B/op, and time only on the same machine.
