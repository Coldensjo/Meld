# Lighting, sky and shadows

Shaders, the sky and time of day, the shadow cascades and the client's lighting.

- **Shaders** are custom `ShaderMaterial`s (terrain, water, sky). They include three's fog,
  tonemapping and colorspace chunks. Prop lighting (Hemisphere + Directional, intensities ×π) is
  tuned to match the terrain shader's uniforms. Change both together.

- `lib/engine/Environment.ts` owns the sky dome, hemisphere light and the single
  shadow-casting key `DirectionalLight` (sun by day, moon by night).
  - The sky dome is three's Preetham `Sky` shader, patched with our ACES tone mapping, stars,
    Milky Way and moon.
  - `update(hour)` computes the sun/moon directions and all lighting colours (`state`).
  - A map with no sky (#339, `Engine.noSky`: a client dungeon or raid in Map.dbc with no WDL far
    terrain around the open region, such as Uldaman) hides the dome and the clouds and shows `EARTH`,
    the floor plane's dark earth with the sea off, as the background (and the editor's fog colour) at
    every pitch and hour. Its halls lie below the floor plane, so a camera there saw the dome's white
    horizon band. A dungeon with land around it (Zul'Farrak, the Deadmines) keeps its sky.
- `Engine.updateEnvironment` pushes `state` into the terrain and water uniforms, fog and
  background every frame. Change lighting there, not in individual shaders.
- **Shadow cascades** (`engine/shadowCascades.ts`): the key light's shadow has two maps. The
  near one is the key light's own (sharp, fitted around the ground point the camera looks at);
  the far one belongs to `Environment.far`, a black `DirectionalLight` that lights nothing and
  only carries the coarse map for the distance. `cascadeShadow(light)` in GLSL reads the near map
  where it reaches and blends into the far one at its edge. The terrain shader calls it as
  `keyShadow()`, and `patchCascadeShadows` makes every Lambert prop material do the same through
  `onBeforeCompile`. The key light must stay directional light 0.
- `Engine.fitShadows` fits both cascades each frame (`Environment.fitCascade` snaps each to its
  texels and sets its depth range and biases in world units from the texel size), from how far ahead
  the camera meets the ground (300 yards when it doesn't): in a world view the streamed tiles
  (`marchGround` over `WorldStream.heightAt`), not the hidden stand-in terrain (#741). Both maps are
  kept between frames (`autoUpdate` off); `Engine.markShadows`, just before the render, redraws the
  far one when its fit, the scene (objects, heights, holes, spawns, a model texture bound:
  `shadowSceneChanged`) or a preference changed, and the near one on those and when the camera moved
  (culling, LODs and the room gate follow it). A still view redraws neither (#326). Something new
  that casts must bump one of those keys or its shadow goes stale; the `shadow-redraw` probe checks
  the edits. Both cascade frustums feed instance culling, so what is off screen still casts.
- **Moving casters** (#346, `engine/posedShadows.ts`): a batch whose shadow changes from frame to
  frame is a mover: a skinned one, or one with a material whose shadow moves (`markShadowMoving`, set
  in `wowMaterial`: a moving texture on a cut-out, or an animated colour that can fade out). Movers
  are on `POSED_LAYER` as well as the default layer (`cullForShadows`), and the near pass notes the
  ones in its box (`shadowReach.castsNear`, `materialsNear`). When the only change in the near map is
  a pose or such a material (`Engine.animateModels` sets `nearPosed`; `markShadows` hands it to
  `PosedShadows.poses`), the map isn't redrawn in full: the first such frame draws it with the still
  casters only (`setNearStill`: the movers keep out but are noted) and copies its depth aside
  (`copyTextureToTexture`, a depth blit); every one after copies it back. Each then draws the movers
  on top with three's own shadow pass, through a camera that sees only `POSED_LAYER`, with
  `renderer.clear` skipped, and with the light's matrices as they were for the still pass (the key
  light's position follows the live sun, but the map and its lookup must agree). A full redraw (the
  key light's `needsUpdate`) drops the copy. A material whose shadow moves must be marked before a
  batch is made with it, or the batch is drawn as still and its shadow goes stale; the
  `shadow-poses` probe checks that the split view matches a full redraw.
- The fits hold where a refit would redraw a map for little gain (#324). The far fit holds
  (`Environment.holdsFar`) until the wanted centre or half-size has drifted a quarter (`FAR_HOLD`) of
  the held half-size, the light has turned, or the near box would reach past 90% of the held far box,
  so a turning camera no longer redraws the far map every frame (a second full shadow pass: about
  3.5 ms of a turning frame on the everything map). The light direction holds within 0.1°
  (`DIR_COS`): a fit keeps its fitted direction and so its texel grid, so the day cycle's sun redraws
  the maps about every 0.1° rather than every frame. The key light's own position follows the live
  direction for the lighting; three updates a shadow matrix only when it redraws that map, so a map
  and its lookup always agree. `Engine.cullInstances` calls `shadow.updateMatrices` every frame for
  the cull's frustums, so it puts `shadow.matrix` back afterwards (#366); anything else that updates
  a shadow's matrices outside its draw must do the same, or the shadows slide under the day cycle. Keep the near box inside the far one (the 90% bound) if either
  cascade's sizes change: `cascadeShadow` blends into the far map at the near map's edge.
- In a world view a scene change (a model placed, a texture bound) redraws the far map at most once
  every `WORLD_FAR_FRAMES` (30) frames (`Engine.markShadows`, #15): streaming tiles change the scene on
  most frames, and each far redraw there is about 2,000 calls and 5 ms of shadow pass. A held change
  is drawn once the frames are up; a far fit moving, a preference or a tab switch still redraws at once.
- Lighting is plain Lambert on terrain and props alike (no wrap, no shadow floor), so a shadowed
  surface keeps only the hemisphere light. The day sky light is a few times weaker than the sun
  for the shadows to read.
- **Client lighting** (Lighting › Client Lighting, `prefs.clientLighting`): Go reads a map's Light, LightParams,
  LightIntBand and LightFloatBand rows (`vmangos/lights.go`, `MapLights` binding; 1.12 layouts, positions
  in 1/36 yard, band times in half-minutes); `wow/clientLight.ts` blends the global light with the local
  lights reaching the camera, as Noggit Red's Skies and the client do (bands walked as a cycle in stored
  order, as the client walks them), and `Engine.applyClientLight` puts the sun, sky ambient, horizon/fog
  and water colours over the Environment's each frame. From Benilla's port of the client: the sun's
  direction is DayNight's (`wow/dayNight.ts`: it never sets, 20° to 37° up in the north-west, so night is
  only its colours), the scene fog ends at the light's fog end (or the far clip) and starts at its share
  of that, and the sky dome is the client's (`Environment.setClientSky`: the five sky bands on the
  client's ring elevations, the fog colour at the horizon, the dawn and dusk warp where LightParams'
  highlightSky says so, drawn raw), with the visible sun, moon and stars on the client's tables.
  Its clouds (B-179, Benilla's `clouds/`) are `wow/clouds.ts` (`CloudKernel`: the client's 128² tile of
  four octaves of scrolling value noise, thresholded by the light's float band 3, coloured from colour
  bands 10 to 12 with a glow toward the sun or moon, a quarter redrawn ten times a second) on
  `engine/CloudDome.ts`, a dome from the zenith to the eye-level rim drawn right after the sky, while
  Lighting › Clouds is on.
- **Weather preview** (Lighting › Weather Preview, #185; `ui.weather` and `ui.weatherGrade`, not saved):
  the client's rain, snow or sandstorm at a light, medium or heavy grade (the middles of VMaNGOS's
  bands, `wow/weather.ts`). Two halves, both from Benilla's port of the client's weather: the storm
  light, where `lightAt` blends each light's storm params (Light.dbc slot 2, which `lights.go` reads
  beside the clear ones; a light without them keeps its clear ones) over the clear ones by the storm
  blend, full from a quarter grade up, so the fog closes in (a storm's negative fog share) and the
  clouds darken (`CloudDome.update`'s `storm`); it needs Client Lighting. And the drops,
  `world/WeatherLayer.ts`: rain as Mod2x streak triangles (the head on `RainDrop01.blp`'s bottom
  rows, v = 1, where its streak is wide and bright; the tip on its top, v = 0), snow as white point sprites, and the mist
  puffs (all a sandstorm has) in the fog's colour, each placed in the vertex shader from its seed and
  the clock and wrapped into a box around the eye, so nothing runs per drop on the CPU. A part is built
  the first time its weather shows; clear weather and the top-down view hide the group. Three more
  parts of the client's rain (#244, Benilla's `precip`):
  - **Splashes**, rain's 0.25 s patters on the 4 x 4 atlas `RainDropSplash01.blp`: the wrapped box has
    no landing, so they are a field of their own, 64 yd square round the eye, filled at the rate the
    box's drops land on that much ground (`wow/weather.ts` `splashRate`), a ring of slots the CPU
    fills a few dozen a frame (`WeatherLayer.land`). Each lands on the higher of the terrain and the
    models' surface on its 1.04 yd cell (the client's grid), read from the roof grid below; a cell not
    probed yet takes the terrain alone, so over Stormwind's holed ground the splashes fill in over the
    first moments.
  - **Settled flakes** (#316), snow's: a flake that lands lies where it fell and fades out over
    0.25 s (Benilla's `SNOW_SETTLE_LIFE`), drawn as the falling flakes' point sprite and size law.
    They land as the splashes do, on the same ground and cell cache, in a field as wide as the snow's
    box (90 yd, where a flake is down to its 1 px floor), at `wow/weather.ts` `settleRate`, faded at the
    field's edges as the box's are; `WeatherLayer.land` fills either ring, one a frame, and each sits
    0.05 yd up, since a point sprite takes its centre's depth and the ground would clip its lower half.
  - **Wind**: the camera's own planar velocity over 149 ms (`WeatherWind`). It leads each box by 1.75 x
    itself, held to 0.3 of the box's width (Meld's camera flies far faster than a player runs), and
    tips the streaks' tails into it, up to 45 degrees at 30 yd/s. The client's slab tilt is not ported
    (the wrapped box is full everywhere, so a moving camera meets drops anyway), nor the mist's yaw by
    the wind's heading (it turns each new puff, and wrapped puffs have no birth).
  - **Roofs** (#315): the client's drops die where they land, so none falls inside a building or
    under a bridge. `world/WeatherRoof.ts` keeps the models' highest surface on each 1.04 yd cell 75
    yd round the eye (144 x 144 cells), raycast straight down from 30 yd over the eye by the Engine's
    `splashGround` (`near` lists the models whose reach takes in the grid, drawn or not, helpers left
    out; `models` tests only the ones over the cell with `raycastAmong`), nearest cells first, for 1 ms
    a frame (about 38 us a cell on Stormwind's street, 8 on open ground, in the headless probe page).
    It is an R32F texture wrapped on itself (a cell's texel is its index mod 144), so it follows the
    eye without moving: the rows and columns that come in are emptied until probed, and a still eye
    with the grid probed costs nothing. The rain and snow vertex shaders (`roofChunk`) drop a drop below
    its cell's roof; the splashes and settled flakes land on the same cells. The grid is forgotten
    when the models change (`ObjectLayer.version`, which also bumps when a model loads) or the eye
    moves a story (8 yd). Cell sized, as the client's: a drop within a yard of a wall whose cell holds
    the wall's top is hidden too. The mist is left alone.
  - **Rooms**: in a WMO group open to the sky (0x8, 0x40 or 0x100, as Stormwind's streets) the
    weather shows whole; in a true interior only through the doorways onto one (the flood's
    `skyWindows`, a fragment clip on up to 4 NDC rects, `WeatherLayer.gate`, set after
    `updateRoomGate` so it is this frame's), and a room with none in view hides it, as the client hides
    it when no such group is visible. The roofs (above) keep the drops out of the room itself; the
    clip still keeps the mist out, and anything over the roof's probes (30 yd above the eye).
  Which weather a zone gets is the server's `game_weather` (the Zones dialog,
  docs/architecture/terrain.md).
- Time of day, day cycle, clouds and shadows are `prefs`. The Engine keeps its own `hour` while
  cycling, so it doesn't write reactive state every frame.
