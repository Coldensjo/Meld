// Run with: bun test tests/menus.test.ts
// The menu bar's menus (lib/ui/menus.ts, #584) built from plain objects: the disabled states follow the
// context, and every check and radio item reads the same value its click writes.
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { buildMenus, regionEvents, type Menu, type MenuActions, type MenuContext, type MenuIo, type MenuItem } from '../src/lib/ui/menus.ts'
import type { CommandId } from '../src/lib/ui/commands.ts'
import type { CameraView } from '../src/lib/ui/cameraView.ts'

type Bag = Record<string, unknown>

/** A context over plain objects; `command` toggles the values the bound commands toggle in the app. */
function makeCtx(over: { ui?: Bag; editor?: Bag; prefs?: Bag; backend?: boolean; events?: MenuContext['events'] } = {}) {
	const ui: Bag = { recentProjects: [], serverStatus: null, serverAction: '', externalDb: null, project: null, ...over.ui }
	const editor: Bag = { bookmarks: [], maskSelect: { step: 4 }, smoothArea: { mode: 'smooth', shape: 'raise' }, selectedIds: [], selection: null, regionBlock: null, worldMap: null, ...over.editor }
	const prefs: Bag = { shownEvents: [], biomes: [], ...over.prefs }
	const commands: CommandId[] = []
	// The check items whose click runs a command (their key's), and the value that command flips.
	const flips: Partial<Record<CommandId, [Bag, string]>> = {
		grid: [editor, 'grid'],
		inspector: [ui, 'inspector'],
		hidePanels: [ui, 'hidePanels'],
		climbView: [prefs, 'climbView'],
		minimap: [ui, 'minimap'],
		perfOverlay: [prefs, 'perfOverlay'],
	}
	const io = new Proxy({}, { get: () => () => undefined }) as MenuIo
	const state = { cameraView: 'orbit' as CameraView }
	const act: MenuActions = {
		command: (id) => {
			commands.push(id)
			const f = flips[id]
			if (f) f[0][f[1]] = !f[0][f[1]]
		},
		engine: () => null,
		switchProject: () => {},
		exit: () => {},
		openManual: () => {},
		setCameraView: (v) => (state.cameraView = v),
		setStatus: () => {},
		io,
	}
	const build = (): Menu[] =>
		buildMenus({
			ui: ui as unknown as MenuContext['ui'],
			editor: editor as unknown as MenuContext['editor'],
			prefs: prefs as unknown as MenuContext['prefs'],
			backend: over.backend ?? true,
			wowLoaded: true,
			events: over.events ?? [],
			cameraView: state.cameraView,
			cameraViews: [
				{ id: 'orbit', label: 'Orbit' },
				{ id: 'flying', label: 'Flying' },
			],
			benchMaps: [{ kind: 'wmo', label: 'Buildings' }],
			benchScales: [
				['Normal', 1],
				['Heavy (4x)', 4],
			],
			act,
		})
	return { ui, editor, prefs, commands, build }
}

function item(menus: Menu[], menu: string, label: string): MenuItem {
	const m = menus.find((x) => x.name === menu)
	assert.ok(m, `no menu ${menu}`)
	const it = m.items.find((i) => i.kind !== 'sep' && i.label === label)
	assert.ok(it, `no item ${label} in ${menu}`)
	return it
}

const disabled = (menus: Menu[], menu: string, label: string) => {
	const it = item(menus, menu, label)
	assert.equal(it.kind, 'action')
	return !!(it.kind === 'action' && it.disabled)
}

test('the items that need the Go side are off without it', () => {
	const off = makeCtx({ backend: false }).build()
	const on = makeCtx({ backend: true }).build()
	for (const [menu, label] of [
		['File', 'Compile to Client'],
		['File', 'Open Part of Azeroth…'],
		['Tools', 'Creatures…'],
		['World', 'Zones…'],
		['Import/Export', 'Export Heightmap…'],
		['Help', 'Copy Scene'],
	]) {
		assert.equal(disabled(off, menu, label), true, `${menu} › ${label} without the backend`)
		assert.equal(disabled(on, menu, label), false, `${menu} › ${label} with the backend`)
	}
})

test('the selection, the clipboard, history and busy states turn their items on and off', () => {
	let menus = makeCtx().build()
	assert.equal(disabled(menus, 'Edit', 'Copy'), true)
	assert.equal(disabled(menus, 'Edit', 'Undo'), true)
	assert.equal(disabled(menus, 'Edit', 'Paste'), true)
	assert.equal(disabled(menus, 'Models', 'Duplicate Selected Models'), true)
	assert.equal(disabled(menus, 'File', 'Save'), false)

	menus = makeCtx({ editor: { selectedIds: [1] }, ui: { canUndo: true, hasClip: true, busy: true } }).build()
	assert.equal(disabled(menus, 'Edit', 'Copy'), false)
	assert.equal(disabled(menus, 'Edit', 'Undo'), false)
	assert.equal(disabled(menus, 'Edit', 'Paste'), false)
	assert.equal(disabled(menus, 'Models', 'Duplicate Selected Models'), false)
	// Grouping takes two models.
	assert.equal(disabled(menus, 'Models', 'Group Selected Models'), true)
	assert.equal(disabled(menus, 'File', 'Save'), true)
	assert.equal(disabled(makeCtx({ editor: { selectedIds: [1, 2] } }).build(), 'Models', 'Group Selected Models'), false)
})

