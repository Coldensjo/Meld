// Dragging a panel's edge to resize it (#592): the dock's left edge and the asset browser's top edge.
// The drag captures the pointer and ends on pointerup, pointercancel (a pen lifted out of range, a
// touch taken over by the system) or lostpointercapture (Alt-Tab), so a cancelled drag does not
// leave the move listener behind to keep writing the size on the next hover.
import { toCss } from './uiScale'

export interface DragResize {
	/** 'x' for a left edge (dragging left grows the panel), 'y' for a top edge (dragging up grows it). */
	axis: 'x' | 'y'
	/** The panel's size in CSS px when the drag starts. */
	get: () => number
	/** Writes the new size. */
	set: (size: number) => void
	min: number
	/** The largest size; a function is read on every move (a share of the window, which can change). */
	max: number | (() => number)
}

/** The size after moving the edge from `startPos` to `pos` (window px), rounded and kept to [min, max]. */
export function resizedSize(startSize: number, startPos: number, pos: number, min: number, max: number): number {
	return Math.round(Math.min(max, Math.max(min, startSize + toCss(startPos - pos))))
}

/** `use:dragResize={{ axis, get, set, min, max }}` on the edge element. */
export function dragResize(node: HTMLElement, options: DragResize) {
	let opts = options
	let stop: (() => void) | null = null
	const down = (e: PointerEvent) => {
		stop?.()
		const o = opts
		const at = (ev: PointerEvent) => (o.axis === 'x' ? ev.clientX : ev.clientY)
		const startPos = at(e)
		const startSize = o.get()
		node.setPointerCapture(e.pointerId)
		const move = (ev: PointerEvent) => {
			o.set(resizedSize(startSize, startPos, at(ev), o.min, typeof o.max === 'function' ? o.max() : o.max))
		}
		const end = () => {
			node.removeEventListener('pointermove', move)
			node.removeEventListener('pointerup', end)
			node.removeEventListener('pointercancel', end)
			node.removeEventListener('lostpointercapture', end)
			if (stop === end) stop = null
		}
		node.addEventListener('pointermove', move)
		node.addEventListener('pointerup', end)
		node.addEventListener('pointercancel', end)
		node.addEventListener('lostpointercapture', end)
		stop = end
	}
	node.addEventListener('pointerdown', down)
	return {
		update(next: DragResize) {
			opts = next
		},
		destroy() {
			stop?.()
			node.removeEventListener('pointerdown', down)
		},
	}
}
