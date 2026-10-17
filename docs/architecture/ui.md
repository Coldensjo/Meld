# UI

The window layout, the asset browser and the dock panels and floating windows.

- **UI layout** (Photoshop-like, `App.svelte`):
  - Rows: `MenuBar`, `OptionsBar`, then the main row, then `StatusBar`.
  - Main row: `Toolbar` | centre column | `Dock`. The centre column is the `Viewport` (with the
    document tab) over the `AssetBrowser`, which has its own area along the bottom.
  - Per-tool settings go in `OptionsBar` (use `OptSlider`).
  - Contextual editing goes in dock panels (`DockPanel` wrapper: tabs + collapse). Dock width
    and collapsed panels are stored in `prefs`.
  - Theme tokens are in `app.css` (neutral greys, blue `--accent`).

- **Asset browser** (`components/AssetBrowser.svelte`, along the bottom of the window):
  - Search-first: `lib/wow/search.ts` tokenises every path (folder segments, file-name words,
    camel-case) and scores a query against them, with a synonym table (`SYNONYMS`) mapping the
    words an author types to the client's words. Kind tabs (Doodads, Buildings, Textures, All), a
    zone select and category facets narrow the results. Ctrl+F focuses the search.
  - Categories and zones come from path keywords in `lib/wow/catalog.ts`; tune the regex rules
    there.
  - The grid is virtualised (only the rows in view are rendered), so there is no result cap.
    `AssetPreview.svelte` shows the hovered (else picked) item live in its own small renderer.
  - `ui.palette` follows the tool (textures while painting) and the browser follows it. Its
    height, collapsed state, tile size and recent picks are `prefs`, and so are the tab
    (`browserKind`) and each tab's search, zone, category and scroll (`browserViews`, `wow/browserViews.ts`).
  - The **Sets** tab shows the author's model sets (`wow/modelSets.ts`, `prefs.modelSets`): named lists
    of doodads and buildings, made and filled through a tile's right-click menu (which also holds the
    favourite star), and imported or exported as TOML (`importModelSets`/`exportModelSet` in `mapio.ts`).
  - The **Prefabs** tab (`PrefabBrowser.svelte`, #170) lists the TOML files of `prefs.prefabDir`
    (`wow/prefabs.ts`: model clips by path, `ListPrefabs` binding); Models › Save Selection as Prefab
    writes one, and a click places it as a model paste (`Engine.placeObjectClip`; R and Ctrl+scroll
    turn a model paste, `world/clipTurn.ts`), varied when `prefs.prefabVary.on`. Its thumbnail draws
    all its models (`registerPrefab`, keyed by a hash of the file).
  - Thumbnails (`lib/wow/thumbs.ts`) render lazily into a render target on the **main**
    renderer, which shares GPU textures. They are cached as PNG via the `SaveThumbnail` binding.
  - **Never send request bodies (POST) to the Wails asset server.** WebKitGTK segfaults reading
    them. Use bindings for uploads.
- **Dock panels** (`components/Dock.svelte`): only Layers is shown, at the owner's request
  (2026-10-15). What the dropped panels did lives elsewhere now: `PropertiesPanel` is shown by the
  floating **Inspector** (`components/Inspector.svelte`, `ui.inspector`, the I key, Esc closes it);
  growing a region and saving or exporting spawns are File menu actions (shown for a region), with
  the unsaved spawn count as a chip in the status bar; the region's facts are in Map Properties.
  `MinimapPanel` and `SpawnsPanel` are no longer mounted (the owner wants no spawn list).
  - **History** (`components/HistoryWindow.svelte`, `ui.history`, Edit › History) is a floating window
    like the Inspector, not a dock panel: the active map's undo stack (`History.steps`), where a click
    calls `Engine.goToHistory` (undo or redo to that step). It re-reads the stack when
    `ui.historyVersion`, bumped by every `History` change and tab switch, moves.
  - **Layers** (`LayersPanel.svelte`) is only the four texture layers of the paint chunk under the
    cursor (`editor.hoverChunk`, tracked in `Engine.updateHoverChunk` and tinted in the terrain
    shader), an unused slot shown as an empty layer. With an area selected it is instead about every
    chunk the area touches (`Engine.selectedChunks`), listing their textures together
    (`chunksContents`) with a Delete all. Replace on a layer sets `ui.replaceSlot` (`chunks` + `tex`);
    the next pick in the asset browser goes to `Engine.replaceTextureInChunks`. Delete (✕) is
    `deleteTextureInChunks` (`removeSlot` in `chunkPaint.ts`: the layer's weight goes to each texel's
    strongest other texture; a chunk whose last texture goes is empty, drawn black and exported
    with no layers). All are one undo step. Nothing else goes in this panel. Auto-paint, Fill mask
    and the "Replace Texture Everywhere" dialog are in the Terrain menu.
  - `editor.palette` is the map's list of textures (WoW tileset paths or `#rrggbb` colours, up to
    255). `Engine.useTexture(path)` adds one and makes it the paint texture.
  - **Properties** (`PropertiesPanel.svelte`) is no longer a dock panel: the floating Inspector shows
    it. It is the inspector for what is selected: one model's
    placement as `PropField`s (type a number, or drag the label to scrub; live preview and one undo
    step on release) with Focus, Duplicate, Hide, Delete, Detach, Place more and Select all of
    these (`Engine.selectModelsOfType`); a mixed selection's models by kind (a click narrows the
    selection to that kind); or the selected area (size, holes, cut/fill, copy, mask). With
    nothing selected it only shows a hint.
  - **Map Properties** (`MapPropertiesDialog.svelte`, File > Map Properties…, `ui.dialog =
    'mapProps'`) holds the map's facts and the world settings (sea on/off, sea level, steep
    slopes as rock). The sea level is one height for the whole map and is read-only for a part
    of Azeroth, which keeps the client's ocean. Lakes and rivers are the Water tool's Paint mode.
    Put any new per-map setting in this dialog, not in a panel or the Graphics menu.
  - Alt+click is the pipette (`tools/PipetteTool.ts`): in Select and Place it picks the model
    under the cursor as the one to place, or the ground's texture; in Paint and Road, the texture.
