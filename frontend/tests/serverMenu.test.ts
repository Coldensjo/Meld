// The File menu's local server group (#857): the header says what runs, and the controls are on only
// when they would do something.
import { describe, expect, test } from 'bun:test'
import { serverControls, serverHeader, type ServerState } from '../src/lib/io/serverMenu'

const S = (database: boolean, auth: boolean, world: boolean, more: Partial<ServerState> = {}): ServerState => ({ available: true, reason: '', database, ownDatabase: true, auth, world, busy: false, ...more })

describe('serverHeader', () => {
	test('says running, stopped or which parts run', () => {
		expect(serverHeader(S(true, true, true))).toBe('VMaNGOS server: running')
		expect(serverHeader(S(false, false, false))).toBe('VMaNGOS server: stopped')
		expect(serverHeader(S(true, false, false))).toBe('VMaNGOS server: database running; login, world stopped')
	})
	test('names a database that is not the server folder’s own', () => {
		expect(serverHeader(S(true, false, false, { ownDatabase: false }))).toContain('database (not the folder’s own) running')
	})
	test('says why the controls are off, or what runs now', () => {
		expect(serverHeader(S(false, false, false, { available: false, reason: 'no VMaNGOS server folder is set' }))).toBe('VMaNGOS server: no VMaNGOS server folder is set')
		expect(serverHeader(S(true, true, true), 'stop')).toBe('VMaNGOS server: stopping…')
		expect(serverHeader(null)).toBe('VMaNGOS server')
	})
})

describe('serverControls', () => {
	test('Start while something is down, Stop and Restart while something runs', () => {
		expect(serverControls(S(true, true, true))).toEqual({ start: false, stop: true, restart: true })
		expect(serverControls(S(false, false, false))).toEqual({ start: true, stop: false, restart: false })
		expect(serverControls(S(true, false, true))).toEqual({ start: true, stop: true, restart: true })
	})
	test('Stop leaves alone a database that is not the folder’s own', () => {
		expect(serverControls(S(true, false, false, { ownDatabase: false })).stop).toBe(false)
	})
	test('all off without a server, while one runs, or before the state is read', () => {
		const off = { start: false, stop: false, restart: false }
		expect(serverControls(S(true, true, true, { available: false }))).toEqual(off)
		expect(serverControls(S(true, true, true, { busy: true }))).toEqual(off)
		expect(serverControls(S(true, true, true), 'restart')).toEqual(off)
		expect(serverControls(null)).toEqual(off)
	})
})
