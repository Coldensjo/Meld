import { describe, expect, test } from 'bun:test'
import { openScript, runScript, type BrushEvent, type ScriptHost, type ScriptModel } from '../src/lib/script/scriptApi'
import { noiseGrid, NOISE_NAMES } from '../src/lib/script/scriptNoise'

/** A host over a flat `verts`×`verts` grid, `cell` yards apart, and a list of models. */
function fakeHost(verts = 9, cell = 2) {
	const heights = new Array<number>(verts * verts).fill(0)
	const models: ScriptModel[] = []
	const out: string[] = []
	let next = 1
	let heightWrites = 0
	const host: ScriptHost = {
		print: (s) => out.push(s),
		terrain: () => ({ verts, cell, tex: (verts - 1) * 4 }),
		heights: (x0, z0, x1, z1) => {
			const r: number[] = []
			for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) r.push(heights[z * verts + x])
			return r
		},
		setHeights: (x0, z0, w, h, hs) => {
			heightWrites++
			for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) if (Number.isFinite(hs[z * w + x])) heights[(z0 + z) * verts + x0 + x] = hs[z * w + x]
		},
		models: (x0, z0, x1, z1) => models.filter((m) => m.x >= x0 && m.x <= x1 && m.z >= z0 && m.z <= z1).map((m) => ({ ...m })),
		addModel: (kind, file, x, y, z, rx, ry, rz, scale) => {
			if (!file.toLowerCase().endsWith(kind === 'wmo' ? '.wmo' : '.m2')) return `not a ${kind}: ${file}`
			const m = { id: next++, file, x, y, z, rx, ry, rz, scale }
			models.push(m)
			return { ...m }
		},
		setModel: (id, x, y, z, rx, ry, rz, scale) => {
			const m = models.find((o) => o.id === id)!
			Object.assign(m, { x, y, z, rx, ry, rz, scale })
		},
		removeModel: (id) => {
			models.splice(
				models.findIndex((o) => o.id === id),
				1,
			)
		},
		replaceModel: (id, file) => {
			const m = models.find((o) => o.id === id)!
			const n = { ...m, id: next++, file }
			models.splice(models.indexOf(m), 1, n)
			return { ...n }
		},
		camera: () => ({ x: 1, y: 2, z: 3, pitch: 30, yaw: 45 }),
		target: () => ({ x: 4, y: 5, z: 6 }),
		mapId: () => 1,
		areaId: () => 12,
		area: () => null,
		// Chunks, texels, holes and water are tested on the editor's host (tests/scriptGround.test.ts).
		chunkTextures: () => [],
		chunkAddTexture: () => -1,
		chunkRemoveTexture: () => {},
		chunkClearTextures: () => {},
		chunkEffect: () => 0,
		chunkSetHole: () => {},
		chunkArea: () => 0,
		chunkSetArea: () => {},
		chunkSetImpassable: () => {},
		alphas: (x0, z0, x1, z1) => new Array<number>((x1 - x0 + 1) * (z1 - z0 + 1) * 4).fill(0),
		setAlphas: () => {},
		setHole: () => {},
		setWater: () => {},
	}
	return { host, heights, models, out, writes: () => heightWrites }
}

