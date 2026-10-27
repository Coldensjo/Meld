# Architecture overview

Meld has a native Go backend for files, archives and server integration, and a browser-based
frontend for editing and rendering. The Wails bridge connects them in the desktop application.

Read this overview to find the right subsystem. The linked references preserve the deeper format
rules and implementation pitfalls; you do not need to read them all before making a small change.

## The main boundaries

| Layer | Owns | Main locations |
| --- | --- | --- |
| Desktop and bridge | Window lifecycle, dialogs, configuration and bound methods | Root `main.go`, `app.go` and `app_<area>.go` files |
| Backend | MPQ reads, format decoding, map persistence, client/server writes | `internal/` |
| Editing | Tools, terrain changes, model placement and undo | `frontend/src/lib/tools`, `terrain`, `state` and `world` |
| Rendering | Camera, frame loop, terrain, models, water, sky and lighting | `frontend/src/lib/engine`, `models`, `water` and `world` |
| Interface | Menus, panels, dialogs, commands and preferences | `frontend/src/components` and `frontend/src/lib/ui` |
| File workflows | Open, save, compile, publish, import/export and launch | `frontend/src/lib/io` |

**Editing belongs in the frontend.** The backend handles operating-system resources and binary
formats; it does not perform brush strokes. Map mutations must participate in undo history.

## How assets reach the viewport

1. The user selects a local client installation.
2. Go reads its MPQ archive chain, including patches, and decodes requested files.
3. The frontend requests textures, meshes and related data through the `/wow/*` endpoints.
4. Three.js draws terrain and placed models; the UI presents thumbnails and editable properties.

A `.wmap` records client asset paths, not extracted game assets. Missing assets can therefore be
a client-configuration problem rather than a broken map. Keep synthetic test fixtures separate from
data read from a developer's local client.

## How edits reach the game

- A `.wmap` is the editable document. `internal/mapfile` handles its versioned compressed format;
  `frontend/src/lib/io/mapData.ts` converts the bridge representation.
- `internal/adt` reads and rewrites terrain tiles. `internal/vmangos` integrates regions, client
  tables, patch installation, server map extraction and database edits.
- The `io/compile.ts` and `io/publish.ts` workflows distinguish existing-region compilation from
  publishing a new map. Neither is interchangeable with saving a working file.
- Pending patch writes wait for file access; server map rebuilds wait for the world server to stop.
  Explicit game launch is handled separately by `internal/game`.

The [save and compile guide](../guides/saving-and-compiling.md) describes the user-visible contract.
Change tests as well as code when altering this boundary: an editor-only round trip cannot prove
that the actual 1.12 client or server accepts an export.

## Subsystem references

| Area | Read this for |
| --- | --- |
| [Terrain and maps](terrain.md) | `.wmap` versions, height fields, texture chunks, map flags, regions and compilation |
| [Tools and selection](tools.md) | Tool lifecycle, brushes, area selection, clipboard, gizmos and undo |
| [Placed models](objects.md) | Attachments, instancing, picking, LOD, WMO interiors, animation and effects |
| [Water](water.md) | Liquid layers, sea level, rendering and tile export |
| [Lighting and sky](lighting.md) | Client lighting, sky, fog, clouds, shaders and shadows |
| [UI](ui.md) | Layout, asset browser, docking, inspectors and document panels |
| [Client and server integration](client.md) | Asset endpoints, coordinates, spawns, database editors and client compatibility |
| [Scripting](scripting.md) | Lua runtime, supported API, script brushes, noise and images |

These are detailed implementation references, not release notes. Issue numbers identify the history
of a decision or regression; check the current implementation before treating a dated observation
as a present limitation.

## Constraints worth checking first

- **Target format:** WoW 1.12.1. Support for decoding an asset from another version does not imply
  support for exporting a world for that version.
- **Performance:** avoid per-frame allocations and reactive-state writes in hot paths. Measure
  the same scene before and after a performance change.
- **Data safety:** preserve fields the editor does not own. Older documents can lack knowledge
  of client holes, liquids or chunk data; unknown is not the same as deliberately empty.
- **Platform scope:** the editor builds on Windows and Linux, but the bundled VMaNGOS process
  management and map-extraction tooling is Windows-only. Do not equate cross-platform editing
  with cross-platform server automation.
- **Licensing:** do not commit Blizzard data. Behavior reimplemented from another project must
  respect that project's licence; the repository accepts permissively licensed dependencies.

The [design draft](../DESIGN.md) records original priorities and policy. It is retained unchanged;
it contains historical scope statements, including the old Lua non-goal superseded by the
implemented [scripting system](scripting.md).

## Related developer tools

- [Testing](../TESTS.md): choose checks, isolate writes and find regression recipes.
- `cmd/meldtool`: inspect maps, tiles, archives and bridge signatures without the editor.
- `internal/testclient`: locate local installations for read-only integration tests.
- `internal/sandbox`: redirect probe client reads/writes to an isolated client copy.
- `internal/recovery` and `internal/sessionlog`: crash recovery and diagnostic logs.
- [Engineering notebooks](../reference/index.md): retained investigations and detailed checklists.
