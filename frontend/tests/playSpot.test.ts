// Run with: bun test tests/playSpot.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playSpot } from '../src/lib/cubes/play.ts'

const eye = { x: 3, y: 4, z: 5 }
  test('looking north is yaw 0, level', () => {
    const s = playSpot(eye, { x: 0, y: 0, z: -1 })
    assert.deepEqual(s, { X: 3, Y: 4, Z: 5, Yaw: 0, Pitch: 0 })
  })
  test('looking west (-x) is a quarter turn counter-clockwise', () => {
    assert.ok(Math.abs(playSpot(eye, { x: -1, y: 0, z: 0 }).Yaw - (Math.PI / 2)) < 1e-9)
  })
  test('looking south is half a turn', () => {
    assert.ok(Math.abs(Math.abs(playSpot(eye, { x: 0, y: 0, z: 1 }).Yaw) - (Math.PI)) < 1e-9)
  })
  test('looking down is a negative pitch', () => {
    assert.ok(Math.abs(playSpot(eye, { x: 0, y: -1, z: -1 }).Pitch - (-Math.PI / 4)) < 1e-9)
  })
