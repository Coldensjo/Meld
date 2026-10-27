import './runes.ts'
import { describe, expect, test } from 'bun:test'
import { EngineScriptHost, type ScriptView } from '../src/lib/engine/ScriptRun.ts'
import { runScript } from '../src/lib/script/scriptApi.ts'
import { Terrain } from '../src/lib/terrain/Terrain.ts'
import { SLOTS } from '../src/lib/terrain/chunkPaint.ts'
import { CHUNK_IMPASSABLE } from '../src/lib/terrain/chunkFlags.ts'
import { ObjectLayer } from '../src/lib/world/ObjectLayer.ts'
import { LiquidMap } from '../src/lib/water/liquids.ts'
import type { Command } from '../src/lib/state/history.ts'

// The script API's chunks, texture layers, holes, zones and water (#760) on the editor's own host, over a
// 16-cell map (2 by 2 chunks, 64 texels a side, 32 a chunk), cells 2 yards: a chunk is 16 yards.

const BASE = 'Tileset\\Base.blp'

function world() {
	const t = new Terrain(16, 2)
	const objects = new ObjectLayer(t)
	const liquids = new LiquidMap(16)
	let palette: string[] = [BASE]
	const out: string[] = []
	const view: ScriptView = {
		print: (s) => out.push(s),
		camera: () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0 }),
		target: () => ({ x: 0, y: 0, z: 0 }),
		mapId: 0,
		areaAt: () => 0,
		area: null,
		loadImage: async () => 'no files here',
		palette: () => palette,
		setPalette: (p) => (palette = p),
		effect: (tex) => 100 + tex,
	}
	const run = async (code: string) => {
		const host = new EngineScriptHost(t, objects, liquids, view, 'Script t')
		const r = await runScript(code, 't', host)
		return { r, cmd: host.finish('Script t') as Command }
	}
	return { t, liquids, out, run, palette: () => palette }
}

/** The weight of slot k at texel (x, z). */
const weight = (t: Terrain, x: number, z: number, k: number) => t.weights[(z * t.splatRes + x) * SLOTS + k]

