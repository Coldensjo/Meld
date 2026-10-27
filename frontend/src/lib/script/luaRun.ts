// The app's way into the Lua engine (#28): loaded with a dynamic import on the first run, so wasmoon and
// its WebAssembly stay out of the main bundle, and pointing wasmoon at the bundled copy of its module
// (by default it fetches it from unpkg in a browser). The tests import scriptApi.ts directly.
import wasmUrl from 'wasmoon/dist/glue.wasm?url'
import { setLuaWasmUrl } from './scriptApi'

setLuaWasmUrl(wasmUrl)

export { openScript, runScript } from './scriptApi'
