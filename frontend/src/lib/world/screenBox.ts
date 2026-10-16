import * as THREE from 'three'

// Whether a click lands near a box on the screen (#205): the box's eight corners are projected, and
// the rectangle around those in front of the camera, grown by a margin, is tested against the click.
// It lets a right-click just beside the selected creature open its menu.

const corner = new THREE.Vector3()

/**
 * Whether (`x`, `y`), in pixels from the top left of a `width` by `height` view, falls within `margin`
 * pixels of the rectangle `box` covers on the screen through `camera`. False when the whole box is
 * behind the camera.
 */
export function nearScreenBox(box: THREE.Box3, camera: THREE.Camera, width: number, height: number, x: number, y: number, margin: number): boolean {
	let x0 = Infinity
	let y0 = Infinity
	let x1 = -Infinity
	let y1 = -Infinity
	for (let i = 0; i < 8; i++) {
		corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera)
		// Behind the camera the projection flips; such a corner says nothing about the rectangle.
		if (corner.z > 1 || corner.z < -1) continue
		const px = ((corner.x + 1) / 2) * width
		const py = ((1 - corner.y) / 2) * height
		x0 = Math.min(x0, px)
		y0 = Math.min(y0, py)
		x1 = Math.max(x1, px)
		y1 = Math.max(y1, py)
	}
	if (x0 > x1) return false
	return x >= x0 - margin && x <= x1 + margin && y >= y0 - margin && y <= y1 + margin
}
