// The user's preferences (#459: split out of editor.svelte.ts, which re-exports them). They are
// persisted in the app config through lib/state/prefs.ts.
import type { SessionTab } from '../io/session'
import type { DoodadBrush } from '../tools/doodadBrush'
import type { FitMode } from '../terrain/fitGround'
import type { BrushStack } from '../tools/brushStack'
import { newSpawnBrush, type SpawnBrush } from '../tools/spawnBrush'
import type { BrowserView } from '../wow/browserViews'
import type { ModelSet } from '../wow/modelSets'

/** Camera speed steps: the preference is kept between a quarter and four times its normal speed. */
export function stepCameraSpeed(faster: boolean) {
	const next = prefs.cameraSpeed * (faster ? 1.25 : 0.8)
	prefs.cameraSpeed = Math.min(4, Math.max(0.25, next))
}

/** User preferences' defaults: a fresh object each call, for the reactive `prefs` and the engine's copy before the first applyPrefs. */
export function defaultPrefs() {
	return {
		/** Draw the terrain as a wireframe (for checking its triangles). */
		wireframe: false,
		/** Paint's "Show unpaintable chunks": tint the chunks full with four other textures, which refuse the paint texture. */
		showUnpaintable: false,
		/** Lighting › Client Lighting: the sun, sky light, fog and water colours follow the client's lights where the camera is. */
		clientLighting: false,
		/** Lighting › Baked Shadows: a region's ground darkened where the client's tiles bake shadow (MCSH), as the game draws it. */
		bakedShadows: true,
		/** Preferences › Compile and export › Minimap tiles with all models: the trees too, not only the buildings the client's own tiles show. */
		minimapAllModels: false,
		/** View › Far Horizon: past an open region, the map's coarse WDL ground in the fog colour, as the client draws it. */
		showHorizon: true,
		/** View › Bounding boxes: draw a box around every model (Noggit Red's model boxes). */
		showBoxes: false,
		/** View › Hover outline (#641): a faint stroke round the model or spawn a Select click would pick. */
		hoverOutline: true,
		/** Show › Area triggers: draw the map's AreaTrigger.dbc volumes (dungeon portals and the like, #141). */
		showAreaTriggers: false,
		/** Show › Flight paths: draw the map's flight stops and the routes from them (TaxiNodes.dbc and TaxiPath.dbc, #180). */
		showFlightPaths: false,
		/** The climb view: tint the ground too steep for a character to walk up (Noggit Red's View › Climb; Meld's View › Climb). */
		climbView: false,
		/**
		 * Show › Walkable ground (#175): the navmesh the server's MoveMapGenerator would build, drawn over
		 * the ground around the camera (world/nav/NavPreview.ts).
		 */
		navView: false,
		/**
		 * Show › Server's mmaps (#240): the walkable-ground view shows the navmesh the world server loaded,
		 * read from its movement maps (data/mmaps), instead of building one in the browser.
		 */
		navServer: false,
		/** View › Height contours (#22, Noggit Red's): dark lines along the ground every contourStep yards of height. */
		showContours: false,
		/** The minimap window's Light zones (#26): the map's Light.dbc spheres, the radius each is full at and fades out by. */
		minimapLights: false,
		/** The minimap attached to the dock above Layers (#749), the default; off, it is a floating window. `ui.minimap` (M) shows it in either place. */
		minimapDocked: true,
		contourStep: 4,
		/** The climb view's steepest walkable slope, in degrees (Noggit Red's default is 49). */
		climbAngle: 49,
		/** Show each kind of layer; hiding one doesn't change the map. */
		showTerrain: true,
		showWater: true,
		showObjects: true,
		/** Camera › Locked cursor (#19, Noggit Red's): a brush stays on its ground point while the camera moves; only the mouse moves it. */
		lockedCursor: false,
		/** Preferences › Graphics › FPS limit (#24): frames a second at most, 0 for the screen's rate. */
		fpsLimit: 0,
		/** Help › Benchmark maps' size (#322): how many times its default count a benchmark map places (BENCH_SCALES). */
		benchScale: 1,
		/** The client maps pinned to the top of the Start dialog's map list (#47), by Map.dbc ID. */
		pinnedMaps: [] as number[],
		/** Models › Fit Ground to Selection (#168): yards under the floor, the blend ring's width, which way the ground may move, cutting holes, and how far from the ground a floor counts. */
		fitGround: { margin: 0.2, falloff: 6, mode: 'both' as FitMode, holes: false, reach: 4 },
		/** The Place tool's Fit ground (#207): a model placed on open ground has the ground fitted under it with `fitGround`'s settings. */
		placeFitGround: false,
		/** Preferences › General › Autosave (#177): minutes between recovery copies of the maps with unsaved changes, 0 for none. */
		autosaveMinutes: 3,
		/** Preferences › General › Theme (#49): the editor's colours, or the desktop's light or dark setting. */
		theme: 'dark' as 'dark' | 'light' | 'system',
		/** Preferences › Graphics › Anti-aliasing (#24), mirrored to localStorage by display.ts and applied at the next start. */
		antialias: true,
		/** Show › Doodads (m2 models) and Buildings (wmo), each on its own under Objects (#43). */
		showDoodads: true,
		showBuildings: true,
		/** The creatures and game objects the world database places in a region, by kind. */
		showMonsters: true,
		showNpcs: true,
		showGameObjects: true,
		/**
		 * The world events (game_event IDs) whose spawns are shown (#143): a spawn of an event appears only
		 * while its event is shown, and one an event takes away leaves while it is. None by default, so a
		 * town shows its everyday spawns.
		 */
		shownEvents: [] as number[],
		/** Draw every creature's waypoint path, not only the selected one's. */
		showAllPaths: false,
		/** Show › Spawn pools (#172): a ring in its pool's colour round every pooled spawn, and the region's pools drawn in the viewport legend. */
		showPools: false,
		/** Names over the creatures and game objects, with a creature's level and rank (#125). */
		spawnNames: true,
		/** Show › Names seen as Alliance or Horde (#134): a creature's name is red, yellow or green by how its faction treats that side. */
		namesSide: 'alliance' as 'alliance' | 'horde',
		/**
		 * Creatures and game objects stay drawn with the camera in a building, where the rest of the world
		 * shows only through its doorways (#150).
		 */
		spawnsThroughWalls: true,
		renderScale: 1,
		viewDistance: 1,
		fog: true,
		cameraSpeed: 1,
		mouseSensitivity: 1,
		invertY: false,
		/**
		 * Orbit View (true, the default, #750): the camera's target rides the ground and the camera stays above
		 * it; false is Flying View, where the camera flies anywhere (caves included). `lib/ui/cameraView.ts`.
		 */
		cameraFollowGround: true,
		/** The flying camera stays at least 3 yards above the ground (camera collision); off, it enters caves. */
		cameraCollision: false,
		/** A pen's pressure scales sculpt speed and paint strength (a mouse is unchanged). */
		tabletSupport: false,
		/** With Tablet support, a pen's pressure also sizes the brush tools' radius (Noggit Red's Use Tablet on the radius slider). */
		tabletRadius: false,
		/** Hour of day 0-24 (sun/moon position, lighting, sky). */
		timeOfDay: 13,
		/** Animate a full day/night cycle (one day ≈ cycleMinutes). */
		dayCycle: false,
		cycleMinutes: 10,
		clouds: true,
		shadows: 'medium' as 'off' | 'medium' | 'high',
		/** Flames + dynamic lights on torches, braziers, lamps… */
		propEffects: true,
		/** The models' particles (flames, smoke, sparks, spray) as the client emits them; off, a torch shows a drawn flame instead. */
		particles: true,
		/** Play props' idle animations (windmills, flags, flames…). */
		animations: true,
		/** Leave out models too small on screen to see (a pixel or two), which dense zones have thousands of. */
		cullSmallModels: true,
		/** Draw the ground effects: the grass tufts, flowers and pebbles the game grows on each texture. */
		showGroundEffects: true,
		/** The Detail info readout in the viewport's corner: tile, chunk, cell, height, layers and liquids under the cursor. */
		detailInfo: false,
		/** Run File › Check Map when Compile to Client or Compile All starts, and stop it on an error finding (#195). */
		checkBeforeCompile: false,
		/** Compile to Server rebuilds the server's movement maps (mmaps) of the tiles it rebuilt (#173); read by Go from the saved prefs. */
		buildMoveMaps: true,
		/** View › Performance Overlay (#179): where the frame's time goes, by subsystem and GPU pass, in the viewport's corner. */
		perfOverlay: false,
		/** Every file read from the client (models, textures, lists) goes into the Log window too, with its time (noggit's "additional file loading log"). */
		logFileLoading: false,
		/** How many cells of a chunk grow tufts: the client's Ground Clutter stops Low, Medium and High, 16, 32 and 48 (`frillDensity` in world/groundEffects.ts). */
		groundEffectDensity: 'normal' as 'sparse' | 'normal' | 'full',
		/** Right dock width in px and collapsed panel ids (Photoshop-style dock). */
		dockWidth: 320,
		collapsedPanels: ['properties'] as string[],
		/** The right dock hidden on its own (View › Layers panel, the dock's ✕; #653). Tab's hide-panels works on top of it. */
		dockHidden: false,
		/** The asset browser along the bottom: its height in px, whether it is folded away, and its tile size. */
		browserHeight: 300,
		browserCollapsed: false,
		browserTile: 112,
		/** The names under the asset browser's tiles and in its preview (#655); off, the tiles are only pictures. */
		browserNames: true,
		/** The toolbar's icon size in px (Preferences › General › Toolbar icons), from TOOLBAR_ICON_MIN to TOOLBAR_ICON_MAX (#128). */
		toolbarIcon: 22,
		/** Preferences › Toolbar on the left or the right of the window (#654). */
		toolbarSide: 'left' as 'left' | 'right',
		/** Preferences › General › Interface size (#372): the whole UI scaled by this factor (CSS zoom, lib/ui/uiScale.ts), 1 to 2. */
		uiScale: 1,
		/** The start dialog that offers the client and server folders (#689): "Don't ask again" stops it. */
		skipFolderSetup: false,
		/** The asset browser's tab (a catalog kind, 'all' or a spawn kind) and where each tab was (wow/browserViews.ts). */
		browserKind: 'm2',
		browserViews: {} as Record<string, BrowserView>,
		/** Recently picked assets (catalog keys), newest first. */
		recentAssets: [] as string[],
		/** The favourite assets (catalog keys), starred with a right-click in the asset browser, shown first there. */
		favoriteAssets: [] as string[],
		/** Preferences › Camera and input › Hotkey Manager (#396): the shortcut rows the user rebound, row id → its keys (lib/ui/commands.ts `Keymap`). Only changed rows; replace it, never edit it in place. */
		keymap: {} as Record<string, string[]>,
		/** The other clients Tools › Import from Another Client… imports models and textures from (#858, wow/otherClient.svelte.ts), a name and a folder each. Replace it, never edit it in place. */
		otherClients: [] as Array<{ name: string; path: string }>,
		/** The author's model sets (wow/modelSets.ts), shown in the asset browser's Sets tab, and the name of the one shown. */
		modelSets: [] as ModelSet[],
		modelSet: '',
		/** The doodad brushes (tools/doodadBrush.ts) and the name of the one the Doodad brush tool paints with. */
		doodadBrushes: [] as DoodadBrush[],
		/** The Doodad tool's spawn brush (Creatures mode, #171): its creature templates with weights and its settings. */
		spawnBrush: newSpawnBrush() as SpawnBrush,
		/** The Stamp tool's brush stacks (tools/brushStack.ts) and the name of the one it applies. */
		brushStacks: [] as BrushStack[],
		brushStack: '',
		doodadBrush: '',
		/**
		 * The Script Brush tool (#29): the scripts folder's file it loads, and its brushes' setting (tag) values,
		 * by `file/brush` and then the tag's label. Replace an inner record, never edit it in place.
		 */
		scriptBrush: '',
		scriptBrushTags: {} as Record<string, Record<string, number | string | boolean>>,
		/** Whether a script's write_file, append_file and image:save may write outside the scripts folder (#761). */
		scriptWriteAnyFile: false,
		/** The folder of the user's own greyscale images that shape the image brushes (editor.brushImage). */
		brushImageDir: '',
		/** The folder the author's prefabs are kept in (#170), listed by the asset browser's Prefabs tab. */
		prefabDir: '',
		/** How a placed prefab varies (#170): `on`, each root turned up to `turn` degrees, scaled by up to `scale`, dropped with the chance `drop`. */
		prefabVary: { on: false, turn: 15, scale: 0.1, drop: 0 },
		/** The Item Editor's search order (#677): a key of `vmangos.itemSorts` (name, entry, quality, itemLevel, requiredLevel), and whether it runs high to low. */
		itemSort: 'name',
		itemSortDesc: false,
		/** The tabs open at the last close, reopened at the next start (io/session.ts). */
		session: { tabs: [] as SessionTab[], active: 0 },
	}
}

/** User preferences, persisted in the app config (see lib/state/prefs.ts). */
export const prefs = $state(defaultPrefs())
export type Prefs = ReturnType<typeof defaultPrefs>
