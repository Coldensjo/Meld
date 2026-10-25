// Run with: bun test tests/spawnInfo.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creatureTypeName, levelText, npcRoles, objectTypeName, orientationDegrees, rankName, spawnType } from '../src/lib/world/spawnInfo.ts'

test('creature types start at 1, as the server numbers them', () => {
	assert.equal(creatureTypeName(1), 'Beast')
	assert.equal(creatureTypeName(7), 'Humanoid')
	assert.equal(creatureTypeName(11), 'Totem')
	assert.equal(creatureTypeName(0), 'Type 0')
})

test('ranks match CREATURE_ELITE_*', () => {
	assert.equal(rankName(0), 'Normal')
	assert.equal(rankName(3), 'Boss')
	assert.equal(rankName(4), 'Rare')
})

test('object types match GAMEOBJECT_TYPE_*', () => {
	assert.equal(objectTypeName(0), 'Door')
	assert.equal(objectTypeName(3), 'Chest')
	assert.equal(objectTypeName(19), 'Mailbox')
	assert.equal(objectTypeName(30), 'Aura generator')
	assert.equal(objectTypeName(31), 'Type 31')
})

test('NPC flags name their roles, and a monster has none', () => {
	assert.equal(npcRoles(0), '')
	assert.equal(npcRoles(0x80), 'innkeeper')
	assert.equal(npcRoles(0x1 | 0x4 | 0x10), 'gossip, vendor, trainer')
})

test('levels read as one value or a range', () => {
	assert.equal(levelText(60, 60), '60')
	assert.equal(levelText(58, 60), '58–60')
	assert.equal(levelText(0, 0), '')
})

test('orientation converts from radians to whole degrees', () => {
	assert.equal(orientationDegrees(Math.PI), 180)
	assert.equal(orientationDegrees(Math.PI / 2), 90)
})

test('a spawn type carries the look and pose the model endpoint dresses the model by', () => {
	assert.equal(spawnType({ model: '' }), '')
	assert.equal(spawnType({ model: 'World\\Wmo\\Inn.wmo', look: 'geo=0', anim: 4 }), 'wmo:World\\Wmo\\Inn.wmo')
	assert.equal(spawnType({ model: 'Creature\\Wolf\\Wolf.mdx' }), 'm2:Creature\\Wolf\\Wolf.mdx')
	assert.equal(spawnType({ model: 'Creature\\Wolf\\Wolf.mdx', look: '', anim: 0 }), 'm2:Creature\\Wolf\\Wolf.mdx')
	assert.equal(spawnType({ model: 'Character\\Human\\Male\\HumanMale.mdx', look: 'geo=0%2C5', anim: 69 }), 'm2:Character\\Human\\Male\\HumanMale.mdx?geo=0%2C5&anim=69')
	assert.equal(spawnType({ model: 'Creature\\Wolf\\Wolf.mdx', anim: 97 }), 'm2:Creature\\Wolf\\Wolf.mdx?anim=97')
})
