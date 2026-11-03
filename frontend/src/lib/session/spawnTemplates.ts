// The templates a guest of a shared session places spawns from (#1050): the ones the session map's rows
// already use, read from the rows themselves, since a guest has no world database of its own (the owner's
// choice A on #1020: the host sends the rows with what each needs to draw). The spawn browser's creature
// and object tabs list them on a guest's session map, and placing one (the Place tool, the spawn brush)
// makes a copy of the row of that entry that looks most like the template itself: no display, equipment
// or pose of its own. A row that has them is copied with them, so the new spawn saves the look it draws
// with. No Go binding is read, so a Bun test can run it.
import type { vmangos } from '../wails/models'
import { newCreatureSpawn, newObjectSpawn } from '../world/spawnEdits'

/** The templates of a set of spawn rows, with the row of each entry a new spawn copies. */
export interface SpawnTemplates {
	creatures: vmangos.CreatureTemplate[]
	objects: vmangos.ObjectTemplate[]
	/** The row of each creature entry a new spawn of it copies (`modelRow`). */
	creatureRow: Map<number, vmangos.WorldSpawn>
	/** The look of each creature entry's row, as `SpawnLook` would give it. */
	creatureLook: Map<number, vmangos.LookResult>
	/** The row of each game object entry a new spawn of it copies. */
	objectRow: Map<number, vmangos.WorldSpawn>
}

/** How far a creature row's look is from its template's: a display or equipment of its own, or a pose other than standing with its weapons away. 0 is the template's. */
function ownness(s: vmangos.WorldSpawn): number {
	return (s.ownDisplay ? 4 : 0) + (s.ownEquipment ? 2 : 0) + (s.standState !== 0 || s.emoteState !== 0 || s.sheathState !== 1 ? 1 : 0)
}

/** Whether row `a` is a better model for a new spawn of its entry than `b`: nearer the template's look, then the lower guid. */
function better(a: vmangos.WorldSpawn, b: vmangos.WorldSpawn): boolean {
	const d = a.kind === 'object' ? 0 : ownness(a) - ownness(b)
	return d < 0 || (d === 0 && a.guid < b.guid)
}

/** A creature template as a row shows it: the row's display and equipment, and its template's part of the size. */
export function creatureFromRow(s: vmangos.WorldSpawn): vmangos.CreatureTemplate {
	return {
		entry: s.entry,
		name: s.name,
		subname: s.subname,
		levelMin: s.levelMin,
		levelMax: s.levelMax,
		faction: s.faction,
		npcFlags: s.npcFlags,
		rank: s.rank,
		type: s.type,
		display: s.display,
		scale: s.displayScale > 0 ? s.scale / s.displayScale : s.scale,
		equipment: s.equipment,
		model: s.model,
		look: s.look,
		displayScale: s.displayScale || 1,
	}
}

/** A game object template as a row shows it. */
export function objectFromRow(s: vmangos.WorldSpawn): vmangos.ObjectTemplate {
	return { entry: s.entry, name: s.name, type: s.type, display: s.display, size: s.scale || 1, model: s.model }
}

/** The templates `rows` use, one per entry, in entry order. */
export function templatesOf(rows: readonly vmangos.WorldSpawn[]): SpawnTemplates {
	const creatureRow = new Map<number, vmangos.WorldSpawn>()
	const objectRow = new Map<number, vmangos.WorldSpawn>()
	for (const s of rows) {
		const by = s.kind === 'object' ? objectRow : creatureRow
		const had = by.get(s.entry)
		if (!had || better(s, had)) by.set(s.entry, s)
	}
	const byEntry = (a: { entry: number }, b: { entry: number }) => a.entry - b.entry
	const creatureLook = new Map<number, vmangos.LookResult>()
	for (const [entry, s] of creatureRow) creatureLook.set(entry, { model: s.model, look: s.look, anim: s.anim, displayScale: s.displayScale || 1 })
	return {
		creatures: [...creatureRow.values()].map(creatureFromRow).sort(byEntry),
		objects: [...objectRow.values()].map(objectFromRow).sort(byEntry),
		creatureRow,
		creatureLook,
		objectRow,
	}
}

/** What `layerTemplates` reads of a `SpawnLayer`. */
interface TemplateLayer {
	readonly spawns: readonly vmangos.WorldSpawn[]
	readonly changeStamp: number
}

const cached = new WeakMap<TemplateLayer, { stamp: number; rows: readonly vmangos.WorldSpawn[]; t: SpawnTemplates }>()

/** The templates of a layer's rows, built again only when its `changeStamp` moved (the spawn brush asks every frame). */
export function layerTemplates(layer: TemplateLayer): SpawnTemplates {
	const c = cached.get(layer)
	if (c && c.stamp === layer.changeStamp && c.rows === layer.spawns) return c.t
	const t = templatesOf(layer.spawns)
	cached.set(layer, { stamp: layer.changeStamp, rows: layer.spawns, t })
	return t
}

/** A new creature spawn copying row `s`'s template, look and pose, with guid `guid`, at a point. */
export function copyCreatureRow(s: vmangos.WorldSpawn, guid: number, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn {
	const n = newCreatureSpawn(creatureFromRow(s), guid, x, y, z, orientation, { model: s.model, look: s.look, anim: s.anim, displayScale: s.displayScale || 1 })
	n.ownDisplay = s.ownDisplay
	n.ownEquipment = s.ownEquipment
	n.equipItems = s.equipItems ? s.equipItems.slice() : [0, 0, 0]
	n.standState = s.standState
	n.emoteState = s.emoteState
	n.sheathState = s.sheathState
	return n
}

/** A new game object spawn copying row `s`'s template, with guid `guid`, at a point. */
export function copyObjectRow(s: vmangos.WorldSpawn, guid: number, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn {
	return newObjectSpawn(objectFromRow(s), guid, x, y, z, orientation)
}
