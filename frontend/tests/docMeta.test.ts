// Run with: bun test tests/docMeta.test.ts
// A tab switch stashes the editor's per-map settings into the outgoing document's meta and loads the
// incoming one's (engine/docMeta.ts, which Engine.stashActive and activate call). Every DocMeta field
// must make the round trip, and an undo recorded on one tab must still apply to that tab's map after a
// switch away and back (CLAUDE.md, "Documents" and the undo rule, #437).
import './runes.ts'
import { expect, test } from 'bun:test'
import { editor, ui } from '../src/lib/state/editor.svelte.ts'
import { MapDocument, type DocMeta } from '../src/lib/engine/MapDocument.ts'
import { DOC_META_KEYS, loadMeta, stashMeta } from '../src/lib/engine/docMeta.ts'
import { copyPaths, newPath } from '../src/lib/terrain/paths.ts'

/** A meta with every field set, the optional ones too; `n` makes each value differ from another n's. */
function fullMeta(n: number): Required<DocMeta> {
	const path = newPath([], 'road', `tex${n}.blp`)
	path.points.push({ x: n, y: 2 * n, z: 3 * n })
	return {
		mapName: `map ${n}`,
		filePath: `C:/maps/${n}.wmap`,
		dirty: n % 2 === 1,
		palette: [`#00000${n}`, `tile${n}.blp`],
		region: { mapName: `Map${n}`, x: n, y: n + 1, size: 2, uids: new Map([[n, n * 10]]) },
		vmangos: { dir: `Custom${n}`, mapId: 800 + n },
		bookmarks: [{ name: `spot ${n}`, x: n, y: n, z: n, yaw: n / 10, pitch: n / 20, distance: 100 + n }],
		waterLevel: 5 + n,
		waterEnabled: n % 2 === 0,
		paintLayer: n,
		sculptPaintLayer: n + 1,
		roles: { rock: n, dirt: n + 2 },
		textureEffects: { [`tex${n}`]: n },
		textureLooks: { [`tex${n}`]: n + 1 },
		scopedEffects: { zones: { [`${n}`]: { [`tex${n}`]: n } }, tiles: { [`${n},0`]: { [`tex${n}`]: n + 3 } } },
		reference: { path: `ref${n}.png`, mode: n % 2 ? 'ground' : 'screen', opacity: n / 10, shown: n % 2 === 0, x: n, z: n, w: 10 * n, h: 5 * n, turn: n / 4 },
		paths: [path],
		flattenLock: { on: n % 2 === 1, x: n, y: n + 1, z: n + 2 },
		waterLock: { on: n % 2 === 0, pos: { x: n, y: n * 2, z: n * 3 } },
	}
}

/** The meta as plain data, for comparing: `toEqual` reads a Map by its entries too, but says less. */
const plain = (m: DocMeta) => ({ ...m, region: m.region && { ...m.region, uids: [...m.region.uids] } })

test('fullMeta sets every DocMeta key, and two of them differ in each', () => {
	const a = fullMeta(1)
	const b = fullMeta(2)
	expect(Object.keys(a).sort()).toEqual(Object.keys(DOC_META_KEYS).sort())
	for (const k of Object.keys(DOC_META_KEYS) as (keyof DocMeta)[]) expect([k, JSON.stringify(plain(a)[k])]).not.toEqual([k, JSON.stringify(plain(b)[k])])
})

test('every DocMeta field round-trips through loadMeta and stashMeta, for two maps in turn', () => {
	const a = fullMeta(1)
	const b = fullMeta(2)
	loadMeta(editor, a)
	const stashedA = stashMeta(editor, a)
	expect(Object.keys(stashedA).sort()).toEqual(Object.keys(DOC_META_KEYS).sort())
	expect(plain(stashedA)).toEqual(plain(a))
	// The other map's values replace every one of the first's, so no field rides along from the tab before.
	loadMeta(editor, b)
	expect(plain(stashMeta(editor, b))).toEqual(plain(b))
	loadMeta(editor, stashedA)
	expect(plain(stashMeta(editor, stashedA))).toEqual(plain(a))
})

