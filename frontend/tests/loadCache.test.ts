// Run with: bun test tests/loadCache.test.ts
// A client file that fails to load or decode (a WMO's room data, a model's collision) is warned,
// counted and tried again after RETRY_MS rather than left "loading" for the session (#515).
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { LoadCache, RETRY_MS } from '../src/lib/wow/loadCache.ts'
import { decodeWmoNav, type WmoNav } from '../src/lib/world/wmoRoom.ts'

/** A /wow/wmonav body whose header promises `walk` floor faces that the body doesn't hold (`faces` of them are there). */
function navBody(walk: number, faces = 0): ArrayBuffer {
	const header = JSON.stringify({
		groups: [{ flags: 0, min: [0, 0, 0], max: [1, 1, 1], refStart: 0, refCount: 0, fogs: [0, 0, 0, 0], name: '', walk, camera: 0 }],
		portalVerts: [],
		portals: [],
		refs: [],
		fogs: [],
	})
	// Padded so the faces start on a 4-byte boundary, as Go writes them.
	const json = new TextEncoder().encode(header.padEnd(Math.ceil(header.length / 4) * 4, ' '))
	const buf = new ArrayBuffer(4 + json.length + faces * 36)
	new DataView(buf).setUint32(0, json.length, true)
	new Uint8Array(buf, 4).set(json)
	return buf
}

const settle = () => new Promise((r) => setTimeout(r, 0))

let warn: ReturnType<typeof spyOn>
beforeEach(() => {
	warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

test('a truncated room data body fails, is warned and counted, and is tried again only after RETRY_MS', async () => {
	let clock = 1000
	let body = navBody(2)
	let loads = 0
	const cache = new LoadCache<WmoNav>(
		'WMO room data',
		async () => {
			loads++
			return decodeWmoNav(body)
		},
		() => clock,
	)
	const fails: string[] = []
	cache.onFail = (path) => fails.push(path)

	expect(cache.get('world/a.wmo', 'World/A.wmo')).toBeNull()
	expect(cache.loading).toBe(1)
	await settle()
	expect(cache.loading).toBe(0)
	expect(cache.settled).toBe(1)
	expect(cache.failed).toBe(1)
	expect(fails).toEqual(['World/A.wmo'])
	expect(warn).toHaveBeenCalledTimes(1)
	expect(String(warn.mock.calls[0][2])).toContain('run past')

	// Asked every frame, it isn't fetched again until RETRY_MS has passed.
	clock += RETRY_MS - 1
	expect(cache.get('world/a.wmo', 'World/A.wmo')).toBeNull()
	expect(loads).toBe(1)

	clock += 1
	body = navBody(2, 2)
	expect(cache.get('world/a.wmo', 'World/A.wmo')).toBeNull()
	expect(loads).toBe(2)
	await settle()
	expect(cache.failed).toBe(0)
	expect(cache.get('world/a.wmo')?.walk[0].length).toBe(18)
	expect(loads).toBe(2)
})

test('a value forgotten while it loads is dropped when it arrives', async () => {
	const cache = new LoadCache<number>('test', async () => 1)
	expect(cache.get('a')).toBeNull()
	cache.forget('a')
	await settle()
	expect(cache.settled).toBe(1)
	// Not kept: the next ask loads it again.
	expect(cache.get('a')).toBeNull()
	expect(cache.loading).toBe(1)
	await settle()
	expect(cache.get('a')).toBe(1)
})
