// Run with: bun test tests/prefabs.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPrefab, parsePrefab, prefabClip, prefabHash, type Prefab } from '../src/lib/wow/prefabs.ts'
import { turnObjectClip } from '../src/lib/world/clipTurn.ts'

const camp = (): Prefab => ({
	name: 'Campfire',
	objects: [
		{ type: 'm2:World\\Generic\\Human\\Passive Doodads\\Campfire\\Campfire.m2', cid: 1, x: 0, yOff: 0, z: 0, rotY: 0, scale: 1 },
		{ type: 'm2:World\\Generic\\Human\\Passive Doodads\\Crates\\Crate01.m2', cid: 2, x: 2.5, yOff: -0.1, z: -1.25, rotY: 0.7, scale: 1.2, tiltX: 0.1, tiltZ: -0.05, group: 4 },
		{ type: 'm2:World\\Generic\\Human\\Passive Doodads\\Food\\Bread01.m2', cid: 3, cparent: 2, x: 0, yOff: 0.8, z: 0, rotY: 0, scale: 1 },
	],
})

test('a prefab round-trips through its TOML, with literal strings for the client paths', () => {
	const p = camp()
	const text = formatPrefab(p)
	assert.match(text, /type = 'm2:World\\Generic\\Human\\Passive Doodads\\Campfire\\Campfire\.m2'/)
	const { prefab, errors } = parsePrefab(text)
	assert.deepEqual(errors, [])
	assert.deepEqual(prefab, p)
})

test('a broken model is reported and left out with what hangs on it', () => {
	const text = formatPrefab(camp()).replace("type = 'm2:World\\Generic\\Human\\Passive Doodads\\Crates\\Crate01.m2'", "type = 'crate'")
	const { prefab, errors } = parsePrefab(text)
	assert.equal(prefab?.objects.length, 1)
	assert.equal(errors.length, 2, errors.join('; '))
	assert.equal(parsePrefab('name = "x"').prefab, null)
	assert.equal(parsePrefab('not toml [').prefab, null)
})

test('a varied placement turns and scales roots, drops some, and keeps at least one', () => {
	const p = camp()
	assert.deepEqual(prefabClip(p, null).objects, p.objects)
	let seed = 1
	const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
	const v = prefabClip(p, { turn: 20, scale: 0.1, drop: 0 }, rand)
	assert.equal(v.objects.length, 3)
	for (const o of v.objects.filter((o) => o.cparent === undefined)) {
		const base = p.objects.find((b) => b.cid === o.cid)!
		assert.ok(Math.abs(o.rotY - base.rotY) <= (20 * Math.PI) / 180 + 1e-9)
		assert.ok(o.scale >= base.scale * 0.9 - 1e-9 && o.scale <= base.scale * 1.1 + 1e-9)
		assert.equal(o.x, base.x, 'roots stay where they were')
	}
	const all = prefabClip(p, { turn: 0, scale: 0, drop: 1 }, rand)
	assert.equal(all.objects.filter((o) => o.cparent === undefined).length, 1, 'one root always stays')
	const bread = all.objects.find((o) => o.cid === 3)
	assert.ok(!bread || all.objects.some((o) => o.cid === 2), 'the bread goes with its crate')
})

test('turning a model clip spins the roots about the anchor and leaves attached models alone', () => {
	const p = camp()
	const t = turnObjectClip({ objects: p.objects }, Math.PI / 2)
	const crate = t.objects.find((o) => o.cid === 2)!
	assert.ok(Math.abs(crate.x - 1.25) < 1e-9 && Math.abs(crate.z - 2.5) < 1e-9, `${crate.x}, ${crate.z}`)
	assert.ok(Math.abs(crate.rotY - (0.7 - Math.PI / 2)) < 1e-9)
	assert.deepEqual(
		t.objects.find((o) => o.cid === 3),
		p.objects[2],
	)
	assert.notEqual(prefabHash('a'), prefabHash('b'))
})
