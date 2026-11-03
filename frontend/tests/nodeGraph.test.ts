import { describe, expect, test } from 'bun:test'
import { addNode, compileGraph, connect, errorNode, GraphError, NODE_SPECS, parseGraph, serializeGraph, starterGraph, type Graph, type Value } from '../src/lib/script/nodeGraph'
import { runScript } from '../src/lib/script/scriptApi'
import { fakeHost } from './fakeScriptHost'

/** A graph built by hand: `at` places a node with values, `link` joins two pins (and fails the test when refused). */
function build() {
	const g: Graph = { nodes: [], links: [] }
	const at = (type: string, values: Record<string, Value> = {}) => {
		const n = addNode(g, type, 0, 0)
		n.values = values
		return n.id
	}
	const link = (from: number, out: string, to: number, inp: string) => expect(connect(g, from, out, to, inp)).toBeNull()
	return { g, at, link }
}

async function run(g: Graph, host = fakeHost(9, 2)) {
	const c = compileGraph(g, 'graph')
	const r = await runScript(c.lua, 'graph', host.host)
	return { ...r, lua: c.lua, out: host.out, host, compiled: c }
}

describe('node graphs', () => {
	test('the starter graph raises a hill at the camera target', async () => {
		const f = fakeHost(41, 1)
		const r = await run(starterGraph(), f)
		expect(r.error).toBeUndefined()
		expect(r.ok).toBe(true)
		expect(f.out[0]).toBe('Raising a hill where the camera looks')
		// The fake host's target is (4, 5, 6): the top is 10 up there, and nothing moves 15 yards off.
		expect(f.heights[6 * 41 + 4]).toBeCloseTo(10, 5)
		expect(f.heights[6 * 41 + 19]).toBe(0)
		expect(f.heights[6 * 41 + 10]).toBeGreaterThan(0)
		expect(f.heights[6 * 41 + 10]).toBeLessThan(10)
	})

	test('if, a range loop, variables, maths and text', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const loop = at('forRange', { from: 1, to: 6, step: 1 })
		const mod = at('math', { op: 'mod', b: 2 })
		const even = at('compare', { op: '=', b: 0 })
		const branch = at('if')
		const add = at('addVar', { name: 'sum' })
		const say = at('print')
		const read = at('getVar', { name: 'sum' })
		const join = at('join', { a: 'sum ' })
		link(begin, 'next', loop, 'in')
		link(loop, 'body', branch, 'in')
		link(loop, 'index', mod, 'a')
		link(mod, 'value', even, 'a')
		link(even, 'value', branch, 'cond')
		link(branch, 'then', add, 'in')
		link(loop, 'index', add, 'amount')
		link(loop, 'next', say, 'in')
		link(read, 'value', join, 'b')
		link(join, 'value', say, 'value')
		const r = await run(g)
		expect(r.error).toBeUndefined()
		expect(r.out).toEqual(['sum 12'])
	})

	test('a while loop with a break, and a sequence', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const seq = at('sequence')
		const set = at('setVar', { name: 'n', value: 0 })
		const loop = at('while', { cond: true })
		const add = at('addVar', { name: 'n', amount: 1 })
		const big = at('compare', { op: '≥', b: 5 })
		const read = at('getVar', { name: 'n' })
		const branch = at('if')
		const stop = at('break')
		const say = at('print')
		const read2 = at('getVar', { name: 'n' })
		link(begin, 'next', seq, 'in')
		link(seq, 'first', set, 'in')
		link(seq, 'second', loop, 'in')
		link(loop, 'body', add, 'in')
		link(add, 'next', branch, 'in')
		link(read, 'value', big, 'a')
		link(big, 'value', branch, 'cond')
		link(branch, 'then', stop, 'in')
		link(seq, 'third', say, 'in')
		link(read2, 'value', say, 'value')
		const r = await run(g)
		expect(r.error).toBeUndefined()
		expect(r.out).toEqual(['5'])
	})

	test('models: add, read, move and remove', async () => {
		const { g, at, link } = build()
		const f = fakeHost(9, 2)
		const begin = at('begin')
		const pos = at('vector', { x: 4, y: 0, z: 6 })
		const add = at('addM2', { file: 'World\\Generic\\Tree.m2', scale: 2 })
		const info = at('modelInfo')
		const say = at('print')
		const target = at('targetPos')
		const sel = at('selectAround', { radius: 50 })
		const each = at('forEachModel')
		const move = at('modelSetPos')
		const far = at('vector', { x: 10, y: 0, z: 10 })
		link(begin, 'next', add, 'in')
		link(pos, 'vec', add, 'position')
		link(add, 'model', info, 'model')
		link(info, 'file', say, 'value')
		link(add, 'next', say, 'in')
		link(target, 'position', sel, 'center')
		link(say, 'next', each, 'in')
		link(sel, 'sel', each, 'sel')
		link(each, 'body', move, 'in')
		link(each, 'model', move, 'model')
		link(far, 'vec', move, 'position')
		const r = await run(g, f)
		expect(r.error).toBeUndefined()
		expect(f.out).toEqual(['world/generic/tree.m2'])
		expect(f.models.length).toBe(1)
		expect(f.models[0]).toMatchObject({ x: 10, z: 10, scale: 2 })
	})

	test('a seeded generator is made once, and gives the same numbers each run', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const loop = at('forRange', { from: 1, to: 3 })
		const gen = at('randomSeed', { seed: 'abc' })
		const n = at('randomInteger', { lo: 0, hi: 1000 })
		const say = at('print')
		link(begin, 'next', loop, 'in')
		link(loop, 'body', say, 'in')
		link(gen, 'random', n, 'random')
		link(n, 'value', say, 'value')
		const a = await run(g)
		const b = await run(g)
		expect(a.error).toBeUndefined()
		expect(a.out.length).toBe(3)
		expect(new Set(a.out).size).toBeGreaterThan(1)
		expect(b.out).toEqual(a.out)
		expect(a.lua.match(/random_from_seed/g)?.length).toBe(1)
	})

	test('lists, continue and return', async () => {
		// The odd numbers 1 to 9 into a list, skipping the even ones with Continue; then the list read back,
		// stopping with Return at the item 7.
		const { g, at, link } = build()
		const begin = at('begin')
		const make = at('makeList')
		const loop = at('forRange', { from: 1, to: 9 })
		const mod = at('math', { op: 'mod', b: 2 })
		const even = at('compare', { op: '=', b: 0 })
		const branch = at('if')
		const skip = at('continue')
		const add = at('listAdd')
		const size = at('listSize')
		const saySize = at('print')
		const each = at('forEachItem')
		const seven = at('compare', { op: '=', b: 7 })
		const branch2 = at('if')
		const stop = at('return')
		const say = at('print')
		const after = at('print', { value: 'not reached' })
		link(begin, 'next', make, 'in')
		link(make, 'next', loop, 'in')
		link(loop, 'body', branch, 'in')
		link(loop, 'index', mod, 'a')
		link(mod, 'value', even, 'a')
		link(even, 'value', branch, 'cond')
		link(branch, 'then', skip, 'in')
		link(branch, 'next', add, 'in')
		link(make, 'list', add, 'list')
		link(loop, 'index', add, 'value')
		link(loop, 'next', saySize, 'in')
		link(make, 'list', size, 'list')
		link(size, 'size', saySize, 'value')
		link(saySize, 'next', each, 'in')
		link(make, 'list', each, 'list')
		link(each, 'body', branch2, 'in')
		link(each, 'item', seven, 'a')
		link(seven, 'value', branch2, 'cond')
		link(branch2, 'then', stop, 'in')
		link(branch2, 'next', say, 'in')
		link(each, 'item', say, 'value')
		link(each, 'next', after, 'in')
		const r = await run(g)
		expect(r.error).toBeUndefined()
		expect(r.out).toEqual(['5', '1', '3', '5'])
		// Continue outside a loop.
		const d = build()
		d.link(d.at('begin'), 'next', d.at('continue'), 'in')
		expect(() => compileGraph(d.g)).toThrow(/not inside a loop/)
	})

	test('list get, set, remove and clear', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const make = at('makeList')
		const a = at('listAdd', { value: 'a' })
		const b = at('listAdd', { value: 'b' })
		const c = at('listAdd', { value: 'c' })
		const set = at('listSet', { index: 2, value: 'B' })
		const rm = at('listRemove', { index: 1 })
		const get = at('listGet', { index: 1 })
		const say = at('print')
		const clear = at('listClear')
		const size = at('listSize')
		const say2 = at('print')
		const chain = [begin, make, a, b, c, set, rm, say, clear, say2]
		for (let i = 0; i + 1 < chain.length; i++) link(chain[i], 'next', chain[i + 1], 'in')
		for (const n of [a, b, c, set, rm, get, clear, size]) link(make, 'list', n, 'list')
		link(get, 'value', say, 'value')
		link(size, 'size', say2, 'value')
		const r = await run(g)
		expect(r.error).toBeUndefined()
		expect(r.out).toEqual(['B', '0'])
	})

	test('images: create, fill, set and read pixels, blur and resize', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const make = at('createImage', { w: 9, h: 9 })
		const fill = at('imageFill', { r: 0, g: 0, b: 0, a: 1 })
		const dot = at('imageSetPixel', { x: 4, y: 4, r: 1, g: 1, b: 1, a: 1 })
		const blur = at('imageBlur', { sigma: 1, passes: 1 })
		const resize = at('imageResize', { w: 18, h: 4 })
		const size = at('imageInfo')
		const centre = at('imageGetPixel', { x: 4, y: 4 })
		const side = at('imageGetPixel', { x: 5, y: 4 })
		const far = at('imageGetPixel', { x: 0, y: 0 })
		const p1 = at('print')
		const p2 = at('print')
		const p3 = at('print')
		const p4 = at('print')
		const chain = [begin, make, fill, dot, blur, resize, p1, p2, p3, p4]
		for (let i = 0; i + 1 < chain.length; i++) link(chain[i], 'next', chain[i + 1], 'in')
		for (const n of [fill, dot, blur, resize, centre, side, far]) link(make, 'image', n, 'image')
		link(resize, 'out', size, 'image')
		link(size, 'w', p1, 'value')
		link(centre, 'r', p2, 'value')
		link(side, 'r', p3, 'value')
		link(far, 'a', p4, 'value')
		const f = fakeHost(9, 2)
		const r = await run(g, f)
		expect(r.error).toBeUndefined()
		expect(f.out[0]).toBe('18')
		const [c, s] = [Number(f.out[1]), Number(f.out[2])]
		// A dot of 1 blurred with sigma 1: about 0.16 at its middle, less beside it, the alpha untouched.
		expect(c).toBeGreaterThan(0.1)
		expect(c).toBeLessThan(0.25)
		expect(s).toBeGreaterThan(0.05)
		expect(s).toBeLessThan(c)
		expect(Number(f.out[3])).toBe(1)
	})

	test('chunk reads: texture count, heightmap and alpha layer', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const pos = at('vector', { x: 4, y: 0, z: 4 })
		const chunk = at('chunkAt')
		const count = at('chunkTextureCount')
		const p1 = at('print')
		const heights = at('chunkHeights')
		const size = at('listSize')
		const p2 = at('print')
		const alpha = at('chunkAlpha', { layer: 1 })
		const w = at('imageInfo')
		const p3 = at('print')
		const chain = [begin, p1, heights, p2, alpha, p3]
		for (let i = 0; i + 1 < chain.length; i++) link(chain[i], 'next', chain[i + 1], 'in')
		link(pos, 'vec', chunk, 'position')
		for (const n of [count, heights, alpha]) link(chunk, 'chunk', n, 'chunk')
		link(count, 'count', p1, 'value')
		link(heights, 'heights', size, 'list')
		link(size, 'size', p2, 'value')
		link(alpha, 'image', w, 'image')
		link(w, 'h', p3, 'value')
		const f = fakeHost(41, 1)
		const r = await run(g, f)
		expect(r.error).toBeUndefined()
		expect(f.out).toEqual(['0', '145', '64'])
	})

	test('errors name the node at fault', () => {
		expect(() => compileGraph({ nodes: [], links: [] })).toThrow(/no Begin node/)
		// A loop's vertex read after the loop.
		const { g, at, link } = build()
		const begin = at('begin')
		const target = at('targetPos')
		const sel = at('selectAround')
		const each = at('forEachVertex')
		const raise = at('addHeight')
		link(begin, 'next', each, 'in')
		link(target, 'position', sel, 'center')
		link(sel, 'sel', each, 'sel')
		link(each, 'next', raise, 'in')
		link(each, 'vertex', raise, 'vertex')
		try {
			compileGraph(g)
			throw new Error('compiled')
		} catch (e) {
			expect(e).toBeInstanceOf(GraphError)
			expect((e as GraphError).node).toBe(raise)
			expect((e as Error).message).toMatch(/hasn’t run/)
		}
		// An input that must be linked.
		const b = build()
		const b0 = b.at('begin')
		const add = b.at('addHeight')
		b.link(b0, 'next', add, 'in')
		expect(() => compileGraph(b.g)).toThrow(/link its vertex/)
		// A flow that comes back round.
		const c = build()
		const c0 = c.at('begin')
		const p1 = c.at('print')
		const p2 = c.at('print')
		c.link(c0, 'next', p1, 'in')
		c.link(p1, 'next', p2, 'in')
		c.link(p2, 'next', p1, 'in')
		expect(() => compileGraph(c.g)).toThrow(/comes back/)
		// Break outside a loop.
		const d = build()
		d.link(d.at('begin'), 'next', d.at('break'), 'in')
		expect(() => compileGraph(d.g)).toThrow(/not inside a loop/)
	})

	test('a data loop is refused', () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const a = at('math')
		const b = at('math')
		const say = at('print')
		link(begin, 'next', say, 'in')
		link(a, 'value', b, 'a')
		link(b, 'value', a, 'a')
		link(b, 'value', say, 'value')
		expect(() => compileGraph(g)).toThrow(/circle/)
	})

	test('links keep to their types, one value an input', () => {
		const { g, at } = build()
		const v = at('vector')
		const n = at('number')
		const m = at('math')
		expect(connect(g, v, 'vec', m, 'a')).toMatch(/vector/)
		expect(connect(g, n, 'value', m, 'a')).toBeNull()
		expect(connect(g, n, 'value', m, 'b')).toBeNull()
		const n2 = at('number')
		expect(connect(g, n2, 'value', m, 'a')).toBeNull()
		expect(g.links.filter((l) => l.to === m && l.in === 'a').map((l) => l.from)).toEqual([n2])
		expect(connect(g, m, 'op', n, 'value')).not.toBeNull()
	})

	test('a runtime error points at its node', async () => {
		const { g, at, link } = build()
		const begin = at('begin')
		const add = at('addM2', { file: 'nope.blp' })
		const pos = at('vector')
		link(begin, 'next', add, 'in')
		link(pos, 'vec', add, 'position')
		const r = await run(g)
		expect(r.ok).toBe(false)
		expect(errorNode(r.compiled, 'graph', r.error ?? '')).toBe(add)
	})

	test('every node compiles to Lua that loads', async () => {
		for (const spec of NODE_SPECS) {
			if (spec.type === 'begin') continue
			const { g, at, link } = build()
			const begin = at('begin')
			const node = at(spec.type)
			// Feed every input that needs a link from a node of its type.
			const feeds: Record<string, [string, string]> = {
				vec: ['vector', 'vec'],
				sel: ['selectAround', 'sel'],
				model: ['addM2', 'model'],
				chunk: ['chunkAt', 'chunk'],
				random: ['randomSeed', 'random'],
				noise: ['noiseMap', 'noise'],
				vert: ['forEachVertex', 'vertex'],
				image: ['createImage', 'image'],
				list: ['makeList', 'list'],
			}
			let flowFrom: [number, string] = [begin, 'next']
			if (spec.type === 'break' || spec.type === 'continue') {
				const loop = at('forRange')
				link(begin, 'next', loop, 'in')
				flowFrom = [loop, 'body']
			}
			for (const p of spec.inputs) {
				if (p.type === 'exec' || p.def !== undefined || p.optional || p.options || p.field) continue
				const [type, out] = feeds[p.type]
				const src = at(type)
				const srcSpec = NODE_SPECS.find((s) => s.type === type)!
				for (const q of srcSpec.inputs) {
					if (q.type === 'vec' && !q.optional) link(at('targetPos'), 'position', src, q.id)
					if (q.type === 'sel') {
						const s = at('selectAround')
						link(at('targetPos'), 'position', s, 'center')
						link(s, 'sel', src, q.id)
					}
				}
				if (srcSpec.emit) {
					link(flowFrom[0], flowFrom[1], src, 'in')
					flowFrom = type === 'forEachVertex' ? [src, 'body'] : [src, 'next']
				}
				link(src, out, node, p.id)
			}
			if (spec.emit) link(flowFrom[0], flowFrom[1], node, 'in')
			else {
				const say = at('print')
				link(flowFrom[0], flowFrom[1], say, 'in')
				link(node, spec.outputs[0].id, say, 'value')
			}
			const { lua } = compileGraph(g, 'graph')
			const r = await runScript(`local f, err = load(${JSON.stringify(lua)}, '=graph')\nif not f then error(err, 0) end`, 'check', fakeHost().host)
			expect([spec.type, r.error]).toEqual([spec.type, undefined])
		}
	})

	test('a graph keeps through its file, dropping what this Meld lacks', () => {
		const g = starterGraph()
		const text = serializeGraph(g)
		const { graph, dropped } = parseGraph(text)
		expect(dropped).toEqual([])
		expect(graph.nodes.length).toBe(g.nodes.length)
		expect(graph.links).toEqual(g.links)
		expect(compileGraph(graph).lua).toBe(compileGraph(g).lua)
		const raw = JSON.parse(text) as { nodes: { id: number; type: string }[] }
		raw.nodes[1].type = 'teleport'
		const back = parseGraph(JSON.stringify(raw))
		expect(back.dropped).toEqual(['teleport'])
		expect(back.graph.links.some((l) => l.from === raw.nodes[1].id || l.to === raw.nodes[1].id)).toBe(false)
		expect(() => parseGraph('{"nodes": []}')).toThrow(/not a node graph/)
	})
})
