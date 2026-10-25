// The heightfield filters VMaNGOS's mmap generator runs in place of some of Recast's own
// (contrib/mmap/src/TileWorker.cpp; GPL, so their behaviour is reimplemented here, not their code):
// its ledge filter with the lower step where terrain meets a model, the fold of the model areas back
// into ground and steep slope, and the liquid pass that turns ground under water into swim area.
//
// recast-navigation-js has no setter for a span's area, so these read and write the heightfield's
// spans in the WASM heap: an rcHeightfield is width, height, bmin[3], bmax[3], cs, ch, then the
// pointer to its column heads (word 10); an rcSpan is one word of smin (13 bits), smax (13) and area
// (6), then its next pointer. `heightfieldSpans` checks the header against the API's getters, and
// tests/navmesh.test.ts checks the spans, so a Recast upgrade that moves them fails loudly.

import type * as RecastModule from 'recast-navigation'
import { AREA_GROUND, AREA_GROUND_MODEL, AREA_STEEP, AREA_STEEP_MODEL, AREA_WATER, AREA_WATER_TRANSITION, type Recast } from './navBuild'

const MAX_HEIGHT = 0xffff
const SMASK = 0x1fff
const AREA_SHIFT = 26
const LOW_BITS = (1 << AREA_SHIFT) - 1

const smin = (w: number) => w & SMASK
const smax = (w: number) => (w >>> 13) & SMASK
const area = (w: number) => w >>> AREA_SHIFT

/** A heightfield's spans in the WASM heap: `heap` is its 32-bit words, `heads` the word index of its column heads. */
interface Spans {
	heap: Uint32Array
	heads: number
	w: number
	h: number
}

/** The spans of `hf`, checked against the API's own view of its header. */
export function heightfieldSpans(r: Recast, hf: RecastModule.RecastHeightfield): Spans {
	const M = r.Raw.Module
	const heap = M.HEAPU32
	const p = M.getPointer(hf.raw) >> 2
	const w = hf.width()
	const h = hf.height()
	if (heap[p] !== w || heap[p + 1] !== h || M.HEAPF32[p + 8] !== Math.fround(hf.cs()) || M.HEAPF32[p + 9] !== Math.fround(hf.ch())) {
		throw new Error('walkable ground: the rcHeightfield layout is not the one navFilters.ts reads')
	}
	return { heap, heads: heap[p + 10] >> 2, w, h }
}

/** Every span of column `i` as [smin, smax, area], bottom up (for the tests). */
export function columnSpans(s: Spans, i: number): Array<[number, number, number]> {
	const out: Array<[number, number, number]> = []
	for (let q = s.heap[s.heads + i]; q; q = s.heap[(q >> 2) + 1]) {
		const v = s.heap[q >> 2]
		out.push([smin(v), smax(v), area(v)])
	}
	return out
}

function setArea(heap: Uint32Array, q: number, a: number) {
	heap[q >> 2] = (heap[q >> 2] & LOW_BITS) | (a << AREA_SHIFT)
}

const isModel = (a: number) => a === AREA_GROUND_MODEL || a === AREA_STEEP_MODEL

const DX = [-1, 0, 1, 0]
const DY = [0, 1, 0, -1]

/**
 * The server's ledge filter: a span with a drop deeper than the climb beside it is no ground, and one
 * whose reachable neighbours differ by more than the climb is steep slope. The climb is
 * `climbTerrain` (1.8 yd), but `climbTransition` (1.2 yd) where terrain meets a model, and a
 * terrain-to-model step over that is no ground at all, so a fence can't be stepped over.
 */
