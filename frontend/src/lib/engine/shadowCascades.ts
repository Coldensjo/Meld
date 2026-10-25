import * as THREE from 'three'

// The key light's (sun or moon) shadow comes in two cascades. Cascade 0 is the key light's own
// shadow map: a sharp one fitted around what the camera looks at. Cascade 1 is a second, black
// `DirectionalLight` that lights nothing and only carries a far coarser map covering the distance.
// Both the terrain shader and the props' Lambert materials read them through `cascadeShadow`.

/** GLSL: `cascadeShadow(light)` is the shadow for directional light `light` (only 0 has one). */
export const CASCADE_SHADOW_GLSL = /* glsl */ `
float cascadeShadow(const in int light) {
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
    if (light != 0) return 1.0;
    vec4 c0 = vDirectionalShadowCoord[0];
    vec3 p0 = c0.xyz / c0.w;
    // 0 at the near map's centre, 1 at its edge, where the far map takes over.
    float edge = max(abs(p0.x - 0.5), abs(p0.y - 0.5)) * 2.0;
    float s = 1.0;
    if (edge < 1.0 && p0.z <= 1.0) {
      DirectionalLightShadow d0 = directionalLightShadows[0];
      s = getShadow(directionalShadowMap[0], d0.shadowMapSize, d0.shadowIntensity, d0.shadowBias, d0.shadowRadius, c0);
    }
    #if NUM_DIR_LIGHT_SHADOWS > 1
      float t = p0.z > 1.0 ? 1.0 : smoothstep(0.8, 1.0, edge);
      if (t > 0.0) {
        DirectionalLightShadow d1 = directionalLightShadows[1];
        float f = getShadow(directionalShadowMap[1], d1.shadowMapSize, d1.shadowIntensity, d1.shadowBias, d1.shadowRadius, vDirectionalShadowCoord[1]);
        s = mix(s, f, t);
      }
    #endif
    return s;
  #else
    return 1.0;
  #endif
}
`

const DIRECTIONAL_SHADOW_CALL = /getShadow\( directionalShadowMap\[ i \][^;]*vDirectionalShadowCoord\[ i \] \)/

// three's lighting loop with the directional light's shadow read from the cascades instead. Inside the
// unrolled loop only UNROLLED_LOOP_INDEX becomes the light's number.
const LIGHTS_FRAGMENT_BEGIN = THREE.ShaderChunk.lights_fragment_begin.replace(DIRECTIONAL_SHADOW_CALL, 'cascadeShadow( UNROLLED_LOOP_INDEX )')
if (LIGHTS_FRAGMENT_BEGIN === THREE.ShaderChunk.lights_fragment_begin) {
	throw new Error('three changed lights_fragment_begin: the shadow cascade patch no longer applies')
}

/** Makes a built-in lit material (Lambert) read the key light's shadow from the cascades. */
export function patchCascadeShadows(m: THREE.Material) {
	m.onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + CASCADE_SHADOW_GLSL).replace('#include <lights_fragment_begin>', LIGHTS_FRAGMENT_BEGIN)
	}
	m.customProgramCacheKey = () => 'cascades'
}
