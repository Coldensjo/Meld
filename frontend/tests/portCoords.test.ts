// Run with: node --import ./tests/register.mjs --test tests/portCoords.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPortCoords, teleportCommand } from '../src/lib/io/portCoords.ts'

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
