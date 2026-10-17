import * as THREE from 'three'

const UP = new THREE.Vector3(0, 1, 0)
/** The model's own quarter turn: a model faces +X in the editor at rest (see `spawnRotation`). */
const QUARTER = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)
const tmpTilt = new THREE.Quaternion()

/**
 * A spawn's rotation in the editor's axes: its facing, and for a tilted game object its tilt
 * (`tilt`, relative to the facing, #229). The server's rotation is Rz(facing)·tilt in its own axes.
 * Server (x, y, z) is the editor's (-z, -x, y), so a quaternion's axis (x, y, z) becomes (-y, z, -x),
 * a turn about server Z one about the editor's Y; the model's quarter turn comes last.
 */
export function spawnQuaternion(s: { orientation: number; tilt?: number[] | null }, out: THREE.Quaternion): THREE.Quaternion {
	out.setFromAxisAngle(UP, s.orientation)
	const t = s.tilt
	if (t && t.length === 4) out.multiply(tmpTilt.set(-t[1], t[2], -t[0], t[3]).normalize())
	return out.multiply(QUARTER)
}
