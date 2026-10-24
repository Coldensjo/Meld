# Lighting, sky and shadows

The sky and time of day, and the shadow cascades.

- `lib/engine/Environment.ts` owns the sky dome, hemisphere light and the single
  shadow-casting key `DirectionalLight` (sun by day, moon by night).
  - The sky dome is three's Preetham `Sky` shader, patched with our ACES tone mapping, stars,
    Milky Way, moon and clouds (Lighting › Clouds, `setClouds`).
  - `update(hour)` computes the sun/moon directions and all lighting colours (`state`).
- `Engine.updateEnvironment` puts `state`'s horizon into the fog and background every frame, at
  the fog distances the world's size and Graphics › View distance give (`applyViewDistance`).
- **Shadow cascades**: the key light's shadow has two maps. The near one is the key light's own
  (sharp, fitted around the first cube the camera looks at); the far one belongs to
  `Environment.far`, a black `DirectionalLight` that lights nothing and only carries the coarse map
  for the distance. `Engine.fitShadows` fits both each frame (`Environment.fitCascade` snaps each to
  its texels and sets its depth range and biases in world units from the texel size). Both maps are
  kept between frames (`autoUpdate` off); `Engine.markShadows`, just before the render, redraws the
  far one when its fit, the cubes drawn (another tab, an edit, chunks built, the layer slice:
  `shadowSceneChanged`) or a preference changed, and the near one on those and when the camera
  moved. A still view redraws neither (#326). Something new that casts must bump one of those keys
  or its shadow goes stale.
- **What casts and receives** (#158): `CubeLayer`'s solid cube meshes cast (from both faces,
  `shadowSide` DoubleSide) and receive, liquids only receive, and glowing lava (unlit) does neither.
  Plain three materials read only each light's own map, and the far light is black, so the lit cube
  materials are patched by `lib/engine/shadowCascades.ts` (`patchCascadeShadows`): its
  `cascadeShadow` replaces the directional shadow lookup in three's `lights_fragment_begin` with the
  near map blended into the far one at its edge. It throws at load if a three update changes that
  chunk so the patch no longer applies.
- The fits hold where a refit would redraw a map for little gain (#324). The far fit holds
  (`Environment.holdsFar`) until the wanted centre or half-size has drifted a quarter (`FAR_HOLD`) of
  the held half-size, the light has turned, or the near box would reach past 90% of the held far box.
  The light direction holds within 0.1° (`DIR_COS`), so the day cycle's sun redraws the maps about
  every 0.1° rather than every frame.
- **The game's mood** (3dgame #142, Lighting › Look, `prefs.look`, on by default): the viewport
  wears the game's look, the moods of `crates/gameplay/moods.toml` (`docs/look/README.md`), which
  `lib/engine/moods.ts` reads (imported as text, the editor's copy of `gameplay::Moods` and of the
  client's `mood.rs` `day_mood` and `sky_light`). `Engine.updateMood` picks the mood of the layer
  looked at (the slice's layer while the slice is on, else the camera's) and, above ground, the day's
  at the hour shown (hour / 24 is the game's time of day) unless Lighting › Mood (`prefs.mood`) picks
  a surface mood, and eases to it as the client does. Where a mood region (3dgame #143,
  `cubes.md`) holds the cell of the camera's target in that layer, the region's mood is worn
  instead, as the client's `place_mood` does (`moods.ts` `namedMood`, `dayMood` with its keys over
  the hour's). `Environment.applyMood` puts it on the lights
  in the client's units (Bevy's exposure, EV100 9.7, makes light about 0.001 of its lux) and shows
  `moodLook.ts`' `MoodSky`, the client's `sky.wgsl` in GLSL, instead of the Preetham sky. The fog is
  the client's exponential one, started at the camera's target rather than the camera (it stands
  back from what it looks at): `moodLook.ts` patches three's `fog_fragment` so a linear `Fog` with a
  negative `far` is exponential, `near` the density. The scene is drawn into a half-float target and
  `MoodGrade` grades it onto the canvas with Bevy's white balance and sectional grade, then Khronos
  PBR Neutral in place of the client's TonyMcMapface (a LUT). Before the grade, `MoodBloom` blooms
  it as Bevy's `Bloom::NATURAL` (3dgame #178): eight half-float mips from 512 high down, Bevy's
  13-tap downsample (Karis average on the first) and tent upsample, blended energy-conserving by its
  `compute_blend_factor`, the first mip mixed into the scene by the mood's `bloom`. The textures'
  glow takes the mood's `glow` (`setCubeGlow`). The lava's and the lamps' lights (3dgame #178,
  `lib/engine/moodLights.ts`): `CubeLayer` keeps a light over each chunk with lava (the middle of its
  lava's top faces, 4 m up, as the client's `scene.rs`) and `PropLayer` each lamp's (a model with
  models.toml `light`), and `MoodLights` gives a fixed pool of 12 point lights to the ones that light
  the place looked at most (up to 30 m ahead of the camera), in the client's lumens, ranges and
  colours (the lamps the mood's `lamp`, flickering as `props.rs`). The client lights all of them; a
  fixed pool keeps three's per-fragment cost and its shaders (which compile in the number of lights)
  fixed, so lights further from the focus go dark. The pool is in the scene only under the mood.
  Not drawn: the particles and the ground mist. `renderer.info` is put back to the scene's numbers
  after the bloom and grade passes, so the stats and the probes count the scene.
- Time of day, day cycle, clouds and shadows are `prefs`. The Engine keeps its own `hour` while
  cycling, so it doesn't write reactive state every frame.
- The client's own lighting (its sky dome, cloud dome and weather), which only a Meld map of the WoW
  client had, went with those maps (#61) and the client readers (#59); the sky above is the only one.
