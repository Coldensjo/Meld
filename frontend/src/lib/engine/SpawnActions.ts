import * as THREE from 'three'
import { editor, setStatus, ui, type ContextItem } from '../state/editor.svelte'
import type { MapDocument } from './MapDocument'
import type { vmangos } from '../../../wailsjs/go/models'
import { NextCreatureGUID, NextObjectGUID, NextPoolEntry, ObjectModel, SpawnLook, SpawnTeleports } from '../../../wailsjs/go/main/App'
import type { SpawnBrushEntry } from '../tools/spawnBrush'
import type { TriggerDestination } from '../world/areaTriggers'
import { spawnType } from '../world/spawnInfo'
import { copyItems } from '../ui/copyId'
import { spawnKey, spawnOrientation, spawnRotation } from '../world/SpawnLayer'
import { creatureOf, follows, joinChanges, leaveChanges, slotFieldsAt, slotPosition, type SpawnChange } from '../world/formations'
import { joinMotherChanges, joinPoolChanges, leavePoolChanges, newPoolFields } from '../world/pools'
import { creatureTemplateOf, newCreatureSpawn, newObjectSpawn, selectSpawn, spawnAdd, spawnChange, spawnDelete, spawnsChange, syncSpawnUi, withLook, withPoint, type SpawnFields } from '../world/spawnEdits'

/** The most Teleport items a spawn's menu lists (#308); a boss with many blink spots would fill the screen. */
const MAX_TELEPORT_ITEMS = 10

/** The two guid ranges of the world database: `creature.guid` and `gameobject.guid`. */
export type SpawnKind = 'creature' | 'object'

/** What the guid and pool searches read of an open tab. */
type SpawnsOf = { readonly spawnLayer: { readonly spawns: readonly vmangos.WorldSpawn[] } }

/** The spawn's guid range: game objects have their own, every other kind is a creature. */
const kindOf = (s: vmangos.WorldSpawn): SpawnKind => (s.kind === 'object' ? 'object' : 'creature')

/**
 * The lowest guid of `kind` that is at least `floor` and above every spawn of that kind in every open
 * tab, so spawns placed in different tabs never share one.
 */
export function nextFreeGuid(docs: readonly SpawnsOf[], kind: SpawnKind, floor: number): number {
	let guid = floor
	for (const doc of docs) for (const s of doc.spawnLayer.spawns) if (kindOf(s) === kind) guid = Math.max(guid, s.guid + 1)
	return guid
}

/** The lowest pool entry that is at least `floor` and above every pool a spawn of an open tab is in. */
export function nextFreePoolEntry(docs: readonly SpawnsOf[], floor: number): number {
	let entry = floor
	for (const doc of docs) for (const s of doc.spawnLayer.spawns) entry = Math.max(entry, s.pool + 1)
	return entry
}

/** What SpawnActions needs of the Engine. */
export interface SpawnHost {
	/** Every open tab. */
	readonly documents: readonly MapDocument[]
	/** The active tab, whose spawns are edited. */
	readonly doc: MapDocument
	/** Where the camera stands, which a placed spawn faces. */
	readonly cameraPos: THREE.Vector3
	/** Counts the viewport menus opened, so a late answer finds whether its menu is still up. */
	readonly menuSeq: number
	/** Moves the camera to look at (x, z) of the active region from `distance` yards. */
	focus(x: number, z: number, distance: number): void
	/** Drops the selection of placed models. */
	deselect(): void
	/** Teleport to destination (`io/region.ts` `teleportTo`). */
	teleport(dest: TriggerDestination, what: string): void
}

/**
 * The editing of the world database's spawns, out of Engine (#557): placing creatures and game
 * objects (also with the spawn brush), their fields, paths, formations and pools, the template
 * updates, the right-click menu's spawn items and the spawn keys. Engine forwards the public names.
 */
export class SpawnActions {
	/** The guid the next placed spawn of each kind gets; 0 until the world database has been asked. */
	private next: Record<SpawnKind, number> = { creature: 0, object: 0 }
	/** A read of the database's next creature guid is under way (for the spawn brush, which can't wait). */
	private guidReading = false
	/** The looks of the spawn brush's templates (#171), by display and equipment; null while one is read. */
	private brushLooks = new Map<string, vmangos.LookResult | null>()

	constructor(private host: SpawnHost) {}