describe('Lua scripts', () => {
	test('print, the math globals and Lua 5.1 names', async () => {
		const f = fakeHost()
		const r = await runScript(
			'print("hi", 1, nil, true)\nprint(round(2.5), floor(2.7), lerp(0, 10, 0.25), dist_2d(vec(0,9,0), vec(3,0,4)))\nprint(unpack({7, 8}))\nprint(rotate_2d(vec(1,0,0), vec(0,0,0), 90))\nprint(_VERSION)',
			'a',
			f.host,
		)
		expect(r.ok).toBe(true)
		expect(f.out[0]).toBe('hi\t1\tnil\ttrue')
		expect(f.out[1]).toBe('3\t2\t2.5\t5.0')
		expect(f.out[2]).toBe('7\t8')
		expect(f.out[3]).toMatch(/^vec\(6\.\d+e-17, 0, 1\)$/)
	})

	test('a seeded random repeats, and integer stays below its high bound', async () => {
		const f = fakeHost()
		const code = 'local r = random_from_seed("noggit") local t = {} for i = 1, 200 do local v = r:integer(1, 4) assert(v >= 1 and v < 4) t[#t+1] = v end print(table.concat(t, ",", 1, 10)) print(r:real(2, 3) < 3)'
		await runScript(code, 'a', f.host)
		await runScript(code, 'a', f.host)
		expect(f.out[0]).toBe(f.out[2])
		expect(f.out[1]).toBe('true')
	})

	test('verts set heights, written back once at the end', async () => {
		const f = fakeHost()
		const r = await runScript('local sel = select_origin(vec(8, 0, 8), 2, 2)\nfor _, v in pairs(sel:verts()) do v:set_height(v:get_pos().x) end', 'a', f.host)
		expect(r.ok).toBe(true)
		// Vertices 3..5 each way (x 6, 8, 10), heights their x.
		expect(f.heights[4 * 9 + 3]).toBe(6)
		expect(f.heights[5 * 9 + 5]).toBe(10)
		expect(f.heights[2 * 9 + 4]).toBe(0)
		expect(f.heights.filter((h) => h !== 0).length).toBe(9)
		expect(f.writes()).toBe(1)
	})

	test('add_height reads its own edits, and apply writes before the next read', async () => {
		const f = fakeHost()
		const code = 'local sel = select_between(vec(0,0,0), vec(2,0,2))\nfor _, v in pairs(sel:verts()) do v:add_height(1) v:add_height(1) end\nsel:apply()\nfor _, v in pairs(sel:verts()) do v:sub_height(0.5) end\nprint(#sel:verts())'
		expect((await runScript(code, 'a', f.host)).ok).toBe(true)
		expect(f.heights[0]).toBe(1.5)
		expect(f.heights[1 * 9 + 1]).toBe(1.5)
		expect(f.out[0]).toBe('4')
	})

	test('models: add, find, move, turn, replace and remove', async () => {
		const f = fakeHost()
		const code = [
			'local m = add_m2("World/Generic/Tree.m2", vec(4, 1, 4), 2, vec(0, 90, 0))',
			'print(m:get_filename(), m:has_filename("WORLD\\\\GENERIC\\\\TREE.M2"), m:get_scale())',
			'add_wmo("World/wmo/Hut.wmo", vec(14, 0, 14))',
			'local found = select_origin(vec(4, 0, 4), 1):models()',
			'print(#found, found[1]:get_rot().y)',
			'found[1]:set_pos(vec(5, 2, 6))',
			'found[1]:set_rot(vec(0, 180, 0))',
			'found[1]:replace("World/Generic/Bush.m2")',
			'print(found[1]:get_filename(), found[1]:get_pos())',
			'for _, o in pairs(select_origin(vec(14, 0, 14), 1):models()) do o:remove() end',
		].join('\n')
		const r = await runScript(code, 'a', f.host)
		expect(r.error).toBeUndefined()
		expect(f.out[0]).toBe('world/generic/tree.m2\ttrue\t2')
		expect(f.out[1]).toBe('1\t90')
		expect(f.out[2]).toBe('world/generic/bush.m2\tvec(5, 2, 6)')
		expect(f.models.length).toBe(1)
		expect(f.models[0]).toMatchObject({ file: 'World/Generic/Bush.m2', x: 5, y: 2, z: 6, ry: 180, scale: 2 })
	})

	test('a refused model is the script error, at its line', async () => {
		const f = fakeHost()
		const r = await runScript('\nadd_m2("tree.mdl", vec(0, 0, 0))', 'trees', f.host)
		expect(r.ok).toBe(false)
		expect(r.error).toContain('trees:2: not a m2: tree.mdl')
	})

	test('a syntax error names the script and line', async () => {
		const r = await runScript('local x = = 1', 'broken', fakeHost().host)
		expect(r.ok).toBe(false)
		expect(r.error).toStartWith('broken:1:')
	})

	test('what Meld lacks says so', async () => {
		const r = await runScript('write_file("a.txt", "b")', 'b', fakeHost().host)
		expect(r.error).toContain('write_file is not in Meld yet')
	})

	test('an endless loop is stopped', async () => {
		const r = await runScript('while true do end', 'loop', fakeHost().host, 200)
		expect(r.ok).toBe(false)
		expect(r.error).toContain('stopped after 0.2 s')
	})

	test('the camera, map and Meld extras', async () => {
		const f = fakeHost()
		await runScript('print(camera_pos(), cam_yaw(), get_map_id(), get_area_id(vec(0,0,0)), target_pos(), selected_area())', 'a', f.host)
		expect(f.out[0]).toBe('vec(1, 2, 3)\t45\t1\t12\tvec(4, 5, 6)\tnil')
	})
})

