<script lang="ts">
  import * as THREE from 'three'
  import { onMount } from 'svelte'
  import { buildWowAsset, texturesReady } from '../lib/models/assets'
  import { fetchMesh } from '../lib/wow/api'
  import { ModelAnimation, modelMesh } from '../lib/world/Animator'
  import { spawnType } from '../lib/world/spawnInfo'

  // A creature shown big and animated, as the creature editor sees it: the model dressed in its look
  // (see wow.Look) playing one of its animations. Drag turns it, the wheel zooms. It has its own
  // renderer, so the main scene is untouched.

  interface Props {
    /** The client model path and its look query, as a spawn carries them. */
    model: string
    look: string
    /** The AnimationData ID to play; the model's Stand when it has no such loop. */
    anim: number
    /** The creature's size in the world (template scale times display scale). */
    scale: number
  }
  let { model, look, anim, scale }: Props = $props()

  let canvas: HTMLCanvasElement | undefined = $state()
  let loading = $state(false)
  let failed = $state('')
  let size = $state<{ h: number; tris: number } | null>(null)

  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 2000)
  const pivot = new THREE.Group()
  let mesh: THREE.Mesh | null = null
  let animation: ModelAnimation | null = null
  let geometry: THREE.BufferGeometry | null = null
  let yaw = 0.5
  let pitch = 0.15
  let distance = 6
  let target = new THREE.Vector3(0, 1, 0)
  let spinning = $state(false)
  let raf = 0
  let loadId = 0
  const start = performance.now()

  scene.add(pivot)
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.65, 0.75), new THREE.Color(0.28, 0.25, 0.22), Math.PI))
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.96, 0.88), Math.PI * 0.9)
  sun.position.set(4, 7, 3)
  scene.add(sun)
  // A disc for the creature to stand on, a yard per ring, so its size reads.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a414c }))
  const rings = new THREE.PolarGridHelper(1, 8, 1, 48, 0x56606e, 0x4a525e)
  scene.add(ground, rings)

  function drop() {
    if (mesh) pivot.remove(mesh)
    geometry?.dispose()
    mesh = null
    animation = null
    geometry = null
  }

  function frame() {
    raf = requestAnimationFrame(frame)
    if (!renderer || !canvas) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    if (spinning) yaw += 0.004
    animation?.update(performance.now() - start)
    const cp = Math.cos(pitch)
    camera.position.set(target.x + Math.sin(yaw) * cp * distance, target.y + Math.sin(pitch) * distance, target.z + Math.cos(yaw) * cp * distance)
    camera.lookAt(target)
    renderer.render(scene, camera)
  }

  async function show(model: string, look: string, anim: number, scale: number) {
    const id = ++loadId
    failed = ''
    if (!model) {
      drop()
      size = null
      failed = 'This display has no model.'
      return
    }
    const type = spawnType({ model, look, anim })
    loading = true
    try {
      const m = await fetchMesh(type.slice(type.indexOf(':') + 1))
      const a = buildWowAsset(m)
      await texturesReady(a.material)
      if (id !== loadId) {
        a.geometry.dispose()
        return
      }
      const first = !mesh
      drop()
      geometry = a.geometry
      // The preview poses its own copy of the bones, so it never moves the scene's instances.
      if (m.bones && m.boneIdx && m.boneW) animation = new ModelAnimation(a.geometry, m.bones, m.boneIdx, m.boneW)
      mesh = modelMesh(a.geometry, a.material, animation?.skeleton)
      const k = scale > 0 ? scale : 1
      mesh.scale.setScalar(k)
      pivot.add(mesh)
      const box = a.bbox.clone()
      box.min.multiplyScalar(k)
      box.max.multiplyScalar(k)
      const s = box.getSize(new THREE.Vector3())
      const r = Math.max(s.x, s.z) * 0.75 + 0.5
      ground.scale.setScalar(r)
      rings.scale.setScalar(r)
      size = { h: s.y, tris: a.geometry.index ? a.geometry.index.count / 3 : 0 }
      // A new creature is framed whole; another animation or look of the same one keeps the view.
      if (first || Math.abs(target.y - s.y * 0.55) > s.y * 0.3) {
        target = new THREE.Vector3(0, s.y * 0.55, 0)
        distance = (Math.max(s.y, s.x, s.z) / 2 / Math.tan(THREE.MathUtils.degToRad(15))) * 1.25
        camera.near = distance / 200
        camera.far = distance * 20
        camera.updateProjectionMatrix()
      }
    } catch (err) {
      if (id === loadId) failed = `The model could not be loaded: ${err}`
    } finally {
      if (id === loadId) loading = false
    }
  }

  $effect(() => {
    void show(model, look, anim, scale)
  })

  onMount(() => {
    if (canvas) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.outputColorSpace = THREE.SRGBColorSpace
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      drop()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      rings.dispose()
      renderer?.dispose()
      renderer = null
    }
  })

  let drag: { x: number; y: number } | null = null
  function down(e: PointerEvent) {
    drag = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!drag) return
    yaw -= (e.clientX - drag.x) * 0.01
    pitch = Math.min(1.4, Math.max(-0.3, pitch + (e.clientY - drag.y) * 0.01))
    drag = { x: e.clientX, y: e.clientY }
  }
  function up() {
    drag = null
  }
  function wheel(e: WheelEvent) {
    e.preventDefault()
    distance *= e.deltaY > 0 ? 1.1 : 0.9
  }
</script>

<div class="preview">
  <div class="view" role="img" aria-label="Creature preview" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel}>
    <canvas bind:this={canvas}></canvas>
    <div class="overlay">
      {#if loading}<span>Loading…</span>{/if}
      {#if failed}<span class="warn">{failed}</span>{/if}
    </div>
    <label class="spin"><input type="checkbox" bind:checked={spinning} /> Turn</label>
  </div>
  {#if size}
    <p class="dim">{size.h.toFixed(1)} yd tall · {size.tris.toLocaleString()} triangles · drag to turn, scroll to zoom</p>
  {/if}
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 0;
  }
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    border-radius: 4px;
    background: radial-gradient(circle at 50% 35%, #5a6373, #22262d 85%);
    overflow: hidden;
    cursor: grab;
  }
  .view:active {
    cursor: grabbing;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .overlay {
    position: absolute;
    left: 10px;
    top: 8px;
    font-size: 12px;
    color: var(--text-dim);
    pointer-events: none;
  }
  .warn {
    color: var(--danger);
  }
  .spin {
    position: absolute;
    right: 10px;
    bottom: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .dim {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
