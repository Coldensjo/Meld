import type { Engine } from '../engine/Engine'

/** The single Engine instance, set by Viewport once the canvas exists. */
export const engineRef: { current: Engine | null } = { current: null }
