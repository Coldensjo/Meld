import * as THREE from 'three'
import type { ModelAsset } from '../models/assets'
import type { Terrain } from '../terrain/Terrain'
import { hasSkeleton, modelMesh } from '../world/Animator'

const MAX_BOXES = 8

/** A model to outline, where it stands, and whether it touches anything (the stroke's colour). */
export interface OutlineTarget {
	asset: ModelAsset
	matrix: THREE.Matrix4
	/** It stands on the ground, is attached to a parent, or meets another prop: drawn in `touchColor`. */
	touching: boolean
}

/**
 * Screen-space silhouette stroke around the selected models. Each model is drawn into a
 * mask (respecting alpha-tested textures, so leaves outline correctly, not as
 * quads), then a full-screen pass draws a coloured edge around the mask. The stroke is yellow
 * around a model that floats free, green around one that touches something (the ground, its
 * parent or another prop), and red along the parts that are buried or inside another prop.
 */
export class SelectionOutline {
	/** Colour around a model that touches nothing. */
	readonly color = new THREE.Color(1, 0.8, 0.2)
	/** Colour around a model that touches the ground, its parent or another prop. */
	readonly touchColor = new THREE.Color(0.3, 0.9, 0.45)
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
	private maskRT = new THREE.WebGLRenderTarget(1, 1)
	private maskScene = new THREE.Scene()
	/** One stand-in mesh per outlined model, grown as needed. */
	private proxies: THREE.Mesh[] = []
	/** Mask materials per source material, for a free and for a touching model (the B channel). */
	private maskMats = [new WeakMap<THREE.Material, THREE.ShaderMaterial>(), new WeakMap<THREE.Material, THREE.ShaderMaterial>()]
	private quadScene = new THREE.Scene()
	private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
	private quadMat: THREE.ShaderMaterial
	private active = false