	/** Takes the next free guid of `kind`, at least `dbNext` (the database's next one, or 0 once known). */
	private takeGuid(kind: SpawnKind, dbNext: number): number {
		const guid = nextFreeGuid(this.host.documents, kind, Math.max(this.next[kind], dbNext))
		this.next[kind] = guid + 1
		return guid
	}

	/** The database's next guid of `kind`, read only until the first spawn of that kind is placed. */
	private dbGuid(kind: SpawnKind): Promise<number> {
		if (this.next[kind]) return Promise.resolve(0)
		return kind === 'object' ? NextObjectGUID() : NextCreatureGUID()
	}

	/** Moves the camera to a spawn, in the active region's coordinates. */
	focusSpawn(s: vmangos.WorldSpawn) {
		this.host.focus(s.x, s.z, 40)
	}

	/** Moves the camera to a point of the active region, such as a waypoint. */
	focusPoint(x: number, z: number) {
		this.host.focus(x, z, 30)
	}

	/**
	 * Starts editing creature `key`'s path on the map (#138): selects it in the Select tool, closes the
	 * creature editor that would cover the map, and picks the last point, so a click on the ground
	 * adds a point at the end. `PathEditBar` shows what can be done until Done or Esc.
	 */
	editPath(key: string) {
		const s = this.host.doc.spawnLayer.get(key)
		if (!s || s.kind === 'object') return
		if (editor.tool !== 'select') editor.tool = 'select'
		selectSpawn(s)
		ui.creatureEditor = null
		editor.selectedWaypoint = (s.waypoints?.length ?? 0) - 1
		ui.pathEdit = true
	}

	/**
	 * Starts building the selected spawn `key`'s formation or pool on the map (#172): clicks on spawns
	 * then follow `ui.spawnPick`'s mode (see `pickSpawn`) until Done or Esc. `SpawnPickBar` says what a
	 * click does.
	 */
	startSpawnPick(key: string, mode: 'lead' | 'follow' | 'pool' | 'joinPool' | 'joinMother') {
		const s = this.host.doc.spawnLayer.get(key)
		if (!s || ((mode === 'lead' || mode === 'follow') && s.kind === 'object')) return
		if (editor.tool !== 'select') editor.tool = 'select'
		selectSpawn(s)
		ui.creatureEditor = ui.objectEditor = null
		ui.pathEdit = false
		ui.spawnPick = { mode, key }
	}

	/**
	 * A click on spawn `o` while `ui.spawnPick` is on, as one undo step: in `lead`, `o` follows the
	 * picked creature (or leaves, when it does already); in `follow`, the picked creature follows `o`'s
	 * leader (or `o`) and the picking ends; in `pool`, `o` joins the picked spawn's pool (or leaves it);
	 * in `joinPool`, the picked spawn joins `o`'s pool and the picking ends; in `joinMother`, the picked
	 * spawn's pool joins `o`'s pool's mother pool (#261) and the picking ends.
	 */
	pickSpawn(o: vmangos.WorldSpawn) {
		const pick = ui.spawnPick
		const d = this.host.doc
		const layer = d.spawnLayer
		const s = pick ? layer.get(pick.key) : undefined
		if (!pick || !s) {
			ui.spawnPick = null
			return
		}
		if (o.guid === s.guid && o.kind === s.kind) return
		let changes: SpawnChange[] | string = []
		let label = ''
		let done = false
		switch (pick.mode) {
			case 'lead':
				if (o.kind !== 'object' && o.leader === s.guid) {
					changes = leaveChanges(layer.spawns, o)
					label = `Leave formation (${o.name})`
				} else {
					changes = joinChanges(layer.spawns, s, o)
					label = `Join formation (${o.name})`
				}
				break
			case 'follow': {
				const leader = follows(o) ? creatureOf(layer.spawns, o.leader) : o
				if (!leader) {
					setStatus(`${o.name}'s leader is not in this region.`, 4000)
					return
				}
				changes = leader.guid === s.guid ? `${s.name} can't follow its own follower.` : joinChanges(layer.spawns, leader, s)
				label = `Follow ${leader.name} (${s.name})`
				done = true
				break
			}
			case 'pool':
				if (o.pool === s.pool && (o.kind === 'object') === (s.kind === 'object')) {
					changes = leavePoolChanges(o)
					label = `Leave pool (${o.name})`
				} else {
					changes = joinPoolChanges(s, o)
					label = `Join pool (${o.name})`
				}
				break
			case 'joinPool':
				changes = joinPoolChanges(o, s)
				label = `Join pool (${s.name})`
				done = true
				break
			case 'joinMother':
				changes = joinMotherChanges(layer.spawns, o, s)
				label = `Join master pool ${o.motherPool} (pool ${s.pool})`
				done = true
				break
		}
		if (typeof changes === 'string') {
			setStatus(changes, 5000)
			return
		}
		const cmd = spawnsChange(layer, changes, label)
		if (cmd) d.history.push(cmd)
		if (done) ui.spawnPick = null
	}

