# UI and the window

Panels, windows, the asset browser, preferences and saving. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first. The cube palette, the camera in a
world, the minimap's picture and World Properties are checked by the `cube-*` probes (`docs/architecture/cubes.md`, Checks).

## Session restore (reopening the last tabs at start)

Checks: `lib/io/session.ts` keeps the saved world tabs with their cameras in `prefs.session` (a few
seconds after it changes, saved alone through `savePref`, and on quit) and opens them again at start.
Untitled worlds are not kept. The prefs effect in App.svelte leaves `session` out, so a camera move
re-applies nothing: `bun run probe session-prefs` (#461).
- In the dev page: open a saved world (`mapio.openPath(__engine, '../crates/world/tests/fixtures/small.world')`
  through the page's own module URL), wait ~4 s, read `JSON.stringify(prefs.session)`, then reload
  the page without `nosession`: the tab comes back with its camera (`__engine.sceneView()`).
- Trap: the dev page without `?nosave` writes the real config.json, so the owner's own app will also
  open that world next.

## Autosave and recovery (#177)

Checks: `lib/io/recovery.ts` copies dirty world tabs as `.world` files into `%LOCALAPPDATA%\Meld\recovery`
(Linux `~/.cache/Meld/recovery`), and the next start offers copies whose session is gone
(`internal/recovery`, Go tests cover the alive file going stale). `bun run probe cube-copies` checks a
world's copy, its load and its recovery into a dirty tab (#65).
- By hand in the dev page: set `prefs.autosaveMinutes = 0.05` (from the loaded `editor.svelte.ts` URL),
  edit a world with the Cubes tool, and within ~20 s `<session>_<doc>.world` and `.json` appear beside
  `<session>.alive`.
- A crash without killing `wails dev` (it may be the owner's): copy the pair under another session name
  (`20261016-000000-aaaaaa_7`, with `id` and `session` changed in the JSON) and open a new page. The
  Recover dialog lists only that one; Recover opens it dirty and drops the copy.
- Traps: the page's session is the Go process's, so a page reload never offers its own copies, and two
  dev pages on one `wails dev` share the session (their doc ids can collide). Delete the probe copies
  afterwards, or the owner's next start offers them.

## The desktop window itself (closing with unsaved worlds, #188)

Checks: what only the native window does (its ✕, Alt+F4), in the built `build/bin/Meld.exe`. WebView2's
`--remote-debugging-port` through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` does not work (Wails sets
its own browser arguments), so drive the window from PowerShell with user32 (`SetForegroundWindow`,
`SetCursorPos`, `mouse_event`) and `SendKeys`, and look at screenshots (`Graphics.CopyFromScreen`):

- Start it with `Start-Process -PassThru`, wait for `MainWindowHandle` and ~12 s for the session to
  open, send `Y` (the Cubes tool) and click the world in the window's centre: the tab turns dirty (`*`).
- `$p.CloseMainWindow()` is the ✕: with a dirty world the process stays and "Unsaved changes" shows;
  clicking Quit without saving (its screen position from the screenshot; the screenshot's pixels are
  the screen's) ends the process with no second prompt.
- Trap: this runs the owner's real app on their config; its session restore opens their tabs. Only
  edit an untitled world, and quit without saving.

## Hover previews in tile grids (no gap between tiles)

Checks: in a grid whose hovered tile drives a preview (the cube palette), a tile only *sets* the hover
and the grid clears it on `pointerleave`, so moving slowly from one tile to the next never flashes the
tool's cube in the gap between them. `cube-palette` checks the hover and the leave. A new grid with a
hover preview should do the same.

## Names under the tiles (#655)

Checks: the asset browser header's Names checkbox (`prefs.browserNames`) hides the names under the
palette's tiles and in the preview, and the rows pack tighter. In the dev page: toggle it and count
`.tile .label`. The setting is saved to the real config from a dev page without `?nosave`: put it back.

## Menu heights (#122)

Checks: every menu fits the window. In headless Chrome (`docs/TESTS.md`), click each `.menubar .title`, read
the `.menubar .dropdown`'s height and whether `scrollHeight > clientHeight`, and click it shut. An
item is about 31 px tall, so a menu of 20 items with headers is near 700 px: keep a menu under about
18 rows, or it passes a 768 px tall window (the dropdown then scrolls rather than running off). A
script that compares the `label:` strings of `MenuBar.svelte` before and after a move (`git show
HEAD:...`, sorted) proves no item was lost.

## Hide panels (Tab)

Checks: Tab hides the toolbar, options bar, asset browser and status bar and the viewport grows to
fill the window; Tab again brings them back; View › Hide panels is the same switch.
In the dev page: `ui.hidePanels = true`, then `document.querySelector('canvas').clientHeight`
grows and `document.querySelector('[data-ui="Toolbar"]')` is null. A key event
(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))`) does the
same unless an input has focus; Ctrl+Tab still cycles the world tabs.
Probe: `bun run probe hide-panels` (canvas fills the window below the menu bar, returns on the second Tab).
Trap: `.centre` must stay in grid column 2 of `.main`; alone in the auto first column it shrank to its
content (145 px wide, #248).

## Toolbar on the right (#654)

Checks: Preferences › Toolbar on the right (`prefs.toolbarSide`) puts the toolbar at the window's right
edge, and back. In the dev page, click the Preferences menu item, then the radio "Toolbar on the
right": `.toolbar` sits at the right of the centre column, and its left border is set. Hover a toolbar
button (`pointerenter`, wait 450 ms): the `.tip` ends left of the toolbar. Hide panels still fills the
window. The pref saves to the real config from the dev page: set it back to the left.

## Tool hints

Checks: each tool's help sentence (`ToolHint.svelte`, a branch per tool and Cubes mode) shows in the
status bar's left slot and not in the options bar; a status message (`setStatus`) takes the slot and
the hint returns after it. In the dev page: set `editor.tool` and `editor.cubeMode`, step a frame and
read `[data-ui="StatusBar"]`'s text.
Trap: the slot is one line with an ellipsis, so a long hint is cut off at narrow widths; hovering
it shows the whole text.

## Help window

Checks: Help › Help… (or F1 anywhere but in an input) opens the Help dialog; its Open the manual
button and Help › Manual open docs/MANUAL.md on GitHub in the system browser (`BrowserOpenURL`; the
dev page uses `window.open`). In the dev page: `ui.dialog = 'help'` shows it. The URL is
`MANUAL_URL` in `AppDialogs.svelte`.

## Preferences from two windows

Checks: a save writes only the changed keys, merged into the file (`changedPrefs` in `prefsPatch.ts`,
`tests/prefs.test.ts`; `config.MergePrefs` in `internal/config/config_test.go`). By hand: open the
desktop app and a dev page without `?nosave`, change the camera speed in the app, then turn the fog
off in the page; the app's speed is still in `config.json` (the page sent only `fog`). The page's
`baseline` is private to `prefs.ts`; a key that was never saved goes out on the first save.

## Saving bar (#343, probe `saving-bar`)

Checks: `bun run probe saving-bar` drives `lib/state/saving.ts` in the dev page: a 100 ms save never
shows `SavingBar.svelte` (`[data-ui="SavingBar"]`), a longer one shows it after 400 ms centred in the
window, an overlapping save names itself with its log line and the first shows again when it ends,
and a save that throws still clears it. For a look, a scratch probe that calls `startSaving` and
waits 600 ms, run with `--shot <dir>`. The real saves need the desktop app's dialogs, so the probe
checks the helper, not File › Save.

## Top-down view (U)

Checks: U (or Camera › Top-down View) draws the world straight down with an orthographic camera
over the controller's target; the wheel zooms, WASD and a middle drag pan, Q/E and a right drag
turn the view, and both tools pick as in 3D (the ray goes straight down). Fog is off while it is on.
In the dev page: `ui.topDown = true; __engine.frame()`, then `__engine.camera.isOrthographicCamera`
is true. `ui.topDown = false` brings the perspective camera back.

## Log window

Checks: Help › Log… lists every status message with its time (`appLog.lines` in
`editor.svelte.ts`, the last 500) and the Go side's progress lines (they arrive as status messages).
In the dev page: `setStatus('probe')`, then `appLog.lines.slice(-1)`; `ui.dialog = 'log'` opens the
window, which stays scrolled to the newest line. Copy puts the whole log on the clipboard.

The same lines go to a file, one a session, in `<user cache>/Meld/logs/<start time>.log` (#319;
`internal/sessionlog`, the last 10 kept; on Windows `%LOCALAPPDATA%\Meld\logs`), batched once a
second through the `AppendLog` binding (`io/sessionLog.ts`). It is the first thing to read for a bug
report, as the Log window is gone once the editor closes. Probe `session-log` logs lines, clears the
window and reads them back through `SessionLog`. The running `make dev` must have rebuilt its Go side
first (a stale binary answers `null`).

## Minimap window (M)

Checks: M (or Camera › Minimap Window) opens a floating map at the top left (`[aria-label="Minimap"]`):
the camera's layer from above (`lib/cubes/layerMap.ts`), a pixel a column, redrawn when the layer or
the world's cubes change (checked at 2 Hz through `stats.view`), and a marker for the camera. A click
moves the camera there (`controller.focus`). `bun run probe cube-camera` checks the picture and its
redraw after an edit.
- The marker moves on the click itself (#129), not at the next 2 Hz refresh: dispatch a `click` with
  `clientX`/`clientY` on `.minimap .map`, wait one frame, and the marker has moved.

## Projects (#48)

Checks: File › Project… opens a project folder; the folder gets `meld-project.json`, the config
(`%APPDATA%\Meld\config.json`) gets `projectPath` and the project at the front of `projects`, the
File menu lists the other recent ones, and the Open and Save dialogs start in the folder. Go:
`go test ./internal/config/` (the recent list and the project file). By hand in the app: open a project
on a scratch folder, pick the folder again in the dialog (its name fills in), switch to another from
the File menu, and Close Project.
- Trap: opening a project changes the owner's real config (the recent list), so a probe must not call
  `OpenProject`; set `ui.project` in the page instead.

## Accessibility (#354)

Checks: keyboard focus, roles and contrast, the audit's method (its findings are #369 to #375).
- `cd frontend && bun run check` reports Svelte's a11y warnings; `svelte.config.js` sets no
  `warningFilter`, so 0 warnings means none are hidden.
- Focus and roles in the live app, from a probe (`P.state()` gives `ui`): open a dialog with
  `ui.dialog = 'about'`, then read `document.activeElement` and
  `document.querySelector('[role="dialog"]').contains(document.activeElement)`; click a
  `.menubar .title` and check the focus lands in `.dropdown`; count `[aria-pressed]` in `.toolbar`
  (exactly one true, moving with `editor.tool`, #373).
  Dispatch keys with `new KeyboardEvent('keydown', { key, bubbles: true })` on the focused element.
- Contrast: compute the WCAG ratio of each token pair in `app.css` (relative luminance, sRGB) for
  both themes; small UI text (10 to 12 px) needs 4.5:1, focus rings and borders 3:1.
  `frontend/tests/contrast.test.ts` asserts it for `--text`, `--text-dim`, `--accent-text` and
  `--danger-text` on all four panels; text uses those tokens, `--accent` and `--danger` stay for fills.
- Trap: `el.focus()` from a script doesn't match `:focus-visible` in Chromium, so a focus ring checked
  that way reads `outline-style: none`; press Tab in a real page, or check the CSS rule itself.
- Focus ring and reduced motion (#374, probe `focus-motion`): checks `app.css` holds the `:root[data-kbd-nav] :focus-visible` ring
  (#652: `main.ts` sets the attribute on Tab, clears it on a pointer press) and the plain `:focus-visible` reset and the `prefers-reduced-motion` rule (it reads the stylesheets,
  since the probe cannot fake a Tab or the media query). Look at the ring by pressing Tab in the dev page.
- Trap: the `data-ui` attributes on component roots belong to the F8 overlay, not to accessibility.
- Trap: the tool tip opens on keyboard focus only (`:focus-visible`), which a script's `focus()` does not
  trigger in the dev page and a synthetic Tab keydown cannot fake (Tab toggles the panels). Press Tab in the
  dev page by hand to see the tip.

## Dialog focus and Esc (#369, #573, probe `dialog-focus`)

Checks: a dialog takes the focus on open, keeps Tab inside it and gives the focus back on close.
- `bun run probe dialog-focus` opens About from a button and from the Help menu, checks the focus
  lands inside, that Tab from the last control and Shift+Tab from the first wrap (and are prevented),
  that Tab from outside pulls the focus back in, and that closing refocuses the opener (the menu title
  for a menu item). Then an Esc in a field of About only leaves the field and the next closes About
  (#573), and Keyboard Shortcuts opens with its Arrow keys row once (#377). Esc going to the topmost
  of two open dialogs is not probed: no two dialogs open at once since the doodad brush editor went.
- Trap: the first focus waits a `setTimeout(0)`, so a dialog's own `autofocus` or `searchBox.focus()`
  wins; read the focus with `P.until`, not straight after setting `ui.dialog`.
- Trap: a synthetic Tab `KeyboardEvent` doesn't move the focus by itself; the probe checks the
  wrap cases only, where the action moves it and calls `preventDefault`.

## Menu keys (#370, probe `menu-keys`)

Checks: the menu bar and the right-click menu work from the keyboard.
- `bun run probe menu-keys` checks the roles (`menubar`, `aria-haspopup`, `aria-expanded`), that a
  click on File focuses its first item, Down/Up/Home/End and the wrap, that a tool letter (`y`)
  pressed in the menu doesn't change the tool (and does once the menu is closed), Right and Left
  between File and Edit, Escape back onto the title, Down/Up/Enter/Right on a closed title, and Tab
  closing the menu onto its title. Then it opens a right-click menu through `ui.contextMenu` with a
  separator and a disabled item, and checks the first focus, the skip and the wrap, Escape giving
  the focus back to the opener, and a pick running its item. Run `dialog-focus` with it.
- Trap: a synthetic Tab doesn't move the focus, so the probe only checks the menu closed and the
  focus sits on the title, from where the browser's own Tab moves on.

## Interface size (#372, probe `ui-scale`)

Checks: Preferences › Interface size zooms the whole UI and everything still lines up.
- `bun run probe ui-scale` sets 150 % and checks the root's `zoom` and `--ui-zoom`, that the app
  fills the window without running past it, that the canvas's buffer matches its size on screen
  (sharp), that the window's own hit test finds the canvas inside its rect and a pointer at a share
  of the rect gives the engine that share, that the Preferences menu fits and lists the sizes, that
  a right-click menu opened at window px (300, 200) has its corner there, and Ctrl+= / Ctrl+- /
  Ctrl+0. Run `menu-keys`, `dialog-focus` and `hide-panels` with it.
- To look at it: a scratch probe that sets `prefs.uiScale = 1.5` and opens a dialog, run with
  `--shot <dir>`.
- Trap: the zoom also scales `vw` and `vh` (a `100vh` box is 1.5 windows tall at 150 %), which is
  why the styles use `var(--vh)`. A new `vh` or `vw` in a style overflows at a larger size.
- Not checked here: WebKitGTK (Linux). Its `zoom` may report `getBoundingClientRect` in the zoomed
  page's px rather than window px; check the viewport picking and the right-click menu there at 150 %.
