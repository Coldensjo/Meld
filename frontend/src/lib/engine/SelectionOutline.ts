import * as THREE from 'three'
import type { ModelAsset } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'

const MAX_BOXES = 8

/** A model to outline, and where it stands. */
export interface OutlineTarget {
  asset: ModelAsset
  matrix: THREE.Matrix4
}

/**
 * Screen-space silhouette stroke around the selected models. Each model is drawn into a
 * mask (respecting alpha-tested textures, so leaves outline correctly, not as
 * quads), then a full-screen pass draws a coloured edge around the mask.
 */
export class SelectionOutline {
  readonly color = new THREE.Color(1, 0.8, 0.2)
  /** Colour for the parts that are underground or inside another prop. */
  readonly warnColor = new THREE.Color(1, 0.23, 0.19)
  // Shared by all mask materials: terrain heightmap + other props' boxes.
  private shared = {
    heightTex: { value: null as THREE.DataTexture | null },
    cellSize: { value: 2 },
    verts: { value: 1 },
    sinkTol: { value: 0.3 },
    boxMin: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
    boxMax: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
    boxCount: { value: 0 },
  }
  private terrain: Terrain | null = null
  private terrainVersion = -1
  private maskRT = new THREE.WebGLRenderTarget(1, 1)
  private maskScene = new THREE.Scene()
  /** One stand-in mesh per outlined model, grown as needed. */
  private proxies: THREE.Mesh[] = []
  private maskMats = new WeakMap<THREE.Material, THREE.ShaderMaterial>()
  private quadScene = new THREE.Scene()
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quadMat: THREE.ShaderMaterial
  private active = false

