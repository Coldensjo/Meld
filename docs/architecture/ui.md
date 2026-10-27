# UI

The window layout, the asset browser and the dock panels and floating windows.

- **UI layout** (Photoshop-like, `App.svelte`):
  - Rows: `MenuBar`, `OptionsBar`, then the main row, then `StatusBar`.
  - Main row: `Toolbar` | centre column | `Dock`. The centre column is the `Viewport` (with the
    document tab) over the `AssetBrowser`, which has its own area along the bottom.
  - Preferences › Toolbar on the left / on the right (`prefs.toolbarSide`, #654) moves the toolbar to
    the window's right edge, after the dock. `App.svelte` swaps the `.main` grid's columns
    (`.toolbar-right`); the DOM order stays, so the tab order and the probes don't change. The
    toolbar's border and its hover description (#130) flip with it: the tip is placed by the
    toolbar's left edge and translated by its own width.
  - Per-tool settings go in `OptionsBar` (use `OptSlider`). The bar is one row: its controls wrap
    and the rows below the first are clipped until its More (n) button opens the bar over the
    viewport (#254), so put a tool's most used controls first; the brush's Size and Strength
    (`sizeStrength`) follow right after a tool's modes. Aim for a tool's controls to fit the row at 1400 px with
    nothing under More (#715): the Sculpt bar does, with its twelve modes as icon buttons (`SCULPT_MODES`,
    named by their tooltips and `aria-label`), narrower sliders, and a Brush button that opens a panel
    under the bar (`.brushpanel`, outside the clipped `.options`) with the settings set once: edit
    limit, image, falloff curve, shape, Flatten's target, direction and angled plane, Terrace's offset
    and painting while sculpting (the button reads "Brush · Paint" while that is on). The Water, Doodad
    and Paint bars fit the same way (#734): the panel is one for all four tools (`hasPanel`, its button
    `.brushbtn` last on the bar, named by `panelLabel`: Water, Placement, Spawns, Mask or Brush), with
    a branch per tool and mode; their Size, Strength and Falloff come from `sizeStrength` at
    `sliderW` 70, and the falloff curve and shape move into the panel. A spawn brush with many
    creatures still overflows under More. `OptSlider`'s
    number box hides its spin arrows to stay 46 px wide. It holds controls only: a sentence of
    help for the tool goes in `ToolHint.svelte` (a branch per tool and mode, with `<kbd>` markup),
    which `StatusBar` shows in its message slot while `ui.status` is 'Ready'; a status message takes
    the slot for its few seconds. Labels that name a control (`Texture:`, `Selected:`) stay in the bar.
  - Contextual editing goes in dock panels (`DockPanel` wrapper: tabs + collapse). Dock width
    and collapsed panels are stored in `prefs`.
  - Theme tokens are in `app.css` (neutral greys, blue `--accent`); status text is `--ok`, `--warn` and `--bad`, text on the accent fill `--accent-ink`, the dark 3D preview backgrounds `--preview-bg`, `--preview-glow` and `--preview-edge`, monospace `--mono` (#579).
    A component's `<style>` holds no colour literal: `tests/contrast.test.ts` fails on one (its allow-list is the debug
    overlay, SVG map strokes, game-coloured tooltips and overlays dark in both themes) and checks the status tokens on every panel.
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

- **Projects** (#48, Noggit Red's; File › Project…, `components/ProjectDialog.svelte`,
  `lib/io/project.ts`, `app_project.go`, `internal/config/project.go`): a project is a folder for the
  user's maps of it and the client folder it edits. Meld still opens straight into a map; only the
  Start dialog's Part of Azeroth asks for a project first (the owner's limit on the approval), and a
  new world needs none. Opening one (`OpenProject`) loads its client first (the client folder in
  Preferences becomes it), then writes `meld-project.json` (name and client) into the folder, so the
  folder picked again finds its client (`ProjectInFolder`), and puts it at the front of the config's
  recent list (`Projects`, ten kept, `ProjectPath` the open one). The Open and Save map dialogs
  start in the project's folder. Changing the client in Preferences changes the open project's client
  too (`projectClientChanged`). The File menu lists four recent projects to switch to; `ui.project`
  and `ui.recentProjects` mirror the config. Nothing else is per project yet (the server folder, the
  login and the prefs stay global).
- **Asset browser** (`components/AssetBrowser.svelte`, along the bottom of the window):
  - Search-first: `lib/wow/search.ts` tokenises every path (folder segments, file-name words,
    camel-case) and scores a query against them, with a synonym table (`SYNONYMS`) mapping the
    words an author types to the client's words. Kind tabs (Doodads, Buildings, Textures, All), a
    zone select and category facets narrow the results. Ctrl+F focuses the search.
  - Categories and zones come from path keywords in `lib/wow/catalog.ts`; tune the regex rules
    there.
  - The grid is virtualised (only the rows in view are rendered), so there is no result cap.
    Every tile grid (the asset and spawn browsers, the doodad brush editor, the display, look, icon
    and weapon pickers) shares it (#578): `lib/ui/virtualGrid.ts` (`gridCols`, `gridWindow`, the
    rows in view plus one each side, `rowTop`) and `components/VirtualGrid.svelte`, which renders
    the window's items through a `cell` snippet. The scroller, its scroll position and resets stay
    in each grid; the asset browser binds the block (`el`) to measure the Recent section above it.
    `AssetPreview.svelte` shows the hovered (else picked) item live in its own small renderer.
    It and `CreaturePreview` share `lib/ui/previewRenderer.ts` (#589): the renderer, its context
    loss and release, the orbit camera with drag and wheel, a right or middle drag that moves the
    orbit target up and down the model (#662: scaled by the distance, held to the bounds the view
    sets with `setPanRange` when it fits a model), and a frame loop that runs only while the
    view's `step` says something moves (a spin, an animation, particles, a moving texture), wakes on
    input, a resize, a restored context or a shown page, and keeps to Graphics › FPS limit. The asset
    preview spins a newly shown model for 6 s and while the pointer is over it, then stops drawing.
  - `ui.palette` follows the tool (textures while painting) and the browser follows it. Its
    height, collapsed state, tile size and recent picks are `prefs`, and so are the tab
    (`browserKind`) and each tab's search, zone, category and scroll (`browserViews`, `wow/browserViews.ts`).
    The Creatures and NPCs tabs (`SpawnBrowser.svelte`) also keep a sort there (#659: database order,
    or by level with `byLevel`, lowest or highest first).
  - The header is the same on every tab (#651): one search box (Ctrl+F, a per-tab placeholder), the
    count and the tile-size slider. Beside the box the model tabs show the zone select and Creatures
    and NPCs the sort; Objects and Prefabs show neither. The box writes the shown tab's
    `browserViews` entry (Prefabs has one too); `SpawnBrowser` reads its query from there and
    `PrefabBrowser` gets it as a prop, and both hand their result's length back through a bindable
    `count`. Neither has a search box of its own, and their category facets stay in their panels.
  - The **Names** checkbox in the header (`prefs.browserNames`, #655) shows or hides the name under
    every browser tab's tiles (`PaletteTile`'s `showLabel`) and, in the asset preview, the whole details
    block under the picture (name, kind, size and path; the Prefabs tab's name and contents too); the
    rows' height (`rowH`) drops by the label's 22 px with it. The pickers and the brush editor always
    show names. The size slider, the checkbox and the fold button sit in `.view-opts` at the header's
    right end, 254 px wide so they stand over the 260 px preview column (owner's request). In a narrow
    browser the search, the select and `.view-opts` shrink (to 60, 70 and 150 px) so the checkbox and
    the fold button stay in view; the slider gives way first.
  - The **Sets** tab shows the author's model sets (`wow/modelSets.ts`, `prefs.modelSets`): named lists
    of doodads and buildings, made and filled through a tile's right-click menu (which also holds the
    favourite star), and imported or exported as TOML (`importModelSets`/`exportModelSet` in `io/lists.ts`).
  - The **Prefabs** tab (`PrefabBrowser.svelte`, #170) lists the TOML files of `prefs.prefabDir`
    (`wow/prefabs.ts`: model clips by path, `ListPrefabs` binding); Models › Save Selection as Prefab
    writes one, and a click places it as a model paste (`Engine.placeObjectClip`; R and Ctrl+scroll
    turn a model paste, `world/clipTurn.ts`), varied when `prefs.prefabVary.on`. Its thumbnail draws
    all its models (`registerPrefab`, keyed by a hash of the file).
  - Thumbnails (`lib/wow/thumbs.ts`) render lazily into a render target on the **main**
    renderer, which shares GPU textures. They are cached as PNG via the `SaveThumbnail` binding.
  - **Never send request bodies (POST) to the Wails asset server.** WebKitGTK segfaults reading
    them. Use bindings for uploads.
- **Dock panels** (`components/Dock.svelte`): Layers, and the Minimap above it while attached (#749); only Layers otherwise, at the owner's request
  (2026-10-15). What the dropped panels did lives elsewhere now: `PropertiesPanel` is shown by the
  floating **Inspector** (`components/Inspector.svelte`, `ui.inspector`, the I key, Esc closes it);
  growing a region and saving or exporting spawns are File menu actions (shown for a region), with
  the unsaved spawn count as a chip in the status bar; the region's facts are in Map Properties.
  `MinimapPanel` and `SpawnsPanel` were deleted (the owner wants no spawn list; #263).
  The dock hides on its own (#653): `prefs.dockHidden`, set by the ✕ on its header (`DockPanel`'s
  `onclose`) and toggled by View › Layers panel. `App.svelte` then leaves it out of `.main`, and
  `.centre` keeps its pinned grid column, so the viewport takes the dock's width. Hiding drops a
  pending Replace (`ui.replaceSlot`), whose Cancel is in the hidden panel. Tab's hide-panels works on
  top of it.
  - **Minimap** (#749): `MinimapView.svelte` is the map (canvas, overview, tile borders, light zones,
    the camera's marker, click to jump), shown in one place at a time: as a dock panel above Layers
    while `prefs.minimapDocked` (the default), or in the floating `MinimapWindow.svelte`. `ui.minimap`
    (M, Camera › Minimap) shows it in either; `lib/ui/minimap.ts` holds the toggle, attach (⇥) and
    detach (⇱), and shows a hidden dock when the minimap is attached. `DockPanel`'s `actions` snippet
    puts the Light zones box and ⇱ on its header. The dock panel stays square at the dock's width, at
    most 40 % of the window's height. In a world tab (#15) it shows the map's overview in tiles
    instead of the stand-in's heights, with no light zones (terrain.md, the world view).
  - **History** (`components/HistoryWindow.svelte`, `ui.history`, Edit › History) is a floating window
    like the Inspector, not a dock panel: the active map's undo stack (`History.steps`), where a click
    calls `Engine.goToHistory` (undo or redo to that step). It re-reads the stack when
    `ui.historyVersion`, bumped by every `History` change and tab switch, moves. Its header shows the
    steps against `HISTORY_LIMIT` and the bytes they hold (`History.bytes`, the sum of each
    `Command.bytes`); `History` drops the oldest steps past the limit or past `History.budget`
    (`HISTORY_BYTES`, 256 MB), always keeping the newest (#444).
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
    picture 4:3, as the game stretches its square pictures over the screen. Its tiles on the
    client's 64×64 grid are a `TileGrid` too (#46, terrain.md's Start dialog): read from the map
    after every undo step (`ui.historyVersion`), a change inside the square is `setWorldTiles`, one
    past it `growWorld` after `askConfirm`.
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
  Esc belongs to the topmost dialog only (#573): each dialog's window keydown listener calls
  `takeEscape(e, root)` (`lib/state/escape.ts`, `root` its `use:dialogFocus` element), which is
  true once per event and false while another dialog is open above `root` (`topDialog()`, the
  newest root on dialogFocus's stack), so a Modal over an editor (the weapon picker over the
  creature editor) closes alone, whatever order the listeners mounted in. In a text field the first
  Esc only leaves the field, in Modal as in the editors. A new dialog with its own Esc uses the same.
- **Confirm prompts** (#581): never the native `confirm()` (unthemed, it blocks the render loop,
  skips the focus return, and headless Chrome answers it no). `await askConfirm(text, { title, ok,
  danger })` (`lib/state/confirm.ts`) sets `ui.confirm`, which AppDialogs draws as a Modal after
  every other dialog, so it sits over the dialog or editor that asked; Cancel, Esc and a click
  outside answer false. A dialog whose close asks (Zones, Portals, Lights) passes its async `close`
  to `Modal onclose`, so Esc and the backdrop ask too.
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
- **Camera views** (#750): the Camera menu's radio group Orbit View (F2, the default), Flying View
  (F3), Walking View (F4) and Top-down View (U), from `lib/ui/cameraView.ts`. A view has no state of
  its own: it is read from `prefs.cameraFollowGround` (Orbit or Flying, so a saved value and an old
  scene keep their meaning), `ui.walkCamera` and `ui.topDown`, and picking one sets the three
  (`withView`). Walking keeps Follow the Ground for the camera the walk returns to (`setWalk`), and
  Top-down keeps both, so U and F4 again go back to the view under them. T (`followGround`) switches
  Orbit and Flying; while walking or top-down it changes only the camera that view returns to.
- **Copy id** (#681): anything with an id has a right-click that copies it, as plain text, and its
  name where it has one: spawns (entry and guid), area triggers and a region's models (their unique
  ID; Copy path too) in the viewport, the asset tiles (Copy path), the creature and object tiles, and
  the editors' search results, list rows and RefField names and hits. `lib/ui/copyId.ts` makes the
  items (`copyItems`, labelled with what the id is: "Copy creature entry 448", via `idOf`), opens a
  menu (`openIdMenu`) or wires a row (`use:idMenu`); a row with a menu of its own adds `copyItems`
  to it. A list or script named by a summary of what it holds gets no Copy name (RefField `NAMED`).
  `EditorFrame` leaves Esc to an open right-click menu.
- **Shortcuts in one table** (#583): `lib/ui/commands.ts` lists every shortcut (id, group, text, and
  the `chords` App binds). App.svelte `onKeyDown` asks `commandFor(e, early)` and runs the command
  through `lib/ui/runCommand.ts`: the early chords (Ctrl, the function keys, Tab) before the engine
  and the tool see the key, the rest after `handleSelectionKey`/`handleToolKey`, so a tool's own
  letter (Paint's T) wins. A menu item takes its shortcut text and action with `cmd(id)` or
  `toggle(id)` (`keysOf(id)` for a key the engine reads itself, such as Del or H), and Help ›
  Keyboard Shortcuts lists `shortcutSections()`. A new shortcut is a row there plus its runner; a
  menu never types a shortcut string (`tests/shortcuts.test.ts` fails on one). The tool keys come
  from `TOOLS` (`lib/ui/tools.ts`).
- **Rebinding** (#396, Preferences › Hotkey Manager, `components/HotkeyManager.svelte`): the table's
  `chords` (commands, matched on `e.key`) and `codes` (the camera's movement rows, `camForward`…,
  matched on `e.code` as CameraController always did) are the defaults; the `keymap` pref holds only
  the rows the user changed (row id → chord texts such as `ctrl+shift+z`, or key codes; an empty list
  is a row with no key; an entry that doesn't parse keeps the default). App calls
  `bindKeymap(() => prefs.keymap)`, and every reader (`commandFor`, `keysOf`, `firstKeyOf`,
  `CAMERA_KEYS`) goes through the effective keys rebuilt when the pref is *replaced*: never edit it in
  place. Read inside a `$derived` (the menus, the Shortcuts dialog, the toolbar), `keysOf` follows the
  pref; `$effect(syncKeymap)` in App refills `CAMERA_KEYS` at once. `assignBinding` takes a key off
  every other row with the same press (a camera code clashes with the plain letter it types);
  `refusal` keeps out modifiers, F5/F8/F12 and the plain keys the engine reads (Esc, Enter, Del,
  arrows, PgUp/PgDn); `fixedClash` warns of H, R, T and Z, which the selection or a tool read first.
  The rows without chords or codes (Del, H, R, arrows, Esc, Paint's T, the mouse) stay fixed.
