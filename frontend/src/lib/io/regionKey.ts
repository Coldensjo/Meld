// A short fingerprint of what Compile writes for a region (#214): Launch compares the open region's
// against the one taken when it was opened or last compiled, to tell whether the client still lacks
// some of its edits. Spawns are not in it, since they go to the server's database, not the tiles.

import type { RegionObject } from '../engine/Engine'
import { liquidsToAdt, type LiquidMap } from '../water/liquids'
import type { ScopedEffects, TextureEffects } from '../world/groundEffects'
import type { TextureLooks } from '../world/textureLooks'

/**
 * Everything Compile writes for a region, as the document holds it (`Engine.regionKey` gathers it):
 * the terrain's arrays, the settings the paint and chunk headers are built from, the models and the
 * liquids. `Engine.exportInput` and the region save (io/compile.ts `regionEdit`) are built from these,
 * and tests/regionKey.test.ts checks every `ExportInput` key against them.
 */
export interface RegionKeyInput {
	terrain: {
		heights: Float32Array
		weights: Uint8Array
		chunkSlots: Uint8Array
		holes: Uint8Array
		noEffect: Uint8Array
		areaIds: Uint32Array
		chunkFlags: Uint8Array
		shadow: Uint8Array | null
	}
	settings: {
		palette: readonly string[]
		textureEffects: TextureEffects
		textureLooks: TextureLooks
		scopedEffects: ScopedEffects
		chunkDataKnown: boolean
		liquidsKnown: boolean
		holesKnown: boolean
	}
	objects: readonly RegionObject[]
	liquids: LiquidMap
}

/** The region's fingerprint: every part of `input`, so any edit Compile would write changes it. */
export function regionKey(input: RegionKeyInput): string {
	const t = input.terrain
	const s = input.settings
	const settings = [s.palette, s.textureEffects, s.textureLooks, s.scopedEffects, s.chunkDataKnown, s.liquidsKnown, s.holesKnown]
	return contentKey([t.heights, t.weights, t.chunkSlots, t.holes, t.noEffect, t.areaIds, t.chunkFlags, t.shadow, JSON.stringify(settings), JSON.stringify(input.objects), JSON.stringify(liquidsToAdt(input.liquids))])
}

/** A part of the fingerprint: a typed array's bytes, a string, or nothing (an absent array). */
export type KeyPart = ArrayBufferView | string | null | undefined

/**
 * Two 32-bit FNV-1a style hashes over every part, with each part's kind and length mixed in, so moving
 * bytes from one part to the next changes the key. Typed arrays are read four bytes at a time where
 * they are aligned, which keeps a 3x3 region's 37 MB of paint weights to a few tens of milliseconds.
 */
export function contentKey(parts: KeyPart[]): string {
	let a = 0x811c9dc5
	let b = 0x01000193
	const mix = (v: number) => {
		a = Math.imul(a ^ v, 0x01000193)
		b = Math.imul(b ^ v, 0x5bd1e995) ^ (b >>> 15)
	}
	for (const p of parts) {
		if (p == null) {
			mix(0x7fffffff)
			continue
		}
		if (typeof p === 'string') {
			mix(0x53545200 ^ p.length)
			for (let i = 0; i < p.length; i++) mix(p.charCodeAt(i))
			continue
		}
		let bytes = new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
		// An unaligned view is copied, so it hashes as the same bytes in an array of their own do.
		if (bytes.byteOffset % 4) bytes = bytes.slice()
		mix(0x42595400 ^ bytes.length)
		const words = Math.floor(bytes.length / 4)
		if (words) {
			const w = new Int32Array(bytes.buffer, bytes.byteOffset, words)
			for (let i = 0; i < words; i++) mix(w[i])
		}
		for (let i = words * 4; i < bytes.length; i++) mix(bytes[i])
	}
	return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/**
 * The Go side's last answer to "what does the client lack of this region" (`RegionPending`), for a
 * region whose client state has no fingerprint (one opened from a file): how many files differed, at
 * which history step, and the fingerprint then (#531).
 */
export type PendingAnswer = { key: string; changes: number; files: number }

/**
 * The remembered answer's file count for a document now `changes` steps into its history, or null
 * when it must be asked again. It holds while the history hasn't moved, or, once it has, while the
 * fingerprint `key()` (only worked out then) is still the one it was taken at, as after a spawn edit
 * or an undo back to it; that hit moves the answer to `changes`, so the next check is free again.
 */
export function cachedPending(answer: PendingAnswer | null, changes: number, key: () => string): number | null {
	if (!answer) return null
	if (answer.changes === changes) return answer.files
	if (answer.key !== key()) return null
	answer.changes = changes
	return answer.files
}
