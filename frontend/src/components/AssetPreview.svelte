<script lang="ts" module>
  import * as THREE from 'three'

  // One small renderer shared by every preview; rendered on demand only.
  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000)
  const holder = new THREE.Group()
  scene.add(new THREE.HemisphereLight(0xc8d4e6, 0x403528, Math.PI))
  const sun = new THREE.DirectionalLight(0xfff2d9, Math.PI)
  sun.position.set(3, 5, 4)
  scene.add(sun, holder)

  function getRenderer(size: number) {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
      renderer.setClearColor(0x000000, 0)
    }
    renderer.setSize(size, size, false)
    return renderer
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getAsset, loadAsset, displayName } from '../lib/models/assets'

  let { type, size = 200 }: { type: string; size?: number } = $props()
  let canvas: HTMLCanvasElement
  let loading = $state(true)
  let timers: ReturnType<typeof setTimeout>[] = []

  function draw() {
    const a = getAsset(type)
    holder.clear()
    const mesh = new THREE.Mesh(a.geometry, a.material)
    holder.add(mesh)
    const s = a.bbox.getBoundingSphere(new THREE.Sphere())
    const r = Math.max(s.radius, 0.5)
    const d = (r / Math.sin(THREE.MathUtils.degToRad(15))) * 1.05
    camera.position.set(s.center.x + d * 0.6, s.center.y + d * 0.45, s.center.z + d * 0.66)
    camera.near = d / 100
    camera.far = d * 4
    camera.updateProjectionMatrix()
    camera.lookAt(s.center)
    const r3 = getRenderer(size)
    r3.render(scene, camera)
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(r3.domElement, 0, 0, size, size)
    holder.clear()
  }

  $effect(() => {
    const t = type
    loading = true
    timers.forEach(clearTimeout)
    timers = []
    loadAsset(t).then(() => {
      if (t !== type) return
      loading = false
      draw()
      // Textures stream in after the mesh; redraw a couple of times.
      timers = [300, 900, 2000].map((ms) => setTimeout(() => t === type && draw(), ms))
    })
  })

  onDestroy(() => timers.forEach(clearTimeout))
</script>

<div class="preview" style:width="{size}px" style:height="{size}px">
  <canvas bind:this={canvas} width={size} height={size}></canvas>
  {#if loading}<span class="loading">Loading…</span>{/if}
  <span class="name">{displayName(type)}</span>
</div>

<style>
  .preview {
    position: relative;
    margin: 0 auto 8px;
    background: radial-gradient(circle at 50% 40%, var(--panel-3), var(--bg));
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  canvas {
    width: 100%;
    height: 100%;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 12px;
  }
  .name {
    position: absolute;
    left: 6px;
    bottom: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
