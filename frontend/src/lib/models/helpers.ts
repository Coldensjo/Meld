import * as THREE from 'three'

// Helper models, as the owner decided for Noggit Red's (B-040, issue #95): plain shapes of set sizes that
// an author places as visual aids (how big is 8 yards, how tall is a player), saved in the map like any
// model but never exported to the client. They are generated here, not client models, so they are the
// one exception to Meld shipping no built-in models; they draw as see-through shapes so they never pass
// for scenery.

/** A helper's type: `helper:<shape>:<yards>`, or `helper:human`. */
export const HELPER_PREFIX = 'helper:'

export const isHelper = (type: string) => type.startsWith(HELPER_PREFIX)

/** The helpers the asset browser offers, with their names. */
export const HELPERS: Array<{ type: string; name: string }> = [
	{ type: 'helper:human', name: 'Human height (2 yards)' },
	{ type: 'helper:cube:1', name: 'Cube 1 yard' },
	{ type: 'helper:cube:4', name: 'Cube 4 yards' },
	{ type: 'helper:cube:16', name: 'Cube 16 yards' },
	{ type: 'helper:disc:8', name: 'Disc 8 yards across' },
	{ type: 'helper:disc:33', name: 'Disc a chunk across (33 yards)' },
	{ type: 'helper:sphere:2', name: 'Sphere 2 yards' },
	{ type: 'helper:sphere:10', name: 'Sphere 10 yards' },
]

/** A helper's name for labels, or '' for a type that isn't a helper. */
export function helperName(type: string): string {
	return HELPERS.find((h) => h.type === type)?.name ?? (isHelper(type) ? type.slice(HELPER_PREFIX.length) : '')
}

/** A helper's geometry, standing on its origin; null for a type that isn't one of the helpers. */
export function helperGeometry(type: string): THREE.BufferGeometry | null {
	if (!isHelper(type)) return null
	const [shape, size] = type.slice(HELPER_PREFIX.length).split(':')
	const s = Number(size) || 1
	switch (shape) {
		case 'human':
			// A player is about two yards tall: a post that high, a shoulder's width across.
			return new THREE.CapsuleGeometry(0.3, 1.4, 4, 12).translate(0, 1, 0)
		case 'cube':
			return new THREE.BoxGeometry(s, s, s).translate(0, s / 2, 0)
		case 'disc':
			return new THREE.CylinderGeometry(s / 2, s / 2, 0.1, 48).translate(0, 0.05, 0)
		case 'sphere':
			return new THREE.SphereGeometry(s / 2, 32, 16).translate(0, s / 2, 0)
	}
	return null
}

let material: THREE.Material | null = null

/** The helpers' look: a see-through cyan, unlit, so it reads as an aid and not as scenery. */
export function helperMaterial(): THREE.Material {
	if (!material) material = new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.35, depthWrite: false })
	return material
}
