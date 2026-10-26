// Run with: bun test tests/portCoords.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPortCoords, serverSpot, teleportCommand, wmoOnlyTiles } from '../src/lib/io/portCoords.ts'

const ZP = 32 * (533 + 1 / 3)

test('the origin of the map sits at the client zero point', () => {
	const text = formatPortCoords({ x: 0, y: 0, z: 0 }, 1)
	assert.equal(text, `Map: Unknown area on ADT 0 0\nTrinity:\n.go xyz ${ZP.toFixed(2)} ${ZP.toFixed(2)} 0.00 1\nArcEmu:\n.worldport 1 ${ZP.toFixed(2)} ${ZP.toFixed(2)} 0.00\n`)
})

test('x and z swap and mirror into the client, and height stays y', () => {
	const text = formatPortCoords({ x: 100, y: 25.5, z: 200 }, 530)
	assert.equal(text, `Map: Unknown area on ADT 0 0\nTrinity:\n.go xyz ${(ZP - 200).toFixed(2)} ${(ZP - 100).toFixed(2)} 25.50 530\nArcEmu:\n.worldport 530 ${(ZP - 200).toFixed(2)} ${(ZP - 100).toFixed(2)} 25.50\n`)
})

test('the first line names the zone and the tile the point is in', () => {
	const text = formatPortCoords({ x: 600, y: 0, z: 1100 }, 0, 'Goldshire, Elwynn Forest')
	assert.equal(text.split('\n')[0], 'Map: Goldshire, Elwynn Forest on ADT 1 2')
})

test('values are rounded to two decimals', () => {
	const text = formatPortCoords({ x: 1.005, y: 3.14159, z: 0 }, 0)
	assert.match(text, /\.go xyz \S+ \S+ 3\.14 0$/m)
})

test("the teleport command adds a region's first tile: Northshire Abbey in Azeroth 32_48", () => {
	// The abbey stands at about (182, 81, 353) in the region; the client has it near (-8887, -182, 81) on map 0.
	assert.equal(teleportCommand({ x: 182, y: 81, z: 353 }, 0, 32, 48), '.go xyz -8886.33 -182.00 81.00 0')
	assert.equal(teleportCommand({ x: 100, y: 25.5, z: 200 }, 530), `.go xyz ${(ZP - 200).toFixed(2)} ${(ZP - 100).toFixed(2)} 25.50 530`)
})

test("a server spot is the teleport's point, on the region's map", () => {
	const s = serverSpot({ x: 182, y: 81, z: 353 }, 0, 32, 48)
	assert.equal(s.map, 0)
	assert.equal(s.x.toFixed(2), '-8886.33')
	assert.equal(s.y.toFixed(2), '-182.00')
	assert.equal(s.z, 81)
})

test('a server spot faces where the camera looks', () => {
	// The camera looks along (-sin yaw, -cos yaw) in the editor: yaw 0 looks to -z, the server's +x (facing 0).
	const at = { x: 0, y: 0, z: 0 }
	const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`)
	close(serverSpot(at, 0, 0, 0, 0).o, 0)
	// Yaw a quarter turn looks to -x, the server's +y: facing a quarter turn.
	close(serverSpot(at, 0, 0, 0, Math.PI / 2).o, Math.PI / 2)
	// Any yaw comes out in [0, 2π).
	close(serverSpot(at, 0, 0, 0, -Math.PI / 2).o, (3 * Math.PI) / 2)
	close(serverSpot(at, 0, 0, 0, 5 * Math.PI).o, Math.PI)
})

test('a WMO-only map made with New World puts its building at the server 0,0 (#272)', () => {
	const building = { x: 266.5, y: 12, z: 410 }
	const t = wmoOnlyTiles(building)
	const s = serverSpot(building, 1902, t.x, t.y)
	assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.y) < 1e-9, `${s.x}, ${s.y}`)
	assert.equal(s.z, 12)
	// A point 10 yards east of it in the editor (+x) is 10 yards to the server's -y.
	const east = serverSpot({ x: building.x + 10, y: 0, z: building.z }, 1902, t.x, t.y)
	assert.ok(Math.abs(east.y + 10) < 1e-9 && Math.abs(east.x) < 1e-9, `${east.x}, ${east.y}`)
	assert.equal(teleportCommand(building, 1902, t.x, t.y), '.go xyz 0.00 0.00 12.00 1902')
})

test('the port commands of a map placed on the grid (#46) name its tile and point on the server', () => {
	const text = formatPortCoords({ x: 100, y: 5, z: 200 }, 1900, '', 31, 31).split('\n')
	assert.equal(text[0], 'Map: Unknown area on ADT 31 31')
	assert.equal(text[2], teleportCommand({ x: 100, y: 5, z: 200 }, 1900, 31, 31))
	// Tile 31's corner is a tile short of the world's middle on both axes.
	assert.equal(text[2], `.go xyz ${(533 + 1 / 3 - 200).toFixed(2)} ${(533 + 1 / 3 - 100).toFixed(2)} 5.00 1900`)
})
