// Graphics › FPS limit (#24): the render loop skips rAF frames until the limit's interval has passed.

/**
 * Whether a frame is due under an FPS limit: `last` is when the last one was drawn and `now` the
 * rAF's time, both in ms. A frame is let through a little early, so a 60 limit on a 60 Hz screen
 * never drops one to timer jitter.
 */
export function frameDue(now: number, last: number, limit: number): boolean {
	return limit <= 0 || now - last >= 1000 / limit - 2
}
