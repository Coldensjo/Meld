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
