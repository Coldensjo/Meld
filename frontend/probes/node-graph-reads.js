// The Node Editor's chunk-read, image and list nodes (#1090) on the editor's own host: on a flat map a Lua script paints a second texture over part of a chunk, then a graph run through Engine.runScript reads that chunk's layer texture, its alpha layer as an image (painted where the script painted, bare past it), its heightmap as a list of 145, and blurs and resizes the image; the reads print what the editor's arrays hold.
// touches: frontend/src/lib/script/nodeGraph.ts, frontend/src/lib/script/prelude.ts, frontend/src/lib/script/scriptApi.ts, frontend/src/lib/script/scriptImage.ts
const e = P.e
const bad = []
const r = {}
const { addNode, compileGraph, connect } = await import('/src/lib/script/nodeGraph.ts')
const BASE = 'Tileset/Elwynn/ElwynnGrassBase.blp'
const ROCK = 'Tileset/Durotar/DurotarRock.blp'
e.newDocument(256, 'flat', 0, 'Probe Node Reads')
await P.frames(1)
const prep = `
local sel = select_between(vec(70, 0, 70), vec(90, 0, 90))
for _, c in ipairs(sel:chunks()) do
	c:clear_textures()
	c:add_texture("${BASE}")
	c:add_texture("${ROCK}")
end
for _, tx in ipairs(sel:tex()) do
	if tx:get_pos_2d().x < 80 then tx:set_alpha(1, 1) end
end
sel:apply()
`
const p0 = await e.runScript(prep, 'prep', () => {})
if (!p0?.ok) bad.push(`the paint script failed: ${p0?.error}`)
await P.frames(1)

// The chunk at (75, 75) spans 66.7 to 100 yards: its alpha image's pixel 16 lies at about 75, 54 at about 95.
const g = { nodes: [], links: [] }
const at = (type, values = {}) => {
	const n = addNode(g, type, 0, 0)
	n.values = values
	return n.id
}
const link = (from, out, to, inp) => {
	const err = connect(g, from, out, to, inp)
	if (err) bad.push(`link ${from}.${out} to ${to}.${inp}: ${err}`)
}
const begin = at('begin')
const pos = at('vector', { x: 75, y: 0, z: 75 })
const chunk = at('chunkAt')
const tex = at('chunkTexture', { layer: 1 })
const alpha = at('chunkAlpha', { layer: 1 })
const painted = at('imageGetPixel', { x: 16, y: 16 })
const bare = at('imageGetPixel', { x: 54, y: 16 })
const heights = at('chunkHeights')
const size = at('listSize')
const blur = at('imageBlur', { sigma: 2, passes: 1 })
const resize = at('imageResize', { w: 32, h: 32 })
const small = at('imageGetPixel', { x: 8, y: 8 })
const prints = [0, 1, 2, 3, 4].map(() => at('print'))
link(pos, 'vec', chunk, 'position')
for (const n of [tex, alpha, heights]) link(chunk, 'chunk', n, 'chunk')
for (const n of [painted, bare, blur, resize]) link(alpha, 'image', n, 'image')
link(resize, 'out', small, 'image')
link(heights, 'heights', size, 'list')
const chain = [begin, prints[0], alpha, prints[1], prints[2], heights, prints[3], blur, resize, prints[4]]
for (let i = 0; i + 1 < chain.length; i++) link(chain[i], 'next', chain[i + 1], 'in')
link(tex, 'file', prints[0], 'value')
link(painted, 'r', prints[1], 'value')
link(bare, 'r', prints[2], 'value')
link(size, 'size', prints[3], 'value')
link(small, 'r', prints[4], 'value')
const printed = []
const { lua } = compileGraph(g, 'reads')
const res = await e.runScript(lua, 'reads', (s) => printed.push(s))
r.res = res && { ok: res.ok, error: res.error, ms: Math.round(res.ms) }
r.printed = printed
if (!res?.ok) bad.push(`the graph failed: ${res?.error}`)
else {
	if (printed[0] !== 'tileset/durotar/durotarrock.blp') bad.push(`Texture by Layer gave ${JSON.stringify(printed[0])}`)
	if (Number(printed[1]) < 0.9) bad.push(`the alpha image is ${printed[1]} where the script painted, not about 1`)
	if (Number(printed[2]) > 0.05) bad.push(`the alpha image is ${printed[2]} past the paint, not 0`)
	if (printed[3] !== '145') bad.push(`Get Heightmap gave ${printed[3]} heights, not 145`)
	if (Number(printed[4]) < 0.5) bad.push(`the blurred, halved image is ${printed[4]} inside the paint, not about 1`)
}
e.history.undo()
e.history.undo()
r.bad = bad
r.ok = !bad.length
return r
