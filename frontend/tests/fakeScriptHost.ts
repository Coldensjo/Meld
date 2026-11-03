// A script host over a flat grid and a list of models, for the tests of Lua scripts and node graphs.
import type { ScriptHost, ScriptModel } from '../src/lib/script/scriptApi'

/** A host over a flat `verts`×`verts` grid, `cell` yards apart, and a list of models. */
export function fakeHost(verts = 9, cell = 2) {
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
		chunkSetEffect: () => {},
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
