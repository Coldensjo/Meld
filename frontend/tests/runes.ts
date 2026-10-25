// Svelte's runes as plain values, for the tests: `editor.svelte.ts` (and every module that imports it,
// the tools, the object layer, the palette) compiles only through Svelte, which `bun test` doesn't run.
// Import this before them, first in the file:
//
//     import './runes.ts'
//
// and they load as they are, with the editor's real defaults. Prefer it to `mock.module` of the
// editor: a module mock lasts for the rest of `bun test`'s run, so a later file that loads the real
// module gets the mock instead.
const g = globalThis as Record<string, unknown>
g.$state = Object.assign(<T>(v: T) => v, { snapshot: <T>(v: T) => structuredClone(v) })