describe('Lua scripts: chunks and textures', () => {
	test('chunks list their textures, take new ones as layers, and undo as one step', async () => {
		const w = world()
		const { r, cmd } = await w.run(`
			local c = get_chunk(vec(20, 0, 4))
			print(c:get_texture_count(), c:get_texture(0))
			print(c:add_texture('Tileset/Grass.blp'), c:add_texture('tileset\\\\grass.blp'), c:add_texture('Tileset/Rock.blp', 5))
			print(c:get_texture_count(), c:get_texture(2), c:get_effect(1))
			c:set_area_id(12)
			c:set_impassable(true)
			print(c:get_area_id(), #select_between(vec(0, 0, 0), vec(20, 0, 4)):chunks())
			c:remove_texture(1)
			print(c:get_texture_count(), c:get_texture(1))
		`)
		expect(r.error).toBeUndefined()
		// The note comes as the third add_texture runs, before its line prints.
		expect(w.out).toEqual([
			'1\ttileset/base.blp',
			"chunk:set_effect: Meld keeps one ground effect per texture (Texture Properties), not per chunk layer, so the effect didn't change.",
			'1\t1\t2',
			'3\ttileset/rock.blp\t101',
			'12\t2',
			'2\ttileset/rock.blp',
		])
		// Chunk 1 (x 16..32, z 0..16): the base, then Rock, packed into the first slots.
		expect(w.palette()).toEqual([BASE, 'Tileset\\Grass.blp', 'Tileset\\Rock.blp'])
		expect([...w.t.chunkSlots.subarray(SLOTS, SLOTS * 2)]).toEqual([0, 2, 255, 255])
		expect(w.t.areaIds[1]).toBe(12)
		expect(w.t.chunkFlags[1] & CHUNK_IMPASSABLE).toBe(CHUNK_IMPASSABLE)
		cmd.undo()
		expect(w.palette()).toEqual([BASE])
		expect([...w.t.chunkSlots.subarray(SLOTS, SLOTS * 2)]).toEqual([0, 255, 255, 255])
		expect(w.t.areaIds[1]).toBe(0)
		expect(w.t.chunkFlags[1]).toBe(0)
		cmd.redo()
		expect(w.t.areaIds[1]).toBe(12)
		expect([...w.t.chunkSlots.subarray(SLOTS, SLOTS * 2)]).toEqual([0, 2, 255, 255])
	})

	test('an empty layer added by a script stays for a later one to paint, and a full chunk gives -1', async () => {
		const w = world()
		await w.run(`local c = get_chunk(vec(1, 0, 1)) for i = 1, 3 do c:add_texture('T/L' .. i .. '.blp') end print(c:add_texture('T/L4.blp'))`)
		expect(w.out).toEqual(['-1'])
		expect([...w.t.chunkSlots.subarray(0, SLOTS)]).toEqual([0, 1, 2, 3])
		expect(weight(w.t, 0, 0, 0)).toBe(255)
		const { r } = await w.run(`
			local c = get_chunk(vec(1, 0, 1))
			c:clear_textures()
			print(c:get_texture_count())
			print(c:add_texture('T/L2.blp'), c:get_tex(0):get_alpha(0) == 1)
		`)
		expect(r.error).toBeUndefined()
		expect(w.out.slice(1)).toEqual(['0', '0\ttrue'])
		expect(weight(w.t, 31, 31, 0)).toBe(255)
	})

	test('texel alphas: the layers above the base keep theirs, the base takes the rest', async () => {
		const w = world()
		const { r, cmd } = await w.run(`
			local c = get_chunk(vec(1, 0, 1))
			c:add_texture('T/Grass.blp')
			c:add_texture('T/Rock.blp')
			local s = select_between(vec(0, 0, 0), vec(2, 0, 2))
			local texels = s:tex()
			print(#texels, texels[2]:get_pos_2d())
			for _, t in ipairs(texels) do t:set_alpha(1, 0.5) t:set_alpha(2, 0.8) end
			s:apply()
			local t = select_between(vec(0, 0, 0), vec(0, 0, 0)):tex()[1]
			print(string.format('%.2f %.2f %.2f', t:get_alpha(0), t:get_alpha(1), t:get_alpha(2)))
			print(c:get_tex(64 * 2 + 2):get_pos_2d())
		`)
		expect(r.error).toBeUndefined()
		// A texel is half a yard: corners 0, 0.5 ... 2 make 5 by 5.
		expect(w.out[0]).toBe('25\tvec(0.5, 0, 0)')
		// 0.5 of 255 rounds to 128, and 0.8 is cut to the 127 left.
		expect(w.out[1]).toBe('0.00 0.50 0.50')
		expect(w.out[2]).toBe('vec(0.5, 0, 0.5)')
		expect([weight(w.t, 0, 0, 0), weight(w.t, 0, 0, 1), weight(w.t, 0, 0, 2)]).toEqual([0, 128, 127])
		expect(weight(w.t, 5, 0, 0)).toBe(255)
		cmd.undo()
		expect(weight(w.t, 0, 0, 0)).toBe(255)
		expect(weight(w.t, 0, 0, 1)).toBe(0)
	})

	test('vert alphas set the texels nearest the vertex, and paint_texture adds an image to a layer', async () => {
		const w = world()
		const { r } = await w.run(`
			local c = get_chunk(vec(1, 0, 1))
			c:add_texture('T/Grass.blp')
			local v = select_between(vec(4, 0, 4), vec(4, 0, 4)):verts()[1]
			v:set_alpha(1, 1)
			print(v:get_alpha(1) == 1, v:get_alpha(0) == 1)
			local img = create_image(4, 4)
			for x = 0, 3 do for y = 0, 3 do img:set_pixel_floats(x, y, 1, 1, 1, 1) end end
			local s = select_origin(vec(12, 0, 12), 2, 2)
			procedures:paint_texture(s, img, 1, 1, 0)
			procedures.paint_texture(s, img, 1, 1, 0)
			s:apply()
		`)
		expect(r.error).toBeUndefined()
		expect(w.out[0]).toBe('true\ttrue')
		// Vertex (2, 2) is at 4 yards: the texels 6..9 a side are nearest it.
		expect(weight(w.t, 6, 6, 1)).toBe(255)
		expect(weight(w.t, 9, 9, 1)).toBe(255)
		expect(weight(w.t, 10, 9, 1)).toBe(0)
		expect(weight(w.t, 5, 6, 1)).toBe(0)
		// At the middle the image adds its full red each call; near the edge it fades.
		expect(weight(w.t, 24, 24, 1)).toBe(255)
		expect(weight(w.t, 21, 24, 1)).toBeGreaterThan(0)
		expect(weight(w.t, 21, 24, 1)).toBeLessThan(255)
	})
})

