// The Stamp tool's per-brush settings copy holds only the brush tools' fields, not the region's spawns, and costs the same with 5000 spawns loaded (#445).
// touches: frontend/src/lib/tools/StampTool.ts, frontend/src/lib/tools/brushStack.ts, frontend/src/lib/state/editor.svelte.ts
const st = await P.app('/src/lib/state/editor.svelte.ts')
const bs = await P.app('/src/lib/tools/brushStack.ts')
const { editor } = st
const was = editor.spawns
editor.spawns = Array.from({ length: 5000 }, (_, i) => ({ guid: i, waypoints: Array.from({ length: 10 }, (_, j) => ({ x: j, y: j, z: j })) }))
const t0 = performance.now()
let base
for (let i = 0; i < 20; i++) base = st.copyToolSettings()
const ms = (performance.now() - t0) / 20
editor.spawns = was
const keys = Object.keys(base)
const item = bs.newStackItem('sculpt', '')
const a = bs.applyItem(structuredClone(base), { ...item, radius: 3, inheritRadius: false }, { radius: 9, strength: 1, rotation: 0 }, 0)
const b = bs.applyItem(structuredClone(base), { ...item, radius: 7, inheritRadius: false }, { radius: 9, strength: 1, rotation: 0 }, 0)
const independent = a.brush.radius === 3 && b.brush.radius === 7 && editor.brush.radius !== 3 + 0.123
return { ok: !keys.includes('spawns') && keys.length === st.TOOL_SETTING_KEYS.length && independent && ms < 2, keys: keys.length, msPerCopy: +ms.toFixed(3), independent }
