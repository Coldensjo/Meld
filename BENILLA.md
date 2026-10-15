# BENILLA.md: using Benilla as Meld's game client

[Benilla](https://github.com/samwhosung/benilla) is an open-source World of Warcraft 1.12.1 client,
written from scratch in Rust and Bevy (MIT or Apache-2.0). It is not new game data: it reads the same
1.12.1 install Meld already reads (`Data\*.MPQ`) and connects to VMaNGOS over the stock protocol.
So Meld keeps writing exactly what it writes today (tiles, WDT, WDL and DBCs into `patch-3.MPQ`, SQL
into the world database), and Benilla is just another program that shows it.

## Setup on this machine (done 2026-10-15)

- Cloned to `C:\Servers\Software\benilla` (beside Meld, not inside it).
- Built with `cargo build --release -p benilla` (Rust 1.98.1, pinned by its `rust-toolchain.toml` and
  fetched by rustup; its Lua is compiled by the Visual Studio 2022 C toolchain). The program is
  `C:\Servers\Software\benilla\target\release\benilla.exe`. This is the default "dev" build, which
  reads the install from `WOW_DATA`; `--no-default-features` is the player build, which only looks for
  `Data\` beside the binary, so keep the dev build for Meld.
- Meld points at it: Preferences › Benilla Folder… is `C:\Servers\Software\benilla`, and Preferences ›
  Game client › Benilla is picked (both in `%APPDATA%\Meld\config.json`: `benillaPath`, `gameClient`).

To rebuild after `git pull` in the Benilla folder: `cargo build --release -p benilla`.

## What Meld does with it (done)

- **Preferences › Game client**: World of Warcraft (Wow.exe) or Benilla. Benilla needs its folder
  (Preferences › Benilla Folder…) with a release build in it; Meld refuses otherwise and says why.
- **Around an export** (region save, publish, zone, light and ground effect saves): Meld closes the
  chosen game (`benilla.exe` instead of `Wow.exe`), writes the patch, then starts it again
  (`internal/game/session.go`).
- **Starting Benilla**: from its own folder (it keeps `benilla-config\` there: settings, addons,
  screenshots), with `WOW_DATA` set to the install's `Data` folder and, with a saved Game Login,
  `WOW_USER` and `WOW_PASS`, so Benilla logs itself in. No keystrokes are typed into a window, unlike
  Wow.exe's login.
- **Preferences › Launch Benilla** opens it on demand.

## What Benilla reads of Meld's output (checked in its source)

| Meld writes | Benilla |
|---|---|
| `patch-3.MPQ`, files stored whole | Mounts `patch-?.MPQ` in the client's order (`benilla-formats/src/chain.rs`); reads stored and compressed files |
| ADT ground, MCLY layers with 4-bit alpha, MCLQ water, holes at 0x3C, area ID, impassable flag | All read (`benilla-adt`) |
| Ground effect IDs per layer, predominant-texture map at 0x40, no-tuft bits at 0x50 | Read at the same offsets, which confirms Meld's layout |
| MCLY look flags (scrolling, overbright) | Read with the layer flags |
| WDL horizon | Drawn (`benilla-assets/src/shaders/wdl.wgsl`) |
| WMO-only maps (MPHD 0x1, MWMO, MODF) | Read (`benilla-wdt`) |
| AreaTable, Map, Light, LightParams, LightIntBand, LightFloatBand, GroundEffectTexture, LoadingScreens | All read from the patch chain (`benilla-formats`); it checks field counts as Meld does, and Meld writes the client's own layouts |

## What needs to be done

In order. Each becomes a BACKLOG.md item (B-164 onwards).

1. **Check a round trip by hand (B-164).** Save a region in Meld, let it restart Benilla, and walk the
   edited ground: heights, paint, water, holes, models, tufts. Then a new map published to the server.
   Benilla wants an English 1.12.1 (build 5875) install; the SoloCraft client is one, but a repack can
   differ, so this is the first thing to confirm. Benilla also needs Warden off (VMaNGOS ships it off).
2. **Don't close Benilla to write the patch (B-165).** Wow.exe keeps the patch locked, which is why Meld
   closes it. Benilla opens a fresh file handle per read, and Rust opens files shareable (read, write,
   delete), so Meld could replace `patch-3.MPQ` while Benilla runs. Benilla still has to reload what it
   has loaded: either restart it (as now) or teach it to reopen the chain and drop its caches for the
   changed tiles (a change in Benilla, so a fork or an upstream pull request). Test the file sharing
   first.
3. **Port Benilla's exact client behaviour where Meld approximates (B-166 to B-170).** Benilla is built
   against reverse engineering of the real client and is MIT/Apache, which CLAUDE.md allows porting
   from (unlike Noggit, which is GPL). Port the behaviour into Meld's Go and TypeScript:
   - the client's light blending, sky dome colours and fog (Meld keeps its own Preetham sky; Client
     Lighting only takes the colours) (B-166);
   - the WDL far horizon beyond the open block (B-155, now with a renderer to follow) (B-167);
   - M2 particles and ribbons (B-154) (B-168);
   - the minimap textures and `md5translate.trs` (B-129): how the client finds and draws them (B-169);
   - overbright and scrolling textures exactly as the client draws them (Meld's overbright is a ×1.5
     guess) (B-170).
4. **Optional: a "Play here" button (B-171).** Benilla takes `WOW_HOST`, the login and the data folder
   from its environment; a server-side teleport of the logged-in character to the camera's spot (a GM
   command over the world database or the server's console) would let an author jump into the spot
   they are editing.

## Things to keep in mind

- Benilla only reads the install, never writes it, so Meld's patch is still the only thing that
  changes the game data. VMaNGOS's map extraction (publish) still reads the same patch.
- Benilla follows 1.12.1 only (its README rules out other clients), which matches Meld's own rule.
- It is a young project: if something Meld writes shows wrong in Benilla but right in Wow.exe, compare
  in Wow.exe first before changing Meld.
