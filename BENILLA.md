# BENILLA.md: using Benilla as Meld's game client

[Benilla](https://github.com/samwhosung/benilla) is an open-source World of Warcraft 1.12.1 client,
written from scratch in Rust and Bevy (MIT or Apache-2.0). It is not new game data: it reads the same
1.12.1 install Meld already reads (`Data\*.MPQ`) and connects to VMaNGOS over the stock protocol.
So Meld keeps writing exactly what it writes today (tiles, WDT, WDL and DBCs into `patch-3.MPQ`, SQL
into the world database), and Benilla is just another program that shows it.

## Setup on this machine (done 2026-10-15)

- Cloned to `C:\WoW\benilla` (beside Meld, not inside it).
- Built with `cargo build --release -p benilla` (Rust 1.98.1, pinned by its `rust-toolchain.toml` and
  fetched by rustup; its Lua is compiled by the Visual Studio 2022 C toolchain). The program is
  `C:\WoW\benilla\target\release\benilla.exe`. This is the default "dev" build, which
  reads the install from `WOW_DATA`; `--no-default-features` is the player build, which only looks for
  `Data\` beside the binary, so keep the dev build for Meld.
- Meld points at it: Preferences › Benilla Folder… is `C:\WoW\benilla`, and Preferences ›
  Game client › Benilla is picked (both in `%APPDATA%\Meld\config.json`: `benillaPath`, `gameClient`).

- It reads the one client install, `C:\WoW\client\Data`: Meld sets `WOW_DATA` when it starts Benilla,
  and `WOW_DATA` is also set for the user, so a Benilla started by hand finds it. Its old copy of the
  client data (`benilla\WoW\Data`) was removed on 2026-10-15.

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
- **Preferences › Game window**: the game's own setting, Windowed or Fullscreen, at a size (1280×720
  to 2560×1440). Each time Meld starts the game it writes the 1.12 client's `gxWindow`, `gxMaximize`
  and `gxResolution` into the game's own settings (Benilla's `benilla-config\config.toml` `[cvars]`,
  Wow.exe's `WTF\Config.wtf`), so the in-game Video options still work until Meld next starts it
  (`internal/game/window.go`; config `gameWindow`, `gameResolution`). Benilla's fullscreen is borderless
  at the monitor's size; its `gxResolution` is the window's inner size, checked at 1280×720 on
  2026-10-15. Benilla's own `WOW_WIN` would also force a size, but it quits when the window comes out
  any other size, so Meld doesn't use it.

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

In order. Each became a backlog item (B-164 onwards), now a GitHub issue with the same B-number (label `benilla` or `benilla-port`).

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
3. **Port Benilla's exact client behaviour** where Meld approximates: see "Porting from Benilla" below
   (B-166 to B-176).
4. **Optional: a "Play here" button (B-171).** Benilla takes `WOW_HOST`, the login and the data folder
   from its environment; a server-side teleport of the logged-in character to the camera's spot (a GM
   command over the world database or the server's console) would let an author jump into the spot
   they are editing.

## Porting from Benilla

Benilla is MIT or Apache-2.0, which CLAUDE.md allows porting from (unlike Noggit, which is GPL), and it is
written against reverse engineering of the real 1.12.1 client ([benilla-re](https://github.com/samwhosung/benilla-re)),
citing the client's own function addresses in its comments. Porting it gives Meld the client's own rules
instead of approximations. The owner wants these done first, in the order below, starting in a fresh
session (decided 2026-10-15).

**How to port.** Benilla is Rust; Meld is Go (files, formats) and TypeScript (rendering, editing). Port the
behaviour, not the code layout: read the Benilla module, then write it Meld's way, with Meld's tests. Keep
Benilla's client address references in the comments where they explain a constant. Say in each commit
message that it ports from Benilla (MIT/Apache) and which module. The clone is at
`C:\WoW\benilla` (read only; `git pull` there to update). Benilla's paths below are under
`crates/`. Verify against the client the way the earlier items did (TESTS.md), and in Benilla itself where
a change shows on screen (it reads the same install, so what Meld previews should match what Benilla draws).

| Order | Item | Benilla source | Meld code it replaces or extends |
|---|---|---|---|
| 1 | **B-172 Ground tufts as the client places them** (done 2026-10-15; their view-depth fade done as B-178, #10) | `benilla-formats/src/ground_effects.rs` (`scatter_ground_doodads`, `BlizzardRandomizer`, `FRILL_DENSITY`), `benilla-world/src/clutter.rs` (the 70 yd range) | `frontend/src/lib/world/groundEffects.ts` (`cellTufts`, `tuftsPerCell`, `hash01`), `world/GroundEffectLayer.ts` (`TUFT_RANGE`) |
| 2 | **B-166 The client's sun, sky and fog** (done 2026-10-15; clouds done as B-179, #9) | `benilla-world/src/lighting/daynight.rs` (sun direction), `lighting/resolve.rs` (scene fog), `benilla-formats/src/light/atmosphere.rs` and `light/tables.rs` (band meanings), `benilla-world/src/shaders/sky.wgsl`, `sky.rs`, `clouds/` | `frontend/src/lib/wow/clientLight.ts`, `Engine.applyClientLight`, `engine/Environment.ts` (sun path, Preetham sky) |
| 3 | **B-173 Baked terrain shadows (MCSH)** (done 2026-10-15) | `benilla-adt/src/lib.rs` (MCSH read), `benilla-assets/src/terrain.rs` (shadow array), `benilla-assets/src/shaders/terrain.wgsl` (how it shades) | `internal/adt` (reads MCSH: today it is only passed through), `terrain/TerrainMaterial.ts`; then B-057 (the editor) |
| 4 | **B-167 Far horizon from the WDL** (done 2026-10-15) | `benilla-formats/src/wdl.rs` (mesh), `benilla-world/src/wdl.rs`, `benilla-assets/src/shaders/wdl.wgsl` (unlit, own fog) | new: a horizon layer beside `Water.floor`; Go already writes and reads the WDL (`internal/vmangos/wdl.go`) |
| 5 | **B-168 M2 particles, ribbons, texture animation** (texture animation done 2026-10-15; the rest split into B-181 to B-183; B-181 colour and transparency done 2026-10-15; B-182 particle emitters done 2026-10-15, #2; B-183 ribbons done 2026-10-15, #3) | `benilla-world/src/particles/`, `ribbons.rs`, `benilla-formats/src/particles.rs`, `ribbons.rs`, `models/tex_anim.rs`, `models/mat_anim.rs` | `internal/wow/m2anim.go` (emitters are only flame anchors today), `world/PropEffects.ts`, `world/Animator.ts` |
| 6 | **B-170 Terrain look** (compared 2026-10-15: filtering and blending already match, Benilla draws no overbright or scroll; the tiling waits on the owner, #4) | `benilla-assets/src/shaders/terrain.wgsl`, `terrain.rs` (repeats, blending, alpha edge filtering, overbright, layer animation) | `terrain/TerrainMaterial.ts` (the x1.5 overbright, the scroll rate) |
| 7 | **B-174 Water look** (done 2026-10-15, #5; `water_fx/` is a character's wading foam, not ported) | `benilla-world/src/liquid/`, `benilla-assets/src/shaders/liquid.wgsl`, `water_fx/` | `water/liquidMaterial.ts` |
| 8 | **B-169 Minimap textures** (the index read and written as the client's, done 2026-10-15, #6; writing the tiles is #17) | `benilla-formats/src/minimap_translate.rs`, `benilla-assets/src/minimap_grid.rs` | B-129 (writing them) |
| 9 | **B-175 Footsteps by terrain type** (done 2026-10-15, #7) | `benilla-formats/src/footsteps.rs`, `terrain.rs` | `GroundEffectsDialog.svelte` (footsteps picked by number) |
| 10 | **B-176 WMO interiors** (scoped 2026-10-15, effort L: a split proposed on #8) | `benilla-world/src/wmo_portal/` (portal culling, interior fog) | `world/ObjectLayer.ts`, the interior materials |

Also useful as references while doing other items: `benilla-formats/src/area_trigger.rs` (B-150),
`benilla-formats/src/light/` (the light editor B-149), `benilla-world/src/collision.rs` (camera collision).

Already gained from porting: the client's tuft scatter (B-172), and with it a bug fix (B-177): a ground
effect's slots name GroundEffectDoodad rows by their internal ID, not their row ID, which Meld had wrong.

Already gained from reading it: Benilla's ADT reader confirmed Meld's ground effect header offsets
(predominant map at 0x40 to 0x4F, no-tuft bits at 0x50), and its MPQ, WDT and WDL readers match what Meld
writes.

## Things to keep in mind

- Benilla only reads the install, never writes it, so Meld's patch is still the only thing that
  changes the game data. VMaNGOS's map extraction (publish) still reads the same patch.
- Benilla follows 1.12.1 only (its README rules out other clients), which matches Meld's own rule.
- It is a young project: if something Meld writes shows wrong in Benilla but right in Wow.exe, compare
  in Wow.exe first before changing Meld.
