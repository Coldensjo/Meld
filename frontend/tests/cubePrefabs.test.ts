// Run with: bun test tests/cubePrefabs.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CubeWorld, GROUND_LAYER, kindId } from '../src/lib/cubes/world.ts'
import { boxOf } from '../src/lib/cubes/edit.ts'
import { copyBox, turnClip } from '../src/lib/cubes/clip.ts'
import { formatCubePrefab, isCubePrefabText, parseCubePrefab, prefabContents } from '../src/lib/cubes/prefabs.ts'
import { newCubeSet, validCubeSets, withCubeItem, withoutCubeItem } from '../src/lib/cubes/cubeSets.ts'
import { clipThumbFaces, thumbFaces } from '../src/lib/cubes/palette.ts'

const STONE = kindId('stone')
const WOOD = kindId('wood')
const SLOPE = 2
const STAIRS = 3
const UP = GROUND_LAYER - 1

/** A doorway of stone two high with a wood stair turned once and upside down on its lintel. */
function doorClip() {
	const w = new CubeWorld(1, 1)
	w.set(2, 2, UP, STONE)
	w.set(4, 2, UP, STONE)
	w.set(2, 2, UP - 1, STONE)
	w.set(3, 2, UP - 1, STONE)
	w.set(4, 2, UP - 1, STONE)
	w.set(3, 3, UP - 1, WOOD, STAIRS, 5)
	w.set(2, 3, UP, WOOD, SLOPE, 3)
	return copyBox(w, boxOf({ x: 2, z: 2, layer: UP }, { x: 4, z: 3, layer: UP }, 1))
}

test('a prefab of cubes round-trips through its TOML, by kind and shape names', () => {
	const clip = doorClip()
	const text = formatCubePrefab({ name: "Ogre's door", clip })
	assert.ok(isCubePrefabText(text))
	assert.match(text, /^size = \[3, 2, 2\]$/m)
	assert.match(text, /kind = 'wood'\nshape = 'stairs'\nturn = 1\nupside_down = true/)
	assert.match(text, /at = \[0, 1, 0\]\nkind = 'wood'\nshape = 'slope'\nturn = 3/)
	const { prefab, errors } = parseCubePrefab(text)
	assert.deepEqual(errors, [])
	assert.equal(prefab?.name, "Ogre's door")
	assert.deepEqual(prefab?.clip, clip)
	// Turned, it is still a clip that writes and reads back.
	const turned = turnClip(clip)
	assert.deepEqual(parseCubePrefab(formatCubePrefab({ name: 'x', clip: turned })).prefab?.clip, turned)
	assert.deepEqual(prefabContents(clip), [
		['stone', 5],
		['wood', 2],
	])
})

test('a hand-written prefab: a missing shape is full, a turn the shape lacks is dropped, bad cubes are reported and left out', () => {
	const text = `name = 'Post'
size = [1, 1, 3]
[[cube]]
at = [0, 0, 0]
kind = 'stone'
turn = 2
[[cube]]
at = [0, 0, 1]
kind = 'wood'
shape = 'pillar'
upside_down = true
[[cube]]
at = [0, 0, 5]
kind = 'stone'
[[cube]]
at = [0, 0, 2]
kind = 'gold'
`
	const { prefab, errors } = parseCubePrefab(text)
	assert.equal(errors.length, 2)
	assert.match(errors[0], /outside the size/)
	assert.match(errors[1], /kind must be/)
	const c = prefab!.clip
	// The lowest cube is last (the clip's layers run from the top).
	assert.equal(c.cubes[2], STONE)
	assert.equal(c.cubes[1], WOOD | (5 << 8))
	assert.equal(c.cubes[0], 0)
	assert.equal(parseCubePrefab('name = [').prefab, null)
	assert.equal(parseCubePrefab("size = [0, 1, 1]\n[[cube]]\nat = [0, 0, 0]\nkind = 'stone'").prefab, null)
	assert.equal(parseCubePrefab('size = [100000, 100000, 1]\n[[cube]]').prefab, null)
	assert.equal(parseCubePrefab('size = [1, 1, 1]').prefab, null)
	assert.equal(parseCubePrefab("size = [1, 1, 1]\n[[cube]]\nat = [0, 0, 0]\nkind = 'stone'", 'From file').prefab?.name, 'From file')
})

test("a prefab of cubes tells apart from Meld's prefabs of models in the folder", () => {
	const cubes = formatCubePrefab({ name: 'Door', clip: doorClip() })
	// A Meld prefab of models, as Models › Save Selection as Prefab wrote it.
	const models = "# Meld prefab: models placed together, by their client paths\nname = 'Camp'\n\n[[model]]\ntype = 'm2:World\\Tent.m2'\nid = 1\nat = [0, 0, 0]\nturn = 0\nscale = 1\n"
	assert.ok(isCubePrefabText(cubes))
	assert.ok(!isCubePrefabText(models))
	assert.equal(parseCubePrefab(models).prefab, null)
})

test('a set of cubes holds each tile once, and only tiles', () => {
	let s = withCubeItem(newCubeSet('House'), 'kind:4')
	s = withCubeItem(s, 'shape:3')
	s = withCubeItem(s, 'kind:4')
	assert.deepEqual(s.items, ['kind:4', 'shape:3'])
	assert.equal(withCubeItem(s, 'kind:0'), s, 'empty is no tile')
	assert.equal(withCubeItem(s, 'm2:a.m2'), s)
	assert.deepEqual(withoutCubeItem(s, 'kind:4').items, ['shape:3'])
	assert.deepEqual(validCubeSets([{ name: 'A', items: ['kind:1', 'kind:1', 'nope', 3] }, { items: [] }, null, { name: 'B' }]), [
		{ name: 'A', items: ['kind:1'] },
		{ name: 'B', items: [] },
	])
	assert.deepEqual(validCubeSets('x'), [])
})

test("a prefab's picture: one cube matches the palette's, and faces between cubes are hidden", () => {
	const one = { w: 1, d: 1, h: 1, cubes: new Uint32Array([STONE]) }
	assert.equal(clipThumbFaces(one, GROUND_LAYER, 64).length, thumbFaces(STONE, 0, 0, GROUND_LAYER, 64).length)
	// Two stone cubes side by side along x: the first's east face is hidden, so 3 + 2 faces show.
	const two = { w: 2, d: 1, h: 1, cubes: new Uint32Array([STONE, STONE]) }
	assert.equal(clipThumbFaces(two, GROUND_LAYER, 64).length, 5)
	// Every point lies in the square.
	for (const f of clipThumbFaces(doorClip(), GROUND_LAYER, 64)) for (const [x, y] of f.points) assert.ok(x >= 0 && x <= 64 && y >= 0 && y <= 64)
	assert.deepEqual(clipThumbFaces({ w: 1, d: 1, h: 1, cubes: new Uint32Array(1) }, GROUND_LAYER, 64), [])
})