const at = (x: number, z: number, outer = 2, dt = 0): BrushEvent => ({ x, y: 0, z, outer, inner: 0.5, dt })

describe('Script brushes (#29)', () => {
	const BRUSH = `
local b = brush("Raiser")
b:add_description("Raises the ground")
local amount = b:add_real_tag("Amount", 0, 10, 2, 3)
local steps = b:add_int_tag("Steps", 1, 5, 9)
local name = b:add_string_tag("Name")
local on = b:add_bool_tag("On", true)
b:add_null_tag()
local mode = b:add_string_list_tag("Mode", "up", "down")
function b:on_left_click(evt)
	local sel = select_origin(evt:pos(), evt:outer_radius())
	local sign = mode:get() == "up" and 1 or -1
	for _, v in pairs(sel:verts()) do v:add_height(sign * amount:get()) end
	print("click", evt:pos(), evt:inner_radius(), steps:get(), name:get(), on:get(), holding_shift(), holding_left_mouse())
end
function b:on_left_hold(evt)
	print("hold", evt:dt())
	evt:set_outer_radius(7)
end
function b:on_left_release(evt) error("released") end
`

	test('brush() keeps the state, with the tags and the events it handles', async () => {
		const f = fakeHost()
		const { result, session } = await openScript(BRUSH, 'raiser', f.host)
		expect(result.ok).toBe(true)
		expect(session).not.toBeNull()
		const b = session!.brushes[0]
		expect(b.name).toBe('Raiser')
		expect(b.handles).toEqual(['left_click', 'left_hold', 'left_release'])
		expect(b.tags.map((t) => t.kind)).toEqual(['description', 'real', 'int', 'string', 'bool', 'null', 'list'])
		expect(b.tags[1]).toEqual({ kind: 'real', label: 'Amount', low: 0, high: 10, def: 2, digits: 3 })
		// A default past the range is kept to it.
		expect(session!.values[0]).toEqual(['', 2, 5, '', true, '', 'up'])
		expect(b.tags[6]).toMatchObject({ values: ['up', 'down'] })
		session!.close()
	})

	test('a script without brushes closes its state', async () => {
		const { result, session } = await openScript('print(1)', 'a', fakeHost().host)
		expect(result.ok).toBe(true)
		expect(session).toBeNull()
	})

	test('events run the handlers with the position, radius, keys and tag values', async () => {
		const f = fakeHost()
		const { session } = await openScript(BRUSH, 'raiser', f.host)
		const s = session!
		s.keys = { alt: false, shift: true, ctrl: false, space: false, left: true, right: false }
		s.setTag(0, 1, 3)
		s.setTag(0, 3, 'x')
		const r = await s.event(0, 'left_click', at(8, 8))
		expect(r.ok).toBe(true)
		expect(f.out[0]).toBe('click\tvec(8, 0, 8)\t0.5\t5\tx\ttrue\ttrue\ttrue')
		// Vertices 3..5 each way (2 yards apart), raised 3.
		expect(f.heights[4 * 9 + 4]).toBe(3)
		expect(f.heights.filter((h) => h === 3).length).toBe(9)
		s.setTag(0, 6, 'down')
		await s.event(0, 'left_click', at(8, 8))
		expect(f.heights[4 * 9 + 4]).toBe(0)
		let radius: number[] = []
		s.onRadius = (o, i) => (radius = [o, i])
		expect((await s.event(0, 'left_hold', at(8, 8, 2, 0.25))).ok).toBe(true)
		expect(f.out.at(-1)).toBe('hold\t0.25')
		expect(radius).toEqual([7, 0.5])
		// An error names the script's line; the brush still works after it.
		const bad = await s.event(0, 'left_release', at(8, 8))
		expect(bad.ok).toBe(false)
		expect(bad.error).toMatch(/^raiser:20: released/)
		expect((await s.event(0, 'left_hold', at(8, 8))).ok).toBe(true)
		// An event the brush has no handler for does nothing.
		expect((await s.event(0, 'right_click', at(8, 8))).ok).toBe(true)
		s.close()
		expect((await s.event(0, 'left_click', at(8, 8))).ok).toBe(false)
	})

	test('each event reads the terrain of the host it is sent with', async () => {
		const { session } = await openScript(BRUSH, 'raiser', fakeHost(9, 2).host)
		const other = fakeHost(5, 4)
		session!.host = other.host
		await session!.event(0, 'left_click', at(8, 8, 4))
		// Vertex 2,2 of the 5-wide grid is at (8, 8).
		expect(other.heights[2 * 5 + 2]).toBe(2)
		session!.close()
	})

	test('an endless loop in an event is stopped', async () => {
		const { session } = await openScript('local b = brush("x") function b:on_left_click() while true do end end', 'loop', fakeHost().host, 200)
		const r = await session!.event(0, 'left_click', at(0, 0))
		expect(r.error).toContain('stopped after 0.2 s')
		session!.close()
	})
})

