// The arithmetic of the virtualised tile grids (the asset and spawn browsers, the doodad brush, the
// display, look, icon and weapon pickers): how many columns fit, and which rows to render for a
// scroll position, so a list of ten thousand tiles renders only the few rows in view (#578).

/** The rows a grid renders: `first` to `last` (exclusive), the items `start` to `end` (exclusive). */
export interface GridWindow {
	/** Rows in the whole list, which size the scrolled block (`rows * rowH`). */
	rows: number
	first: number
	last: number
	start: number
	end: number
}

/**
 * Columns of `tile` px tiles, `gap` px apart, that fit in `width`, at least one. `inset` is the
 * width kept free besides the tiles and the gaps between them (the grid's padding); it defaults to
 * one gap.
 */
export function gridCols(width: number, tile: number, gap: number, inset = gap): number {
	return Math.max(1, Math.floor((width - inset) / (tile + gap)))
}

/**
 * The rows in view for a scroll position, with one more row above and below so a short scroll
 * finds them ready. `scrollTop` is measured from the grid's own top.
 */
export function gridWindow(count: number, cols: number, rowH: number, scrollTop: number, viewHeight: number): GridWindow {
	const rows = Math.ceil(count / cols)
	const first = Math.max(0, Math.floor(scrollTop / rowH) - 1)
	const last = Math.max(first, Math.min(rows, Math.ceil((scrollTop + viewHeight) / rowH) + 1))
	const start = Math.min(count, first * cols)
	return { rows, first, last, start, end: Math.max(start, Math.min(count, last * cols)) }
}

/** The scroll position (from the grid's top) that puts item `index`'s row at the top. */
export function rowTop(index: number, cols: number, rowH: number): number {
	return Math.floor(index / cols) * rowH
}

/**
 * The tile size that fills a row of `cols` columns (from `gridCols` at the smallest tile `min`) across
 * `width`, less the grid's padding `pad` and the gaps between the tiles, kept between `min` and `max`
 * px (#389: the display picker's tiles grow to end at the grid's right edge, not short of it).
 */
export function gridTile(width: number, cols: number, gap: number, pad: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.floor((width - pad - (cols - 1) * gap) / cols)))
}
