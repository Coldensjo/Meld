# UI

The window layout, the asset browser and the dock panels and floating windows.

- **UI layout** (Photoshop-like, `App.svelte`):
  - Rows: `MenuBar`, `OptionsBar`, then the main row, then `StatusBar`.
  - Main row: `Toolbar` | centre column | `Dock`. The centre column is the `Viewport` (with the
    document tab) over the `AssetBrowser`, which has its own area along the bottom.
  - Per-tool settings go in `OptionsBar` (use `OptSlider`). The bar is one row: its controls wrap
    and the rows below the first are clipped until its More (n) button opens the bar over the
    viewport (#254), so put a tool's most used controls first; the brush's Size and Strength
    (`sizeStrength`) follow right after a tool's modes. It holds controls only: a sentence of
    help for the tool goes in `ToolHint.svelte` (a branch per tool and mode, with `<kbd>` markup),
    which `StatusBar` shows in its message slot while `ui.status` is 'Ready'; a status message takes
    the slot for its few seconds. Labels that name a control (`Texture:`, `Selected:`) stay in the bar.
  - Contextual editing goes in dock panels (`DockPanel` wrapper: tabs + collapse). Dock width
    and collapsed panels are stored in `prefs`.
  - Theme tokens are in `app.css` (neutral greys, blue `--accent`).
  - **Saving bar** (`components/SavingBar.svelte`, #343): a box in the middle of the window that
    names the save running (`ui.saving`) over a moving stripe, with a publish's log line under it
    (`ui.savingDetail`). Every save goes through `lib/state/saving.ts`: `withSaving(label, fn)` around
    the write itself (not its file dialog), or `startSaving(label)` and the returned end function
    where a Save button already keeps a `saving` flag (the database editors, their tabs, the flight
    path, light, portal and zone windows). Saves may overlap; the newest running is named. The Go
    bindings report no progress, so there is no percentage. It shows after 400 ms, takes no clicks
    (the quit dialog under it still works) and sits at z-index 900, over the editors and `Modal`.
    A new save anywhere gets a label through the same helper; the background server map rebuild
    after a compile reports in the status bar only, since editing goes on during it.
  - **Interface size** (Preferences, Ctrl+= / Ctrl+- / Ctrl+0, `prefs.uiScale`, #372):
    `lib/ui/uiScale.ts` puts CSS `zoom` on the root element, since every size in the app is in px.
    Under it, pointer positions (`clientX`) and `getBoundingClientRect` stay in window px, while
    `left`, `top`, widths, `offsetWidth`, `clientWidth` and `scrollTop` are in the zoomed page's CSS
    px. So code that turns a pointer position, a drag distance or a rect into a CSS position or size
    goes through `toCss` (and `cssViewport()` for the window's size); a ratio of a pointer to a rect
    (the viewport's picking) needs nothing. Zoom scales `vw` and `vh` too: use `var(--vw)` and
    `var(--vh)` from `app.css`. The 3D canvas and the preview canvases multiply their pixel ratio
    by the zoom, so they keep one buffer pixel per screen pixel.

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
  `MinimapPanel` and `SpawnsPanel` were deleted (the owner wants no spawn list; #263).
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
    selection to that kind); the selected area (size, holes, cut/fill, copy, mask); or, with a
    creature or game object of the region selected, its pool and formation (`PoolFields`,
    `FormationFields`, #172; client.md). With nothing selected it only shows a hint.
  - **Map Properties** (`MapPropertiesDialog.svelte`, File > Map Properties…, `ui.dialog =
    'mapProps'`) holds the map's facts and the world settings (sea on/off, sea level, steep
    slopes as rock). The sea level is one height for the whole map and is read-only for a part
    of Azeroth, which keeps the client's ocean. Lakes and rivers are the Water tool's Paint mode.
    A map made for the client also has its Map.dbc and map_template facts here (`MapInfo`, written
    on publish). Its loading screen is one of the client's or, through Picture… (#218), a PNG of the
    author's: `WriteLoadingScreen` (`vmangos/loadingscreen.go`) writes it at once as a 512x512 DXT1
    BLP at `Interface\Glues\LoadingScreens\LoadScreenMeld<Dir>.blp`, a LoadingScreens.dbc row of its
    own (found again by that path) and the map's Map.dbc field 38 when the client has the row, and the
    dialog chooses the row in `MapInfo` so a later publish keeps it. The preview draws the chosen
    picture 4:3, as the game stretches its square pictures over the screen.
    Put any new per-map setting in this dialog, not in a panel or the Graphics menu.
  - Alt+click is the pipette (`tools/PipetteTool.ts`): in Select and Place it picks the model
    under the cursor as the one to place, or the ground's texture; in Paint and Road, the texture.
- **Dialogs and focus** (#369): every dialog, `Modal.svelte` and the editors and windows with their
  own `role="dialog"` root (the creature, item, spell, quest and object editors, the Creatures
  workspace, the doodad brush editor, the model preview, the start dialog), carries
  `use:dialogFocus` (`lib/ui/dialogFocus.ts`). On open it focuses the first control (Modal prefers
  its body over the ✕) unless the dialog focused a field itself (`autofocus`, a search box); while
  it is the newest open dialog, Tab and Shift+Tab wrap at its ends; on close the focus goes back to
  what held it, or to the menu title when a menu item opened it. A new dialog root gets the action
  too. Modal is labelled by its `<h2>` (`aria-labelledby`, an id from `$props.id()`).
- **Menus from the keyboard** (#370): the menu bar (`MenuBar.svelte`, `role="menubar"`, titles with
  `aria-haspopup` and `aria-expanded`) and the right-click menu (`ContextMenu.svelte`) follow the
  WAI-ARIA menu pattern. Opening a menu (click, Enter, Space or Down on a title; Up opens on the last
  item) focuses its first enabled item; Up, Down, Home and End move between the items
  (`lib/ui/menuKeys.ts`, shared by both), Left and Right open the neighbouring menu, Escape closes
  it onto its title (the right-click menu: onto what held the focus before), Tab closes it and moves
  on. The items have `tabindex="-1"`, and the dropdown's keydown handler stops every key, so the
  map's hotkeys (App.svelte `onKeyDown`, on `window`) don't fire while a menu holds the focus. Keep
  each dropdown right after its title in the DOM: `dialogFocus` finds the title as the menu's
  previous sibling.
