import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { modelPathOf, replacedFiles, thumbReplaced } from '../src/lib/wow/replaced.ts'

test('replaced files sort into models (a WMO group as its root) and textures (#922)', () => {
	const f = replacedFiles(['World/A/Tree.M2', 'World\\B\\Hut.wmo', 'World\\B\\Hut_003.wmo', 'World/C/Bark.BLP', 'Sound/x.wav', 'World\\D\\Old.mdx'])
	assert.deepEqual([...f.models].sort(), ['world\\a\\tree.m2', 'world\\b\\hut.wmo', 'world\\d\\old.mdx'])
	assert.deepEqual([...f.textures], ['world\\c\\bark.blp'])
})

test('a model type or thumbnail key names its model path without a query', () => {
	assert.equal(modelPathOf('m2:World\\A\\Tree.m2?look=3'), 'world\\a\\tree.m2')
	assert.equal(modelPathOf('wmo:World\\B\\Hut.wmo?set=1'), 'world\\b\\hut.wmo')
	assert.equal(modelPathOf('tex:World\\C\\Bark.blp'), '')
	assert.equal(modelPathOf('prefab:abc'), '')
})

test('a thumbnail is stale when it shows a replaced model or texture itself', () => {
	const f = replacedFiles(['World\\A\\Tree.m2', 'World\\C\\Bark.blp', 'World\\B\\Hut_000.wmo'])
	assert.ok(thumbReplaced('m2:World\\A\\TREE.m2', f))
	assert.ok(thumbReplaced('m2:World\\A\\Tree.m2?look=2', f))
	assert.ok(thumbReplaced('wmo:World\\B\\Hut.wmo', f))
	assert.ok(thumbReplaced('tex:World\\C\\Bark.blp', f))
	assert.ok(!thumbReplaced('m2:World\\A\\Bush.m2', f))
	assert.ok(!thumbReplaced('prefab:x', f))
})