export function filterLedgeSpans(s: Spans, walkableHeight: number, climbTransition: number, climbTerrain: number) {
	const { heap, heads, w, h } = s
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			for (let q = heap[heads + x + y * w]; q; q = heap[(q >> 2) + 1]) {
				const word = heap[q >> 2]
				const a = area(word)
				if (a === 0) continue
				const bot = smax(word)
				const next = heap[(q >> 2) + 1]
				const top = next ? smin(heap[next >> 2]) : MAX_HEIGHT
				let minNeighbor = MAX_HEIGHT
				let accMin = bot
				let accMax = bot
				let allTerrain = true
				let allModel = true
				for (let dir = 0; dir < 4; dir++) {
					const dx = x + DX[dir]
					const dy = y + DY[dir]
					if (dx < 0 || dy < 0 || dx >= w || dy >= h) {
						minNeighbor = Math.min(minNeighbor, -climbTerrain - bot)
						continue
					}
					const head = heap[heads + dx + dy * w]
					// From below the column to its first span.
					let nbot = -climbTerrain
					let ntop = head ? smin(heap[head >> 2]) : MAX_HEIGHT
					if (Math.min(top, ntop) - Math.max(bot, nbot) > walkableHeight) minNeighbor = Math.min(minNeighbor, nbot - bot)
					for (let n = head; n; n = heap[(n >> 2) + 1]) {
						const nw = heap[n >> 2]
						const na = area(nw)
						if (na === 0) continue
						nbot = smax(nw)
						const nn = heap[(n >> 2) + 1]
						ntop = nn ? smin(heap[nn >> 2]) : MAX_HEIGHT
						if (Math.min(top, ntop) - Math.max(bot, nbot) <= walkableHeight) continue
						minNeighbor = Math.min(minNeighbor, nbot - bot)
						if (Math.abs(nbot - bot) <= climbTerrain) {
							if (nbot < accMin) accMin = nbot
							if (nbot > accMax) accMax = nbot
							if (isModel(na)) allTerrain = false
							else allModel = false
						}
					}
				}
				const transition = isModel(a) ? !allModel : !allTerrain
				const climb = transition ? climbTransition : climbTerrain
				if (minNeighbor < -climb) setArea(heap, q, 0)
				else if (accMax - accMin > climb) setArea(heap, q, transition ? 0 : AREA_STEEP)
			}
		}
	}
}

/** Folds the model areas back into ground and steep slope, once the ledge filter has used them. */
export function removeModelAreas(s: Spans) {
	const { heap, heads, w, h } = s
	for (let i = 0; i < w * h; i++) {
		for (let q = heap[heads + i]; q; q = heap[(q >> 2) + 1]) {
			const a = area(heap[q >> 2])
			if (a === AREA_GROUND_MODEL) setArea(heap, q, AREA_GROUND)
			else if (a === AREA_STEEP_MODEL) setArea(heap, q, AREA_STEEP)
		}
	}
}

/**
 * The liquid pass: ground with a liquid's surface `min` to `max` voxels above it takes the liquid's
 * area (deep water is swim area), ground under shallower water is the transition both walkers and
 * swimmers take, and a fully submerged steep slope is swim area too (shallow water leaves it steep).
 */
export function markLiquidSpans(liquid: Spans, solid: Spans, min: number, max: number) {
	const { w, h } = solid
	const sh = solid.heap
	const lh = liquid.heap
	for (let i = 0; i < w * h; i++) {
		for (let q = sh[solid.heads + i]; q; q = sh[(q >> 2) + 1]) {
			for (let l = lh[liquid.heads + i]; l; l = lh[(l >> 2) + 1]) {
				const word = sh[q >> 2]
				const a = area(word)
				const lw = lh[l >> 2]
				const gap = smin(lw) - smax(word)
				if (a === AREA_GROUND) {
					if (gap < 0 || gap > max) continue
					if (gap >= min) setArea(sh, q, area(lw))
					else if (area(lw) === AREA_WATER) setArea(sh, q, AREA_WATER_TRANSITION)
				} else if (a === AREA_STEEP) {
					if (gap >= min && gap <= max) setArea(sh, q, area(lw))
				}
			}
		}
	}
}
