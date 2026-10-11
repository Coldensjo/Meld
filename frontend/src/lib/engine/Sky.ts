import * as THREE from 'three'

export const HORIZON = new THREE.Color('#c9d9e6')
const ZENITH = new THREE.Color('#4a7fc0')

/** Gradient sky dome with a soft sun glow. Always centred on the camera. */
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      horizon: { value: HORIZON },
      zenith: { value: ZENITH },
      sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.6);
        vec3 col = mix(horizon, zenith, t);
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  mesh.name = 'sky'
  return mesh
}
