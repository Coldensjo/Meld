// The lights the game's mood shows (3dgame #178): the lava's, a point light over each chunk with lava
// (the client's scene.rs), and the lamps' (props.rs), coloured by the mood's `lamp` and flickering as
// the client's do. The client lights every one of them; three's forward renderer pays for each light
// in every lit fragment and compiles the number of lights into its shaders, so the editor keeps a
// fixed pool of POOL point lights and gives them, each frame the view or the lights moved, to the
// lights that light the place looked at the most (`focus`). Lights further off go dark. The pool is in
// the scene only under the mood, so the work light pays nothing for it.

import * as THREE from 'three'
import { BEVY_EXPOSURE } from './Environment'
import { moodColour } from './moodLook'
import type { Mood } from './moods'
import type { CubeLayer } from '../cubes/CubeLayer'

/** How many point lights the pool holds. */
const POOL = 12

/** Bevy's point light intensity is lumens over the sphere; three's is candela, times the camera's exposure. */
const CANDELA = BEVY_EXPOSURE / (4 * Math.PI)

/** The lava's light: lumens (scene.rs GLOW_LUMENS times lava's glow, 4), reach in metres, colour (mesher.rs kind_look). */
const LAVA_LUMENS = 4_000_000
const LAVA_RANGE = 60
const LAVA_COLOUR = new THREE.Color().setRGB(1, 0.35, 0.05, THREE.SRGBColorSpace)

/** A lamp's light: lumens and reach (props.rs LAMP_LUMENS, LAMP_RANGE). */
const LAMP_LUMENS = 60_000
const LAMP_RANGE = 20

/** How far the focus moves before the lights are picked again, metres. */
const REPICK = 0.5

export class MoodLights {
	readonly group = new THREE.Group()
	private readonly lights: THREE.PointLight[] = []
	/** What each light of the pool shows: a lava light's or lamp's place, null for none. */
	private readonly at: (THREE.Vector3 | null)[] = new Array(POOL).fill(null)
	private readonly lava: boolean[] = new Array(POOL).fill(false)
	private readonly scores: number[] = new Array(POOL).fill(0)
	private readonly picked = new THREE.Vector3(Infinity, 0, 0)
	private pickedFrom: CubeLayer | null = null
	private pickedVersion = -1
	private readonly lamp = new THREE.Color()

	constructor() {
		this.group.name = 'mood lights'
		for (let i = 0; i < POOL; i++) {
			const l = new THREE.PointLight(0xffffff, 0, 1, 2)
			l.castShadow = false
			this.lights.push(l)
			this.group.add(l)
		}
		this.group.visible = false
	}

	/**
	 * Lights `cubes`' lava and lamps under mood `m` around `focus` (the place looked at), at `time`
	 * seconds (the lamps' flicker); `on` false takes the pool out of the scene.
	 */
	update(on: boolean, cubes: CubeLayer, m: Mood, focus: THREE.Vector3, time: number) {
		this.group.visible = on
		if (!on) return
		if (cubes !== this.pickedFrom || cubes.lightsVersion !== this.pickedVersion || focus.distanceToSquared(this.picked) > REPICK * REPICK) this.pick(cubes, focus)
		moodColour(m.lamp, this.lamp)
		for (let i = 0; i < POOL; i++) {
			const l = this.lights[i]
			const at = this.at[i]
			if (!at) {
				l.intensity = 0
				continue
			}
			if (this.lava[i]) {
				l.intensity = LAVA_LUMENS * CANDELA
				continue
			}
			// props.rs flicker_lamps, its phase the lamp's x + z.
			const phase = at.x + at.z
			const n = Math.sin(time * 7 + phase) * 0.5 + Math.sin(time * 13.3 + phase * 2) * 0.3
			l.intensity = LAMP_LUMENS * CANDELA * (1 + 0.12 * n)
			l.color.copy(this.lamp)
		}
	}

	/** Gives the pool to the POOL lights that light `focus` the most, as three and Bevy fall a light off. */
	private pick(cubes: CubeLayer, focus: THREE.Vector3) {
		this.pickedFrom = cubes
		this.pickedVersion = cubes.lightsVersion
		this.picked.copy(focus)
		this.at.fill(null)
		this.scores.fill(0)
		cubes.lights((at, lava) => {
			const range = lava ? LAVA_RANGE : LAMP_RANGE
			const d2 = at.distanceToSquared(focus)
			if (d2 >= range * range) return
			const w = 1 - (d2 * d2) / (range * range * range * range)
			const score = ((lava ? LAVA_LUMENS : LAMP_LUMENS) * w * w) / Math.max(d2, 1)
			// Insert by score, the pool kept sorted best first.
			let i = POOL
			while (i > 0 && score > this.scores[i - 1]) i--
			if (i === POOL) return
			for (let k = POOL - 1; k > i; k--) {
				this.scores[k] = this.scores[k - 1]
				this.at[k] = this.at[k - 1]
				this.lava[k] = this.lava[k - 1]
			}
			this.scores[i] = score
			this.at[i] = at
			this.lava[i] = lava
		})
		for (let i = 0; i < POOL; i++) {
			const at = this.at[i]
			if (!at) continue
			const l = this.lights[i]
			l.position.copy(at)
			l.distance = this.lava[i] ? LAVA_RANGE : LAMP_RANGE
			if (this.lava[i]) l.color.copy(LAVA_COLOUR)
		}
	}

	/** How many lights of the pool shine now (the probes). */
	get shining(): number {
		return this.group.visible ? this.at.filter((a) => a).length : 0
	}
}
