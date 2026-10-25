import * as THREE from 'three'
import type { vmangos } from '../../../wailsjs/go/models'
import { levelText, rankName } from './spawnInfo'
import { SPAWN_COLORS, type SpawnKind, type SpawnLayer } from './SpawnLayer'

// Names over the spawns, as the game draws them over heads (#125): the name in the kind's colour,
// the subname in angle brackets, and a creature's level and rank. Only the nearest spawns among those
// the last cull drew get one (so the kinds shown, the view and a WMO room's doorways apply), picked
// again a few times a second; each frame only moves them. A name whose spot the ground or a building
// hides from the camera is left out, so a building's people don't show through its walls. They are
// DOM elements over the canvas, built when a label takes another spawn, so the text costs nothing
// per frame.

/** Farthest a name is drawn, in yards, and where it starts to fade. */
const RANGE = 70
const FADE_FROM = 50
/** Most names drawn at once: the nearest spawns. */
const MAX_LABELS = 48
/** Seconds between picks of the spawns that get a name. */
const PICK_EVERY = 0.25
/** Yards above the top of the model's box. */
const LIFT = 0.4
/** Most sight lines tested a pick, nearest spawns first. */
const MAX_TESTS = 96

interface Label {
	el: HTMLDivElement
	name: HTMLDivElement
	sub: HTMLDivElement
	level: HTMLDivElement
	spawn: vmangos.WorldSpawn | null
	/** What the label shows, to tell when a spawn's name or level changed. */
	text: string
	/** The name's colour now. */
	color: string
	/** The height the label stands at: the top of the spawn's model. */
	top: number
	opacity: number
	shown: boolean
}

const css = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** The text a spawn's label shows, as one string: name, subname and level line. */
function labelText(s: vmangos.WorldSpawn): string {
	return `${s.name}\n${s.subname}\n${levelLine(s)}`
}

/**
 * "Level 60 Elite" for a creature (no rank word for a normal one); "Invisible in the game" for a
 * spawn with no model (#140); nothing for any other game object.
 */
function levelLine(s: vmangos.WorldSpawn): string {
	if (!s.model) return 'Invisible in the game'
	if (s.kind === 'object') return ''
	const lv = levelText(s.levelMin, s.levelMax)
	const rank = s.rank > 0 ? rankName(s.rank) : ''
	return [lv && `Level ${lv}`, rank].filter(Boolean).join(' ')
}

/** How a faction template treats each side's player (vmangos.FactionInfo). */
export interface FactionReaction {
	alliance: string
	horde: string
}

export class SpawnLabels {
	enabled = true
	/**
	 * The reactions by faction template and the side the names are seen from (#134): a creature's
	 * name is red, yellow or green by how its faction treats that side's player, as in the game.
	 * Without them (no client read yet) the name takes its kind's colour.
	 */
	private reactions: Map<number, FactionReaction> | null = null
	private side: 'alliance' | 'horde' = 'alliance'

	setReactions(r: Map<number, FactionReaction>) {
		this.reactions = r
	}

	setSide(side: 'alliance' | 'horde') {
		this.side = side
	}

	/** A spawn's name colour: by its faction's reaction to the side for a creature, else by its kind. */
	private nameColor(s: vmangos.WorldSpawn): string {
		const r = s.kind === 'object' ? undefined : this.reactions?.get(s.faction)
		const how = r ? r[this.side] : ''
		const kind: SpawnKind = how === 'hostile' ? 'monster' : how === 'friendly' ? 'npc' : how === 'neutral' ? 'object' : (s.kind as SpawnKind)
		return css(SPAWN_COLORS[kind] ?? 0xffffff)
	}
	/** Whether the ground or a building stands between the camera and `to`; set by the Engine. */
	blocked: (to: THREE.Vector3) => boolean = () => false
	private root: HTMLDivElement
	private labels: Label[] = []
	private bySpawn = new Map<vmangos.WorldSpawn, Label>()
	private layer: SpawnLayer | null = null
	private layerVersion = -1
	private moveSeq = 0
	private since = Infinity
	// Scratch for the pick, kept between picks.
	private cand: vmangos.WorldSpawn[] = []
	private candD: number[] = []
	private order: number[] = []
	private keep = new Set<vmangos.WorldSpawn>()
	/** The top of each spawn's model, found once per version of the spawns. */
	private tops = new Map<vmangos.WorldSpawn, number>()
	private v = new THREE.Vector3()
	private box = new THREE.Box3()

