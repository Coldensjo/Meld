// Draws a cube world's attached objects and links (#32): each object as a box where the game puts it
// in its state (objects.ts objectExtent), coloured by kind (a torch by its fire's colour); for the selected object an outline and a
// line to each object it acts on (a lever to its door, a teleporter to the pad it leads to); and an
// outline round every cube of the groups of joined cubes that reach into the Select tool's box. Monster
// spawn points (#91) are drawn too: a box of the kind's body and colour standing on the bottom of its
// cube, with the kind's name above it (several in one cube side by side). NPCs (#99) are drawn the same
// way, a box of the NPC's body and colour with its name, each cube of its route as a flat marker in its
// colour and the route as a closed loop of lines (start, each cube in turn, back to the start), the
// selected NPC's in yellow and seen through the cubes. Objects, spawn points and NPCs are few, so it is
// redrawn whole when something changes (CubeLayer.update asks).

import * as THREE from 'three'
import type { CubeWorld, SpawnPoint, WorldObject } from './world'
import { CUBE_HEIGHT, CUBE_SIZE } from './shapes'
import { layerBottom } from './mesher'
import { FIRE_MARK_COLOURS, OBJECT_COLOURS, TELEPORTER, TORCH, groupsIn, objectExtent } from './objects'
import type { CubeBox } from './clip'
import { monsterKind } from './monsterKinds'
import { npcLook } from './npcNames'
import { blockedLegs, type NpcPoint } from './npcs'

const COLOUR_SELECTED = 0xffe066
const COLOUR_LINK = 0xffe066
const COLOUR_JOIN = 0x4affc0
/** A spawn point whose kind the game does not know: grey, so the author sees it needs fixing. */
const COLOUR_UNKNOWN_MONSTER = 0x808080
/** An NPC's route line, and the selected NPC's. */
const COLOUR_ROUTE = 0x7fd0ff
const COLOUR_ROUTE_SELECTED = 0xffe066
/** A leg of a route that crosses solid cubes. */
const COLOUR_ROUTE_BLOCKED = 0xff3030
/** A route marker: its side and height, metres. */
const ROUTE_MARK = 0.7
const ROUTE_MARK_HEIGHT = 0.12
/** The most cubes of joined groups outlined at once. */
const MAX_JOIN_OUTLINES = 2000

let kindMaterials: THREE.Material[] | null = null
function materials(): THREE.Material[] {
	kindMaterials ??= OBJECT_COLOURS.map((c, kind) =>
		kind === TELEPORTER || kind === TORCH ? new THREE.MeshBasicMaterial({ color: c }) : new THREE.MeshLambertMaterial({ color: c, transparent: kind === 1, opacity: kind === 1 ? 0.6 : 1 }),
	)
	return kindMaterials
}

let fireMaterials: THREE.Material[] | null = null
/** The material of an object's mark: its kind's, or for a torch its fire colour's. */
function markMaterial(kind: number, colour: number | undefined): THREE.Material {
	if (kind !== TORCH || !colour) return materials()[kind]
	fireMaterials ??= FIRE_MARK_COLOURS.map((c) => new THREE.MeshBasicMaterial({ color: c }))
	return fireMaterials[colour] ?? materials()[kind]
}

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
const unitEdges = new THREE.EdgesGeometry(unitBox)
/** A body's material by its colour (0 to 1), or grey for one the game does not know; made once a key. */
const bodyMaterials = new Map<string, THREE.Material>()
function bodyMaterial(key: string, colour: [number, number, number] | undefined): THREE.Material {
	let m = bodyMaterials.get(key)
	if (!m) {
		m = new THREE.MeshLambertMaterial({ color: colour ? new THREE.Color().setRGB(colour[0], colour[1], colour[2], THREE.SRGBColorSpace) : COLOUR_UNKNOWN_MONSTER })
		bodyMaterials.set(key, m)
	}
	return m
}
const monsterMaterial = (kind: string) => bodyMaterial(`monster ${kind}`, monsterKind(kind)?.colour)
const npcMaterial = (name: string) => bodyMaterial(`npc ${name}`, npcLook(name)?.colour)

/** A spawn point's name tag (the kind, with '?' when the game does not know it). */
function labelMaterial(kind: string): THREE.SpriteMaterial | null {
	return nameTag(`monster ${kind}`, monsterKind(kind) ? kind : `${kind || '(no kind)'}?`, monsterKind(kind) ? '#ff8a80' : '#c0c0c0')
}

/** An NPC's name tag (with '?' when the game has no NPC by that name). */
function npcLabelMaterial(name: string): THREE.SpriteMaterial | null {
	return nameTag(`npc ${name}`, npcLook(name) ? name : `${name || '(no name)'}?`, npcLook(name) ? '#9fe3ff' : '#c0c0c0')
}

