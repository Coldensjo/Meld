import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineDebug } from '../src/lib/engine/Engine.ts'
import { DEBUG_MEMBERS, type DebugMember } from '../src/lib/engine/engineDebug.ts'

// DEBUG_MEMBERS names exactly EngineDebug's keys: a member added to one and not the other fails `bun run check`.
type Unlisted = Exclude<keyof EngineDebug, DebugMember> | Exclude<DebugMember, keyof EngineDebug>
const exact: [Unlisted] extends [never] ? true : false = true

const dir = join(import.meta.dir, '..', 'probes')
const probes = readdirSync(dir)
	.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
	.map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }))

test('every member a probe reaches through the debug facade is in it', () => {
	assert.equal(exact, true)
	assert.ok(probes.length > 50, 'the probes are found')
	const listed = new Set<string>(DEBUG_MEMBERS)
	const unknown: string[] = []
	for (const p of probes) for (const m of p.text.matchAll(/\.debug\.(\w+)/g)) if (!listed.has(m[1])) unknown.push(`${p.name}: debug.${m[1]}`)
	assert.deepEqual(unknown, [])
})

test("no probe reaches the facade's members on the engine directly", () => {
	const direct = new RegExp(`(?<![\\w.$])(window\\.__engine|P\\.e|e)\\.(${DEBUG_MEMBERS.join('|')})\\b`, 'g')
	const found: string[] = []
	for (const p of probes) for (const m of p.text.matchAll(direct)) found.push(`${p.name}: ${m[0]}`)
	assert.deepEqual(found, [], 'use P.e.debug.<name> (Engine.ts, EngineDebug)')
})
