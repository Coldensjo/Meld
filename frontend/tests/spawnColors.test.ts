// Run with: bun test tests/spawnColors.test.ts
// Show › Spawn colours (#949): the colour each mode gives a spawn, the level ramp over the map's
// spread, the legend, and the layer painting its markers' instances when the mode changes.
import './runes.ts'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { vmangos } from '../src/lib/wails/models'
import { KIND_COLORS, LEVEL_RAMP, NO_COLOR, RANK_COLORS, REACTION_COLORS, levelRange, rampColor, reactionOf, spawnColor, spawnLegend, type FactionReaction } from '../src/lib/world/spawnColors'
import type { CullView } from '../src/lib/world/instanceCull'

const { SpawnLayer } = await import('../src/lib/world/SpawnLayer.ts')

function view(): CullView {
	const cam = new THREE.PerspectiveCamera(90, 1, 0.1, 1000)
	cam.updateMatrixWorld()
	const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
	return { frustums: [f], eye: cam.position.clone(), pxPerUnit: 500, cutoffPx: 0 }
}

function spawn(kind: string, levelMin: number, levelMax: number, extra: Partial<vmangos.WorldSpawn> = {}): vmangos.WorldSpawn {
	return { kind, guid: 1, entry: 1, name: 'x', x: 0, y: 0, z: -20, orientation: 0, model: '', waypoints: [], levelMin, levelMax, faction: 0, rank: 0, ...extra } as Partial<vmangos.WorldSpawn> as vmangos.WorldSpawn
}

const reactions = new Map<number, FactionReaction>([
	[12, { alliance: 'friendly', horde: 'hostile' }],
	[22, { alliance: 'hostile', horde: 'hostile' }],
	[31, { alliance: 'neutral', horde: 'neutral' }],
])
const ctx = { reactions, side: 'alliance' as const, levels: [1, 11] as const }

test('kind mode keeps the kind colours', () => {
	assert.equal(spawnColor(spawn('monster', 5, 5), 'kind', ctx), KIND_COLORS.monster)
	assert.equal(spawnColor(spawn('npc', 5, 5), 'kind', ctx), KIND_COLORS.npc)
	assert.equal(spawnColor(spawn('object', 0, 0), 'kind', ctx), KIND_COLORS.object)
})

test('level mode ramps over the range, low blue to high red, with objects grey', () => {
	// The monsters' levels set the range; the NPCs' only when no monster has one.
	assert.deepEqual(levelRange([spawn('monster', 3, 5), spawn('npc', 30, 30), spawn('object', 0, 0), spawn('monster', 0, 0), spawn('monster', 9, 9)]), [4, 9])
	assert.deepEqual(levelRange([spawn('npc', 3, 5), spawn('npc', 30, 30)]), [4, 30])
	assert.deepEqual(levelRange([spawn('object', 0, 0)]), [0, 0])
	// With 50 or more, the few outliers past the 5th and 95th percentile are left out of the range.
	const zone = [...Array.from({ length: 98 }, (_, i) => spawn('monster', 5 + (i % 10), 5 + (i % 10))), spawn('monster', 62, 62), spawn('monster', 62, 62)]
	assert.deepEqual(levelRange(zone), [5, 14])
	assert.equal(spawnColor(spawn('monster', 1, 1), 'level', ctx), LEVEL_RAMP[0])
	assert.equal(spawnColor(spawn('monster', 11, 11), 'level', ctx), LEVEL_RAMP[LEVEL_RAMP.length - 1])
	// A range's middle: 5 to 7 is level 6, half way along 1 to 11.
	assert.equal(spawnColor(spawn('monster', 5, 7), 'level', ctx), LEVEL_RAMP[2])
	assert.equal(spawnColor(spawn('object', 0, 0), 'level', ctx), NO_COLOR)
	assert.equal(spawnColor(spawn('monster', 0, 0), 'level', ctx), NO_COLOR)
	assert.equal(rampColor(-1), LEVEL_RAMP[0])
	assert.equal(rampColor(2), LEVEL_RAMP[4])
})

test('reaction mode follows the faction to the side, as the names do', () => {
	const guard = spawn('npc', 30, 30, { faction: 12 })
	assert.equal(reactionOf(guard, reactions, 'alliance'), 'friendly')
	assert.equal(reactionOf(guard, reactions, 'horde'), 'hostile')
	assert.equal(spawnColor(guard, 'reaction', ctx), REACTION_COLORS.friendly)
	assert.equal(spawnColor(guard, 'reaction', { ...ctx, side: 'horde' }), REACTION_COLORS.hostile)
	assert.equal(spawnColor(spawn('monster', 1, 1, { faction: 31 }), 'reaction', ctx), REACTION_COLORS.neutral)
	// Not read yet, or a faction the table lacks.
	assert.equal(spawnColor(guard, 'reaction', { ...ctx, reactions: null }), NO_COLOR)
	assert.equal(spawnColor(spawn('monster', 1, 1, { faction: 999 }), 'reaction', ctx), NO_COLOR)
})

test('rank mode gives each rank its colour', () => {
	for (let r = 0; r < RANK_COLORS.length; r++) assert.equal(spawnColor(spawn('monster', 60, 60, { rank: r }), 'rank', ctx), RANK_COLORS[r])
	assert.equal(spawnColor(spawn('monster', 60, 60, { rank: 9 }), 'rank', ctx), NO_COLOR)
})

test('the legend lists a mode’s colours, once each level', () => {
	assert.deepEqual(spawnLegend('kind', [1, 10], 'alliance'), [])
	assert.equal(spawnLegend('rank', [1, 10], 'alliance').length, 6)
	assert.match(spawnLegend('reaction', [1, 10], 'horde')[0].label, /Horde/)
	assert.deepEqual(
		spawnLegend('level', [1, 61], 'alliance').map((r) => r.label),
		['Level 1 and below', 'Level 16', 'Level 31', 'Level 46', 'Level 61 and above', 'Game objects'],
	)
	assert.deepEqual(
		spawnLegend('level', [5, 6], 'alliance').map((r) => r.label),
		['Level 5 and below', 'Level 6 and above', 'Game objects'],
	)
})

test('the layer paints its markers by the mode, and again when the mode changes', () => {
	const layer = new SpawnLayer()
	const low = spawn('monster', 1, 1, { guid: 1 })
	const high = spawn('monster', 11, 11, { guid: 2, x: 5 })
	layer.set([low, high])
	const mesh = () => layer.group.children[0] as THREE.InstancedMesh
	const colorAt = (k: number) => new THREE.Color().fromArray(mesh().instanceColor!.array as Float32Array, k * 3).getHex()
	const ids = () => mesh().userData.ids as vmangos.WorldSpawn[]
	layer.cull(view())
	assert.equal(colorAt(0), KIND_COLORS.monster)
	layer.setColoring('level', 'alliance', null)
	layer.cull(view())
	assert.deepEqual(layer.levelSpread, [1, 11])
	assert.equal(colorAt(ids().indexOf(low)), LEVEL_RAMP[0])
	assert.equal(colorAt(ids().indexOf(high)), LEVEL_RAMP[4])
	// A creature whose level changes is painted again at the next cull.
	high.levelMin = high.levelMax = 1
	layer.refresh(high)
	layer.cull(view())
	assert.equal(colorAt(ids().indexOf(high)), LEVEL_RAMP[0])
})