/** A sprite material of `text` in `fill`, made once a key; null without a document (the unit tests). */
const labelMaterials = new Map<string, THREE.SpriteMaterial>()
function nameTag(key: string, text: string, fill: string): THREE.SpriteMaterial | null {
	if (typeof document === 'undefined') return null
	let m = labelMaterials.get(key)
	if (!m) {
		const c = document.createElement('canvas')
		c.width = 256
		c.height = 64
		const g = c.getContext('2d')!
		g.font = 'bold 36px sans-serif'
		g.textAlign = 'center'
		g.textBaseline = 'middle'
		g.lineWidth = 6
		g.strokeStyle = 'rgba(0, 0, 0, 0.85)'
		g.fillStyle = fill
		g.strokeText(text, 128, 32, 248)
		g.fillText(text, 128, 32, 248)
		const t = new THREE.CanvasTexture(c)
		t.colorSpace = THREE.SRGBColorSpace
		m = new THREE.SpriteMaterial({ map: t, transparent: true })
		labelMaterials.set(key, m)
	}
	return m
}

const overlay = (colour: number) => new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.9 })

/** Where object `o` is, in metres: its box's corner and size. */
function objectBox(world: CubeWorld, o: WorldObject): { at: THREE.Vector3; size: THREE.Vector3 } {
	const [min, max] = objectExtent(world, o)
	const x = o.pos.x * CUBE_SIZE
	const y = layerBottom(o.pos.layer)
	const z = o.pos.z * CUBE_SIZE
	return {
		at: new THREE.Vector3(x + min[0] * CUBE_SIZE, y + min[1] * CUBE_HEIGHT, z + min[2] * CUBE_SIZE),
		size: new THREE.Vector3(Math.max(0.02, (max[0] - min[0]) * CUBE_SIZE), Math.max(0.02, (max[1] - min[1]) * CUBE_HEIGHT), Math.max(0.02, (max[2] - min[2]) * CUBE_SIZE)),
	}
}

export class ObjectMarks {
	readonly group = new THREE.Group()
	private readonly lineMaterials = {
		selected: overlay(COLOUR_SELECTED),
		link: overlay(COLOUR_LINK),
		join: overlay(COLOUR_JOIN),
		route: new THREE.LineBasicMaterial({ color: COLOUR_ROUTE, transparent: true, opacity: 0.8 }),
		routeSelected: overlay(COLOUR_ROUTE_SELECTED),
		routeBlocked: overlay(COLOUR_ROUTE_BLOCKED),
	}

	constructor() {
		this.group.name = 'cube objects'
	}

	/** Draws the objects again, those on layers `shown` leaves, with `selected`, the NPC `selectedNpc` and the groups in `box` marked. */
	draw(world: CubeWorld, shown: (layer: number) => boolean, selected: number | null, box: CubeBox | null, selectedNpc: number | null = null) {
		this.clear()
		const mats = materials()
		for (const o of world.objects) {
			if (!shown(o.pos.layer)) continue
			const { at, size } = objectBox(world, o)
			const m = new THREE.Mesh(unitBox, mats[o.kind] ? markMaterial(o.kind, o.colour) : mats[0])
			m.position.copy(at)
			m.scale.copy(size)
			m.name = `object ${o.id}`
			m.userData.objectId = o.id
			this.group.add(m)
		}
		this.drawMonsters(world, shown)
		this.drawNpcs(world, shown, selectedNpc)
		const sel = selected === null ? undefined : world.objects.find((o) => o.id === selected)
		if (sel) {
			const { at, size } = objectBox(world, sel)
			const pad = 0.06
			const v = new THREE.LineSegments(unitEdges, this.lineMaterials.selected)
			v.position.set(at.x - pad, at.y - pad, at.z - pad)
			v.scale.set(size.x + 2 * pad, size.y + 2 * pad, size.z + 2 * pad)
			v.renderOrder = 11
			v.name = 'selected object'
			this.group.add(v)
			const points: number[] = []
			const from = at.clone().addScaledVector(size, 0.5)
			for (const t of sel.targets) {
				const target = world.objects.find((o) => o.id === t)
				if (!target) continue
				const b = objectBox(world, target)
				const to = b.at.addScaledVector(b.size, 0.5)
				points.push(from.x, from.y, from.z, to.x, to.y, to.z)
			}
			if (points.length) {
				const g = new THREE.BufferGeometry()
				g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
				const lines = new THREE.LineSegments(g, this.lineMaterials.link)
				lines.renderOrder = 11
				lines.frustumCulled = false
				lines.name = 'object links'
				lines.userData.owned = true
				this.group.add(lines)
			}
		}
		if (box) {
			let n = 0
			for (const j of groupsIn(world, box)) {
				for (const c of j.cubes) {
					if (n++ >= MAX_JOIN_OUTLINES) break
					const v = new THREE.LineSegments(unitEdges, this.lineMaterials.join)
					const pad = 0.1
					v.position.set(c.x * CUBE_SIZE + pad, layerBottom(c.layer) + pad, c.z * CUBE_SIZE + pad)
					v.scale.set(CUBE_SIZE - 2 * pad, CUBE_HEIGHT - 2 * pad, CUBE_SIZE - 2 * pad)
					v.renderOrder = 10
					v.name = `joined ${j.id}`
					this.group.add(v)
				}
			}
		}
	}

