// The main page's side of the Inspector (#910, inspector.ts): the view of what is selected, built from the
// Engine and the editor state, and the actions that run on them. The in-page Inspector uses both directly;
// in the desktop app the view is published to the Inspector's own OS window and its commands run these.
import { displayName, isWowType, wowPath } from '../models/assets'
import { baseType } from '../models/wmoSet'
import { editor, ui } from '../state/editor.svelte'
import { engineRef } from '../state/engineRef'
import { copyToClipboard } from '../ui/clipboard'
import type { vmangos } from '../wails/models'
import { disbandChanges, flagChanges, leaveChanges, type SpawnChange } from '../world/formations'
import type { WorldObject } from '../world/ObjectLayer'
import { leaveMotherChanges, leavePoolChanges, motherLimitChanges, poolSettingChanges } from '../world/pools'
import { selectSpawn } from '../world/spawnEdits'
import { spawnKey } from '../world/SpawnLayer'
import { editorWindowTarget } from './editorHost.svelte'
import { relatedSpawns, type InspectorActions, type InspectorView, type SpawnPanel, type SpawnPanelActions } from './inspector'

/** The model's path in the client (or its type, for a helper shape). */
const pathOf = (type: string) => (isWowType(type) ? wowPath(baseType(type)) : type)

/**
 * What the Inspector shows now, as a plain object. It reads the editor's state, so a `$derived` of it
 * follows the selection; the selection groups are the Engine's, which change with an undo step, so read
 * `ui.historyVersion` beside it.
 */
export function inspectorView(): InspectorView {
	const e = engineRef.current
	const layer = e?.objects
	const selected = editor.selected
	const ids = editor.selectedIds
	const groupsOf = () => {
		const gs = new Set<number>()
		for (const id of ids) {
			const g = layer?.objects.get(id)?.group
			if (g) gs.add(g)
		}
		return layer ? [...gs].map((g) => layer.groupMembers(g).size) : []
	}
	if (selected && ids.length <= 1) {
		const parent = selected.parent !== undefined ? layer?.objects.get(selected.parent) : undefined
		return {
			kind: 'model',
			o: { ...selected },
			name: displayName(selected.type),
			path: pathOf(selected.type),
			parentName: selected.parent === undefined ? '' : parent ? displayName(parent.type) : `#${selected.parent}`,
			groupSize: groupsOf()[0] ?? 0,
		}
	}
	if (ids.length > 1) {
		const counts = new Map<string, number>()
		for (const id of ids) {
			const o = layer?.objects.get(id)
			if (o) counts.set(o.type, (counts.get(o.type) ?? 0) + 1)
		}
		const breakdown = [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, name: displayName(type), n }))
		return { kind: 'models', count: ids.length, breakdown, groups: groupsOf() }
	}
	const area = editor.selection
	if (area) return { kind: 'area', ...area, holes: e?.holesInSelection() ?? 0 }
	const s = editor.selectedSpawn
	if (s) return { kind: 'spawn', s, panel: { spawns: relatedSpawns(editor.spawns, s), pick: ui.spawnPick } }
	return { kind: 'none' }
}

/** What the pool and formation fields of an editor read: every spawn of the region, and the pick under way. */
export function spawnPanel(): SpawnPanel {
	return { spawns: editor.spawns, pick: ui.spawnPick }
}

const spawnOf = (key: string) => editor.spawns.find((o) => spawnKey(o) === key)

/**
 * The pool and formation actions on the active map. `onswitch`: the editor around the fields, which asks
 * about its unsaved edits before it moves to a picked spawn.
 */
