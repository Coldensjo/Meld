import { expect, test } from 'bun:test'
import { folderGaps } from '../src/lib/io/folderGaps'

test('asks only for the unset folders', () => {
	expect(folderGaps('', '', false)).toEqual({ client: true, server: true })
	expect(folderGaps('C:\WoW\client', '', false)).toEqual({ client: false, server: true })
	expect(folderGaps('', 'C:\WoW\vmangos', false)).toEqual({ client: true, server: false })
	expect(folderGaps(' ', 'x', false)?.client).toBe(true)
})

test('stays quiet when both are set or the user said not to ask', () => {
	expect(folderGaps('a', 'b', false)).toBeNull()
	expect(folderGaps('', '', true)).toBeNull()
})