  constructor() {
    this.quadMat = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: this.maskRT.texture },
        texel: { value: new THREE.Vector2(1, 1) },
        color: { value: this.color },
        warnColor: { value: this.warnColor },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D mask;
        uniform vec2 texel;
        uniform vec3 color;
        uniform vec3 warnColor;
        varying vec2 vUv;
        void main() {
          float c = texture2D(mask, vUv).r;
          float m = 0.0;
          float warn = 0.0;
          // Dilate by ~2.5px in 12 directions; G marks underground/overlapping parts.
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5236;
            vec2 d = vec2(cos(a), sin(a)) * texel;
            vec4 s1 = texture2D(mask, vUv + d * 1.25);
            vec4 s2 = texture2D(mask, vUv + d * 2.5);
            m = max(m, max(s1.r, s2.r));
            warn = max(warn, max(s1.g, s2.g));
          }
          float edge = clamp(m - c, 0.0, 1.0);
          if (edge < 0.01) discard;
          gl_FragColor = vec4(mix(color, warnColor, warn), edge);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat))
  }

  setSize(width: number, height: number) {
    this.maskRT.setSize(Math.max(1, width), Math.max(1, height))
    this.quadMat.uniforms.texel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height))
  }

  /** White mask material that keeps the source's alpha cut-outs (e.g. leaves). */
  private maskMaterial(src: THREE.Material): THREE.ShaderMaterial {
    let m = this.maskMats.get(src)
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, useMap: { value: 0 }, cutoff: { value: 0 }, ...this.shared },
        defines: { MAX_BOXES },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform float useMap;
          uniform float cutoff;
          uniform sampler2D heightTex;
          uniform float cellSize;
          uniform float verts;
          uniform float sinkTol;
          uniform vec3 boxMin[MAX_BOXES];
          uniform vec3 boxMax[MAX_BOXES];
          uniform int boxCount;
          varying vec2 vUv;
          varying vec3 vWorld;

          float h(ivec2 p) {
            p = clamp(p, ivec2(0), ivec2(int(verts) - 1));
            return texelFetch(heightTex, p, 0).r;
          }
          // Bilinear terrain height at a world position.
          float terrainHeight(vec2 xz) {
            vec2 g = clamp(xz / cellSize, vec2(0.0), vec2(verts - 1.0));
            ivec2 i = ivec2(floor(g));
            vec2 f = g - vec2(i);
            return mix(mix(h(i), h(i + ivec2(1, 0)), f.x), mix(h(i + ivec2(0, 1)), h(i + ivec2(1, 1)), f.x), f.y);
          }

          void main() {
            if (useMap > 0.5 && texture2D(map, vUv).a < cutoff) discard;
            float warn = vWorld.y < terrainHeight(vWorld.xz) - sinkTol ? 1.0 : 0.0;
            for (int k = 0; k < MAX_BOXES; k++) {
              if (k >= boxCount) break;
              if (all(greaterThan(vWorld, boxMin[k])) && all(lessThan(vWorld, boxMax[k]))) warn = 1.0;
            }
            gl_FragColor = vec4(1.0, warn, 0.0, 1.0);
          }`,
      })
      this.maskMats.set(src, m)
    }
    const s = src as THREE.MeshLambertMaterial
    const cutoff = s.alphaTest > 0 ? s.alphaTest : s.transparent ? 0.3 : 0
    m.uniforms.map.value = s.map ?? null
    m.uniforms.useMap.value = s.map && cutoff > 0 ? 1 : 0
    m.uniforms.cutoff.value = cutoff
    m.side = s.side
    // Additive/modulate effect layers (glows) shouldn't widen the silhouette.
    m.visible = s.blending === THREE.NormalBlending
    return m
  }

  /** Terrain used to detect underground parts (heightmap kept in sync). */
  setTerrain(t: Terrain) {
    if (t !== this.terrain) {
      this.terrain = t
      this.shared.heightTex.value?.dispose()
      const tex = new THREE.DataTexture(t.heights, t.verts, t.verts, THREE.RedFormat, THREE.FloatType)
      tex.minFilter = tex.magFilter = THREE.NearestFilter
      tex.needsUpdate = true
      this.shared.heightTex.value = tex
      this.shared.cellSize.value = t.cellSize
      this.shared.verts.value = t.verts
      this.terrainVersion = t.heightsVersion
    } else if (this.terrainVersion !== t.heightsVersion && this.active) {
      this.terrainVersion = t.heightsVersion
      this.shared.heightTex.value!.needsUpdate = true
    }
  }

  /** World boxes of other props the target overlaps; parts inside them are marked. */
  setWarnBoxes(boxes: THREE.Box3[]) {
    const n = Math.min(boxes.length, MAX_BOXES)
    for (let i = 0; i < n; i++) {
      this.shared.boxMin.value[i].copy(boxes[i].min)
      this.shared.boxMax.value[i].copy(boxes[i].max)
    }
    this.shared.boxCount.value = n
  }

  /** Outline every target, or nothing when the list is empty. */
  setTargets(targets: readonly OutlineTarget[]) {
    this.active = targets.length > 0
    while (this.proxies.length < targets.length) {
      const p = new THREE.Mesh()
      p.matrixAutoUpdate = false
      p.frustumCulled = false
      this.maskScene.add(p)
      this.proxies.push(p)
    }
    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[i]
      const t = targets[i]
      proxy.visible = !!t
      if (!t) continue
      proxy.geometry = t.asset.geometry
      proxy.material = Array.isArray(t.asset.material) ? t.asset.material.map((m) => this.maskMaterial(m)) : this.maskMaterial(t.asset.material)
      proxy.matrix.copy(t.matrix)
      proxy.matrixWorld.copy(t.matrix)
    }
  }

  /** Draw the stroke on top of the already-rendered frame. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (!this.active) return
    const prevTarget = renderer.getRenderTarget()
    const prevColor = renderer.getClearColor(new THREE.Color())
    const prevAlpha = renderer.getClearAlpha()
    const prevAuto = renderer.autoClear
    renderer.setRenderTarget(this.maskRT)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(this.maskScene, camera)
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevColor, prevAlpha)
    renderer.autoClear = false
    renderer.render(this.quadScene, this.quadCam)
    renderer.autoClear = prevAuto
  }

  dispose() {
    this.shared.heightTex.value?.dispose()
    this.maskRT.dispose()
    this.quadMat.dispose()
  }
}
