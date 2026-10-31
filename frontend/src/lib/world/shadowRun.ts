import type * as THREE from 'three'

// One draw for a model's opaque materials in the shadow passes (#926). three draws a mesh into a shadow
// map a call per material group, though every group without an alpha test gets the same depth
// material (`getDepthMaterial`: three's one depth material, drawn from both faces, as our materials'
// `shadowSide` asks), so their calls differ only in their range of the index. A loaded model's index is
// laid out with those groups first, one after another (`orderForShadows`, before its bounds tree is
// built), and while the shadow maps are drawn (`useShadowGroups`, around three's `shadowMap.render`)
// its geometry's groups are a shadow list: one group for that whole run, then the other groups as
// they are. Swapping the list rather than emptying groups in `onBeforeShadow` spares three its work
// per group too (the depth material, the program, the hooks). From Goldshire the far cascade drew
// 1,995 calls, 1,275 of them from 28 whole WMOs, Stormwind alone 469. A cut-out (alpha test) keeps its
// own draw with its texture, and so does a group whose colour fades, which three leaves out of the
// pass while it is hidden. The scene pass is unchanged: its groups keep their order and materials.

/** The run of a model's index its mergeable groups fill, and those groups (indices into `geometry.groups`, in order). */
export interface ShadowRun {
	start: number
	count: number
	groups: number[]
}

/** The group facts that decide whether its shadow draw merges (models/assets.ts `wowMaterial`). */
export interface ShadowGroup {
	start: number
	count: number
	/** 1 is an alpha test (a cut-out), whose depth draw samples its texture. */
	blend: number
	/** A colour of its own may fade out, which hides the material and its shadow. */
	color?: unknown
}

/** Whether a group's depth draw is three's plain one: no alpha test, never hidden. */
export function mergesShadow(g: ShadowGroup): boolean {
	return g.blend !== 1 && !g.color
}

/**
 * Moves the triangles of the groups whose shadow draw merges to the front of `index` (in place), in
 * the groups' order, the others after them in theirs, and writes each group's new start into
 * `starts`. Returns the merged run, or null (and leaves `index` alone) when fewer than two groups
 * merge or the groups don't tile the index exactly. Pure, for the tests.
 */
export function orderForShadows(index: Uint16Array | Uint32Array, groups: readonly ShadowGroup[], starts: number[]): ShadowRun | null {
	const merged: number[] = []
	let total = 0
	for (let i = 0; i < groups.length; i++) {
		total += groups[i].count
		if (mergesShadow(groups[i])) merged.push(i)
	}
	if (merged.length < 2 || total !== index.length) return null
	// Tiling: sorted by start, each group begins where the one before it ends.
	const byStart = groups.map((_, i) => i).sort((a, b) => groups[a].start - groups[b].start)
	let at = 0
	for (const i of byStart) {
		if (groups[i].start !== at) return null
		at += groups[i].count
	}
	const src = index.slice()
	let o = 0
	const put = (i: number) => {
		const g = groups[i]
		starts[i] = o
		index.set(src.subarray(g.start, g.start + g.count), o)
		o += g.count
	}
	for (const i of merged) put(i)
	const count = o
	for (let i = 0; i < groups.length; i++) if (!mergesShadow(groups[i])) put(i)
	return { start: 0, count, groups: merged }
}

/** The geometry's merged run, as `setShadowRun` put it there. */
export function shadowRunOf(geometry: THREE.BufferGeometry): ShadowRun | null {
	return (geometry.userData.shadowRun as ShadowRun | undefined) ?? null
}

interface Entry {
	geometry: THREE.BufferGeometry
	/** The geometry's own groups, while the shadow list stands in for them. */
	groups: THREE.GeometryGroup[]
	shadow: THREE.GeometryGroup[]
}

const entries = new Set<Entry>()

/** Notes `run` on a model's `geometry` and gives it a shadow list (`addShadowGroups`). */
export function setShadowRun(geometry: THREE.BufferGeometry, run: ShadowRun) {
	geometry.userData.shadowRun = run
	addShadowGroups(geometry, run)
}

/**
 * Gives `geometry` (a model's, or a group cull's twin of it) the shadow list for `run` and returns
 * the list's group for the run, which a twin points at its view half for the near cascade
 * (`WmoGroupCull.shadowBefore`). The list goes with the geometry when it is disposed.
 */
export function addShadowGroups(geometry: THREE.BufferGeometry, run: ShadowRun): THREE.GeometryGroup {
	const merged = new Set(run.groups)
	const lead: THREE.GeometryGroup = { start: run.start, count: run.count, materialIndex: geometry.groups[run.groups[0]].materialIndex ?? 0 }
	const entry: Entry = { geometry, groups: geometry.groups, shadow: [lead, ...geometry.groups.filter((_, i) => !merged.has(i))] }
	entries.add(entry)
	geometry.addEventListener('dispose', () => entries.delete(entry))
	return lead
}

let swapped = false

/** Off draws every group into the shadow maps on its own, as before #926 (the shadow-merge probe compares the two). */
export const shadowMerge = { enabled: true }

/** Swaps every listed geometry's groups for its shadow list (on) or back (off): call around three's `shadowMap.render`. */
export function useShadowGroups(on: boolean) {
	if (on === swapped) return
	swapped = on
	for (const e of entries) {
		if (on) {
			e.groups = e.geometry.groups
			e.geometry.groups = e.shadow
		} else e.geometry.groups = e.groups
	}
}

/** Draws the shadow maps of `renderer` with the shadow lists in place: call once, after making it. */
export function mergeShadowDraws(renderer: THREE.WebGLRenderer) {
	const sm = renderer.shadowMap
	const render = sm.render.bind(sm)
	sm.render = (lights, scene, camera) => {
		useShadowGroups(shadowMerge.enabled)
		try {
			render(lights, scene, camera)
		} finally {
			useShadowGroups(false)
		}
	}
}
