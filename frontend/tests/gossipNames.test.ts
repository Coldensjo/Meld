// Run with: bun test tests/gossipNames.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_TALK, AI_EVENTS, CHAT_TYPES, GOSSIP_ACTIONS, GOSSIP_ICONS, nameOf, nextOptionId } from '../src/lib/wow/gossipNames.ts'

test('a number names its VMaNGOS constant', () => {
	assert.equal(nameOf(GOSSIP_ICONS, 0), 'Chat bubble') // GOSSIP_ICON_CHAT
	assert.equal(nameOf(GOSSIP_ICONS, 2), 'Wings (flight)') // GOSSIP_ICON_TAXI
	assert.equal(nameOf(GOSSIP_ICONS, 20), 'Dot (20)') // GOSSIP_ICON_DOT_20, the last one
	assert.equal(GOSSIP_ACTIONS[ACTION_TALK].name, 'Talk (open a menu)') // GOSSIP_OPTION_GOSSIP
	assert.equal(GOSSIP_ACTIONS[17].name, 'Unlearn pet skills') // GOSSIP_OPTION_UNLEARNPETSKILLS, the last one
	assert.equal(nameOf(AI_EVENTS, 4), 'On aggro') // EVENT_T_AGGRO
	assert.equal(nameOf(AI_EVENTS, 11), 'On spawn') // EVENT_T_SPAWNED
	assert.equal(nameOf(CHAT_TYPES, 1), 'yells') // CHAT_TYPE_YELL
	assert.equal(nameOf(CHAT_TYPES, 4), 'whispers') // CHAT_TYPE_WHISPER
})

test('a number past the table is shown as itself', () => {
	assert.equal(nameOf(GOSSIP_ICONS, 21), '#21')
	assert.equal(nameOf(CHAT_TYPES, 99), '#99')
	assert.equal(nameOf(['a'], 4), '#4')
})

test('an action names the creature flag it needs, with 1.12 values', () => {
	assert.equal(GOSSIP_ACTIONS[3].flag, 4) // a vendor option needs UNIT_NPC_FLAG_VENDOR
	assert.equal(GOSSIP_ACTIONS[4].flag, 8) // a flight master's, as Stormwind's gryphon master has
	assert.equal(GOSSIP_ACTIONS[5].flag, 16) // a trainer option needs UNIT_NPC_FLAG_TRAINER
	assert.equal(GOSSIP_ACTIONS[16].flagName, 'Trainer') // unlearning talents is a trainer's too
})

test('nextOptionId takes the lowest free number', () => {
	assert.equal(nextOptionId([]), 0)
	assert.equal(nextOptionId([0, 1, 3]), 2)
	assert.equal(nextOptionId([1, 2]), 0)
})