export function localSpawnActions(onswitch?: (o: vmangos.WorldSpawn) => void): SpawnPanelActions {
	const e = () => engineRef.current
	const change = (key: string, fn: (s: vmangos.WorldSpawn) => { changes: SpawnChange[]; label: string }) => {
		const s = spawnOf(key)
		if (!s) return
		const { changes, label } = fn(s)
		e()?.changeSpawns(changes, label)
	}
	return {
		pickSpawn(key) {
			const drawn = e()?.activeDocument().spawnLayer.get(key)
			if (!drawn) return
			if (onswitch) {
				onswitch(drawn)
				return
			}
			selectSpawn(drawn)
			if (drawn.kind === 'object') {
				if (ui.objectEditor?.key || editorWindowTarget.object?.key) ui.objectEditor = { key, entry: drawn.entry }
			}
			// A creature or object editor open on a spawn in its own window (#915, #916) moves to the picked one too, asking there about its unsaved edits.
			else if (ui.creatureEditor?.key || editorWindowTarget.creature?.key) ui.creatureEditor = { key, entry: drawn.entry }
		},
		poolSetting: (key, vals, label) => change(key, (s) => ({ changes: poolSettingChanges(editor.spawns, s, vals), label: `${label} (pool ${s.pool})` })),
		motherLimit: (key, limit) => change(key, (s) => ({ changes: motherLimitChanges(editor.spawns, s, limit), label: `Master pool limit (pool ${s.motherPool})` })),
		poolChance(key, chance) {
			const s = spawnOf(key)
			if (s) void e()?.editSpawn(key, { poolChance: Math.min(100, Math.max(0, chance)) }, `Pool chance (${s.name})`)
		},
		leavePool: (key) => change(key, (s) => ({ changes: leavePoolChanges(s), label: `Leave pool (${s.name})` })),
		leaveMother: (key) => change(key, (s) => ({ changes: leaveMotherChanges(editor.spawns, s), label: `Leave master pool ${s.motherPool} (pool ${s.pool})` })),
		makePool: (key) => void e()?.makePool(key),
		startPick: (key, mode) => e()?.startSpawnPick(key, mode),
		cancelPick: () => (ui.spawnPick = null),
		formationSlot(key, dist, angleDeg) {
			if (!Number.isFinite(dist) || !Number.isFinite(angleDeg)) return
			e()?.setFormationSlot(key, dist, (((angleDeg % 360) + 360) % 360) * (Math.PI / 180))
		},
		formationFlags: (key, flags) => change(key, (s) => ({ changes: flagChanges(editor.spawns, s, flags), label: `Formation flags (${s.name})` })),
		leaveFormation: (key) => change(key, (s) => ({ changes: leaveChanges(editor.spawns, s), label: `Leave formation (${s.name})` })),
		disband: (key) => change(key, (s) => ({ changes: disbandChanges(editor.spawns, s), label: `Disband formation (${s.name})` })),
	}
}

/** The Inspector's actions on the active map. A scrub's undo step goes back to the copy `start` took. */
export function localActions(): InspectorActions {
	const e = () => engineRef.current
	let before: WorldObject | undefined
	return {
		...localSpawnActions(),
		start() {
			const s = editor.selected
			before = s ? { ...s } : undefined
		},
		live: (patch) => e()?.editSelected(patch, false),
		commit(patch) {
			// A scrub begun on another model (the selection changed under it) makes no step of its own.
			const from = before && before.id === editor.selected?.id ? before : undefined
			e()?.editSelected(patch, true, from)
			before = undefined
		},
		detach: () => e()?.detachSelected(),
		group: () => e()?.groupSelected(),
		ungroup: () => e()?.ungroupSelected(),
		setDoodadSet: (set) => e()?.setDoodadSet(set),
		focus: () => e()?.focusSelected(),
		duplicate: () => e()?.duplicateSelected(),
		hide: () => e()?.toggleHideSelected(),
		remove: () => e()?.deleteSelected(),
		placeMore(type) {
			editor.prefab = type
			editor.tool = 'place'
		},
		selectType: (type, within) => e()?.selectModelsOfType(type, within),
		deselect: () => e()?.deselect(),
		setHole: (hole) => e()?.setHoleInSelection(hole),
		copyArea: () => void e()?.copySelection(),
		maskArea: () => e()?.maskFromSelection(),
		copyPath(path) {
			copyToClipboard(path).catch(() => {
				/* no clipboard in this context */
			})
		},
		openSpawnEditor(key) {
			const s = spawnOf(key) ?? (editor.selectedSpawn && spawnKey(editor.selectedSpawn) === key ? editor.selectedSpawn : undefined)
			if (!s) return
			if (s.kind === 'object') ui.objectEditor = { key, entry: s.entry }
			else ui.creatureEditor = { key, entry: s.entry }
		},
		focusSpawn(key) {
			const s = spawnOf(key) ?? (editor.selectedSpawn && spawnKey(editor.selectedSpawn) === key ? editor.selectedSpawn : undefined)
			if (s) e()?.focusSpawn(s)
		},
	}
}