test('the editor and the stashed meta share no arrays or objects', () => {
	const a = fullMeta(1)
	loadMeta(editor, a)
	editor.palette.push('#ffffff')
	editor.paths[0].points.push({ x: 9, y: 9, z: 9 })
	editor.roles.rock = 99
	editor.water.lockPos.x = 99
	expect(plain(a)).toEqual(plain(fullMeta(1)))
	const s = stashMeta(editor, a)
	editor.bookmarks.push({ ...editor.bookmarks[0] })
	editor.scopedEffects.zones['1']['tex1'] = 42
	editor.flattenLock.x = 42
	expect(s.bookmarks.length).toBe(1)
	expect(s.scopedEffects.zones['1']['tex1']).toBe(1)
	expect(s.flattenLock?.x).toBe(1)
})

test('a meta without the optional locks loads them unlocked, and loading drops the pick of a path', () => {
	const m: DocMeta = { ...fullMeta(1) }
	delete m.flattenLock
	delete m.waterLock
	editor.pathId = 3
	editor.pathPoint = 2
	loadMeta(editor, m)
	expect(editor.flattenLock).toEqual({ on: false, x: 0, y: 0, z: 0 })
	expect(editor.water.lock).toBe(true)
	expect(editor.water.lockPos).toEqual({ x: 0, y: 0, z: 0 })
	expect([editor.pathId, editor.pathPoint]).toEqual([-1, -1])
})

/** Switches the editor from `from` to `to` as Engine.activate does: stash, load, republish the history. */
function switchTo(from: MapDocument, to: MapDocument) {
	from.meta = stashMeta(editor, from.meta)
	loadMeta(editor, to.meta)
	to.history.refresh()
	editor.dirty = to.meta.dirty
}

test("an undo recorded on one tab applies to that tab's map after a switch away and back", () => {
	const a = new MapDocument(16, 'A')
	const b = new MapDocument(16, 'B')
	loadMeta(editor, a.meta)
	a.history.refresh()

	// On A: a path added and the ground raised, each undone the way the tools write it, through
	// `editor` and the document at call time rather than through arrays captured when it was made.
	const before = copyPaths(editor.paths)
	editor.paths = [...editor.paths, newPath(editor.paths, 'road', 'road.blp')]
	const after = editor.paths
	a.history.push({ label: 'Add path', undo: () => (editor.paths = copyPaths(before)), redo: () => (editor.paths = copyPaths(after)) })
	a.terrain.heights[5] = 7
	a.history.push({ label: 'Raise', undo: () => (a.terrain.heights[5] = 0), redo: () => (a.terrain.heights[5] = 7) })
	expect(editor.dirty).toBe(true)
	expect(ui.canUndo).toBe(true)

	switchTo(a, b)
	expect(ui.canUndo).toBe(false)
	expect(editor.dirty).toBe(false)
	expect(editor.paths.length).toBe(0)
	expect(a.meta.paths.length).toBe(1)

	switchTo(b, a)
	expect(ui.canUndo).toBe(true)
	expect(editor.dirty).toBe(true)
	expect(editor.paths.length).toBe(1)
	a.history.undo()
	expect(a.terrain.heights[5]).toBe(0)
	a.history.undo()
	expect(editor.paths.length).toBe(0)
	expect(ui.canUndo).toBe(false)
	expect(ui.canRedo).toBe(true)
	expect(b.terrain.heights[5]).toBe(0)
	expect(b.meta.paths.length).toBe(0)

	// Stashed and loaded again, A keeps the undone paths and can still redo.
	switchTo(a, b)
	switchTo(b, a)
	expect(editor.paths.length).toBe(0)
	a.history.redo()
	a.history.redo()
	expect(editor.paths.length).toBe(1)
	expect(a.terrain.heights[5]).toBe(7)
})
