# UI

The window layout, the palette along the bottom, the floating windows and the dialogs.

- **UI layout** (Photoshop-like, `App.svelte`):
  - Rows: `MenuBar`, `OptionsBar`, then the main row, then `StatusBar`.
  - Main row: `Toolbar` | centre column. The centre column is the `Viewport` (with the document
    tab) over the `AssetBrowser`, which has its own area along the bottom. The right dock (`Dock`,
    its Layers panel of terrain textures) went with the terrain (#61).
  - Preferences › Toolbar on the left / on the right (`prefs.toolbarSide`, #654) moves the toolbar to
    the window's right edge. `App.svelte` swaps the `.main` grid's columns
    (`.toolbar-right`); the DOM order stays, so the tab order and the probes don't change. The
    toolbar's border and its hover description (#130) flip with it: the tip is placed by the
    toolbar's left edge and translated by its own width.
  - Per-tool settings go in `OptionsBar` (use `OptSlider`). The bar is one row: its controls wrap
    and the rows below the first are clipped until its More (n) button opens the bar over the
    viewport (#254), so put a tool's most used controls first, right after its modes. It holds
    controls only: a sentence of
    help for the tool goes in `ToolHint.svelte` (a branch per tool and mode, with `<kbd>` markup),
    which `StatusBar` shows in its message slot while `ui.status` is 'Ready'; a status message takes
    the slot for its few seconds. Labels that name a control (`Texture:`, `Selected:`) stay in the bar.
  - Theme tokens are in `app.css` (neutral greys, blue `--accent`).
  - **Saving bar** (`components/SavingBar.svelte`, #343): a box in the middle of the window that
    names the save running (`ui.saving`) over a moving stripe, with a log line under it
    (`ui.savingDetail`). Every save goes through `lib/state/saving.ts`: `withSaving(label, fn)` around
    the write itself (not its file dialog), or `startSaving(label)` and the returned end function
    where a Save button already keeps a `saving` flag. Saves may overlap; the newest running is named. The Go
    bindings report no progress, so there is no percentage. It shows after 400 ms, takes no clicks
    (the quit dialog under it still works) and sits at z-index 900, over the editors and `Modal`.
    A new save anywhere gets a label through the same helper.
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
  user's worlds; it no longer has a client folder (3dgame #59: an older project file's `clientPath` is
  ignored). The editor opens straight into a world; nothing needs a project. Opening one
  (`OpenProject`) writes `meld-project.json` (its name) into the folder, so the folder picked again
  finds its name (`ProjectInFolder`), and puts it at the front of the config's recent list
  (`Projects`, ten kept, `ProjectPath` the open one). The Open and Save dialogs start in the
  project's folder. The File menu lists four recent projects to switch to; `ui.project`
  and `ui.recentProjects` mirror the config. Nothing else is per project yet (the prefs stay global).
- **Asset browser** (`components/AssetBrowser.svelte`, along the bottom of the window): the frame
  (its height, dragged by its top edge, `prefs.browserHeight`, and folding away,
  `prefs.browserCollapsed`) round the cube palette (`CubePalette.svelte`, #63, cubes.md), which has
  the tabs, the search (Ctrl+F), the tiles, the sets and the prefabs of cubes. The client's models and
  textures, their tabs, sets, prefabs, thumbnails and previews went with the terrain and its models
  (#61).
  - **Never send request bodies (POST) to the Wails asset server.** WebKitGTK segfaults reading
    them. Use bindings for uploads.
- **History** (`components/HistoryWindow.svelte`, `ui.history`, Edit › History) is a floating
  window: the active world's undo stack (`History.steps`), where a click calls `Engine.goToHistory`
  (undo or redo to that step). It re-reads the stack when `ui.historyVersion`, bumped by every
  `History` change and tab switch, moves. Its header shows the steps against `HISTORY_LIMIT` and the
  bytes they hold (`History.bytes`, the sum of each `Command.bytes`); `History` drops the oldest steps
  past the limit or past `History.budget` (`HISTORY_BYTES`, 256 MB), always keeping the newest (#444).
- **World Properties** (`MapPropertiesDialog.svelte`, File › World Properties…, `ui.dialog =
  'mapProps'`) holds the world's facts (size, layers, chunks, file, monsters, NPCs, props) and its spawn
  point (`Engine.setWorldSpawn`, one undo step). Put any new per-world setting in this dialog, not in
  a panel or the Graphics menu.
- **Dialogs and focus** (#369): every dialog, `Modal.svelte` and the editors and windows with their
  own `role="dialog"` root, carries
  `use:dialogFocus` (`lib/ui/dialogFocus.ts`). On open it focuses the first control (Modal prefers
  its body over the ✕) unless the dialog focused a field itself (`autofocus`, a search box); while
  it is the newest open dialog, Tab and Shift+Tab wrap at its ends; on close the focus goes back to
  what held it, or to the menu title when a menu item opened it. A new dialog root gets the action
  too. Modal is labelled by its `<h2>` (`aria-labelledby`, an id from `$props.id()`).
  Esc belongs to the topmost dialog only (#573): each dialog's window keydown listener calls
  `takeEscape(e, root)` (`lib/state/escape.ts`, `root` its `use:dialogFocus` element), which is
  true once per event and false while another dialog is open above `root` (`topDialog()`, the
  newest root on dialogFocus's stack), so a Modal over another dialog closes alone, whatever order the listeners mounted in. In a text field the first
  Esc only leaves the field, in Modal as in the editors. A new dialog with its own Esc uses the same.
- **Menus from the keyboard** (#370): the menu bar (`MenuBar.svelte`, `role="menubar"`, titles with
  `aria-haspopup` and `aria-expanded`) and the right-click menu (`ContextMenu.svelte`, on the cube palette) follow the
  WAI-ARIA menu pattern. Opening a menu (click, Enter, Space or Down on a title; Up opens on the last
  item) focuses its first enabled item; Up, Down, Home and End move between the items
  (`lib/ui/menuKeys.ts`, shared by both), Left and Right open the neighbouring menu, Escape closes
  it onto its title (the right-click menu: onto what held the focus before), Tab closes it and moves
  on. The items have `tabindex="-1"`, and the dropdown's keydown handler stops every key, so the
  world's hotkeys (App.svelte `onKeyDown`, on `window`) don't fire while a menu holds the focus. Keep
  each dropdown right after its title in the DOM: `dialogFocus` finds the title as the menu's
  previous sibling.
