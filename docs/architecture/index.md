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

## Extend an internal feature

This is a source-navigation checklist, not a plugin SDK or a stable third-party interface.
For user-authored Lua, use the [manual](../MANUAL.md) and [scripting reference](scripting.md);
do not expose Go, filesystem or database access merely to add a map operation.

### Add or change a map tool

1. Start with Tool and ToolContext in frontend/src/lib/tools/Tool.ts. Implement the relevant
   activation, pointer, tick/frame and key hooks. Pointer events can be absent when the engine
   ends a stroke during a tool/tab switch; do not assume a physical mouse-up always arrives.
2. Register a new ID in state/editor.svelte.ts:ToolId, its instance in Engine.ts's tools map,
   and its toolbar metadata in ui/tools.ts:TOOLS. Add the options UI where appropriate. The
   toolbar and shortcut rows use that metadata; a class alone does not make a tool selectable.
3. Follow an existing edit from input to history. SculptTool in tools/SculptTool.ts is a useful
   example: BrushTool starts a TerrainStroke on press and finishes/pushes its command on release.
   History.push accepts an **already-applied** command; undo restores the previous state and redo
   restores the result. Capture every changed array/placement and any dependent visual refresh,
   not just the most obvious value. One stroke should produce one meaningful undo step.
4. Put shared terrain-tool settings in the appropriate state/types and TOOL_SETTING_KEYS. Stamp
   copies those settings per brush; forgetting that path can make a tool work alone but not in a
   stack. Keep persistent preferences distinct from per-document editing state.
5. Use ui/commands.ts for rebindable command defaults and ui/runCommand.ts for shared execution.
   Tool selection rows are generated as tool:<id> from TOOLS; the user's prefs.keymap overrides
   defaults. Camera codes and fixed tool-local keys are distinct; do not add a competing listener
   that bypasses rebinding or steals text-field input.
6. Add the smallest deterministic regression: pure rule tests first, then an appropriate case in
   tests/toolUndo.test.ts for press/drag/tick/release and full snapshot Undo/Redo. Use
   tests/history.test.ts for stack semantics and tests/shortcuts.test.ts for key matching. Only
   add a live probe when the outcome needs actual UI/rendering; coordinate its shared backend.

### Add a backend capability

1. Keep editing logic in the frontend. Put OS/file/format work in the matching Go package and
   expose only the narrow operation through App in the relevant root app_<area>.go file.
   main.go binds the App instance and routes asset requests; validate paths and write permissions
   at this boundary rather than trusting a picker or a stale frontend preview.
2. Regenerate frontend/bindings and frontend/src/lib/wails with **make bindings** after changing the bound method signature;
   do not hand-edit generated exports/models. Run **make bindings-check** to detect method-name
   drift, and frontend type checks for shape/call-site errors. Binding generation is a development
   operation with the platform/Wails prerequisites in [development](../development.md), not a
   reason to regenerate every binding while changing prose.
3. For large binary replies, inspect the existing region-alpha handoff before adding base64 JSON.
   app_region.go:handOffAlpha puts bytes in internal/handoff.Store and returns alphaUrl;
   io/region.ts fetches it once as bytes through /wow/handoff. A handoff expires after two minutes
   or is consumed by its first fetch. Empty output has no URL; a second fetch returns 404, so a
   retry must request fresh data rather than blindly retrying the old URL. This is an internal
   transport detail, not persistent storage or a public download service.
4. Test format logic with synthetic bytes/temp files and handoffs with Go's httptest. For an
   external write, state destination/order/partial-error behavior and update the
   [write guide](../guides/saving-and-compiling.md) or
   [authoring guide](../guides/database-editing.md) as needed. UI Revert and map Undo do not
   retroactively undo external SQL/client output.

### Verify a small change

For the source-checked Sculpt/History/shortcut and region-handoff examples, these focused checks
avoid a live game or database. Run the Go command at the repository root and Bun commands from
frontend/:

```sh
go test ./internal/handoff -run '^TestServeOnce$' -count=1
cd frontend
bun test tests/history.test.ts tests/shortcuts.test.ts
bun test tests/toolUndo.test.ts
```

These tests do not certify pointer capture in the native app, WebGL frames, live client compatibility
or database writes. See [testing](../TESTS.md) for read-only integration versus isolated write tests,
standalone browser pages and backend-sharing probes. For database editor form state, reuse the
existing TemplateEditor explanation in [client integration](client.md), not a second editor framework.

## Related developer tools

- [Testing](../TESTS.md): choose checks, isolate writes and find regression recipes.
- `cmd/meldtool`: inspect maps, tiles, archives, models and bridge signatures without the editor; convert BLP textures and heightmaps; read the world database's creatures, objects, items and spells (JSON out, nothing written into the client or server).
- `internal/testclient`: locate local installations for read-only integration tests.
- `internal/sandbox`: redirect probe client reads/writes to an isolated client copy.
- `internal/recovery` and `internal/sessionlog`: crash recovery and diagnostic logs.
- [Engineering notebooks](../reference/index.md): retained investigations and detailed checklists.