describe('make_noise (#29)', () => {
	test('a noise map holds the grid of whole yards it was made over', async () => {
		const f = fakeHost()
		const code = 'local m = make_noise(10, 20, 4, 3, 0.1, "simplex", "seed")\nprint(m:width(), m:height(), m:start())\nprint(m:get(vec(10, 0, 20)), m:get(vec(13.4, 0, 21.6)))'
		expect((await runScript(code, 'n', f.host)).error).toBeUndefined()
		expect(f.out[0]).toBe('4\t3\tvec(10, 0, 20)')
		const grid = noiseGrid('SIMPLEX', 10, 20, 4, 3, 0.1, 0)
		const [a, b] = f.out[1].split('\t').map(Number)
		expect(a).not.toBe(b)
		// The same seed string gives the same map.
		await runScript(code, 'n', f.host)
		expect(f.out[3]).toBe(f.out[1])
		expect(grid.length).toBe(12)
	})

	test('reading past the map is an error, as is an unknown algorithm', async () => {
		const out = await runScript('local m = make_noise(0, 0, 2, 2, 1, "VALUE", "s")\nm:get(vec(2, 0, 0))', 'n', fakeHost().host)
		expect(out.error).toContain('n:2: noisemap:get: noise coordinates out of bounds: x=2 z=0 width=2 height=2')
		const bad = await runScript('make_noise(0, 0, 2, 2, 1, "PLASMA", "s")', 'n', fakeHost().host)
		expect(bad.error).toContain('n:1: make_noise: unknown noise algorithm "PLASMA"')
	})

	test("FastNoise2's encoded trees fall back to FRACTAL, said once", async () => {
		const f = fakeHost()
		const code =
			'local sel = select_origin(vec(8, 0, 8), 4)\nfor i = 1, 3 do local m = sel:make_noise(0.01, "HgANAAUAAAAAAABAEAAAAAA/CAAAAACAPwAAAAA/AAAAAAABEwBI4RpAGwANAAMAAAAAAABACAAAAAAAPwAAAAAAAI/C9Tw=", "noggit") assert(m:width() == 12) end'
		expect((await runScript(code, 'n', f.host)).error).toBeUndefined()
		expect(f.out).toEqual(["make_noise: FastNoise2's encoded node trees can't be read in Meld; FRACTAL noise is used instead."])
	})

	test("is_highest checks Noggit Red's square around the point", async () => {
		const f = fakeHost()
		const code = `
local m = make_noise(0, 0, 5, 5, 1, "WHITE", "s")
for x = 0, 4 do for z = 0, 4 do m:set(x, z, 0) end end
m:set(2, 2, 1)
print(m:is_highest(vec(2, 0, 2), 2), m:is_highest(vec(1, 0, 1), 1), m:is_highest(vec(3, 0, 3), 1))
print(pcall(function() local r = m:is_highest(vec(0, 0, 0), 1) return r end))`
		expect((await runScript(code, 'n', f.host)).error).toBeUndefined()
		// (1, 1) checks 0..1 each way, which leaves out (2, 2); (3, 3) checks 2..3 and finds it.
		expect(f.out[0]).toBe('true\ttrue\tfalse')
		expect(f.out[1]).toContain('false\tn:6: noisemap:is_highest: noise coordinates out of bounds: x=-1')
	})

	test('noise maps are freed when Lua collects them', async () => {
		const { session } = await openScript('local b = brush("x") function b:on_left_hold() for i = 1, 50 do make_noise(0, 0, 8, 8, 1, "VALUE", "s") end collectgarbage() collectgarbage() end', 'n', fakeHost().host)
		await session!.event(0, 'left_hold', at(0, 0))
		expect(session!.held).toBeLessThan(5)
		session!.close()
	})

	test('every algorithm stays about in -1..1 and varies', () => {
		for (const name of NOISE_NAMES) {
			const g = noiseGrid(name, -50, -50, 100, 100, 0.07, 1234)
			let lo = Infinity
			let hi = -Infinity
			for (const v of g) {
				lo = Math.min(lo, v)
				hi = Math.max(hi, v)
			}
			expect(lo).toBeGreaterThanOrEqual(-1.01)
			expect(hi).toBeLessThanOrEqual(1.01)
			expect(hi - lo).toBeGreaterThan(0.5)
		}
	})
})