	/** Changes several spawns of the active region (`formations.ts`, `pools.ts` changes) as one undo step. */
	changeSpawns(changes: readonly SpawnChange[], label: string) {
		const d = this.host.doc
		const cmd = spawnsChange(d.spawnLayer, changes, label)
		if (cmd) d.history.push(cmd)
	}

	/**
	 * Puts spawn `key` into a new pool of its own (#172), with a limit of 1 and the pool entry after
	 * every one the world database and the open regions use, then starts adding spawns to it.
	 */
	async makePool(key: string) {
		const d = this.host.doc
		const s = d.spawnLayer.get(key)
		if (!s) return
		try {
			const entry = nextFreePoolEntry(this.host.documents, await NextPoolEntry())
			if (entry > 65535) throw new Error('every pool entry up to 65535 is taken')
			const cmd = spawnsChange(d.spawnLayer, [{ key, vals: newPoolFields(entry, `${s.name} (Meld)`) }], `Make pool (${s.name})`)
			if (cmd) d.history.push(cmd)
			if (d === this.host.doc) this.startSpawnPick(key, 'pool')
		} catch (err) {
			setStatus(`Could not make a pool: ${err}`, 8000)
		}
	}

	/**
	 * Gives follower `key` the slot `dist` yards from its leader at `angle` radians from the leader's
	 * facing, and moves it there, onto the ground, as one undo step.
	 */
	setFormationSlot(key: string, dist: number, angle: number) {
		const d = this.host.doc
		const layer = d.spawnLayer
		const s = layer.get(key)
		const leader = s && follows(s) ? creatureOf(layer.spawns, s.leader) : undefined
		if (!s || !leader) return
		const p = slotPosition(leader, Math.max(0, dist), angle, { x: 0, z: 0 })
		const vals: SpawnFields = { followDist: Math.max(0, dist), followAngle: angle }
		if (d.terrain.contains(p.x, p.z)) Object.assign(vals, { x: p.x, z: p.z, y: d.terrain.heightAt(p.x, p.z) })
		const cmd = spawnChange(layer, key, vals, `Formation slot (${s.name})`)
		if (cmd) d.history.push(cmd)
	}

	/** Deletes the picked point of the selected creature's path, as one undo step. */
	deletePathPoint() {
		const sel = editor.selectedSpawn
		const i = editor.selectedWaypoint
		if (!sel || i < 0) return
		const d = this.host.doc
		const s = d.spawnLayer.get(spawnKey(sel))
		if (!s?.waypoints?.[i]) return
		const cmd = spawnChange(d.spawnLayer, spawnKey(sel), { waypoints: withPoint(s.waypoints, i, null) }, `Delete path point (${sel.name})`)
		if (cmd) d.history.push(cmd)
		editor.selectedWaypoint = Math.min(i, s.waypoints.length - 1)
	}

	/**
	 * Changes fields of the active region's spawn `key` as one undoable step. A creature whose
	 * display, equipment or pose changes is dressed again by the Go side first.
	 */
	async editSpawn(key: string, vals: SpawnFields, label: string) {
		const d = this.host.doc
		const s = d.spawnLayer.get(key)
		if (!s) return
		let full: SpawnFields
		try {
			full = await withLook(s, vals)
		} catch (err) {
			setStatus(`Could not dress the spawn: ${err}`, 8000)
			return
		}
		// A follower moved takes its slot where it stands now (#172).
		if (vals.x !== undefined || vals.z !== undefined) Object.assign(full, slotFieldsAt(d.spawnLayer.spawns, s, vals.x ?? s.x, vals.z ?? s.z))
		const cmd = spawnChange(d.spawnLayer, key, full, label)
		if (cmd) d.history.push(cmd)
	}

