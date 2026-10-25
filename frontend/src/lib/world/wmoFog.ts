// The room fog: which fog a WMO room's MFOG records give the camera, and its crossfade with the scene
// fog. Ported from Benilla (MIT/Apache-2.0): `wmo_portal/fog.rs` (`select_wmo_fog`) and
// `lighting/resolve.rs` (`WmoCrossfade`), after the 1.12 client's selector 0x69de20 and its staging
// at 0x6cef43.
//
// A root with a single MFOG record (five in six) keeps the scene fog. Otherwise the fog starts from
// record 0, and every record the room's four fog indices name that holds the eye within its outer
// radius (flag 0x1 excluded) blends over it by its radius falloff, the nearest last. The result
// fades in over 4 s while the camera is in such a room, and out again after it leaves, from the last
// room's fog. Only the groups the portal flood marks take it (`wmoFlood.ts`); the rest of the scene
// keeps its own fog.

import type { WmoFog } from './wmoRoom'

/** A fog: colour (sRGB, 0..1), end (yd) and start as a share of the end. */
export interface FogTarget {
	color: [number, number, number]
	end: number
	start: number
}

/** The fog for an eye at `eye` (model space, WoW axes) in a room with `indices`, or null to keep the scene's. */
export function selectWmoFog(fogs: WmoFog[], indices: ArrayLike<number>, eye: [number, number, number]): FogTarget | null {
	if (fogs.length < 2) return null
	const cands: Array<[number, WmoFog]> = []
	for (let k = 0; k < indices.length; k++) {
		const rec = fogs[indices[k]]
		if (!rec || rec.flags & 1) continue
		const d = Math.hypot(eye[0] - rec.pos[0], eye[1] - rec.pos[1], eye[2] - rec.pos[2])
		if (d <= rec.outer) cands.push([d, rec])
	}
	cands.sort((a, b) => b[0] - a[0]) // farthest first, so the nearest blends last
	const acc = triple(fogs[0])
	for (const [d, rec] of cands) {
		const span = rec.outer - rec.inner
		const w = span > 0 ? Math.min(1, Math.max(0, 1 - (d - rec.inner) / span)) : 1
		const t = triple(rec)
		for (let c = 0; c < 3; c++) acc.color[c] += (t.color[c] - acc.color[c]) * w
		acc.end += (t.end - acc.end) * w
		acc.start += (t.start - acc.start) * w
	}
	return acc
}

/** MFOG's colour dword reads 0xAARRGGBB. */
function triple(rec: WmoFog): FogTarget {
	const c = rec.color >>> 0
	return { color: [((c >>> 16) & 0xff) / 255, ((c >>> 8) & 0xff) / 255, (c & 0xff) / 255], end: rec.end, start: rec.start }
}

/** The crossfade rate: 4 s in and 4 s out. */
export const FOG_RAMP_PER_SEC = 0.25

/** The room fog's crossfade with the scene fog. */
export class RoomFogFade {
	/** The weight of the room fog, 0..1. */
	t = 0
	private staged: FogTarget | null = null
	readonly color: [number, number, number] = [0, 0, 0]
	near = 0
	far = 0

	/**
	 * Moves the fade by `dt` toward `target` (null: out) and sets `color`, `near` and `far`: the scene
	 * fog's (`sceneColor`, `sceneNear`, `sceneFar`) blended toward the room's, staged as end =
	 * min(end, farClip) and start = end · start share. Reports whether the room fog shows at all.
	 */
	update(target: FogTarget | null, sceneColor: ArrayLike<number>, sceneNear: number, sceneFar: number, farClip: number, dt: number): boolean {
		if (target) this.staged = target
		this.t = Math.min(1, Math.max(0, this.t + (target ? 1 : -1) * FOG_RAMP_PER_SEC * dt))
		for (let c = 0; c < 3; c++) this.color[c] = sceneColor[c]
		this.near = sceneNear
		this.far = sceneFar
		const s = this.staged
		if (!s) return false
		if (this.t <= 0) {
			this.staged = null
			return false
		}
		const end = Math.min(s.end, farClip)
		const start = end * s.start
		const k = this.t
		for (let c = 0; c < 3; c++) this.color[c] += (s.color[c] - this.color[c]) * k
		this.near += (start - this.near) * k
		this.far += (end - this.far) * k
		return true
	}
}
