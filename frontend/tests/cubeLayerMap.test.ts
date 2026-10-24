// Run with: bun test tests/cubeLayerMap.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CubeWorld, GROUND_LAYER, LAYER_COUNT, kindId } from '../src/lib/cubes/world.ts'
import { layerBottom } from '../src/lib/cubes/mesher.ts'
import { drawLayerMap, layerAtHeight } from '../src/lib/cubes/layerMap.ts'
import { CubeLayer } from '../src/lib/cubes/CubeLayer.ts'

const STONE = kindId('stone')
const WOOD = kindId('wood')
const LAVA = kindId('lava')

const pixel = (out: Uint8ClampedArray, side: number, x: number, z: number) => Array.from(out.subarray((z * side + x) * 4, (z * side + x) * 4 + 4))

test('the layer of a height: each layer from its bottom up to the next, held to 0 and 30', () => {
	for (let layer = 0; layer < LAYER_COUNT; layer++) {
		assert.equal(layerAtHeight(layerBottom(layer)), layer)
		assert.equal(layerAtHeight(layerBottom(layer) + 2.9), layer)
	}
	assert.equal(layerAtHeight(0.5), GROUND_LAYER)
	assert.equal(layerAtHeight(-0.5), GROUND_LAYER + 1)
	assert.equal(layerAtHeight(1000), 0)
	assert.equal(layerAtHeight(-1000), LAYER_COUNT - 1)
})

test('the layer map: the layer own cubes bright, what lies below darker, the deeper the darker', () => {
	const w = new CubeWorld(1, 1)
	w.set(0, 0, GROUND_LAYER, WOOD)
	w.set(1, 0, GROUND_LAYER + 1, STONE)
	w.set(2, 0, GROUND_LAYER + 5, STONE)
	w.set(3, 0, 25, LAVA)
	const side = 16
	const out = new Uint8ClampedArray(side * side * 4)
	drawLayerMap(w, GROUND_LAYER, side, out)
	const wood = pixel(out, side, 0, 0)
	const near = pixel(out, side, 1, 0)
	const deep = pixel(out, side, 2, 0)
	const none = pixel(out, side, 5, 5)
	assert.equal(wood[3], 255)
	assert.ok(wood[0] > wood[2], 'wood is brown')
	assert.ok(near[0] > deep[0], 'stone a layer down is lighter than stone five down')
	assert.ok(none[0] < 30 && none[0] === none[1], 'a column with no cube is dark grey')
	const lava = pixel(out, side, 3, 0)
	assert.ok(lava[0] > lava[2], 'lava below shows red')

	// From the layer the stone is in, it is drawn at full brightness, and the wood above is not seen.
	drawLayerMap(w, GROUND_LAYER + 1, side, out)
	assert.ok(pixel(out, side, 1, 0)[0] > near[0])
	assert.deepEqual(pixel(out, side, 0, 0), none)
})

test('the layer map of a world that is not square: the rest of the square is outside', () => {
	const w = CubeWorld.create(2, 1, true)
	const side = 32
	const out = new Uint8ClampedArray(side * side * 4)
	drawLayerMap(w, 0, side, out)
	const inside = pixel(out, side, 20, 10)
	const outside = pixel(out, side, 20, 20)
	assert.notDeepEqual(inside, outside)
	// The themed world's sky is empty, so the ground layer's dirt shows through, darker.
	drawLayerMap(w, GROUND_LAYER, side, out)
	assert.ok(pixel(out, side, 20, 10)[0] > inside[0])
})

test('CubeLayer counts its rebuilds, so the minimap knows to redraw', () => {
	const w = new CubeWorld(1, 1)
	const layer = new CubeLayer(w)
	const v = layer.version
	w.set(0, 0, GROUND_LAYER, STONE)
	layer.rebuild([w.chunkKey(0, 0, GROUND_LAYER)])
	assert.equal(layer.version, v + 1)
})