describe('Lua scripts: holes, water and colours', () => {
	test('holes by the chunk and by the vertex, undone together', async () => {
		const w = world()
		const { r, cmd } = await w.run(`
			get_chunk(vec(20, 0, 20)):set_hole(true)
			select_between(vec(6, 0, 2), vec(6, 0, 2)):verts()[1]:set_hole(true)
		`)
		expect(r.error).toBeUndefined()
		const hole = (x: number, z: number) => w.t.holes[z * 16 + x]
		// Chunk 3 is cells 8..15 both ways; vertex (3, 1) cuts the block of cells 2..3, 0..1.
		expect(hole(8, 8)).toBe(1)
		expect(hole(15, 15)).toBe(1)
		expect(hole(7, 8)).toBe(0)
		expect([hole(2, 0), hole(3, 1), hole(4, 1), hole(2, 2)]).toEqual([1, 1, 0, 0])
		cmd.undo()
		expect(w.t.holes.every((v) => v === 0)).toBe(true)
	})

	test('set_water puts liquid at a vertex, at its height; type 0 takes it away', async () => {
		const w = world()
		const { r, cmd } = await w.run(`
			local v = select_between(vec(4, 0, 4), vec(4, 0, 4)):verts()[1]
			print(v:is_water_aligned())
			v:set_water(1, 3)
		`)
		expect(r.error).toBeUndefined()
		expect(w.out).toEqual(['true'])
		const layers = w.liquids.layers(0)
		expect(layers.length).toBe(1)
		expect(layers[0].id).toBe(1)
		// Vertex (2, 2): the four cells about it are covered, its surface at 3.
		expect([layers[0].cells[1 * 8 + 1], layers[0].cells[2 * 8 + 2], layers[0].cells[3 * 8 + 3]]).toEqual([1, 1, 0])
		expect(layers[0].heights[2 * 9 + 2]).toBe(3)
		cmd.undo()
		expect(w.liquids.layers(0).length).toBe(0)
		cmd.redo()
		await w.run(`select_between(vec(4, 0, 4), vec(4, 0, 4)):verts()[1]:set_water(0, 0)`)
		expect(w.liquids.layers(0).length).toBe(0)
	})

	test('vertex colours: 1.12 has none, said once', async () => {
		const w = world()
		const { r, cmd } = await w.run(`
			for _, v in ipairs(select_between(vec(0, 0, 0), vec(4, 0, 4)):verts()) do v:set_color(1, 0, 0) end
			get_chunk(vec(0, 0, 0)):clear_colors()
			print(select_between(vec(0, 0, 0), vec(0, 0, 0)):verts()[1]:get_color())
		`)
		expect(r.error).toBeUndefined()
		expect(w.out).toEqual(['vert:set_color: 1.12 tiles have no vertex colours, so Meld keeps none.', 'chunk:clear_colors: 1.12 tiles have no vertex colours, so Meld keeps none.', 'vec(1, 1, 1)'])
		expect(cmd).toBeNull()
	})

	test('get_chunk off the map and a bad layer are errors at the line', async () => {
		const w = world()
		let res = await w.run('\nget_chunk(vec(40, 0, 0))')
		expect(res.r.error).toContain('t:2: get_chunk: (40, 0) is off the map')
		res = await w.run('get_chunk(vec(0, 0, 0)):get_texture(1)')
		expect(res.r.error).toContain('t:1: chunk:get_texture: texture index out of range')
		res = await w.run('select_origin(vec(2, 0, 2), 1):tex()[1]:set_alpha(4, 1)')
		expect(res.r.error).toContain('t:1: tex:set_alpha: invalid texture layer: 4')
	})
})
