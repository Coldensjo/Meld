import { expect, test } from 'bun:test'
import { folderGaps, setupServer } from '../src/lib/io/folderGaps'

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

test('asks a 3.3.5a client for the AzerothCore server, any other for VMaNGOS', () => {
	expect(setupServer(12340)).toBe('azerothcore')
	expect(setupServer(5875)).toBe('vmangos')
	expect(setupServer(8606)).toBe('vmangos')
	expect(setupServer(0)).toBe('vmangos')
})