test('a world view turns off the edits on the map but not the view', () => {
	const menus = makeCtx({ editor: { worldMap: 'Azeroth', regionBlock: null } }).build()
	assert.equal(disabled(menus, 'File', 'Save'), true)
	assert.equal(disabled(menus, 'Edit', 'Paste'), true)
	assert.equal(disabled(menus, 'File', 'Close Map'), false)
	assert.ok(item(menus, 'File', 'Edit Here (Open the Block Around the Camera)'))
	for (const name of ['Terrain', 'Paint']) {
		const m = menus.find((x) => x.name === name)!
		assert.equal(m.items[0].kind, 'header', `${name} says why it is off`)
		for (const it of m.items) if (it.kind === 'action') assert.equal(it.disabled, true, `${name} › ${it.label}`)
	}
	assert.equal(disabled(makeCtx().build(), 'Terrain', 'Clear Height'), false)
})

test('the grow-region items show only for a region, each side as it can grow', () => {
	const none = makeCtx().build()
	assert.equal(
		none.find((m) => m.name === 'File')!.items.some((i) => i.kind === 'action' && i.label.startsWith('Add the tiles')),
		false,
	)
	const menus = makeCtx({ editor: { regionBlock: { x: 0, y: 0, size: 2 } } }).build()
	assert.equal(disabled(menus, 'File', 'Add the tiles to the north'), true, 'tile 0 has no tiles to its north')
	assert.equal(disabled(menus, 'File', 'Add the tiles to the south'), false)
})

test('every check item reads the value its click writes', () => {
	const ctx = makeCtx()
	const before = ctx.build()
	let checks = 0
	for (const [mi, m] of before.entries()) {
		for (const [ii, it] of m.items.entries()) {
			if (it.kind !== 'check') continue
			checks++
			const was = !!it.checked
			it.toggle()
			const now = ctx.build()[mi].items[ii]
			assert.equal(now.kind, 'check')
			assert.equal(!!(now.kind === 'check' && now.checked), !was, `${m.name} › ${it.label} flips`)
			if (now.kind === 'check') now.toggle()
			const back = ctx.build()[mi].items[ii]
			assert.equal(!!(back.kind === 'check' && back.checked), was, `${m.name} › ${it.label} flips back`)
		}
	}
	assert.ok(checks > 40, `only ${checks} check items`)
})

test('every radio item, once picked, is the one checked in its group', () => {
	const ctx = makeCtx({ prefs: { clientLighting: true } })
	const menus = ctx.build()
	let radios = 0
	for (const [mi, m] of menus.entries()) {
		// A group is a run of radio items.
		const groups: number[][] = []
		m.items.forEach((it, i) => {
			if (it.kind !== 'radio') return
			const last = groups[groups.length - 1]
			if (last && last[last.length - 1] === i - 1) last.push(i)
			else groups.push([i])
		})
		// Two groups can sit side by side (Lighting's weather and its strength), so a pick is checked
		// and turns no other item of the run on, rather than leaving it the only one checked.
		const checked = (i: number) => {
			const r = ctx.build()[mi].items[i]
			return r.kind === 'radio' && r.checked
		}
		for (const group of groups) {
			for (const i of group) {
				radios++
				const was = group.map(checked)
				const it = ctx.build()[mi].items[i]
				if (it.kind === 'radio') it.select()
				const label = 'label' in it ? it.label : ''
				assert.equal(checked(i), true, `${m.name} › ${label} is checked once picked`)
				group.forEach((j, k) => {
					if (j !== i && !was[k]) assert.equal(checked(j), false, `${m.name} › ${label} checks another item too`)
				})
			}
		}
	}
	assert.ok(radios > 30, `only ${radios} radio items`)
})

test('picking an item of a group unchecks the one picked before', () => {
	const ctx = makeCtx()
	const pick = (label: string) => {
		const it = item(ctx.build(), 'Graphics', label)
		if (it.kind === 'radio') it.select()
	}
	const isChecked = (label: string) => {
		const it = item(ctx.build(), 'Graphics', label)
		return it.kind === 'radio' && it.checked
	}
	pick('Near')
	assert.equal(isChecked('Near'), true)
	pick('Far')
	assert.equal(isChecked('Far'), true)
	assert.equal(isChecked('Near'), false)
})

test('a check bound to a command runs that command', () => {
	const ctx = makeCtx()
	const it = item(ctx.build(), 'View', 'Show grid')
	assert.equal(it.kind, 'check')
	if (it.kind === 'check') it.toggle()
	assert.deepEqual(ctx.commands, ['grid'])
})

test('the region events are counted, named and sorted, and each shows or hides its spawns', () => {
	const names = new Map([
		[7, 'Midsummer'],
		[2, 'Darkmoon Faire'],
	])
	const events = regionEvents([{ events: [7, -2] }, { events: [2] }, { events: null }, { events: [9] }], names)
	assert.deepEqual(events, [
		{ id: 2, n: 2, name: 'Darkmoon Faire' },
		{ id: 9, n: 1, name: 'Event 9' },
		{ id: 7, n: 1, name: 'Midsummer' },
	])
	const ctx = makeCtx({ events })
	const fair = item(ctx.build(), 'Show', 'Darkmoon Faire (2)')
	if (fair.kind === 'check') fair.toggle()
	assert.deepEqual(ctx.prefs.shownEvents, [2])
	assert.equal(disabled(ctx.build(), 'Show', 'Hide every event'), false)
	assert.equal(disabled(makeCtx({ events }).build(), 'Show', 'Hide every event'), true)
	assert.equal(
		makeCtx()
			.build()
			.find((m) => m.name === 'Show')!
			.items.some((i) => i.kind === 'header' && i.label.startsWith('World events')),
		false,
	)
})
