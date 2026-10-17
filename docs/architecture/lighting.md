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
  texels and sets its depth range and biases in world units from the texel size). The near map is
  redrawn every frame, the far one only when its fit or the scene (objects, heights, spawns)
  changed. Both cascade frustums feed instance culling, so what is off screen still casts.
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
  `world/WeatherLayer.ts`: rain as Mod2x streak triangles, snow as white point sprites, and the mist
  puffs (all a sandstorm has) in the fog's colour, each placed in the vertex shader from its seed and
  the clock and wrapped into a box around the eye, so nothing runs per drop on the CPU. A part is built
  the first time its weather shows; clear weather, the top-down view and the camera in a WMO room hide
  the group. Ground splashes and the wind are left out. Which weather a zone gets is the server's
  `game_weather` (the Zones dialog, docs/architecture/terrain.md).
- Time of day, day cycle, clouds and shadows are `prefs`. The Engine keeps its own `hour` while
  cycling, so it doesn't write reactive state every frame.
