// How a brush's weight falls off from its solid centre to its edge. Kept apart from brush.ts, which
// holds the stroke recording, so the curves can be tested on their own.

/**
 * How a brush's weight falls off across its falloff band: smooth is the default, linear and quadratic
 * fall steadily, gaussian is a bell that meets zero at the edge, and trig eases in and out like a cosine.
 */
export type FalloffCurve = 'smooth' | 'linear' | 'quadratic' | 'gaussian' | 'trig'

export const FALLOFF_CURVES: Array<{ id: FalloffCurve; name: string }> = [
	{ id: 'smooth', name: 'Smooth' },
	{ id: 'linear', name: 'Linear' },
	{ id: 'quadratic', name: 'Quadratic' },
	{ id: 'gaussian', name: 'Gaussian' },
	{ id: 'trig', name: 'Trigonometric' },
]

/**
 * Brush footprint used by the brush iterators. Brush tools set this from the editor state at the start of
 * each tick.
 */
export const brushShape = { square: false, curve: 'smooth' as FalloffCurve }

/**
 * Brush weight for normalised distance t in [0,1]. falloff 0 = hard edge. Inside the solid part the
 * weight is 1; across the falloff band (s runs 0 to 1) the curve takes it down to 0 at the edge.
 */
export function brushWeight(t: number, falloff: number, curve: FalloffCurve = brushShape.curve): number {
	if (t >= 1) return 0
	const hard = 1 - falloff
	if (t <= hard) return 1
	const s = (t - hard) / (1 - hard)
	switch (curve) {
		case 'linear':
			return 1 - s
		case 'quadratic':
			return (1 - s) * (1 - s)
		case 'gaussian': {
			// Zero at s = 1 exactly, so the edge still blends out.
			const k = 4
			return (Math.exp(-k * s * s) - Math.exp(-k)) / (1 - Math.exp(-k))
		}
		case 'trig':
			return 0.5 + 0.5 * Math.cos(Math.PI * s)
		default:
			return 1 - s * s * (3 - 2 * s)
	}
}