	/** Draws each monster spawn point on a layer `shown` leaves: its body standing in its cube, and its name. */
	private drawMonsters(world: CubeWorld, shown: (layer: number) => boolean) {
		// How many spawn points each cube has, and how many of them are drawn so far, to set them side by side.
		const count = new Map<string, number>()
		const key = (p: { x: number; z: number; layer: number }) => `${p.x},${p.z},${p.layer}`
		for (const m of world.monsters) count.set(key(m.pos), (count.get(key(m.pos)) ?? 0) + 1)
		const done = new Map<string, number>()
		world.monsters.forEach((m, i) => {
			if (!shown(m.pos.layer)) return
			const k = key(m.pos)
			const n = count.get(k) ?? 1
			const j = done.get(k) ?? 0
			done.set(k, j + 1)
			const kind = monsterKind(m.kind)
			const w = Math.min(kind?.width ?? 0.8, CUBE_SIZE / n)
			const h = Math.min(kind?.height ?? 1, CUBE_HEIGHT)
			// Side by side along x, centred in the cube.
			const cx = m.pos.x * CUBE_SIZE + (CUBE_SIZE * (j + 0.5)) / n
			const cz = m.pos.z * CUBE_SIZE + CUBE_SIZE / 2
			const y = layerBottom(m.pos.layer)
			const body = new THREE.Mesh(unitBox, monsterMaterial(m.kind))
			body.position.set(cx - w / 2, y, cz - w / 2)
			body.scale.set(w, h, w)
			body.name = `monster ${i}`
			body.userData.monster = i
			this.group.add(body)
			const label = labelMaterial(m.kind)
			if (label) {
				const s = new THREE.Sprite(label)
				s.position.set(cx, y + h + 0.35, cz)
				s.scale.set(1.6, 0.4, 1)
				s.name = `monster label ${i}`
				s.userData.monster = i
				this.group.add(s)
			}
		})
	}

