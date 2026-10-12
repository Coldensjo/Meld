// Run with: node --import ./tests/register.mjs --test tests/portCoords.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPortCoords } from '../src/lib/io/portCoords.ts'

const ZP = 32 * (533 + 1 / 3)

test('the origin of the map sits at the client zero point', () => {
  const text = formatPortCoords({ x: 0, y: 0, z: 0 }, 1)
  assert.equal(text, `Trinity:\n.go xyz ${ZP.toFixed(2)} ${ZP.toFixed(2)} 0.00 1\nArcEmu:\n.worldport 1 ${ZP.toFixed(2)} ${ZP.toFixed(2)} 0.00\n`)
})

test('x and z swap and mirror into the client, and height stays y', () => {
  const text = formatPortCoords({ x: 100, y: 25.5, z: 200 }, 530)
  assert.equal(text, `Trinity:\n.go xyz ${(ZP - 200).toFixed(2)} ${(ZP - 100).toFixed(2)} 25.50 530\nArcEmu:\n.worldport 530 ${(ZP - 200).toFixed(2)} ${(ZP - 100).toFixed(2)} 25.50\n`)
})

test('values are rounded to two decimals', () => {
  const text = formatPortCoords({ x: 1.005, y: 3.14159, z: 0 }, 0)
  assert.match(text, /\.go xyz \S+ \S+ 3\.14 0$/m)
})
