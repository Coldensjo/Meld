/** Play World (#33): the game client's start, from the editor's camera. */

/** What `3dgame-client --at x,y,z --look yaw,pitch` takes: the eyes in metres and the view in radians. */
export interface PlaySpot {
  X: number
  Y: number
  Z: number
  Yaw: number
  Pitch: number
}

/**
 * The client's spot for a camera at `eye` looking along `dir`. The editor's cube world and the game
 * share their coordinates (x and z east and south in metres, y up from the ground layer's bottom), so
 * the eyes go over as they are; the client's yaw 0 looks north (-z) and turns counter-clockwise, and
 * a positive pitch looks up.
 */
export function playSpot(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): PlaySpot {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  return { X: eye.x, Y: eye.y, Z: eye.z, Yaw: Math.atan2(-dir.x, -dir.z) + 0, Pitch: Math.asin(Math.max(-1, Math.min(1, dir.y / len))) }
}
