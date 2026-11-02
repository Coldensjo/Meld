import * as THREE from 'three'
import { ui } from '../state/editor.svelte'
import type { MapDocument } from './MapDocument'
import { liftOffset, liftPeriod, liftPoint, samePlace, type LiftFrame, type LiftOrigin } from '../world/liftMotion'
import { spawnQuaternion } from '../world/spawnTilt'
import { spawnType } from '../world/spawnInfo'
import { getAsset } from '../models/assets'
import { GhostPool } from '../tools/ghosts'

/** What LiftView needs of the Engine. */
export interface LiftHost {
	/** The active tab, whose lift is drawn. */
	readonly doc: MapDocument
	readonly timer: THREE.Timer
}

/** A lift as World › Lifts hands it over: where it stands (a spawn's editor position, facing and tilt), its model and size, and its loop. */
export interface LiftShape extends LiftOrigin {
	model: string
	scale: number
	frames: LiftFrame[]
}

const PATH = new THREE.Color(0xffd23f)
const STOP = new THREE.Color(0x58e0a0)

/**
 * The lift World › Lifts picked (#956): its loop drawn over the map as the line through its frames
 * (yellow, over everything) with a marker at each place it stops or turns, and its preview, which
 * moves the lift's model through the loop as the client does (liftMotion.ts), round and round until
 * stopPlay. The spawn's own model stays where it stands. It shares the boats' preview model
 * (GhostPool) and their way of drawing over the map (TransportLayer's on-top lines).
 */
export class LiftView {
	readonly group = new THREE.Group()
	private line: THREE.LineSegments
	private readonly markGeo = new THREE.OctahedronGeometry(0.9)
	private marks: THREE.InstancedMesh
	private ghosts = new GhostPool()
	private lift: LiftShape | null = null
	private play: { doc: MapDocument; type: string; start: number; rate: number } | null = null
	/** The editor points of the frames drawn (the probes read them). */
	points: THREE.Vector3[] = []
	private at = { x: 0, y: 0, z: 0 }
	private pos = new THREE.Vector3()
	private q = new THREE.Quaternion()
	private m = new THREE.Matrix4()

	constructor(private host: LiftHost) {
		const onTop = { depthTest: false, transparent: true, fog: false }
		this.line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PATH, ...onTop }))
		this.marks = new THREE.InstancedMesh(this.markGeo, new THREE.MeshBasicMaterial({ color: STOP, ...onTop }), 64)
		this.line.renderOrder = 10
		this.marks.renderOrder = 11
		this.line.frustumCulled = this.marks.frustumCulled = false
		this.marks.count = 0
		this.group.add(this.line, this.marks)
		this.group.visible = false
		this.ghosts.grow(1)
		this.ghosts.hideAll()
	}

	/** The groups to add to the scene: the loop and the preview's model. */
	get groups(): THREE.Object3D[] {
		return [this.group, this.ghosts.group]
	}

	/** Draws `lift`'s loop (null: none). A playing preview goes on with the new loop. */
	show(lift: LiftShape | null) {
		this.lift = lift
		this.points = []
		const v: number[] = []
		const marks: THREE.Vector3[] = []
		if (lift) {
			const f = lift.frames
			this.points = f.map((k) => liftPoint(lift, k, new THREE.Vector3()))
			for (let i = 0; i + 1 < f.length; i++) {
				const a = this.points[i]
				const b = this.points[i + 1]
				if (!samePlace(f[i], f[i + 1])) v.push(a.x, a.y, a.z, b.x, b.y, b.z)
			}
			// A marker where the lift stands at the start, waits or turns.
			for (let i = 0; i < f.length; i++) if (!marks.some((p) => p.distanceToSquared(this.points[i]) < 1e-4)) marks.push(this.points[i])
		}
		this.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
		this.line.geometry.computeBoundingSphere()
		if (marks.length > this.marks.instanceMatrix.count) {
			const next = new THREE.InstancedMesh(this.markGeo, this.marks.material, marks.length * 2)
			next.renderOrder = this.marks.renderOrder
			next.frustumCulled = false
			this.group.remove(this.marks)
			this.marks.dispose()
			this.group.add(next)
			this.marks = next
		}
		marks.forEach((p, i) => this.marks.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z)))
		this.marks.count = marks.length
		this.marks.instanceMatrix.needsUpdate = true
		this.group.visible = lift !== null
		if (this.play && lift) this.play.type = spawnType({ model: lift.model })
		if (!lift || liftPeriod(lift.frames) <= 0) this.stopPlay()
	}

	/** Moves the lift's model through its loop from the start, `rate` times its own speed; false when it has no loop to play. */
	startPlay(rate: number): boolean {
		const l = this.lift
		this.stopPlay()
		if (!l || liftPeriod(l.frames) <= 0) return false
		this.play = { doc: this.host.doc, type: spawnType({ model: l.model }), start: this.host.timer.getElapsed(), rate }
		ui.liftPlaying = true
		return true
	}

	/** Changes a playing preview's speed without a jump in where it is. */
	setRate(rate: number) {
		const p = this.play
		if (!p || rate === p.rate) return
		const now = this.host.timer.getElapsed()
		p.start = now - ((now - p.start) * p.rate) / rate
		p.rate = rate
	}

	/** Ends the preview. */
	stopPlay() {
		if (!this.play) return
		this.play = null
		ui.liftPlaying = false
		this.ghosts.hideAll()
	}

	/** Where the preview is in the loop, in milliseconds (the probes read it); -1 when it isn't playing. */
	get playedMs(): number {
		const p = this.play
		const l = this.lift
		if (!p || !l) return -1
		const period = liftPeriod(l.frames)
		return ((((this.host.timer.getElapsed() - p.start) * p.rate * 1000) % period) + period) % period
	}

	/** Moves the preview's model to where the lift is now. */
	update() {
		const p = this.play
		const l = this.lift
		if (!p || !l) return
		if (p.doc !== this.host.doc) {
			this.stopPlay()
			return
		}
		liftOffset(l.frames, this.playedMs, this.at)
		liftPoint(l, this.at, this.pos)
		spawnQuaternion(l, this.q)
		const mesh = p.type ? this.ghosts.show(0, getAsset(p.type)) : this.ghosts.at(0)
		mesh.visible = p.type !== ''
		mesh.position.copy(this.pos)
		mesh.quaternion.copy(this.q)
		mesh.scale.setScalar(l.scale > 0 ? l.scale : 1)
	}

	/** The preview's model as drawn (the probes read it). */
	get model(): THREE.Mesh {
		return this.ghosts.at(0)
	}

	dispose() {
		this.stopPlay()
		this.line.geometry.dispose()
		;(this.line.material as THREE.Material).dispose()
		;(this.marks.material as THREE.Material).dispose()
		this.marks.dispose()
		this.markGeo.dispose()
	}
}
