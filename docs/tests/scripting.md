# Scripting

Lua scripts and the Scripts window (`docs/architecture/scripting.md`). The general methods these
entries use (the dev page in headless Chrome, probes) are in `docs/TESTS.md`; read that first.

## Lua scripts: the API, undo and the Scripts window (#28, probe `lua-script`)

Checks: `tests/luaScript.test.ts` runs the script API under `bun test` against a fake host (flat
arrays of heights and models): print, the math globals, seeded random, verts writing back once,
models added, moved, turned, replaced and removed, errors at the script's line, the missing parts
saying so, and the time limit. `internal/scripts` has the Go tests for the folder (names, list, save,
delete). The probe `lua-script` runs scripts on a flat map in the dev page through `Engine.runScript`:
a hill, models and their turn, one undo step that undoes and redoes exactly, a runtime error that
keeps its edits as a step, an endless loop stopped, and the Scripts window's Run on its starter.

To try a script by hand in the dev page:

```js
await __engine.runScript('print(camera_pos(), #select_origin(target_pos(), 50):models())', 'try', console.log)
```

- wasmoon can't push `null` into Lua: a host function that has nothing to return must return
  `undefined` (`scriptApi.ts` `orNil`), or the call throws inside wasmoon.
- An empty Lua table reaches JavaScript as `{}`, not `[]`; read tables from Lua by index, as
  `numbers()` does.
- The probe's loop check waits out the whole 10 s limit, so the probe takes about 20 s.
- Lua's integers print without `.0` (`90`), floats with it (`90.0`); a number that crossed from
  JavaScript prints as either, so compare with a pattern that takes both.

## Script brushes, noise and images (#29, probe `script-brush`)

Checks: `tests/luaScript.test.ts` covers the brush registry and tags (kinds, defaults kept to the
range), events with the position, radius, keys and tag values, an error at the handler's line, a
brush event reading the terrain of the host it is sent with, the event time limit, noise maps (the
grid, out-of-bounds errors, the FRACTAL fallback for encoded trees, `is_highest`, freed by Lua's
collector, every algorithm about -1..1) and images (`create_image`, the packed pixel, `load_png`
waiting for the host in a run and in an event). `internal/scripts` tests `ImagePath` and `LoadPNG`.
The probe `script-brush` loads a brush through `Engine.runScript` on a flat map, checks the options
bar's controls, strokes it with `P.stroke('script', ...)` (click, holds, release, a noise map, a model
placed), checks the one undo step, a handler's error, and `load_png` of a missing file and of a PNG
written to the throwaway client's scratch folder (`P.sandboxClient`, `P.sandboxFile`).

- A stroke's events run on a promise chain: after `P.stroke`, wait for
  `await __engine.scriptBrushes.settled()` before reading the map or the history.
- Noggit Red's own example brushes (`C:\WoW\noggit-red\scripts`) are GPL: never copy them into the
  repo or a test. To try one, save it in the scripts folder and pick it in the Script Brush tool's
  options bar; `height_noise.lua` (the FRACTAL fallback), `prop_placer.lua` (set a Prop 1 model path)
  and `clean.lua` run (its Shift part clears and lays the chunks' textures, #760).
- After adding a binding, `wails dev` may not rebuild the Go side (#387): the probe's `load_png` then
  fails with "LoadScriptImage is not a function"; stop `Meld-dev.exe` and the `bun` processes and rerun.

## Chunks, texture layers, holes, zones and water (#760, probe `lua-chunks`)

Checks: `tests/scriptGround.test.ts` runs scripts against the editor's own host (`EngineScriptHost`
over a real 16-cell `Terrain`, `ObjectLayer` and `LiquidMap`): chunk layers added, found, removed and
cleared (the palette growing), a full chunk's -1, an unpainted layer kept, texel alphas written by
Noggit Red's rule, `get_tex` and `get_pos_2d`, `vert:set_alpha`, `procedures:paint_texture` (with a
colon and a dot), holes by chunk and by vertex block, `set_water` and its removal, the zone and the
impassable flag, the colour notes, the errors, and the one undo step. The probe `lua-chunks` runs one
script on a flat map in the dev page through `Engine.runScript` and checks the editor's arrays, the
redraw markers (`paintVersion`, `holesVersion`) and that undo and redo restore every array exactly.

- A flat map's chunks already hold three textures: a script that wants a known layer order clears the
  chunk first (`c:clear_textures()`), or `add_texture` lands on layer 3.
- A texel's position is its corner, not its middle: `paint_texture` at the selection's middle fades a
  little there (about 200 of 255 for a 4 yd radius on a 256-cell map).