	constructor(container: HTMLElement) {
		this.root = document.createElement('div')
		this.root.className = 'spawn-labels'
		Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '1' })
		container.appendChild(this.root)
	}

	/**
	 * Picks the labelled spawns when it is time (or the spawns changed), then puts each label over
	 * its spawn. Call after the frame's cull, with the camera that drew it.
	 */
	update(layer: SpawnLayer, camera: THREE.Camera, eye: THREE.Vector3, width: number, height: number, dt: number) {
		if (!this.enabled) {
			if (this.bySpawn.size) this.release()
			return
		}
		this.since += dt
		// Spawns moved in place keep their label and only find their model's top again; the pick is not redone for them.
		if (layer === this.layer && layer.version === this.layerVersion && layer.moveSeq !== this.moveSeq) {
			const moved = layer.movedSince(this.moveSeq)
			this.moveSeq = layer.moveSeq
			if (moved) {
				for (const s of moved) {
					this.tops.delete(s)
					const l = this.bySpawn.get(s)
					if (l) this.fill(l, s, layer)
				}
			} else {
				this.tops.clear()
				this.since = Infinity
			}
		}
		if (this.since >= PICK_EVERY || layer !== this.layer || layer.version !== this.layerVersion) {
			this.since = 0
			const changed = layer !== this.layer || layer.version !== this.layerVersion
			if (changed) this.tops.clear()
			this.pick(layer, eye, changed)
			this.layer = layer
			this.layerVersion = layer.version
			this.moveSeq = layer.moveSeq
		}
		const v = this.v
		for (const l of this.labels) {
			const s = l.spawn
			if (!s) continue
			const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z)
			v.set(s.x, l.top + LIFT, s.z).project(camera)
			const visible = d < RANGE && v.z < 1 && v.z > -1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2
			if (visible !== l.shown) {
				l.shown = visible
				l.el.style.display = visible ? '' : 'none'
			}
			if (!visible) continue
			const x = ((v.x + 1) / 2) * width
			const y = ((1 - v.y) / 2) * height
			l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
			const opacity = d <= FADE_FROM ? 1 : Math.max(0, 1 - (d - FADE_FROM) / (RANGE - FADE_FROM))
			if (Math.abs(opacity - l.opacity) > 0.02) {
				l.opacity = opacity
				l.el.style.opacity = opacity.toFixed(2)
			}
		}
	}

	/** Gives the labels to the nearest drawn spawns, keeping a label on a spawn that still has one. */
	private pick(layer: SpawnLayer, eye: THREE.Vector3, changed: boolean) {
		const cand = this.cand
		const candD = this.candD
		cand.length = 0
		candD.length = 0
		const r2 = RANGE * RANGE
		layer.forEachDrawn((s) => {
			const dx = s.x - eye.x
			const dy = s.y - eye.y
			const dz = s.z - eye.z
			const d2 = dx * dx + dy * dy + dz * dz
			if (d2 >= r2) return
			cand.push(s)
			candD.push(d2)
		})
		const order = this.order
		order.length = 0
		for (let i = 0; i < cand.length; i++) order.push(i)
		order.sort((a, b) => candD[a] - candD[b])
		const keep = this.keep
		keep.clear()
		for (let k = 0; k < order.length && k < MAX_TESTS && keep.size < MAX_LABELS; k++) {
			const s = cand[order[k]]
			if (!this.blocked(this.v.set(s.x, this.top(s, layer) + LIFT, s.z))) keep.add(s)
		}
		// Free the labels whose spawn is no longer among them, then label the newcomers.
		for (const [s, l] of this.bySpawn) {
			if (keep.has(s)) continue
			this.bySpawn.delete(s)
			this.free(l)
		}
		for (const s of keep) {
			let l = this.bySpawn.get(s)
			if (!l) {
				l = this.labels.find((x) => !x.spawn) ?? this.make()
				l.spawn = s
				l.text = ''
				this.bySpawn.set(s, l)
				changed = true
			}
			if (changed) this.fill(l, s, layer)
		}
	}

	/** The top of a spawn's model (its marker's while the model loads). */
	private top(s: vmangos.WorldSpawn, layer: SpawnLayer): number {
		let t = this.tops.get(s)
		if (t === undefined) {
			t = layer.boundsOf(s, this.box) ? this.box.max.y : s.y + 2
			this.tops.set(s, t)
		}
		return t
	}

	/** Writes a spawn's name, subname and level into its label, and finds the top of its model. */
	private fill(l: Label, s: vmangos.WorldSpawn, layer: SpawnLayer) {
		l.top = this.top(s, layer)
		const color = this.nameColor(s)
		if (color !== l.color) {
			l.color = color
			l.name.style.color = color
		}
		const text = labelText(s)
		if (text === l.text) return
		l.text = text
		l.name.textContent = s.name
		l.sub.textContent = s.subname ? `<${s.subname}>` : ''
		l.sub.style.display = s.subname ? '' : 'none'
		const lv = levelLine(s)
		l.level.textContent = lv
		l.level.style.display = lv ? '' : 'none'
	}

	private make(): Label {
		const el = document.createElement('div')
		Object.assign(el.style, {
			position: 'absolute',
			left: '0',
			top: '0',
			textAlign: 'center',
			whiteSpace: 'nowrap',
			font: '600 12px/1.15 var(--font, sans-serif)',
			textShadow: '0 0 2px #000, 0 0 2px #000, 1px 1px 1px #000',
			willChange: 'transform',
		})
		const name = document.createElement('div')
		const sub = document.createElement('div')
		const level = document.createElement('div')
		sub.style.color = '#e8e8e8'
		level.style.color = '#c8c8c8'
		level.style.fontSize = '11px'
		el.append(name, sub, level)
		this.root.appendChild(el)
		const l: Label = { el, name, sub, level, spawn: null, text: '', color: '', top: 0, opacity: 1, shown: true }
		this.labels.push(l)
		return l
	}

	private free(l: Label) {
		l.spawn = null
		l.shown = false
		l.el.style.display = 'none'
	}

	/** Hides every label (names turned off). */
	private release() {
		for (const l of this.bySpawn.values()) this.free(l)
		this.bySpawn.clear()
		this.layer = null
	}

	dispose() {
		this.root.remove()
		this.labels = []
		this.bySpawn.clear()
		this.tops.clear()
	}
}