	/**
	 * `color` draws every stroke in one colour (the free, touching and warning colours alike), and
	 * `fill` also tints the inside of the silhouette with it at that opacity: the Clear tool's marks
	 * on the models it would delete (#131). `opacity` scales the stroke's alpha: the hover outline's
	 * faint stroke (#641).
	 */
	constructor(opts: { color?: THREE.Color; fill?: number; opacity?: number } = {}) {
		if (opts.color) {
			this.color.copy(opts.color)
			this.touchColor.copy(opts.color)
			this.warnColor.copy(opts.color)
		}
		this.quadMat = new THREE.ShaderMaterial({
			uniforms: {
				mask: { value: this.maskRT.texture },
				texel: { value: new THREE.Vector2(1, 1) },
				color: { value: this.color },
				touchColor: { value: this.touchColor },
				warnColor: { value: this.warnColor },
				fill: { value: opts.fill ?? 0 },
				opacity: { value: opts.opacity ?? 1 },
			},
			vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
			fragmentShader: /* glsl */ `
        uniform sampler2D mask;
        uniform vec2 texel;
        uniform vec3 color;
        uniform vec3 touchColor;
        uniform vec3 warnColor;
        uniform float fill;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          float c = texture2D(mask, vUv).r;
          if (fill > 0.0 && c > 0.5) {
            gl_FragColor = vec4(color, fill);
            #include <colorspace_fragment>
            return;
          }
          float m = 0.0;
          float warn = 0.0;
          float touch = 0.0;
          // Dilate by ~2.5px in 12 directions; G marks underground/overlapping parts, B a model
          // that touches something.
          for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5236;
            vec2 d = vec2(cos(a), sin(a)) * texel;
            vec4 s1 = texture2D(mask, vUv + d * 1.25);
            vec4 s2 = texture2D(mask, vUv + d * 2.5);
            m = max(m, max(s1.r, s2.r));
            warn = max(warn, max(s1.g, s2.g));
            touch = max(touch, max(s1.b, s2.b));
          }
          float edge = clamp(m - c, 0.0, 1.0);
          if (edge < 0.01) discard;
          gl_FragColor = vec4(mix(mix(color, touchColor, touch), warnColor, warn), edge * opacity);
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
	private maskMaterial(src: THREE.Material, touching: boolean): THREE.ShaderMaterial {
		const mats = this.maskMats[touching ? 1 : 0]
		let m = mats.get(src)
		if (!m) {
			m = new THREE.ShaderMaterial({
				uniforms: { map: { value: null }, useMap: { value: 0 }, cutoff: { value: 0 }, touch: { value: touching ? 1 : 0 }, ...this.shared },
				defines: { MAX_BOXES },
				vertexShader: /* glsl */ `
          #include <skinning_pars_vertex>
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            // An animated model's proxy is skinned, so the outline follows the pose.
            #include <skinbase_vertex>
            #include <begin_vertex>
            #include <skinning_vertex>
            vec4 w = modelMatrix * vec4(transformed, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
				fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform float useMap;
          uniform float cutoff;
          uniform float touch;
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
            gl_FragColor = vec4(1.0, warn, touch, 1.0);
          }`,
			})
			mats.set(src, m)
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

	/**
	 * Terrain used to detect underground parts. Samples the terrain's own height texture, which
	 * `Terrain.update` keeps in sync by uploading only the edited rect (#567); the terrain owns and
	 * disposes it.
	 */
	setTerrain(t: Terrain) {
		if (t === this.terrain) return
		this.terrain = t
		this.shared.heightTex.value = t.heightTexture()
		this.shared.cellSize.value = t.cellSize
		this.shared.verts.value = t.verts
	}

	/** World boxes of other props the target overlaps (the first `count` of `boxes`); parts inside them are marked. */
	setWarnBoxes(boxes: readonly THREE.Box3[], count = boxes.length) {
		const n = Math.min(count, boxes.length, MAX_BOXES)
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
			let proxy = this.proxies[i]
			const t = targets[i]
			proxy.visible = !!t
			if (!t) continue
			if (!hasSkeleton(proxy, t.asset.skeleton)) {
				// An animated model's stand-in is skinned with its bones, so the outline follows the pose.
				proxy = modelMesh(t.asset.geometry, t.asset.material, t.asset.skeleton)
				proxy.matrixAutoUpdate = false
				proxy.frustumCulled = false
				this.maskScene.remove(this.proxies[i])
				this.maskScene.add(proxy)
				this.proxies[i] = proxy
			}
			proxy.geometry = t.asset.geometry
			proxy.material = Array.isArray(t.asset.material) ? this.maskMaterials(t.asset.material, t.touching) : this.maskMaterial(t.asset.material, t.touching)
			proxy.matrix.copy(t.matrix)
			proxy.matrixWorld.copy(t.matrix)
		}
	}

	/**
	 * A multi-material model's mask materials, filled into an array kept per source array and touching
	 * flag rather than mapped each frame. Each is still asked of `maskMaterial`, which refreshes its map
	 * and cut-off from the source (a texture can arrive after the model).
	 */
	private maskMaterials(list: THREE.Material[], touching: boolean): THREE.Material[] {
		const cache = this.maskLists[touching ? 1 : 0]
		let out = cache.get(list)
		if (!out) {
			out = []
			cache.set(list, out)
		}
		out.length = list.length
		for (let i = 0; i < list.length; i++) out[i] = this.maskMaterial(list[i], touching)
		return out
	}

	/** `maskMaterials`' arrays per source array, for a free and for a touching model. */
	private maskLists = [new WeakMap<THREE.Material[], THREE.Material[]>(), new WeakMap<THREE.Material[], THREE.Material[]>()]

	/** Scratch for `render`'s saved clear colour. */
	private prevClear = new THREE.Color()

	/** Draw the stroke on top of the already-rendered frame. */
	render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
		if (!this.active) return
		const prevTarget = renderer.getRenderTarget()
		const prevColor = renderer.getClearColor(this.prevClear)
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
