// What the Inspector shows (components/PropertiesPanel.svelte) and what it can do, in the page or in its
// own OS window (#910). The panel draws a plain InspectorView and calls InspectorActions: in the page the
// view is built from the Engine and the actions run on it (lib/toolwin/inspectorHost.ts); in its own window
// (components/toolwin/InspectorToolWindow.svelte) the view is the snapshot the main page publishes on the
// channel and each action is a command sent back, which the main page runs, so every edit stays an undo
// step of the main page's History. This module holds only the shapes and the pure parts, so the tests load it.
import type { KeyLike } from '../ui/commands'
import type { vmangos } from '../wails/models'
import type { WorldObject } from '../world/ObjectLayer'
import type { ToolCommand } from './channel'

/** The tool window kind of the Inspector (app_windows.go's toolWindowKinds). */
export const INSPECTOR_KIND = 'inspector'

/** What a click on the map does while a spawn's pool or formation is being built (ui.spawnPick). */
export type SpawnPickMode = 'lead' | 'follow' | 'pool' | 'joinPool' | 'joinMother'
export interface SpawnPick {
	mode: SpawnPickMode
	key: string
}

/** What the pool and formation fields read besides the spawn: the region's spawns they look at, and the pick on the map under way. */
export interface SpawnPanel {
	spawns: readonly vmangos.WorldSpawn[]
	pick: SpawnPick | null
}

/** The placement fields the Inspector edits. */
export type ObjectPatch = Partial<Pick<WorldObject, 'x' | 'z' | 'yOff' | 'rotY' | 'tiltX' | 'tiltZ' | 'scale'>>
const PATCH_KEYS = ['x', 'z', 'yOff', 'rotY', 'tiltX', 'tiltZ', 'scale'] as const

export interface InspectorModel {
	kind: 'model'
	/** A copy of the selected model. */
	o: WorldObject
	/** Its name and its path in the client, as the asset browser shows them. */
	name: string
	path: string
	/** The name of the model it is attached to (or `#id` when that one is gone); '' when it is not attached. */
	parentName: string
	/** The size of the selection group it is in; 0 for none. */
	groupSize: number
}

export interface InspectorModels {
	kind: 'models'
	count: number
	/** The selected models by kind, most numerous first. */
	breakdown: { type: string; name: string; n: number }[]
	/** The sizes of the selection groups they are in. */
	groups: number[]
}

export interface InspectorArea {
	kind: 'area'
	x0: number
	z0: number
	x1: number
	z1: number
	holes: number
}

export interface InspectorSpawn {
	kind: 'spawn'
	s: vmangos.WorldSpawn
	panel: SpawnPanel
}

/** What the Inspector shows: one model, several, a ground area, a spawn, or nothing selected. */
export type InspectorView = InspectorModel | InspectorModels | InspectorArea | InspectorSpawn | { kind: 'none' }

/** What the pool and formation fields do (components/PoolFields.svelte, FormationFields.svelte); spawns by spawnKey. */
export interface SpawnPanelActions {
	/** Selects another spawn of the pool or formation (an editor open on the first moves to it). */
	pickSpawn(key: string): void
	poolSetting(key: string, vals: { poolLimit?: number; poolName?: string }, label: string): void
	motherLimit(key: string, limit: number): void
	poolChance(key: string, chance: number): void
	leavePool(key: string): void
	leaveMother(key: string): void
	makePool(key: string): void
	/** Starts a pick on the map for the spawn (ui.spawnPick), or ends the one under way. */
	startPick(key: string, mode: SpawnPickMode): void
	cancelPick(): void
	/** Moves a follower into the slot at `dist` yards and `angleDeg` degrees from its leader's facing. */
	formationSlot(key: string, dist: number, angleDeg: number): void
	/** Sets a formation's flags, by its leader. */
	formationFlags(key: string, flags: number): void
	leaveFormation(key: string): void
	disband(key: string): void
}

/** What the Inspector's panel does. A scrubbed number calls `start`, `live` on each change and `commit` once at the end: one undo step. */
export interface InspectorActions extends SpawnPanelActions {
	start(): void
	live(patch: ObjectPatch): void
	commit(patch: ObjectPatch): void
	detach(): void
	group(): void
	ungroup(): void
	setDoodadSet(set: number): void
	focus(): void
	duplicate(): void
	hide(): void
	remove(): void
	/** Makes `type` the model the Place tool puts down. */
	placeMore(type: string): void
	/** Selects every model of `type` (`within`: only among the selected). */
	selectType(type: string, within: boolean): void
	deselect(): void
	setHole(hole: boolean): void
	copyArea(): void
	maskArea(): void
	copyPath(path: string): void
	openSpawnEditor(key: string): void
	focusSpawn(key: string): void
}

/** The actions that go to the main page as a `call` command: all but the edits, which have their own. */
export type CallName = Exclude<keyof InspectorActions, 'start' | 'live' | 'commit'>
const CALLS: Record<CallName, true> = {
	pickSpawn: true,
	poolSetting: true,
	motherLimit: true,
	poolChance: true,
	leavePool: true,
	leaveMother: true,
	makePool: true,
	startPick: true,
	cancelPick: true,
	formationSlot: true,
	formationFlags: true,
	leaveFormation: true,
	disband: true,
	detach: true,
	group: true,
	ungroup: true,
	setDoodadSet: true,
	focus: true,
	duplicate: true,
	hide: true,
	remove: true,
	placeMore: true,
	selectType: true,
	deselect: true,
	setHole: true,
	copyArea: true,
	maskArea: true,
	copyPath: true,
	openSpawnEditor: true,
	focusSpawn: true,
}
export const CALL_NAMES = Object.keys(CALLS) as CallName[]