	/**
	 * Draws each NPC that starts on a layer `shown` leaves as a box of its body standing in its cube with
	 * its name (several in one cube side by side), each cube of its route on a shown layer as a flat
	 * marker, and its route as a loop of lines through its cubes at half its height; the selected NPC's
	 * loop in yellow over everything, whatever the slice hides.
	 */
	private drawNpcs(world: CubeWorld, shown: (layer: number) => boolean, selected: number | null) {
		const key = (p: SpawnPoint) => `${p.x},${p.z},${p.layer}`
		const count = new Map<string, number>()
		for (const n of world.npcs) count.set(key(n.pos), (count.get(key(n.pos)) ?? 0) + 1)
		const done = new Map<string, number>()
		const lines: number[] = []
		const selectedLines: number[] = []
		const blockedLines: number[] = []
		world.npcs.forEach((n, i) => {
			const look = npcLook(n.name)
			const h = Math.min(look?.height ?? 1.8, CUBE_HEIGHT)
			const k = key(n.pos)
			const c = count.get(k) ?? 1
			const j = done.get(k) ?? 0
			done.set(k, j + 1)
			if (shown(n.pos.layer)) {
				const w = Math.min(look?.width ?? 0.6, CUBE_SIZE / c)
				const cx = n.pos.x * CUBE_SIZE + (CUBE_SIZE * (j + 0.5)) / c
				const cz = n.pos.z * CUBE_SIZE + CUBE_SIZE / 2
				const y = layerBottom(n.pos.layer)
				const body = new THREE.Mesh(unitBox, npcMaterial(n.name))
				body.position.set(cx - w / 2, y, cz - w / 2)
				body.scale.set(w, h, w)
				body.name = `npc ${i}`
				body.userData.npcPoint = { npc: i, point: -1 } satisfies NpcPoint
				this.group.add(body)
				const label = npcLabelMaterial(n.name)
				if (label) {
					const s = new THREE.Sprite(label)
					s.position.set(cx, y + h + 0.35, cz)
					s.scale.set(2.4, 0.6, 1)
					s.name = `npc label ${i}`
					this.group.add(s)
				}
			}
			n.route.forEach((p, r) => {
				if (!shown(p.layer)) return
				const m = new THREE.Mesh(unitBox, npcMaterial(n.name))
				m.position.set((p.x + 0.5) * CUBE_SIZE - ROUTE_MARK / 2, layerBottom(p.layer), (p.z + 0.5) * CUBE_SIZE - ROUTE_MARK / 2)
				m.scale.set(ROUTE_MARK, ROUTE_MARK_HEIGHT, ROUTE_MARK)
				m.name = `npc ${i} route ${r}`
				m.userData.npcPoint = { npc: i, point: r } satisfies NpcPoint
				this.group.add(m)
			})
			if (!n.route.length) return
			const sel = i === selected
			// A loop is drawn when its NPC or a cube of it is shown, and always for the selected NPC.
			if (!sel && !shown(n.pos.layer) && !n.route.some((p) => shown(p.layer))) return
			const blocked = blockedLegs(world, n)
			const loop = [n.pos, ...n.route, n.pos]
			for (let s = 0; s + 1 < loop.length; s++) {
				const a = loop[s]
				const b = loop[s + 1]
				const out = blocked[s] ? blockedLines : sel ? selectedLines : lines
				out.push((a.x + 0.5) * CUBE_SIZE, layerBottom(a.layer) + h / 2, (a.z + 0.5) * CUBE_SIZE, (b.x + 0.5) * CUBE_SIZE, layerBottom(b.layer) + h / 2, (b.z + 0.5) * CUBE_SIZE)
			}
		})
		const loops: [number[], THREE.LineBasicMaterial, string][] = [
			[lines, this.lineMaterials.route, 'npc routes'],
			[selectedLines, this.lineMaterials.routeSelected, 'selected npc route'],
			[blockedLines, this.lineMaterials.routeBlocked, 'blocked npc route legs'],
		]
		for (const [points, mat, name] of loops) {
			if (!points.length) continue
			const g = new THREE.BufferGeometry()
			g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
			const l = new THREE.LineSegments(g, mat)
			l.renderOrder = 11
			l.frustumCulled = false
			l.name = name
			l.userData.owned = true
			this.group.add(l)
		}
	}

	/** The NPC point (its body, the start, or a route marker) that `ray` meets first, or null (the Cubes tool's NPC mode). */
	npcHit(raycaster: THREE.Raycaster): NpcPoint | null {
		const marks = this.group.children.filter((c) => c.userData.npcPoint !== undefined)
		const hit = raycaster.intersectObjects(marks, false)[0]
		return hit ? { ...(hit.object.userData.npcPoint as NpcPoint) } : null
	}

	/** The NPCs drawn now, by index into CubeWorld.npcs, and how many route markers (the probes). */
	drawnNpcs(): { npcs: number[]; routeMarks: number } {
		const marks = this.group.children.map((c) => c.userData.npcPoint as NpcPoint | undefined).filter((p): p is NpcPoint => !!p)
		return { npcs: marks.filter((p) => p.point < 0).map((p) => p.npc), routeMarks: marks.filter((p) => p.point >= 0).length }
	}

	/** The spawn point (its index in CubeWorld.monsters) whose body `ray` meets first, or -1 (the Cubes tool's Monster mode). */
	monsterHit(raycaster: THREE.Raycaster): number {
		const bodies = this.group.children.filter((c) => c.userData.monster !== undefined && (c as THREE.Mesh).isMesh)
		const hit = raycaster.intersectObjects(bodies, false)[0]
		return hit ? (hit.object.userData.monster as number) : -1
	}

	/** The monster spawn points drawn now, by index into CubeWorld.monsters (the probes). */
	drawnMonsters(): number[] {
		return this.group.children.filter((c) => c.userData.monster !== undefined && (c as THREE.Mesh).isMesh).map((c) => c.userData.monster as number)
	}

	/** The objects drawn now, by id (the probes). */
	drawn(): number[] {
		return this.group.children.filter((c) => c.userData.objectId !== undefined).map((c) => c.userData.objectId as number)
	}

	/** How many link lines and joined-cube outlines are drawn (the probes). */
	marks(): { links: number; joined: number } {
		let links = 0
		let joined = 0
		for (const c of this.group.children) {
			if (c.name === 'object links') links += ((c as THREE.LineSegments).geometry.getAttribute('position').count ?? 0) / 2
			else if (c.name.startsWith('joined ')) joined++
		}
		return { links, joined }
	}

	clear() {
		for (const c of [...this.group.children]) {
			c.removeFromParent()
			if (c.userData.owned) (c as THREE.LineSegments).geometry.dispose()
		}
	}

	dispose() {
		this.clear()
		this.group.removeFromParent()
	}
}