	/** The spawn brush's look for a template: its result, or null while it is read (asked for then). */
	brushLook(e: SpawnBrushEntry): vmangos.LookResult | null {
		const key = `${e.display}|${e.equipment}`
		if (this.brushLooks.has(key)) return this.brushLooks.get(key) ?? null
		this.brushLooks.set(key, null)
		SpawnLook(e.display, e.equipment, 0, 0, 1)
			.then((look) => this.brushLooks.set(key, look))
			.catch((err) => {
				this.brushLooks.delete(key)
				setStatus(`Could not dress ${e.name}: ${err}`, 6000)
			})
		return null
	}

	/**
	 * A new creature of a spawn brush template (#171), with the next free guid, as placeCreature gives
	 * one; null while its look or the database's next guid is still read. It must stay synchronous
	 * (the brush can't await), hence `guidReading`.
	 */
	brushCreature(e: SpawnBrushEntry, x: number, y: number, z: number, orientation: number): vmangos.WorldSpawn | null {
		const look = this.brushLook(e)
		if (!this.next.creature) {
			if (!this.guidReading) {
				this.guidReading = true
				NextCreatureGUID()
					.then((g) => (this.next.creature = Math.max(this.next.creature, g)))
					.catch((err) => setStatus(`Could not read the next creature guid: ${err}`, 6000))
					.finally(() => (this.guidReading = false))
			}
			return null
		}
		if (!look) return null
		return newCreatureSpawn({ ...e, model: '', look: '', displayScale: 1 }, this.takeGuid('creature', 0), x, y, z, orientation, look)
	}

	/** Spawns whichever template the browser's spawn tabs picked (ui.placeCreature or ui.placeObject) at a point. */
	placeSpawnAt(at: THREE.Vector3, rotY?: number) {
		if (ui.placeCreature) void this.placeCreature(ui.placeCreature, at, rotY)
		else if (ui.placeObject) void this.placeObject(ui.placeObject, at, rotY)
	}

	/** Spawns a game object template at a point, facing the camera (or turned `rotY`), as one undo step. */
	placeObject(t: vmangos.ObjectTemplate, at: THREE.Vector3, rotY?: number) {
		return this.place(t.name, async () => {
			const guid = this.takeGuid('object', await this.dbGuid('object'))
			return newObjectSpawn(t, guid, at.x, at.y, at.z, this.facing(at, rotY))
		})
	}

	/**
	 * Spawns creature template `t` at `at` in the active region, facing the camera (or turned `rotY`),
	 * as one undoable step, and selects it. Its guid is above every creature guid of the world database
	 * and of every open region, so creatures placed in different tabs never share one.
	 */
	placeCreature(t: vmangos.CreatureTemplate, at: THREE.Vector3, rotY?: number) {
		return this.place(t.name, async () => {
			const [dbNext, look] = await Promise.all([this.dbGuid('creature'), SpawnLook(t.display, t.equipment, 0, 0, 1)])
			return newCreatureSpawn(t, this.takeGuid('creature', dbNext), at.x, at.y, at.z, this.facing(at, rotY), look)
		})
	}

	/** Adds the spawn `make` builds to the tab active when it was asked for, as one undo step, and selects it. */
	private async place(name: string, make: () => Promise<vmangos.WorldSpawn>) {
		const d = this.host.doc
		try {
			const s = await make()
			d.history.push(spawnAdd(d.spawnLayer, s, `Add ${name}`))
			if (d === this.host.doc) selectSpawn(s)
		} catch (err) {
			setStatus(`Could not place ${name}: ${err}`, 8000)
		}
	}

	/** A placed spawn's orientation: `rotY`, or facing the camera (the model's front, +X at rest, turned towards it). */
	private facing(at: THREE.Vector3, rotY?: number): number {
		const cam = this.host.cameraPos
		return spawnOrientation(rotY ?? Math.atan2(-(cam.z - at.z), cam.x - at.x))
	}

