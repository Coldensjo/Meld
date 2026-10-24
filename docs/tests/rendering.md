# Rendering

Graphics settings and the viewport's WebGL context. The general methods these entries use (the dev page in headless
Chrome, probes, scenes, measuring performance) are in `docs/TESTS.md`; read that first. Drawing cube worlds (the mesher,
the batches, the layer slice, the textures) is checked by the `cube-draw` probe and the unit tests listed in
`docs/architecture/cubes.md`, Checks.

## Graphics › Quality presets (#203)

Checks: `lib/state/graphicsPresets.ts` (unit test `graphicsPresets.test.ts`: each preset is found
again after it is applied, one change makes it Custom). In the dev page, `applyPreset(prefs, 'Low')`
through the page's own module URLs, step a few frames, and read `__engine.prefs` (renderScale 0.5,
shadows off) and `__engine.renderer.getPixelRatio()` (0.5). Click the menu bar's
Graphics button and read the `aria-checked="true"` items: the preset's name is checked and the header
reads Quality; after one setting changes it reads "Quality (custom)" with no preset checked. Use
`?nosave`: a preset writes several prefs at once.

## Losing and restoring the viewport's WebGL context (#209)

Checks: the viewport comes back after the browser drops its WebGL context, and nothing is drawn from a lost one.
- In the dev page (headless Chrome over CDP works, `docs/TESTS.md`): `const x = __engine.renderer.getContext().getExtension('WEBGL_lose_context'); x.loseContext()`,
  wait ~500 ms: `__engine.contextLost` is true and the status bar says the graphics card dropped the
  viewport. Then `x.restoreContext()`, wait ~1.5 s and step `__engine.frame()` a few times: the status
  says the viewport is back, the shot looks as before, and `gl.getError()` stays 0 after each frame.
- Trap: three rebuilds its state and re-uploads geometry and textures by itself on restore, but a
  shadow map exists on the new context only once redrawn. `onContextRestored` sets
  `shadow.needsUpdate` on every casting light for that. Finding such an error: wrap the context's
  prototype methods, call `getError` after each and log the dozen calls before the first error.
