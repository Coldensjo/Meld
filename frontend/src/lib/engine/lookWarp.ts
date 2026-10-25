/**
 * The bookkeeping of the Windows mouse look (#724): the cursor is hidden and moved back to the
 * drag's anchor (`MouseLookRecenter`, `SetCursorPos`) once it wanders `WARP_AT` from it, so a long
 * turn never runs into the monitor's edge. That jump is not the user's and must not turn the camera.
 *
 * The warp is told from a user move by which of the two explains the move better, given the user's
 * last move: carrying on from the last spot, or landing on the anchor and carrying on from there.
 * A fixed window round the anchor is not enough: a fast spin's first move after the warp already
 * carries the next movement and lands well away from the anchor, which left the old test waiting
 * for a landing that never came, with no recenter asked again.
 * A recenter whose landing is not seen within `STALE_MS` is given up, so another is asked for.
 */

/** How far the hidden cursor may wander from the anchor (client px, either axis) before it is moved back. */
export const WARP_AT = 150
/** How long a recenter may go unseen before it is given up and another may be asked for. */
export const STALE_MS = 300

export class LookWarp {
	/** The move to apply for the last `move` call (client px), with any warp jump taken out. */
	dx = 0
	dy = 0
	private ax = 0
	private ay = 0
	/** The user's last move, the guess at the next one. */
	private vx = 0
	private vy = 0
	private pending = false
	private askedAt = 0

	/** Starts a look with the cursor at (x, y), the spot every recenter returns it to. */
	begin(x: number, y: number) {
		this.ax = x
		this.ay = y
		this.vx = this.vy = 0
		this.pending = false
	}

	/**
	 * A move of the cursor from (lastX, lastY) to (x, y) at time `now` (ms). Sets `dx`, `dy` to the
	 * user's part of it and returns true when the caller should ask for a recenter.
	 */
	move(x: number, y: number, lastX: number, lastY: number, now: number): boolean {
		let dx = x - lastX
		let dy = y - lastY
		if (this.pending) {
			const ox = x - this.ax
			const oy = y - this.ay
			// Landed: the user's move is what lies past the anchor. Not landed: it is the whole move.
			const landed = (ox - this.vx) ** 2 + (oy - this.vy) ** 2
			const carried = (dx - this.vx) ** 2 + (dy - this.vy) ** 2
			if (landed < carried) {
				dx = ox
				dy = oy
				this.pending = false
			} else if (now - this.askedAt > STALE_MS) this.pending = false
		}
		this.dx = this.vx = dx
		this.dy = this.vy = dy
		if (!this.pending && (Math.abs(x - this.ax) > WARP_AT || Math.abs(y - this.ay) > WARP_AT)) {
			this.pending = true
			this.askedAt = now
			return true
		}
		return false
	}
}
