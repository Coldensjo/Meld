// Run with: bun test tests/mapIdentity.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { MapIdentity, fileFrameOffset, tileOrigin, type MapPlace, type MapRow } from '../src/lib/engine/MapIdentity.ts'
import { TILE_YARDS } from '../src/lib/wow/format.ts'
import type { RegionRef, VmangosRef } from '../src/lib/engine/MapDocument.ts'

const ROWS: MapRow[] = [
	{ Dir: 'Azeroth', ID: 0, Type: 0 },
	{ Dir: 'Kalimdor', ID: 1, Type: 0 },
	{ Dir: 'Uldaman', ID: 70, Type: 1 },
]

const region = (mapName: string, x = 0, y = 0) => ({ mapName, x, y, size: 2 }) as RegionRef
const vmangos = (mapId: number, tileX?: number, tileY?: number) => ({ dir: 'Mine', mapId, tileX, tileY }) as VmangosRef
const place = (meta: Partial<MapPlace['meta']>, world: MapPlace['world'] = null): MapPlace => ({ meta: { region: null, vmangos: null, ...meta }, world })

/** A map list whose reads are counted, answered with `ROWS` or failed by hand. */
function setup() {
	let time = 0
	const reads: { resolve: (r: MapRow[]) => void; reject: (e: unknown) => void }[] = []
	const failures: unknown[] = []
	const maps = new MapIdentity(
		() => new Promise<MapRow[]>((resolve, reject) => reads.push({ resolve, reject })),
		(e) => failures.push(e),
		() => time,
	)
	return { maps, reads, failures, wait: (ms: number) => (time += ms) }
}

test('a map of its own is 0 and a client map its own ID, without the list', () => {
	const { maps, reads } = setup()
	assert.equal(maps.idOf(place({})), 0)
	assert.equal(maps.idOf(place({ vmangos: vmangos(901) })), 901)
	assert.equal(reads.length, 0)
})

test("a region's and a world view's map are found by folder once the list is read, in any case", async () => {
	const { maps, reads } = setup()
	assert.equal(maps.idOf(place({ region: region('kalimdor') })), null)
	assert.equal(reads.length, 1)
	// A second ask while it is read starts no second read.
	assert.equal(maps.idOf(place({}, { mapName: 'Kalimdor' })), null)
	assert.equal(reads.length, 1)
	reads[0].resolve(ROWS)
	await maps.load()
	assert.equal(maps.idOf(place({ region: region('KALIMDOR') })), 1)
	assert.equal(maps.idOf(place({}, { mapName: 'Kalimdor' })), 1)
	assert.equal(maps.idOf(place({ region: region('Nowhere') })), null)
	assert.equal(maps.idByFolder('uldaman'), 70)
	assert.equal(maps.typeOf('Uldaman'), 1)
	assert.equal(maps.typeOf('Nowhere'), -1)
})

test('resolve waits for the list', async () => {
	const { maps, reads } = setup()
	const id = maps.resolve(place({ region: region('Azeroth') }))
	reads[0].resolve(ROWS)
	assert.equal(await id, 0)
})

test('a failed read leaves the list unknown, says so once and is tried again only after a while', async () => {
	const { maps, reads, failures, wait } = setup()
	const r = place({ region: region('Azeroth') })
	const id = maps.resolve(r)
	reads[0].reject(new Error('no client'))
	assert.equal(await id, null)
	assert.equal(failures.length, 1)
	// Never an empty list, which would make every folder unknown for good.
	assert.equal(maps.idByFolder('Azeroth'), undefined)
	assert.equal(maps.typeOf('Azeroth'), null)
	assert.equal(maps.idOf(r), null)
	assert.equal(reads.length, 1)
	wait(10001)
	assert.equal(maps.idOf(r), null)
	assert.equal(reads.length, 2)
	reads[1].resolve(ROWS)
	await maps.load()
	assert.equal(maps.idOf(r), 0)
})

test("a map's tile origin and its offset into the tiles' frame", () => {
	assert.deepEqual(tileOrigin(place({ region: region('Azeroth', 32, 48) }).meta, { x: 0, y: 0 }), { x: 32, y: 48 })
	assert.deepEqual(tileOrigin(place({ vmangos: vmangos(901, 30, 31) }).meta, { x: 0, y: 0 }), { x: 30, y: 31 })
	assert.deepEqual(tileOrigin(place({ vmangos: vmangos(901) }).meta, { x: 0, y: 0 }), { x: 0, y: 0 })
	assert.deepEqual(tileOrigin(place({}).meta, { x: 5, y: 5 }), { x: 0, y: 0 })
	const out = { x: 0, y: 0 }
	assert.equal(fileFrameOffset(place({ region: region('Azeroth', 32, 48) }).meta, out), out)
	assert.deepEqual(out, { x: 32 * TILE_YARDS, y: 48 * TILE_YARDS })
})