describe('images (#29)', () => {
	test('create_image, its pixels and channels', async () => {
		const f = fakeHost()
		const code = `
local img = create_image(4, 2)
img:set_pixel_floats(1, 1, 1, 0.5, 0, 1)
img:set_pixel(3, 0, 0x10203040)
print(img:width(), img:height(), img:get_red(1, 1), img:get_alpha(0, 0))
print(string.format("%x", img:get_pixel(3, 0)), img:get_green(3, 0) * 255, img:gradient_scale(0.8) * 255)
print(pcall(function() return img:get_red(4, 0) end))`
		const r = await runScript(code, 'i', f.host)
		expect(r.error).toBeUndefined()
		// A whole number that crossed from JavaScript prints with or without the .0.
		expect(f.out[0]).toMatch(/^4\t2\t1(\.0)?\t0(\.0)?$/)
		expect(f.out[1]).toMatch(/^10203040\t32(\.0)?\t16(\.0)?$/)
		expect(f.out[2]).toContain('i:7: image:get_red: image coordinates out of bounds: x=4 y=0 width=4 height=2')
	})

	test('load_png waits for the host to read the file', async () => {
		const f = fakeHost()
		let asked = ''
		f.host.loadImage = async (path) => {
			asked = path
			await new Promise((r) => setTimeout(r, 5))
			return path === 'missing.png' ? 'missing.png was not found' : { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) }
		}
		const r = await runScript('local img = load_png("brushes/dot.png")\nprint(img:width(), img:get_red(0, 0), img:get_blue(1, 0), img:get_alpha(1, 0) > 0.5)\nload_png("missing.png")', 'i', f.host)
		expect(asked).toBe('missing.png')
		expect(f.out[0]).toMatch(/^2\t1(\.0)?\t1(\.0)?\ttrue$/)
		expect(r.error).toContain('i:3: load_png: missing.png was not found')
	})

	test('load_png in a brush event waits too, and without a host to read files it says so', async () => {
		const f = fakeHost()
		f.host.loadImage = async () => ({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) })
		const { session } = await openScript('local b = brush("p") function b:on_left_click() print(load_png("a.png"):width()) end', 'p', f.host)
		expect((await session!.event(0, 'left_click', at(0, 0))).ok).toBe(true)
		expect(f.out[0]).toBe('1')
		session!.close()
		const none = await runScript('load_png("a.png")', 'p', fakeHost().host)
		expect(none.error).toContain('load_png: images can only be read in the desktop app')
	})
})
