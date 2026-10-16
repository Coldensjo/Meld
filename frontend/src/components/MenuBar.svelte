<script lang="ts">
  import { editor, prefs, setStatus, stepCameraSpeed, ui, wow } from '../lib/state/editor.svelte'
  import type { Engine } from '../lib/engine/Engine'
  import { engineRef } from '../lib/state/engineRef'
  import { chooseBenillaFolder, launchGame, setGameClient, setGameWindow, chooseVmangosFolder, exportAlphamap, importAlphamap, exportDoodadBrush, exportHeightmap, exportNormalMap, exportObjectList, exportRegion, exportSpawnSql, extendRegion, hasBackend, importDoodadBrushes, exportPortCoords, importObjectList, openMap, requestRevert, saveMap, saveMinimapImage, saveOrPublish } from '../lib/io/mapio'
  import { growableSides, type Side } from '../lib/io/regionGrow'
  import { activeDoodadBrush } from '../lib/tools/DoodadBrushTool'
  import { chooseWowFolder } from '../lib/wow/api'
  import { copyScene, copyTeleport, pasteScene } from '../lib/io/scene'
  import { ClearThumbnailCache, GameEvents } from '../../wailsjs/go/main/App'
  import { quitNow } from '../lib/io/session'
  import { requestClose } from './DocTabs.svelte'
  import { BrowserOpenURL } from '../../wailsjs/runtime/runtime'
  import { MANUAL_URL } from './AppDialogs.svelte'

  /** Opens a web page in the user's browser (the desktop runtime's way, else the dev page's). */
  function openUrl(url: string) {
    if (hasBackend()) BrowserOpenURL(url)
    else window.open(url, '_blank', 'noopener')
  }

  type Item =
    | { kind: 'action'; label: string; shortcut?: string; disabled?: boolean; run: () => unknown }
    | { kind: 'check'; label: string; shortcut?: string; checked: boolean; toggle: () => void }
    | { kind: 'radio'; label: string; checked: boolean; select: () => void }
    | { kind: 'header'; label: string }
    | { kind: 'sep' }

  const withEngine = (fn: (e: NonNullable<typeof engineRef.current>) => unknown) => () => {
    if (engineRef.current) fn(engineRef.current)
  }

  // The world events' names (game_event), read once there are spawns to sort into them (#143).
  let eventNames = $state<Map<number, string>>(new Map())
  let eventsAsked = false
  $effect(() => {
    if (eventsAsked || !editor.spawns.some((s) => s.events?.length)) return
    eventsAsked = true
    GameEvents()
      .then((list) => (eventNames = new Map((list ?? []).map((e) => [e.id, e.name]))))
      .catch(() => (eventsAsked = false))
  })
  /** The events the open region's spawns belong to, with how many spawns each, by name. */
  const regionEvents = $derived.by(() => {
    const counts = new Map<number, number>()
    for (const s of editor.spawns) for (const e of s.events ?? []) counts.set(Math.abs(e), (counts.get(Math.abs(e)) ?? 0) + 1)
    return [...counts]
      .map(([id, n]) => ({ id, n, name: eventNames.get(id) ?? `Event ${id}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  function toggleEvent(id: number) {
    prefs.shownEvents = prefs.shownEvents.includes(id) ? prefs.shownEvents.filter((e) => e !== id) : [...prefs.shownEvents, id]
  }

  function exit() {
    if (engineRef.current?.anyDirty()) ui.dialog = 'quit'
    else if (hasBackend()) quitNow()
  }

  async function clearThumbs() {
    try {
      await ClearThumbnailCache()
      setStatus('Thumbnail cache cleared. Thumbnails will re-render as you browse (after restart for ones already shown).')
    } catch (e) {
      setStatus(`Could not clear cache: ${e}`)
    }
  }

  /** The sides a region can grow toward, for the File menu. */
  const SIDES: Array<[Side, string]> = [
    ['n', 'north'],
    ['e', 'east'],
    ['s', 'south'],
    ['w', 'west'],
  ]

  /** The climb view's steepest walkable slopes, in degrees: 49 is Noggit Red's default. */
  const CLIMB_ANGLES = [40, 45, 49, 55, 60]
  // The game window sizes Preferences › Game Window offers (gxResolution).
  const GAME_RESOLUTIONS = ['1280x720', '1600x900', '1920x1080', '2560x1440']

  const radios = <T,>(options: Array<[string, T]>, get: () => T, set: (v: T) => void): Item[] =>
    options.map(([label, v]) => ({ kind: 'radio', label, checked: get() === v, select: () => set(v) }))

  // Rebuilt reactively so checkmarks and enabled states stay current. Each menu is kept short enough
  // to fit the screen (#122): the actions on the selected models, the terrain and the world's tables
  // have menus of their own, as do the imports and exports, the view and the game.
  const menus = $derived<Array<{ name: string; items: Item[] }>>([
    {
      name: 'File',
      items: [
        { kind: 'action', label: 'New World…', shortcut: 'Ctrl+N', run: () => { ui.newMapMode = 'new'; ui.showNewDialog = true } },
        { kind: 'action', label: 'Open…', shortcut: 'Ctrl+O', disabled: ui.busy, run: withEngine(openMap) },
        { kind: 'action', label: 'Open Part of Azeroth…', disabled: !hasBackend() || ui.busy, run: () => { ui.newMapMode = 'open'; ui.showNewDialog = true } },
        { kind: 'sep' },
        { kind: 'action', label: 'Save', shortcut: 'Ctrl+S', disabled: ui.busy, run: withEngine((e) => saveOrPublish(e)) },
        { kind: 'action', label: 'Save As…', shortcut: 'Ctrl+Shift+S', disabled: ui.busy, run: withEngine((e) => saveMap(e, true)) },
        { kind: 'action', label: 'Revert to Saved', disabled: !editor.filePath || ui.busy, run: withEngine(requestRevert) },
        { kind: 'action', label: 'Map Properties…', run: () => (ui.dialog = 'mapProps') },
        { kind: 'sep' },
        { kind: 'action', label: 'Export Region to Client…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportRegion(e)) },
        ...(editor.regionBlock
          ? [
              { kind: 'header' as const, label: 'Grow region (save first; the map stays square)' },
              ...SIDES.map(([side, name]) => ({
                kind: 'action' as const,
                label: `Add the tiles to the ${name}`,
                disabled: !hasBackend() || ui.busy || !growableSides(editor.regionBlock!).includes(side),
                run: withEngine((e: Engine) => extendRegion(e, side)),
              })),
              { kind: 'sep' as const },
              { kind: 'action' as const, label: 'Save Spawns to Database…', disabled: !hasBackend() || ui.busy || !ui.spawnChanges, run: () => (ui.dialog = 'saveSpawns') },
              { kind: 'action' as const, label: 'Export Spawn SQL…', disabled: !hasBackend() || ui.busy || !ui.spawnChanges, run: withEngine((e: Engine) => exportSpawnSql(e)) },
            ]
          : []),
        { kind: 'sep' },
        { kind: 'action', label: 'Close Map', shortcut: 'Ctrl+W', run: withEngine((e) => requestClose(e.activeDocumentId())) },
        { kind: 'sep' },
        { kind: 'action', label: 'Exit', run: exit },
      ],
    },
    {
      name: 'Edit',
      items: [
        { kind: 'action', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !ui.canUndo, run: withEngine((e) => e.undo()) },
        { kind: 'action', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !ui.canRedo, run: withEngine((e) => e.redo()) },
        { kind: 'check', label: 'History (go back to any step)', checked: ui.history, toggle: () => (ui.history = !ui.history) },
        { kind: 'sep' },
        { kind: 'action', label: 'Copy', shortcut: 'Ctrl+C', disabled: !editor.selection && !editor.selectedIds.length, run: withEngine((e) => e.copySelection()) },
        { kind: 'action', label: 'Paste', shortcut: 'Ctrl+V', disabled: !ui.hasClip, run: withEngine((e) => e.startPaste()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Select All', shortcut: 'Ctrl+A', run: withEngine((e) => { e.selectAll(); editor.tool = 'select' }) },
        { kind: 'action', label: 'Deselect', shortcut: 'Ctrl+D', disabled: !editor.selection && !editor.selectedIds.length, run: withEngine((e) => e.deselect()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Cut Hole in Selected Area', disabled: !editor.selection, run: withEngine((e) => e.setHoleInSelection(true)) },
        { kind: 'action', label: 'Fill Hole in Selected Area', disabled: !editor.selection, run: withEngine((e) => e.setHoleInSelection(false)) },
      ],
    },
    {
      name: 'Models',
      items: [
        { kind: 'action', label: 'Duplicate Selected Models', shortcut: 'Ctrl+Shift+D', disabled: !editor.selectedIds.length, run: withEngine((e) => e.duplicateSelected()) },
        { kind: 'action', label: 'Reset Rotation', shortcut: 'Ctrl+R', disabled: !editor.selectedIds.length, run: withEngine((e) => e.resetRotation()) },
        { kind: 'action', label: 'Put Selected Models on the Ground', shortcut: 'Ctrl+PgDn', disabled: !editor.selectedIds.length, run: withEngine((e) => e.snapSelectedToGround()) },
        { kind: 'action', label: 'Replace with Copied Model', disabled: !editor.selectedIds.length, run: withEngine((e) => e.replaceSelectedWithCopied()) },
        { kind: 'action', label: 'Group Selected Models', shortcut: 'Ctrl+G', disabled: editor.selectedIds.length < 2, run: withEngine((e) => e.groupSelected()) },
        { kind: 'action', label: 'Ungroup Selected Models', shortcut: 'Ctrl+Shift+G', disabled: !editor.selectedIds.length, run: withEngine((e) => e.ungroupSelected()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Delete Selected Models', shortcut: 'Del', disabled: !editor.selectedIds.length, run: withEngine((e) => e.deleteSelected()) },
        { kind: 'action', label: 'Remove Duplicate Models', run: withEngine((e) => e.removeDuplicateModels()) },
        { kind: 'sep' },
        { kind: 'action', label: 'Hide Selected Models', shortcut: 'H', disabled: !editor.selectedIds.length, run: withEngine((e) => e.toggleHideSelected()) },
        { kind: 'check', label: 'Show Hidden Models', checked: ui.showHiddenModels, toggle: () => (ui.showHiddenModels = !ui.showHiddenModels) },
        { kind: 'action', label: 'Unhide All Models', shortcut: 'Shift+H', disabled: !ui.hiddenModels, run: withEngine((e) => e.unhideAll()) },
        { kind: 'sep' },
        { kind: 'check', label: 'Inspector (placement numbers)', shortcut: 'I', checked: ui.inspector, toggle: () => (ui.inspector = !ui.inspector) },
        { kind: 'check', label: 'Gizmo Arrows in Local Space', checked: editor.gizmoLocal, toggle: () => (editor.gizmoLocal = !editor.gizmoLocal) },
      ],
    },
    {
      name: 'Terrain',
      items: [
        { kind: 'header', label: 'Clean up the tile under the camera' },
        { kind: 'action', label: 'Clear Height', run: withEngine((e) => e.cleanUpTile('height')) },
        { kind: 'action', label: 'Clear Textures', run: withEngine((e) => e.cleanUpTile('textures')) },
        { kind: 'action', label: 'Clear Textures and Set Base (paint texture)', run: withEngine((e) => e.cleanUpTile('setBase')) },
        { kind: 'action', label: 'Remove Texture Duplicates', run: withEngine((e) => e.cleanUpTile('textureDuplicates')) },
        { kind: 'action', label: 'Clear Models', run: withEngine((e) => e.cleanUpTile('models')) },
        { kind: 'action', label: 'Remove Duplicate Models on the Tile', run: withEngine((e) => e.cleanUpTile('duplicateModels')) },
        { kind: 'sep' },
        { kind: 'action', label: editor.selection ? 'Remove Empty Texture Layers in Selection' : 'Remove Empty Texture Layers', run: withEngine((e) => e.removeEmptyLayers()) },
        { kind: 'action', label: 'Auto-paint Textures by Height and Slope', run: withEngine((e) => e.regenerateAutoPaint()) },
        { kind: 'action', label: 'Fill Mask with Paint Texture', disabled: !ui.maskActive, run: withEngine((e) => e.fillMask(editor.paintLayer)) },
        { kind: 'action', label: 'Replace Texture Everywhere…', run: () => (ui.dialog = 'textures') },
        { kind: 'sep' },
        { kind: 'check', label: 'Climb (ground too steep to walk up)', shortcut: 'Shift+F2', checked: prefs.climbView, toggle: () => (prefs.climbView = !prefs.climbView) },
        ...radios(
          CLIMB_ANGLES.map((a): [string, number] => [`Steepest walkable slope ${a}°`, a]),
          () => prefs.climbAngle,
          (v) => {
            prefs.climbAngle = v
            prefs.climbView = true
          },
        ),
        { kind: 'sep' },
        { kind: 'check', label: 'Map Textures (quick palette)', checked: ui.texturePalette, toggle: () => (ui.texturePalette = !ui.texturePalette) },
      ],
    },
    {
      name: 'World',
      items: [
        { kind: 'action', label: 'Doodad Brushes…', run: () => (ui.brushEditor = true) },
        { kind: 'action', label: 'Ground Effects (Grass Tufts)…', run: () => (ui.dialog = 'effects') },
        { kind: 'action', label: 'Texture Looks (Scrolling, Overbright)…', run: () => (ui.dialog = 'looks') },
        { kind: 'action', label: 'Zones…', disabled: !hasBackend(), run: () => (ui.dialog = 'zones') },
        { kind: 'action', label: 'Lights…', disabled: !hasBackend(), run: () => (ui.dialog = 'lights') },
      ],
    },
    {
      name: 'Import/Export',
      items: [
        { kind: 'action', label: 'Import Heightmap…', disabled: !hasBackend() || ui.busy, run: () => (ui.dialog = 'heightmap') },
        { kind: 'action', label: 'Import Watermap…', disabled: !hasBackend() || ui.busy, run: () => (ui.dialog = 'watermap') },
        { kind: 'action', label: 'Export Heightmap…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportHeightmap(e)) },
        { kind: 'action', label: 'Export Normal Map…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportNormalMap(e)) },
        { kind: 'action', label: 'Export Alphamap of the Paint Texture…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportAlphamap(e)) },
        { kind: 'action', label: 'Import Alphamap into the Paint Texture…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => importAlphamap(e)) },
        { kind: 'sep' },
        { kind: 'action', label: 'Import Object List…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => importObjectList(e)) },
        { kind: 'action', label: 'Export Object List…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportObjectList(e)) },
        { kind: 'action', label: 'Export Port Coordinates…', disabled: !hasBackend() || ui.busy, run: withEngine((e) => exportPortCoords(e)) },
        { kind: 'action', label: 'Copy Position as Teleport Command', shortcut: 'F9', run: withEngine((e) => copyTeleport(e)) },
        { kind: 'action', label: 'Save Minimap Image…', shortcut: 'Ctrl+Shift+P', disabled: !hasBackend() || ui.busy, run: withEngine((e) => saveMinimapImage(e)) },
        { kind: 'sep' },
        { kind: 'action', label: 'Import Doodad Brushes…', disabled: !hasBackend() || ui.busy, run: () => importDoodadBrushes() },
        { kind: 'action', label: 'Export Doodad Brush…', disabled: !hasBackend() || ui.busy || !activeDoodadBrush(), run: () => { const b = activeDoodadBrush(); if (b) exportDoodadBrush(b) } },
      ],
    },
    {
      name: 'View',
      items: [
        { kind: 'check', label: 'Show grid', shortcut: 'G', checked: editor.grid, toggle: () => (editor.grid = !editor.grid) },
        { kind: 'check', label: 'Show chunk lines', checked: editor.chunkLines, toggle: () => (editor.chunkLines = !editor.chunkLines) },
        { kind: 'check', label: 'Far Horizon (the map around a region)', checked: prefs.showHorizon, toggle: () => (prefs.showHorizon = !prefs.showHorizon) },
        { kind: 'check', label: 'Bounding boxes (one per model)', checked: prefs.showBoxes, toggle: () => (prefs.showBoxes = !prefs.showBoxes) },
        { kind: 'check', label: 'Detail info (the ground under the cursor)', checked: prefs.detailInfo, toggle: () => (prefs.detailInfo = !prefs.detailInfo) },
        { kind: 'check', label: 'Wireframe', checked: prefs.wireframe, toggle: () => (prefs.wireframe = !prefs.wireframe) },
        { kind: 'check', label: 'Hide panels', shortcut: 'Tab', checked: ui.hidePanels, toggle: () => (ui.hidePanels = !ui.hidePanels) },
        { kind: 'header', label: 'Layers' },
        { kind: 'check', label: 'Terrain', checked: prefs.showTerrain, toggle: () => (prefs.showTerrain = !prefs.showTerrain) },
        { kind: 'check', label: 'Water', checked: prefs.showWater, toggle: () => (prefs.showWater = !prefs.showWater) },
        { kind: 'check', label: 'Objects (doodads and buildings)', checked: prefs.showObjects, toggle: () => (prefs.showObjects = !prefs.showObjects) },
        { kind: 'check', label: 'Ground effects (grass tufts)', checked: prefs.showGroundEffects, toggle: () => (prefs.showGroundEffects = !prefs.showGroundEffects) },
        ...radios<typeof prefs.groundEffectDensity>(
          [
            ['Sparse tufts (the game\'s Low)', 'sparse'],
            ['Normal tufts (Medium)', 'normal'],
            ['Full tufts (High)', 'full'],
          ],
          () => prefs.groundEffectDensity,
          (v) => (prefs.groundEffectDensity = v),
        ),
        { kind: 'check', label: 'Monsters', checked: prefs.showMonsters, toggle: () => (prefs.showMonsters = !prefs.showMonsters) },
        { kind: 'check', label: 'NPCs', checked: prefs.showNpcs, toggle: () => (prefs.showNpcs = !prefs.showNpcs) },
        { kind: 'check', label: 'Game objects', checked: prefs.showGameObjects, toggle: () => (prefs.showGameObjects = !prefs.showGameObjects) },
        { kind: 'check', label: 'All creature paths', checked: prefs.showAllPaths, toggle: () => (prefs.showAllPaths = !prefs.showAllPaths) },
        { kind: 'check', label: 'Names over creatures and objects', checked: prefs.spawnNames, toggle: () => (prefs.spawnNames = !prefs.spawnNames) },
        ...(regionEvents.length
          ? ([
              { kind: 'header', label: 'World events (their spawns)' },
              ...regionEvents.map((ev): Item => ({ kind: 'check', label: `${ev.name} (${ev.n})`, checked: prefs.shownEvents.includes(ev.id), toggle: () => toggleEvent(ev.id) })),
              { kind: 'action', label: 'Hide every event', disabled: !prefs.shownEvents.length, run: () => (prefs.shownEvents = []) },
            ] as Item[])
          : []),
      ],
    },
    {
      name: 'Graphics',
      items: [
        { kind: 'header', label: 'Render scale' },
        ...radios(
          [
            ['50% (fastest)', 0.5],
            ['75%', 0.75],
            ['100%', 1],
            ['150% (sharper)', 1.5],
          ],
          () => prefs.renderScale,
          (v) => (prefs.renderScale = v),
        ),
        { kind: 'header', label: 'View distance' },
        ...radios(
          [
            ['Near', 0.6],
            ['Normal', 1],
            ['Far', 1.8],
          ],
          () => prefs.viewDistance,
          (v) => (prefs.viewDistance = v),
        ),
        { kind: 'sep' },
        { kind: 'check', label: 'Particles', checked: prefs.particles, toggle: () => (prefs.particles = !prefs.particles) },
        { kind: 'check', label: 'Prop animations', checked: prefs.animations, toggle: () => (prefs.animations = !prefs.animations) },
        { kind: 'check', label: 'Skip models too small to see', checked: prefs.cullSmallModels, toggle: () => (prefs.cullSmallModels = !prefs.cullSmallModels) },
      ],
    },
    {
      name: 'Lighting',
      items: [
        { kind: 'header', label: 'Time of day' },
        ...radios(
          [
            ['Dawn', 6.3],
            ['Day', 13],
            ['Dusk', 17.7],
            ['Night', 23.5],
          ],
          () => prefs.timeOfDay,
          (v) => {
            prefs.timeOfDay = v
            prefs.dayCycle = false
          },
        ),
        { kind: 'check', label: 'Animate day/night cycle', checked: prefs.dayCycle, toggle: () => (prefs.dayCycle = !prefs.dayCycle) },
        { kind: 'header', label: 'Shadows' },
        ...radios(
          [
            ['Off', 'off'],
            ['Medium', 'medium'],
            ['High', 'high'],
          ],
          () => prefs.shadows,
          (v) => (prefs.shadows = v as typeof prefs.shadows),
        ),
        { kind: 'sep' },
        { kind: 'check', label: "Client Lighting (the zone's light, fog and water colours)", checked: prefs.clientLighting, toggle: () => (prefs.clientLighting = !prefs.clientLighting) },
        { kind: 'check', label: "Baked Shadows (the client's, on a region)", checked: prefs.bakedShadows, toggle: () => (prefs.bakedShadows = !prefs.bakedShadows) },
        { kind: 'check', label: 'Prop lights & flames', checked: prefs.propEffects, toggle: () => (prefs.propEffects = !prefs.propEffects) },
        { kind: 'check', label: 'Clouds', checked: prefs.clouds, toggle: () => (prefs.clouds = !prefs.clouds) },
        { kind: 'check', label: 'Fog', checked: prefs.fog, toggle: () => (prefs.fog = !prefs.fog) },
      ],
    },
    {
      name: 'Camera',
      items: [
        { kind: 'action', label: 'Turn Around (180°)', run: withEngine((e) => e.turnCameraAround()) },
        { kind: 'check', label: 'Follow the Ground', shortcut: 'T', checked: prefs.cameraFollowGround, toggle: () => (prefs.cameraFollowGround = !prefs.cameraFollowGround) },
        { kind: 'check', label: 'Camera Collision (stay 3 yards above the ground)', checked: prefs.cameraCollision, toggle: () => (prefs.cameraCollision = !prefs.cameraCollision) },
        { kind: 'check', label: 'Top-down View (2D)', shortcut: 'U', checked: ui.topDown, toggle: () => (ui.topDown = !ui.topDown) },
        { kind: 'check', label: 'Minimap Window', shortcut: 'M', checked: ui.minimap, toggle: () => (ui.minimap = !ui.minimap) },
        { kind: 'sep' },
        { kind: 'action', label: 'Faster', shortcut: 'P', run: () => stepCameraSpeed(true) },
        { kind: 'action', label: 'Slower', shortcut: 'O', run: () => stepCameraSpeed(false) },
      ],
    },
    {
      name: 'Bookmarks',
      items: [
        { kind: 'action', label: 'Add Bookmark', shortcut: 'Ctrl+B', run: withEngine((e) => e.addBookmark()) },
        ...(editor.bookmarks.length ? [{ kind: 'sep' as const }] : []),
        ...editor.bookmarks.map((b, i) => ({ kind: 'action' as const, label: b.name, run: withEngine((e: Engine) => e.gotoBookmark(i)) })),
        ...(editor.bookmarks.length ? [{ kind: 'sep' as const }, { kind: 'action' as const, label: 'Clear Bookmarks', run: withEngine((e: Engine) => e.clearBookmarks()) }] : []),
      ],
    },
    {
      name: 'Game',
      items: [
        { kind: 'action', label: ui.gameClient === 'benilla' ? 'Launch Benilla' : 'Launch World of Warcraft', disabled: !hasBackend() || !wow.loaded, run: () => launchGame(engineRef.current) },
        { kind: 'action', label: 'Game Login…', disabled: !hasBackend(), run: () => (ui.dialog = 'gameLogin') },
        { kind: 'header', label: 'Game client' },
        ...radios<'wow' | 'benilla'>(
          [
            ['World of Warcraft (Wow.exe)', 'wow'],
            ['Benilla', 'benilla'],
          ],
          () => ui.gameClient,
          (v) => void setGameClient(v),
        ),
        { kind: 'action', label: 'Benilla Folder…', disabled: !hasBackend(), run: chooseBenillaFolder },
        { kind: 'header', label: 'Game window (when Meld starts it)' },
        ...radios<'' | 'windowed' | 'fullscreen'>(
          [
            ["The Game's Own Setting", ''],
            ['Windowed', 'windowed'],
            ['Fullscreen', 'fullscreen'],
          ],
          () => ui.gameWindow,
          (v) => void setGameWindow(v),
        ),
        ...(ui.gameWindow === ''
          ? []
          : radios<string>(
              GAME_RESOLUTIONS.map((r) => [r.replace('x', ' × '), r]),
              () => ui.gameResolution,
              (v) => void setGameWindow(ui.gameWindow, v),
            )),
      ],
    },
    {
      name: 'Preferences',
      items: [
        { kind: 'action', label: wow.loaded ? 'Change WoW Client Folder…' : 'Select WoW Client Folder…', disabled: !hasBackend(), run: chooseWowFolder },
        { kind: 'action', label: 'VMaNGOS Server Folder…', disabled: !hasBackend(), run: chooseVmangosFolder },
        { kind: 'action', label: 'Clear Thumbnail Cache', disabled: !wow.loaded, run: clearThumbs },
        { kind: 'header', label: 'Camera speed' },
        ...radios(
          [
            ['Slow', 0.5],
            ['Normal', 1],
            ['Fast', 2],
          ],
          () => prefs.cameraSpeed,
          (v) => (prefs.cameraSpeed = v),
        ),
        { kind: 'header', label: 'Mouse sensitivity' },
        ...radios(
          [
            ['Low', 0.6],
            ['Normal', 1],
            ['High', 1.6],
          ],
          () => prefs.mouseSensitivity,
          (v) => (prefs.mouseSensitivity = v),
        ),
        { kind: 'sep' },
        { kind: 'check', label: 'Invert camera Y', checked: prefs.invertY, toggle: () => (prefs.invertY = !prefs.invertY) },
        { kind: 'check', label: 'Tablet support (pen pressure)', checked: prefs.tabletSupport, toggle: () => (prefs.tabletSupport = !prefs.tabletSupport) },
        { kind: 'check', label: 'Pen pressure sizes the brush (with Tablet support)', checked: prefs.tabletRadius, toggle: () => (prefs.tabletRadius = !prefs.tabletRadius) },
        { kind: 'check', label: 'Log file loading (every client file read, in Help › Log)', checked: prefs.logFileLoading, toggle: () => (prefs.logFileLoading = !prefs.logFileLoading) },
      ],
    },
    {
      name: 'Help',
      items: [
        { kind: 'action', label: 'Help…', shortcut: 'F1', run: () => (ui.dialog = 'help') },
        { kind: 'action', label: 'Log…', run: () => (ui.dialog = 'log') },
        { kind: 'action', label: 'Keyboard Shortcuts…', run: () => (ui.dialog = 'shortcuts') },
        { kind: 'action', label: 'Manual (README on GitHub)', run: () => openUrl(MANUAL_URL) },
        { kind: 'sep' },
        { kind: 'action', label: 'Copy Scene', disabled: !hasBackend() || ui.busy, run: withEngine(copyScene) },
        { kind: 'action', label: 'Load Scene from Clipboard', disabled: !hasBackend() || ui.busy, run: withEngine(pasteScene) },
        { kind: 'sep' },
        { kind: 'action', label: 'About Meld…', run: () => (ui.dialog = 'about') },
      ],
    },
  ])

  // Classic menubar behaviour: click opens, hovering another title while
  // open switches menus, click outside / Esc closes.
  let open = $state<string | null>(null)
  let bar: HTMLElement

  function activate(item: Item) {
    if (item.kind === 'action') {
      if (item.disabled) return
      open = null
      item.run()
    } else if (item.kind === 'check') {
      item.toggle()
    } else if (item.kind === 'radio') {
      item.select()
    }
  }

  function onWindowPointer(e: PointerEvent) {
    if (open && !bar.contains(e.target as Node)) open = null
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(e) => open && e.key === 'Escape' && (open = null)} onblur={() => (open = null)} />

<header class="menubar" bind:this={bar}>
  <span class="brand">⛰ Meld</span>
  <nav class="menus">
    {#each menus as m (m.name)}
      <div class="menu">
        <button
          class="title"
          class:open={open === m.name}
          onclick={() => (open = open === m.name ? null : m.name)}
          onpointerenter={() => open && (open = m.name)}
        >
          {m.name}
        </button>
        {#if open === m.name}
          <div class="dropdown" role="menu">
            {#each m.items as item, i (i)}
              {#if item.kind === 'sep'}
                <div class="sep"></div>
              {:else if item.kind === 'header'}
                <div class="header">{item.label}</div>
              {:else}
                <button
                  class="item"
                  role={item.kind === 'action' ? 'menuitem' : item.kind === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={item.kind === 'action' ? undefined : item.checked}
                  disabled={item.kind === 'action' && item.disabled}
                  onclick={() => activate(item)}
                >
                  <span class="mark">
                    {#if item.kind === 'check' && item.checked}✓{:else if item.kind === 'radio' && item.checked}●{/if}
                  </span>
                  <span class="label">{item.label}</span>
                  {#if 'shortcut' in item && item.shortcut}<span class="sc">{item.shortcut}</span>{/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>
  <div class="quick">
    <button
      class="daynight"
      title={prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? 'Switch to night' : 'Switch to day'}
      aria-label="Toggle day and night"
      onclick={() => {
        prefs.dayCycle = false
        prefs.timeOfDay = prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? 23.5 : 13
      }}>{prefs.timeOfDay >= 6 && prefs.timeOfDay < 19 ? '☀' : '☾'}</button
    >
    <button onclick={withEngine((e) => e.undo())} disabled={!ui.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
    <button onclick={withEngine((e) => e.redo())} disabled={!ui.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
  </div>
  <div class="spacer"></div>

</header>

<style>
  .menubar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 50;
  }
  .brand {
    font-weight: 700;
    color: var(--accent-2);
    letter-spacing: 0.02em;
    margin-right: 6px;
  }
  .menus {
    display: flex;
  }
  .menu {
    position: relative;
  }
  .title {
    border: none;
    background: transparent;
    padding: 4px 10px;
    border-radius: 4px;
  }
  .title:hover,
  .title.open {
    background: var(--panel-3);
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    padding: 4px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    /* A menu that still outgrows a small window scrolls rather than running off it. */
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 6px;
    border: none;
    background: transparent;
    padding: 5px 8px;
    border-radius: 4px;
    text-align: left;
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .item:hover:not(:disabled) .sc {
    color: var(--accent-ink);
  }
  .mark {
    width: 14px;
    flex: none;
    text-align: center;
    font-size: 11px;
  }
  .label {
    flex: 1;
  }
  .sc {
    font: 11px var(--mono);
    color: var(--text-dim);
    margin-left: 16px;
  }
  .header {
    padding: 6px 8px 2px 28px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
  .quick {
    display: flex;
    gap: 2px;
    margin-left: 4px;
  }
  .quick button {
    border: none;
    background: transparent;
    padding: 2px 8px;
    font-size: 15px;
  }
  .quick button:hover:not(:disabled) {
    background: var(--panel-3);
  }
  .spacer {
    flex: 1;
  }

</style>
