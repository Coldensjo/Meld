import { describe, expect, test } from 'bun:test'
import { runScript, type ScriptHost, type ScriptModel } from '../src/lib/script/scriptApi'

/** A host over a flat `verts`×`verts` grid, `cell` yards apart, and a list of models. */
function fakeHost(verts = 9, cell = 2) {
	const heights = new Array<number>(verts * verts).fill(0)
	const models: ScriptModel[] = []
	const out: string[] = []
	let next = 1
	let heightWrites = 0
	const host: ScriptHost = {
		print: (s) => out.push(s),
		terrain: () => ({ verts, cell }),
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
		const r = await runScript('brush("x")', 'b', fakeHost().host)
		expect(r.error).toContain('brush (script brushes) is not in Meld yet')
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
