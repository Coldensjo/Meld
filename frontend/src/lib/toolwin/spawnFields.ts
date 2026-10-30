// What the creature and object editors do on the map (#915, #916): the spawn fields'
// edits (components/SpawnFields.svelte), each an undo step of the main page's History, selecting another
// spawn, and a saved template applied to its spawns on the map. In the main page these run on the Engine
// (lib/toolwin/spawnFieldsHost.svelte.ts); in an editor's own OS window each is a `map` command sent to the
// main page, which runs it there, and the main page publishes back what the fields read (SpawnFieldsView).
// This module holds only the shapes, so the tests load it.
import type { vmangos } from '../wails/models'
import type { SpawnFields } from '../world/spawnEdits'
import type { SpawnPanel, SpawnPanelActions } from './inspector'

/** What the spawn fields read of the main page besides the spawn: the pool and formation panel, the path edit on the map and its picked point. */
export interface SpawnFieldsView {
	panel: SpawnPanel
	pathEdit: boolean
	waypoint: number
}

export const NO_SPAWN_FIELDS: SpawnFieldsView = { panel: { spawns: [], pick: null }, pathEdit: false, waypoint: -1 }

/** What an editor does on the map; spawns by spawnKey. */
export interface MapActions extends SpawnPanelActions {
	/** Applies a change to a spawn, as one undo step named `label`. */
	edit(key: string, vals: SpawnFields, label: string): void
	/** Starts editing the spawn's path on the map (Engine.editPath), or ends it. */
	editPath(key: string): void
	stopPathEdit(): void
	focusPoint(x: number, z: number): void
	/** Picks a point of the selected spawn's path (editor.selectedWaypoint). */
	pickWaypoint(i: number): void
	/** Opens the gear picker for a slot of the spawn (in an editor's window, the window's own). */
	chooseWeapon(key: string, slot: number): void
	/** Selects the spawn on the map. */
	selectSpawn(key: string): void
	/** The creature template was saved: its spawns on the map take the new values, as one undo step. */
	applyCreatureTemplate(entry: number, now: Record<string, string>, was: Record<string, string>): void | Promise<void>
	/** Makes the template the Place tool's creature, in the Select tool. */
	placeCreature(t: vmangos.CreatureTemplate): void
	/** Opens the creature guide (CreaturesWorkspace). */
	openCreatures(): void
	/** The object template was saved: its spawns on the map take the new values, as one undo step (#916). */
	applyObjectTemplate(entry: number, now: Record<string, string>, was: Record<string, string>): void | Promise<void>
	/** Makes the template the Place tool's object, in the Select tool. */
	placeObject(t: vmangos.ObjectTemplate): void
}

/** The actions that go to the main page as a `map` command: all but the gear picker, which an editor's window opens itself. */
export type MapCallName = Exclude<keyof MapActions, 'chooseWeapon'>
const CALLS: Record<MapCallName, true> = {
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
	edit: true,
	editPath: true,
	stopPathEdit: true,
	focusPoint: true,
	pickWaypoint: true,
	selectSpawn: true,
	applyCreatureTemplate: true,
	placeCreature: true,
	openCreatures: true,
	applyObjectTemplate: true,
	placeObject: true,
}
export const MAP_CALL_NAMES = Object.keys(CALLS) as MapCallName[]

/** An editor window's map action, by name, with its arguments. */
// A type, not an interface, so it goes in a ToolCommand (which has an index signature).
export type MapCall = {
	name: MapCallName
	args: unknown[]
}

/** The call if `name` and `args` make a well-formed one, else null. */
export function readMapCall(name: unknown, args: unknown): MapCall | null {
	if (typeof name !== 'string' || !Object.hasOwn(CALLS, name) || !Array.isArray(args)) return null
	return { name: name as MapCallName, args }
}

/** Runs a map call of an editor's window on the main page's actions. */
export function runMapCall(call: MapCall, act: MapActions) {
	void (act[call.name] as (...a: unknown[]) => unknown)(...call.args)
}

/**
 * The map actions of an editor in its own window: each sends a `map` command. `chooseWeapon` opens the
 * window's own gear picker, and a pick of another spawn of the pool or formation goes through the editor
 * around the fields (`onswitch`, which asks about its unsaved edits), finding the spawn among the panel's.
 */
export function remoteMapActions(
	send: (call: MapCall) => void,
	local: { chooseWeapon(key: string, slot: number): void; spawns(): readonly vmangos.WorldSpawn[]; keyOf(s: vmangos.WorldSpawn): string },
	onswitch?: (o: vmangos.WorldSpawn) => void,
): MapActions {
	const act: Record<string, unknown> = {}
	for (const name of MAP_CALL_NAMES) act[name] = (...args: unknown[]) => send({ name, args })
	act.chooseWeapon = local.chooseWeapon
	if (onswitch)
		act.pickSpawn = (key: string) => {
			const o = local.spawns().find((s) => local.keyOf(s) === key)
			if (o) onswitch(o)
		}
	// eslint-disable-next-line no-restricted-syntax -- built by name from MAP_CALL_NAMES, which CALLS keeps to every action but chooseWeapon, added above
	return act as unknown as MapActions
}