	/**
	 * Brings the spawns of creature template `entry` in every open region up to date after the
	 * template was saved (`was` its values before): name, level, faction and the like, and for a spawn
	 * showing the template's display or equipment rather than its own, the new ones. The database
	 * already has this, so it is not a spawn edit to save, nor an undo step.
	 */
	async applyCreatureTemplate(entry: number, now: Record<string, string>, was: Record<string, string>) {
		const t = creatureTemplateOf(entry, now)
		const old = creatureTemplateOf(entry, was)
		const info: Partial<vmangos.WorldSpawn> = {
			name: t.name,
			subname: t.subname,
			levelMin: t.levelMin,
			levelMax: t.levelMax,
			faction: t.faction,
			npcFlags: t.npcFlags,
			rank: t.rank,
			type: t.type,
		}
		const looks = new Map<string, Promise<vmangos.LookResult>>()
		for (const d of this.host.documents) {
			const layer = d.spawnLayer
			let touched = false
			for (const s of layer.spawns.slice()) {
				if (s.kind === 'object' || s.entry !== entry) continue
				const vals: Partial<vmangos.WorldSpawn> = { ...info }
				const ownDisplay = s.display !== old.display
				const display = ownDisplay ? s.display : t.display
				const equipment = s.equipment === old.equipment ? t.equipment : s.equipment
				if (display !== s.display || equipment !== s.equipment || (!ownDisplay && t.scale !== old.scale)) {
					const key = [display, equipment, s.standState, s.emoteState, s.sheathState].join('|')
					let p = looks.get(key)
					if (!p) {
						p = SpawnLook(display, equipment, s.standState, s.emoteState, s.sheathState)
						looks.set(key, p)
					}
					try {
						const l = await p
						const templateScale = ownDisplay ? (s.displayScale > 0 ? s.scale / s.displayScale : 1) : t.scale
						Object.assign(vals, { display, equipment, model: l.model, look: l.look, anim: l.anim, displayScale: l.displayScale, scale: templateScale * (l.displayScale || 1) })
					} catch (err) {
						console.warn('spawn not re-dressed', err)
					}
				}
				layer.rebase(s, vals)
				touched = true
			}
			if (touched && d === this.host.doc) syncSpawnUi(layer, true)
		}
	}

	/**
	 * Brings the spawns of game object template `entry` in every open region up to date after the
	 * template was saved (`was` its values before): name, type, and the model and size of its display.
	 * As with applyCreatureTemplate, the database has this already, so it is no edit and no undo step.
	 */
	async applyObjectTemplate(entry: number, now: Record<string, string>, was: Record<string, string>) {
		const n = (v: Record<string, string>, col: string) => Number(v[col]) || 0
		const display = n(now, 'displayId')
		const vals: Partial<vmangos.WorldSpawn> = { name: now.name ?? '', type: n(now, 'type'), display, scale: n(now, 'size') || 1 }
		if (display !== n(was, 'displayId')) {
			try {
				vals.model = await ObjectModel(display)
			} catch (err) {
				console.warn('object model not read', err)
			}
		}
		for (const d of this.host.documents) {
			let touched = false
			for (const s of d.spawnLayer.spawns.slice()) {
				if (s.kind !== 'object' || s.entry !== entry) continue
				d.spawnLayer.rebase(s, vals)
				touched = true
			}
			if (touched && d === this.host.doc) syncSpawnUi(d.spawnLayer, true)
		}
	}

	/** Deletes the selected spawn of the active region, undoably. */
	deleteSelectedSpawn() {
		const sel = editor.selectedSpawn
		if (!sel) return
		const d = this.host.doc
		const cmd = spawnDelete(d.spawnLayer, spawnKey(sel), `Delete ${sel.name}`)
		if (cmd) d.history.push(cmd)
	}

	/** The active region's spawn edits for the world database. */
	spawnEdits(): vmangos.SpawnEdit[] {
		return this.host.doc.spawnLayer.edits()
	}

	/** The world database now has the active region's spawn edits. */
	markSpawnsSaved() {
		const layer = this.host.doc.spawnLayer
		layer.markSaved()
		syncSpawnUi(layer)
	}

