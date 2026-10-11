import * as THREE from 'three'

const vertex = /* glsl */ `
#include <fog_pars_vertex>
uniform float time;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.y += sin(wp.x * 0.15 + time * 1.1) * 0.06 + cos(wp.z * 0.12 + time * 0.9) * 0.06;
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float time;
uniform vec3 shallow;
uniform vec3 deep;
uniform vec3 skyColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float opacity;
varying vec3 vWorldPos;

// Cheap animated normal from a handful of travelling sine waves.
vec3 waveNormal(vec2 p) {
  float t = time;
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.6) * 0.20;
  g += vec2(-0.5, 0.9) * cos(dot(p, vec2(-0.5, 0.9)) * 1.7 + t * 2.1) * 0.12;
  g += vec2(0.3, -0.95) * cos(dot(p, vec2(0.3, -0.95)) * 3.1 + t * 2.7) * 0.07;
  g += vec2(-0.9, -0.2) * cos(dot(p, vec2(-0.9, -0.2)) * 5.3 + t * 3.3) * 0.04;
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main() {
  vec3 v = normalize(cameraPosition - vWorldPos);
  // Fade wave detail with distance to avoid shimmering moire far away.
  float fade = 1.0 / (1.0 + distance(cameraPosition, vWorldPos) * 0.006);
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), waveNormal(vWorldPos.xz), fade));
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = mix(shallow, deep, 0.5 + 0.5 * n.x);
  col = mix(col, skyColor, fres * 0.5);
  vec3 h = normalize(sunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 120.0) * 1.4;
  col += sunColor * spec;
  gl_FragColor = vec4(col, mix(opacity, 1.0, fres * 0.6));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export class Water {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  /** Deep-water floor extending past the map edge (matches the terrain's depth tint). */
  readonly floor: THREE.Mesh

  constructor(worldSize: number) {
    const geo = new THREE.PlaneGeometry(worldSize * 10, worldSize * 10, 160, 160)
    geo.rotateX(-Math.PI / 2)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        time: { value: 0 },
        shallow: { value: new THREE.Color(0.04, 0.28, 0.38) },
        deep: { value: new THREE.Color(0.015, 0.1, 0.2) },
        skyColor: { value: new THREE.Color(0.6, 0.75, 0.9) },
        sunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
        sunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
        opacity: { value: 0.72 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.position.set(worldSize / 2, 0, worldSize / 2)
    this.mesh.renderOrder = 10
    this.mesh.name = 'water'

    const floorGeo = new THREE.PlaneGeometry(worldSize * 10, worldSize * 10)
    floorGeo.rotateX(-Math.PI / 2)
    this.floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.12, 0.18) }))
    this.floor.name = 'seafloor'
    this.mesh.add(this.floor)
    this.floor.position.set(0, -40, 0)
  }

  set level(y: number) {
    this.mesh.position.y = y
  }

  set visible(v: boolean) {
    this.mesh.visible = v
  }

  update(time: number) {
    this.material.uniforms.time.value = time
  }

  dispose() {
    this.floor.geometry.dispose()
    ;(this.floor.material as THREE.Material).dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
