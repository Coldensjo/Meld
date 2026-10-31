import { describe, expect, test } from 'bun:test'
import { fileLine, groupCount, groupFiles, spawnLine } from '../src/lib/io/changeList'
import type { vmangos } from '../src/lib/wails/models'

const file = (name: string, group: string, tile = '', reason = ''): vmangos.FileChange => ({ name, group, tile, reason, new: false, waiting: false })

describe('the Changes window lists (#959)', () => {
	test('groups the files in the window order and leaves out empty groups', () => {
		const groups = groupFiles([
			file('textures\\Minimap\\map32_48.blp', 'minimap'),
			file('World\\Maps\\Azeroth\\Azeroth_32_48.adt', 'tile', '32_48', 'changed in the region'),
			file('World\\Maps\\Azeroth\\Azeroth.wdl', 'wdl'),
			file('World\\Maps\\Azeroth\\Azeroth_33_48.adt', 'tile', '33_48', "beside the region: it lists a model by the region's edge"),
			file('odd.bin', 'something new'),
		])
		expect(groups.map((g) => g.group)).toEqual(['tile', 'wdl', 'minimap', 'other'])
		expect(groups[0].files.map((f) => f.tile)).toEqual(['32_48', '33_48'])
		expect(groupCount(groups[0], 4)).toBe('1 of 4, and 1 beside the region')
		expect(groupCount(groups[1], 4)).toBe('1')
	})

	test('names a tile by its tile and another file by its base name', () => {
		expect(fileLine(file('World\\Maps\\Azeroth\\Azeroth_32_48.adt', 'tile', '32_48', 'changed in the region'))).toBe('32_48: changed in the region')
		expect(fileLine(file('DBFilesClient\\Map.dbc', 'dbc', '', 'adds the row of map 800 (Isle)'))).toBe('Map.dbc: adds the row of map 800 (Isle)')
		expect(fileLine(file('World\\Maps\\Isle\\Isle.wdl', 'wdl'))).toBe('Isle.wdl')
	})

	test('says what a spawn change does, with the changed fields', () => {
		const s = { guid: 42, entry: 3, name: 'Guard', object: false, action: 'change', fields: ['position', 'path'], sql: '' }
		expect(spawnLine(s)).toBe('Change Guard (guid 42): position, path')
		expect(spawnLine({ ...s, action: 'add', fields: [] })).toBe('Add Guard (guid 42)')
		expect(spawnLine({ ...s, name: '', object: true, action: 'delete' })).toBe('Delete object 3 (guid 42)')
	})
})