	/**
	 * The right-click menu of spawn `spawn` (#205): selects it in the Select tool and gives the menu's
	 * title and items. Its Teleport items come later, from `addTeleports`.
	 */
	menu(spawn: vmangos.WorldSpawn): { title: string; items: ContextItem[] } {
		if (editor.tool !== 'select') editor.tool = 'select'
		selectSpawn(spawn)
		const key = spawnKey(spawn)
		const title = `${spawn.name} (${spawn.kind === 'object' ? 'object' : 'creature'} ${spawn.entry}${spawn.model ? '' : ', invisible in the game'})`
		const items: ContextItem[] = []
		if (spawn.kind !== 'object') {
			items.push({ label: 'Edit creature…', run: () => (ui.creatureEditor = { key, entry: spawn.entry }) })
			items.push({ label: spawn.waypoints?.length ? 'Edit path' : 'Give it a path', run: () => this.editPath(key) })
		} else {
			items.push({ label: 'Edit object…', run: () => (ui.objectEditor = { key, entry: spawn.entry }) })
		}
		items.push({ label: 'Focus', shortcut: 'F', run: () => this.focusSpawn(spawn) })
		const type = spawnType(spawn)
		if (type) items.push({ label: 'Preview', run: () => (ui.modelPreview = { title: spawn.name || `#${spawn.entry}`, type, scale: spawn.scale > 0 ? spawn.scale : 1 }) })
		items.push({
			label: 'Unselect',
			run: () => {
				selectSpawn(null)
				this.host.deselect()
			},
		})
		const kind = spawn.kind === 'object' ? 'object' : 'creature'
		// Copy id (#681): the template's entry and this placement's guid (none yet for a new spawn).
		const ids = [{ what: `${kind} entry`, id: spawn.entry }, ...(spawn.guid > 0 ? [{ what: 'spawn guid', id: spawn.guid }] : [])]
		items.push({ separator: true }, ...copyItems({ ids, name: spawn.name }))
		items.push({ separator: true }, { label: 'Delete spawn', shortcut: 'Del', danger: true, run: () => this.deleteSelectedSpawn() })
		return { title, items }
	}

	/**
	 * Adds a spawn's Teleport items to its open menu once the world database answers (#306, #308): one
	 * a destination its gossip, spells and scripts lead to (`SpawnTeleports`), above Focus. Nothing is
	 * added when it teleports no one, or when the menu was closed or replaced meanwhile (`seq` is the
	 * host's `menuSeq` when it opened).
	 */
	async addTeleports(spawn: vmangos.WorldSpawn, seq: number, title: string) {
		let found: vmangos.SpawnTeleport[]
		try {
			found = (await SpawnTeleports(spawn.kind === 'object' ? 'object' : 'creature', spawn.entry, spawn.guid)) ?? []
		} catch {
			return
		}
		const menu = ui.contextMenu
		if (!found.length || seq !== this.host.menuSeq || !menu || menu.title !== title) return
		const what = spawn.name || `#${spawn.entry}`
		const total = new Map<string, number>()
		for (const t of found) total.set(t.label, (total.get(t.label) ?? 0) + 1)
		const seen = new Map<string, number>()
		const items: ContextItem[] = found.slice(0, MAX_TELEPORT_ITEMS).map((t) => {
			const n = (seen.get(t.label) ?? 0) + 1
			seen.set(t.label, n)
			// A creature that blinks between several spots under one name: number them.
			const label = (total.get(t.label) ?? 0) > 1 ? `${t.label} (${n})` : t.label
			return { label: `Teleport: ${label}`, run: () => this.host.teleport(t.dest, `${what}, ${label}`) }
		})
		const at = menu.items.findIndex((i) => i.label === 'Focus')
		ui.contextMenu = { ...menu, items: [...menu.items.slice(0, at), ...items, ...menu.items.slice(at)] }
	}

	/**
	 * Keys for a spawn selected alone: turn it (R), delete it, deselect it. While its path is being
	 * edited, Delete removes the picked point and Esc stops editing. Esc also stops placing spawns and
	 * picking them for a formation or pool. True when the key was used.
	 */
	handleKey(e: KeyboardEvent): boolean {
		if ((ui.placeCreature || ui.placeObject) && e.key === 'Escape') {
			ui.placeCreature = ui.placeObject = null
			setStatus('Stopped placing creatures.')
			return true
		}
		const sel = editor.selectedSpawn
		if (!sel || editor.selectedIds.length > 0 || editor.tool !== 'select') return false
		if (ui.spawnPick && e.key === 'Escape') {
			ui.spawnPick = null
			return true
		}
		if (ui.pathEdit) {
			if (e.key === 'Escape') {
				ui.pathEdit = false
				return true
			}
			if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedWaypoint >= 0) {
				this.deletePathPoint()
				return true
			}
		}
		switch (e.key) {
			case 'r':
			case 'R': {
				const spin = THREE.MathUtils.degToRad(e.altKey ? 5 : 15) * (e.shiftKey ? -1 : 1)
				const o = spawnOrientation(spawnRotation(sel.orientation) + spin)
				void this.editSpawn(spawnKey(sel), { orientation: o }, `Turn ${sel.name}`)
				return true
			}
			case 'Delete':
			case 'Backspace':
				this.deleteSelectedSpawn()
				return true
			case 'Escape':
				selectSpawn(null)
				return true
		}
		return false
	}
}
