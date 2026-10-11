import * as THREE from 'three'
import type { ModelAsset } from '../models/assets'

/**
 * Screen-space silhouette stroke around one model. The model is drawn into a
 * mask (respecting alpha-tested textures, so leaves outline correctly, not as
 * quads), then a full-screen pass draws a coloured edge around the mask.
 */
export class SelectionOutline {
  readonly color = new THREE.Color(1, 0.8, 0.2)
  private maskRT = new THREE.WebGLRenderTarget(1, 1)
  private maskScene = new THREE.Scene()
  private proxy = new THREE.Mesh()
  private maskMats = new WeakMap<THREE.Material, THREE.ShaderMaterial>()
  private quadScene = new THREE.Scene()
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quadMat: THREE.ShaderMaterial
  private active = false

  constructor() {
    this.proxy.matrixAutoUpdate = false
    this.proxy.frustumCulled = false
    this.maskScene.add(this.proxy)
    this.quadMat = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: this.maskRT.texture },
        texel: { value: new THREE.Vector2(1, 1) },
        color: { value: this.color },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D mask;
        uniform vec2 texel;
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          float c = texture2D(mask, vUv).r;
          float m = 0.0;
          // Dilate by ~2.5px in 12 directions.
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5236;
            vec2 d = vec2(cos(a), sin(a)) * texel;
            m = max(m, texture2D(mask, vUv + d * 1.25).r);
            m = max(m, texture2D(mask, vUv + d * 2.5).r);
          }
          float edge = clamp(m - c, 0.0, 1.0);
          if (edge < 0.01) discard;
          gl_FragColor = vec4(color, edge);
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
        uniforms: { map: { value: null }, useMap: { value: 0 }, cutoff: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform float useMap;
          uniform float cutoff;
          varying vec2 vUv;
          void main() {
            if (useMap > 0.5 && texture2D(map, vUv).a < cutoff) discard;
            gl_FragColor = vec4(1.0);
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

  /** Outline `asset` drawn with `matrix`, or nothing when asset is null. */
  setTarget(asset: ModelAsset | null, matrix?: THREE.Matrix4) {
    this.active = !!asset && !!matrix
    if (!asset || !matrix) return
    this.proxy.geometry = asset.geometry
    this.proxy.material = Array.isArray(asset.material) ? asset.material.map((m) => this.maskMaterial(m)) : this.maskMaterial(asset.material)
    this.proxy.matrix.copy(matrix)
    this.proxy.matrixWorld.copy(matrix)
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
    this.maskRT.dispose()
    this.quadMat.dispose()
  }
}
