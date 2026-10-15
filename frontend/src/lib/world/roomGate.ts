// The room gate: portal culling and the room fog for the one placed WMO the camera is in, inside the
// shared WMO materials. A WMO's vertices carry their group plus one (`wmoRoom`, from Go's Mesh.Room).
// Every WMO material is patched to read one set of uniforms: the placement's origin, and a mask of
// its groups (red: drawn, green: room fog). A vertex of an instance at that origin whose group the
// flood didn't reach is moved out of the view, and one whose group takes the room fog is fogged with
// the room's fog instead of the scene's. Every other instance, and every model without the tags, is
// drawn as before. The owner chose this over a mesh of its own for the building (#8): no extra draw
// calls, though a hidden group still costs its vertices.

import * as THREE from 'three'

export const ROOM_ATTRIBUTE = 'wmoRoom'
/** Groups past this are always drawn and never fogged (the biggest 1.12 WMO has 306). */
export const ROOM_MAX_GROUPS = 1024

const maskData = new Uint8Array(ROOM_MAX_GROUPS * 4)
const mask = new THREE.DataTexture(maskData, ROOM_MAX_GROUPS, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
mask.magFilter = THREE.NearestFilter
mask.minFilter = THREE.NearestFilter
mask.generateMipmaps = false
mask.needsUpdate = true

/** Shared by every patched material, so one write reaches them all. */
const uniforms = {
  roomActive: { value: 0 },
  roomOrigin: { value: new THREE.Vector3() },
  roomMask: { value: mask },
  roomFogColor: { value: new THREE.Color() },
  roomFogNear: { value: 0 },
  roomFogFar: { value: 1 },
}

const VERTEX_PARS = /* glsl */ `
attribute float wmoRoom;
uniform float roomActive;
uniform vec3 roomOrigin;
uniform sampler2D roomMask;
varying float vRoomFog;
`

const VERTEX = /* glsl */ `
vRoomFog = 0.0;
#ifdef USE_INSTANCING
if (roomActive > 0.5 && wmoRoom > 0.5 && wmoRoom <= ${ROOM_MAX_GROUPS}.0 && distance(instanceMatrix[3].xyz, roomOrigin) < 0.01) {
	vec4 bits = texelFetch(roomMask, ivec2(int(wmoRoom) - 1, 0), 0);
	// Past the far plane: a hidden group's triangles are clipped whole.
	if (bits.r < 0.5) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
	vRoomFog = bits.g;
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
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERTEX_PARS)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERTEX)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAGMENT_PARS)
      .replace('#include <fog_fragment>', FOG_FRAGMENT)
  }
  m.customProgramCacheKey = () => prevKey.call(m) + '|room'
}

/**
 * Gates the instance at `origin` (world space; null turns the gate off) by its groups: `visible[g]`
 * draws group g, `fog[g]` gives it the room fog.
 */
export function setRoomGate(origin: THREE.Vector3 | null, visible?: ArrayLike<number>, fog?: ArrayLike<number>) {
  if (!origin || !visible || !fog) {
    uniforms.roomActive.value = 0
    return
  }
  uniforms.roomActive.value = 1
  uniforms.roomOrigin.value.copy(origin)
  let changed = false
  const n = Math.min(visible.length, ROOM_MAX_GROUPS)
  for (let g = 0; g < ROOM_MAX_GROUPS; g++) {
    const r = g < n ? (visible[g] ? 255 : 0) : 255
    const gr = g < n && fog[g] ? 255 : 0
    if (maskData[g * 4] !== r || maskData[g * 4 + 1] !== gr) {
      maskData[g * 4] = r
      maskData[g * 4 + 1] = gr
      changed = true
    }
  }
  if (changed) mask.needsUpdate = true
}

/** The room fog's colour (sRGB, 0..1) and distances. */
export function setRoomFog(color: ArrayLike<number>, near: number, far: number) {
  uniforms.roomFogColor.value.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace)
  uniforms.roomFogNear.value = near
  uniforms.roomFogFar.value = Math.max(far, near + 0.001)
}