/**
 * The Inspector window's commands to the main page: an action by name, a placement edit (a live one
 * while a number is scrubbed, then the commit, both naming the scrub they belong to), or a key pressed
 * in the window that the main page's shortcuts may want (Undo, Redo, Esc and I closing it).
 */
export type InspectorCommand = { type: 'call'; name: CallName; args: unknown[] } | { type: 'edit'; commit: boolean; patch: ObjectPatch; gesture: number } | { type: 'key'; key: KeyLike }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** The patch's placement fields that are numbers; anything else in it is dropped. */
export function cleanPatch(p: unknown): ObjectPatch {
	const out: ObjectPatch = {}
	if (!isObject(p)) return out
	for (const k of PATCH_KEYS) if (typeof p[k] === 'number' && Number.isFinite(p[k])) out[k] = p[k]
	return out
}

/** The key of a keydown, as a plain object that goes over the channel. */
export function keyOf(e: KeyLike): KeyLike {
	return { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }
}

/** The command if `cmd` is a well-formed Inspector command, else null. */
export function readInspectorCommand(cmd: ToolCommand): InspectorCommand | null {
	const c = cmd as Record<string, unknown>
	if (c.type === 'call') {
		if (typeof c.name !== 'string' || !Object.hasOwn(CALLS, c.name) || !Array.isArray(c.args)) return null
		return { type: 'call', name: c.name as CallName, args: c.args }
	}
	if (c.type === 'edit') {
		if (typeof c.gesture !== 'number' || typeof c.commit !== 'boolean') return null
		return { type: 'edit', commit: c.commit, patch: cleanPatch(c.patch), gesture: c.gesture }
	}
	if (c.type === 'key') {
		const k = c.key
		if (!isObject(k) || typeof k.key !== 'string') return null
		return { type: 'key', key: { key: k.key, code: typeof k.code === 'string' ? k.code : '', ctrlKey: k.ctrlKey === true, metaKey: k.metaKey === true, shiftKey: k.shiftKey === true } }
	}
	return null
}

/**
 * The main page's side of the window's scrubs. Commands travel as separate requests, so they can
 * arrive out of order: a live edit that lands after its scrub's commit, or after a later scrub began, is
 * dropped, and a scrub's first edit (a live one, or a typed number's commit) starts it, taking the copy
 * its undo step goes back to.
 */
export class EditGestures {
	private current = 0
	private done = 0

	/** What to do with an edit of scrub `gesture`: drop it, or apply it (`fresh`: it starts the scrub). */
	accept(gesture: number, commit: boolean): 'drop' | 'fresh' | 'same' {
		if (gesture <= this.done || gesture < this.current) return 'drop'
		const fresh = gesture !== this.current
		if (commit) {
			this.done = gesture
			this.current = 0
		} else this.current = gesture
		return fresh ? 'fresh' : 'same'
	}

	/** Whether a scrub has begun and not been committed. */
	get active(): boolean {
		return this.current !== 0
	}

	/** Forgets every scrub (the window loaded again). */
	reset() {
		this.current = this.done = 0
	}
}

/** Runs an action or edit command of the window on the main page's actions; false for a command it doesn't run (`key`). */
export function runInspectorCommand(cmd: InspectorCommand, act: InspectorActions, gestures: EditGestures): boolean {
	if (cmd.type === 'call') {
		;(act[cmd.name] as (...a: unknown[]) => void)(...cmd.args)
		return true
	}
	if (cmd.type === 'edit') {
		const how = gestures.accept(cmd.gesture, cmd.commit)
		if (how === 'drop') return true
		if (how === 'fresh') act.start()
		if (cmd.commit) act.commit(cmd.patch)
		else act.live(cmd.patch)
		return true
	}
	return false
}

/**
 * The actions of the Inspector in its own window: each sends a command to the main page. A scrub's live
 * edits are sent at most once a frame (`nextFrame`), the latest one only, and its commit at once.
 */
export function remoteActions(send: (cmd: InspectorCommand) => void, nextFrame: (fn: () => void) => void = (fn) => void requestAnimationFrame(() => fn())): InspectorActions {
	// Scrubs are numbered from the time, so a window opened again doesn't reuse the numbers of the last.
	let gesture = Date.now()
	let pending: ObjectPatch | null = null
	let queued = false
	const flush = () => {
		queued = false
		if (pending) send({ type: 'edit', commit: false, patch: pending, gesture })
		pending = null
	}
	const act: Record<string, unknown> = {
		start() {
			gesture++
			pending = null
		},
		live(patch: ObjectPatch) {
			pending = { ...pending, ...patch }
			if (queued) return
			queued = true
			nextFrame(flush)
		},
		commit(patch: ObjectPatch) {
			pending = null
			send({ type: 'edit', commit: true, patch, gesture })
		},
	}
	for (const name of CALL_NAMES) act[name] = (...args: unknown[]) => send({ type: 'call', name, args })
	// eslint-disable-next-line no-restricted-syntax -- built by name from CALL_NAMES, which CALLS keeps to every action
	return act as unknown as InspectorActions
}

/** The spawns of `spawns` the pool and formation fields of `s` read: its pool's, its master pool's, its formation's, and itself. */
export function relatedSpawns(spawns: readonly vmangos.WorldSpawn[], s: vmangos.WorldSpawn): vmangos.WorldSpawn[] {
	return spawns.filter((o) => (o.kind === s.kind && o.guid === s.guid) || (s.pool && o.pool === s.pool) || (s.motherPool && o.motherPool === s.motherPool) || (s.leader && (o.leader === s.leader || o.guid === s.leader)))
}
