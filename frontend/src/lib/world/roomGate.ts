// The room gate: portal culling and the room fog for the placed WMOs near the camera, inside the
// shared WMO materials. A WMO's vertices carry their group plus one (`wmoRoom`, from Go's Mesh.Room),
// and a doodad named by two groups both (0 for none). Every WMO material is patched to read one set
// of uniforms: up to ROOM_MAX_GATED placements' origins, and a mask with a row of groups for each (red:
// drawn, green: room fog). A vertex of an instance at one of those origins none of whose groups the
// flood reached is moved out of the view, and one with a group that takes the room fog is fogged with
// the room's fog instead of the scene's. Every other instance, and every model without the tags, is
// drawn as before. The owner chose this over a mesh of its own for the building (#8): no extra draw
// calls, though a hidden group still costs its vertices.

import * as THREE from 'three'

export const ROOM_ATTRIBUTE = 'wmoRoom'
/** Groups past this are always drawn and never fogged (the biggest 1.12 WMO has 306). */
export const ROOM_MAX_GROUPS = 1024
/** How many placements are gated at once: the camera's building and the nearest others in view. */
export const ROOM_MAX_GATED = 16

const maskData = new Uint8Array(ROOM_MAX_GROUPS * ROOM_MAX_GATED * 4)
const mask = new THREE.DataTexture(maskData, ROOM_MAX_GROUPS, ROOM_MAX_GATED, THREE.RGBAFormat, THREE.UnsignedByteType)
mask.magFilter = THREE.NearestFilter
mask.minFilter = THREE.NearestFilter
mask.generateMipmaps = false
mask.needsUpdate = true

/** Shared by every patched material, so one write reaches them all. */
const uniforms = {
	roomCount: { value: 0 },
	roomOrigins: { value: Array.from({ length: ROOM_MAX_GATED }, () => new THREE.Vector3()) },
	roomMask: { value: mask },
	roomFogColor: { value: new THREE.Color() },
	roomFogNear: { value: 0 },
	roomFogFar: { value: 1 },
}

const VERTEX_PARS = /* glsl */ `
attribute vec2 wmoRoom;
uniform int roomCount;
uniform vec3 roomOrigins[${ROOM_MAX_GATED}];
uniform sampler2D roomMask;
varying float vRoomFog;
// A group's mask bits in a placement's row; a group past the mask is drawn and not fogged.
vec4 roomBits(float group, int row) {
	if (group > ${ROOM_MAX_GROUPS}.0) return vec4(1.0, 0.0, 0.0, 0.0);
	return texelFetch(roomMask, ivec2(int(group) - 1, row), 0);
}
`

const VERTEX = /* glsl */ `
vRoomFog = 0.0;
#ifdef USE_INSTANCING
if (roomCount > 0 && wmoRoom.x > 0.5) {
	int row = -1;
	for (int i = 0; i < ${ROOM_MAX_GATED}; i++) {
		if (i >= roomCount) break;
		if (distance(instanceMatrix[3].xyz, roomOrigins[i]) < 0.01) { row = i; break; }
	}
	if (row >= 0) {
		vec4 bits = roomBits(wmoRoom.x, row);
		if (wmoRoom.y > 0.5) bits = max(bits, roomBits(wmoRoom.y, row));
		// Past the far plane: a hidden group's triangles are clipped whole.
		if (bits.r < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
		vRoomFog = bits.g;
	}
}
#endif
`

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 roomFogColor;
uniform float roomFogNear;
uniform float roomFogFar;
varying float vRoomFog;
`

// three's linear fog, with the room's fog for the groups the flood marks.
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	bool roomFogged = vRoomFog > 0.5;
	vec3 fogTint = roomFogged ? roomFogColor : fogColor;
	#ifdef FOG_EXP2
		float fogFactor = roomFogged ? smoothstep(roomFogNear, roomFogFar, vFogDepth) : 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
	#else
		float fogFactor = smoothstep(roomFogged ? roomFogNear : fogNear, roomFogged ? roomFogFar : fogFar, vFogDepth);
	#endif
	gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, fogFactor);
#endif
`

/** Adds the room gate to a WMO material, after any patch it already has. */
export function patchRoomGate(m: THREE.Material) {
	const prev = m.onBeforeCompile
	const prevKey = m.customProgramCacheKey
	m.onBeforeCompile = (shader, renderer) => {
		prev.call(m, shader, renderer)
		Object.assign(shader.uniforms, uniforms)
		shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERTEX_PARS).replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERTEX)
		shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAGMENT_PARS).replace('#include <fog_fragment>', FOG_FRAGMENT)
	}
	m.customProgramCacheKey = () => prevKey.call(m) + '|room'
}

/** Rows written this frame, and whether any mask byte changed. */
let rows = 0
let changed = false

/** Starts a frame's gates: none until `addRoomGate` adds them. */
export function beginRoomGates() {
	rows = 0
	changed = false
}

/**
 * Gates the instance at `origin` (world space) by its groups: `visible[g]` draws group g, `fog[g]`
 * gives it the room fog. Reports false when every row is taken.
 */
export function addRoomGate(origin: THREE.Vector3, visible: ArrayLike<number>, fog: ArrayLike<number>): boolean {
	if (rows >= ROOM_MAX_GATED) return false
	const row = rows++
	uniforms.roomOrigins.value[row].copy(origin)
	const n = Math.min(visible.length, ROOM_MAX_GROUPS)
	const base = row * ROOM_MAX_GROUPS * 4
	for (let g = 0; g < ROOM_MAX_GROUPS; g++) {
		const o = base + g * 4
		const r = g < n ? (visible[g] ? 255 : 0) : 255
		const gr = g < n && fog[g] ? 255 : 0
		if (maskData[o] !== r || maskData[o + 1] !== gr) {
			maskData[o] = r
			maskData[o + 1] = gr
			changed = true
		}
	}
	return true
}

/** Ends a frame's gates: uploads the mask if it changed. */
export function endRoomGates() {
	uniforms.roomCount.value = rows
	if (changed) mask.needsUpdate = true
}

/** The room fog's colour (sRGB, 0..1) and distances. */
export function setRoomFog(color: ArrayLike<number>, near: number, far: number) {
	uniforms.roomFogColor.value.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace)
	uniforms.roomFogNear.value = near
	uniforms.roomFogFar.value = Math.max(far, near + 0.001)
}
