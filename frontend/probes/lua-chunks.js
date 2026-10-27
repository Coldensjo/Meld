// Lua scripts' chunks, texture layers, holes, zones and water (#760): on a flat map a script adds a texture to the chunks under a selection and paints it on through sel:tex(), with procedures:paint_texture too, cuts a chunk's hole and a vertex's hole block, sets a chunk's zone and the impassable flag, and puts water at a vertex; the editor's own arrays (the palette, chunkSlots, weights, holes, areaIds, chunkFlags, the liquids) show it, the paint and the holes reach the terrain's redraw, and the run is one undo step that undo and redo exactly.
// touches: frontend/src/lib/script/prelude.ts, frontend/src/lib/script/scriptApi.ts, frontend/src/lib/engine/ScriptRun.ts, frontend/src/lib/tools/brush.ts
const e = P.e
const { editor } = await P.state()
const bad = []
const r = {}
const BASE = 'Tileset/Elwynn/ElwynnGrassBase.blp'
const GRASS = 'Tileset/Durotar/DurotarRock.blp'
e.newDocument(256, 'flat', 0, 'Probe Lua chunks')
await P.frames(1)
const t = e.terrain
const S = 4
const snap = () => ({ palette: [...editor.palette], slots: t.chunkSlots.slice(), weights: t.weights.slice(), holes: t.holes.slice(), areas: t.areaIds.slice(), flags: t.chunkFlags.slice(), water: [...e.doc.liquids.entries()].length })
const before = snap()
const pos0 = e.history.position
const paint0 = t.paintVersion
const holes0 = t.holesVersion
const printed = []
const code = `
local sel = select_between(vec(70, 0, 70), vec(90, 0, 90))
local layers = {}
for _, c in ipairs(sel:chunks()) do
	c:clear_textures()
	c:add_texture("${BASE}")
	layers[#layers + 1] = c:add_texture("${GRASS}")
end
for _, tx in ipairs(sel:tex()) do
	local p = tx:get_pos_2d()
	if p.x < 80 then tx:set_alpha(1, 1) end
end
sel:apply()
local img = create_image(8, 8)
for x = 0, 7 do for y = 0, 7 do img:set_pixel_floats(x, y, 1, 1, 1, 1) end end
procedures:paint_texture(select_origin(vec(85, 0, 85), 4), img, 1, 1, 0)
local c = get_chunk(vec(150, 0, 150))
c:set_hole(true)
c:set_area_id(12)
c:set_impassable(true)
local v = select_between(vec(200, 0, 200), vec(200, 0, 200)):verts()[1]
v:set_hole(true)
select_between(vec(100, 0, 100), vec(100, 0, 100)):verts()[1]:set_water(1, 5)
print(#layers, layers[1], get_chunk(vec(75, 0, 75)):get_texture(1), get_chunk(vec(75, 0, 75)):get_texture_count(), c:get_area_id())
`
const res = await e.runScript(code, 'chunks', (s) => printed.push(s))
await P.frames(2)
r.res = res && { ok: res.ok, error: res.error, ms: Math.round(res.ms) }
r.printed = printed
if (!res?.ok) bad.push(`the script failed: ${res?.error}`)
// 70 to 90 yards lie in one chunk (a chunk is 33.3 yd), cleared to the base and the new texture.
if (!/^1\t1\ttileset\/durotar\/durotarrock\.blp\t2\t12$/.test(printed[0] ?? '')) bad.push(`it printed ${JSON.stringify(printed)}`)
const gi = editor.palette.findIndex((p) => p.toLowerCase() === GRASS.replace(/\//g, '\\').toLowerCase())
if (gi < 0) bad.push('the texture is not in the palette')
const side = t.paintChunksPerSide
const span = t.worldSize / side
const chunkAt = (x, z) => Math.floor(z / span) * side + Math.floor(x / span)
const c75 = chunkAt(75, 75)
r.slots = [...t.chunkSlots.subarray(c75 * S, c75 * S + S)]
if (t.chunkSlots[c75 * S + 1] !== gi) bad.push(`chunk ${c75}'s second layer is ${t.chunkSlots[c75 * S + 1]}, not the texture (${gi})`)
const texel = (x, z, k) => t.weights[(Math.floor((z / t.worldSize) * t.splatRes) * t.splatRes + Math.floor((x / t.worldSize) * t.splatRes)) * S + k]
r.painted = { at75: texel(75, 75, 1), at85: texel(85, 85, 1), at88: texel(88.6, 85, 1), at95: texel(95, 85, 1) }
if (r.painted.at75 !== 255) bad.push(`the texel at 75 has ${r.painted.at75} of the texture, not all`)
// The texel's corner is a little off the middle, so it fades a little (about 200).
if (!(r.painted.at85 > 150)) bad.push(`paint_texture left ${r.painted.at85} at its middle`)
if (r.painted.at95 !== 0) bad.push('paint_texture reached past its selection')
const cell = (x, z) => t.holes[Math.floor(z / t.cellSize) * t.size + Math.floor(x / t.cellSize)]
const c150 = chunkAt(150, 150)
if (!cell(150, 150) || t.areaIds[c150] !== 12 || !(t.chunkFlags[c150] & 1)) bad.push('the chunk at 150 is not a hole of zone 12, impassable')
if (!cell(200, 200)) bad.push('the vertex at 200 cut no hole')
const lw = e.doc.liquids.layers(chunkAt(100, 100))
r.water = lw.map((l) => ({ id: l.id, cells: l.cells.reduce((a, b) => a + b, 0) }))
if (lw.length !== 1 || lw[0].id !== 1) bad.push('no water at 100')
if (t.paintVersion === paint0) bad.push('the paint was not marked for redraw')
if (t.holesVersion === holes0) bad.push('the holes were not marked for redraw')
if (e.history.position !== pos0 + 1) bad.push(`the run made ${e.history.position - pos0} undo steps`)
const after = snap()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const diff = (a, b) => Object.keys(a).filter((k) => !same(Array.from(a[k]?.length !== undefined ? a[k] : [a[k]]), Array.from(b[k]?.length !== undefined ? b[k] : [b[k]])))
e.history.undo()
await P.frames(1)
r.undoDiff = diff(snap(), before)
if (r.undoDiff.length) bad.push(`after the undo these differ: ${r.undoDiff.join(', ')}`)
e.history.redo()
await P.frames(1)
r.redoDiff = diff(snap(), after)
if (r.redoDiff.length) bad.push(`after the redo these differ: ${r.redoDiff.join(', ')}`)
r.bad = bad
r.ok = !bad.length
return r
