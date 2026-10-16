import type { ObjectClip } from './clipboard'

/**
 * The model clip turned `radians` about its anchor (R and Ctrl+scroll while pasting models, #170):
 * each root's place spins about the anchor and the root turns with it, so the arrangement keeps its
 * shape. Attached models keep their place on their parent.
 */
export function turnObjectClip(clip: ObjectClip, radians: number): ObjectClip {
	const c = Math.cos(radians)
	const s = Math.sin(radians)
	return {
		objects: clip.objects.map((o) => {
			if (o.cparent !== undefined) return o
			return { ...o, x: o.x * c - o.z * s, z: o.x * s + o.z * c, rotY: o.rotY - radians }
		}),
	}
}
