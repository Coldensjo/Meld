// Run with: node --import ./tests/register.mjs --test tests/gossipNames.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GOSSIP_ACTIONS, GOSSIP_ICONS, nameOf, nextOptionId } from '../src/lib/wow/gossipNames.ts'

test('the tables cover what VMaNGOS knows', () => {
	// GOSSIP_ICON_DOT_20 and GOSSIP_OPTION_UNLEARNPETSKILLS are the last (Go's maxGossipIcon, maxGossipAction).
	assert.equal(GOSSIP_ICONS.length, 21)
	assert.equal(GOSSIP_ACTIONS.length, 18)
	assert.equal(GOSSIP_ACTIONS[3].flag, 4) // a vendor option needs UNIT_NPC_FLAG_VENDOR (1.12's value)
	assert.equal(GOSSIP_ACTIONS[4].flag, 8) // a flight master's, as Stormwind's gryphon master has
	assert.equal(GOSSIP_ACTIONS[5].flag, 16) // a trainer option needs UNIT_NPC_FLAG_TRAINER
})

test('nextOptionId takes the lowest free number', () => {
	assert.equal(nextOptionId([]), 0)
	assert.equal(nextOptionId([0, 1, 3]), 2)
	assert.equal(nameOf(['a'], 4), '#4')
})
