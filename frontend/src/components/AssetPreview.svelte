<script lang="ts">
  import * as THREE from 'three'
  import { onMount } from 'svelte'
  import { buildWowAsset, releaseWowAsset, texturesReady, type ModelAsset } from '../lib/models/assets'
  import { helperGeometry, helperMaterial, isHelper } from '../lib/models/helpers'
  import { fetchMesh, texturePreview } from '../lib/wow/api'
  import type { SearchItem } from '../lib/wow/search'
  import { uiZoom } from '../lib/ui/uiScale'

  // A live view of one model or texture: models spin slowly and can be turned by dragging, so an
  // author can tell what a thing is before placing it. It has its own small renderer, so the main
  // scene is untouched; three uploads the shared textures to this context on first use.

  interface Props {
    item: SearchItem | null
  }
  let { item }: Props = $props()

  let canvas: HTMLCanvasElement | undefined = $state()
  let texUrl = $state('')
  let loading = $state(false)
  let failed = $state(false)
  let info = $state<{ w: number; h: number; d: number; tris: number } | null>(null)

  let renderer: THREE.WebGLRenderer | null = null
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000)
  const pivot = new THREE.Group()
  let mesh: THREE.Mesh | null = null
  let asset: ModelAsset | null = null
  let yaw = 0.6
  let pitch = 0.35
  let distance = 10
  let center = new THREE.Vector3()
  let spinning = true
  let raf = 0
  /** The context is lost (a driver reset, #213): the frame skips its work until three has restored it. */
  let contextLost = false
  let loadId = 0

  scene.add(pivot)
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.6, 0.65, 0.75), new THREE.Color(0.28, 0.25, 0.22), Math.PI))
  const sun = new THREE.DirectionalLight(new THREE.Color(1, 0.96, 0.88), Math.PI * 0.9)
  sun.position.set(4, 7, 3)
  scene.add(sun)

  function dropMesh() {
    if (mesh) {
      pivot.remove(mesh)
      mesh = null
    }
		// Its geometry, and the materials of its own, which leave the animated lists (#506).
		if (asset) releaseWowAsset(asset)
		asset = null
  }

  function frame() {
    raf = requestAnimationFrame(frame)
    if (!renderer || contextLost || !canvas || !mesh) return
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    // three sizes the buffer to the CSS size times the pixel ratio; comparing with the CSS size alone resized it every frame.
    const pr = renderer.getPixelRatio()
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    if (spinning) yaw += 0.004
    const cp = Math.cos(pitch)
    camera.position.set(center.x + Math.sin(yaw) * cp * distance, center.y + Math.sin(pitch) * distance, center.z + Math.cos(yaw) * cp * distance)
    camera.lookAt(center)
    renderer.render(scene, camera)
  }

  async function show(it: SearchItem | null) {
    const id = ++loadId
    dropMesh()
    texUrl = ''
    failed = false
    info = null
    if (!it) return
    loading = true
    try {
      if (it.kind === 'tex') {
        const u = await texturePreview(it.path, 256)
        if (id === loadId) texUrl = u
        return
      }
      // A helper shape gets a geometry of its own here, since the preview disposes what it drew.
      const helper = isHelper(it.key) ? helperGeometry(it.key) : null
      if (helper) helper.computeBoundingBox()
      const a: ModelAsset = helper ? { geometry: helper, material: helperMaterial(), bbox: helper.boundingBox!.clone(), ready: true, effects: [], emitters: [], ribbons: [] } : buildWowAsset(await fetchMesh(it.path))
      await texturesReady(a.material)
      if (id !== loadId) {
        releaseWowAsset(a)
        return
      }
      asset = a
      mesh = new THREE.Mesh(a.geometry, a.material)
      pivot.add(mesh)
      const size = a.bbox.getSize(new THREE.Vector3())
      a.bbox.getCenter(center)
      const r = Math.max(size.length() / 2, 0.3)
      distance = (r / Math.sin(THREE.MathUtils.degToRad(15))) * 0.95
      camera.near = distance / 100
      camera.far = distance * 4
      camera.updateProjectionMatrix()
      // Tall things are looked at from lower down, flat things from higher up.
      pitch = size.y > Math.max(size.x, size.z) * 1.5 ? 0.15 : size.y < Math.max(size.x, size.z) * 0.3 ? 0.8 : 0.35
      info = { w: size.x, h: size.y, d: size.z, tris: a.geometry.index ? a.geometry.index.count / 3 : 0 }
    } catch {
      if (id === loadId) failed = true
    } finally {
      if (id === loadId) loading = false
    }
  }

  $effect(() => {
    void show(item)
  })

  /** The path without a look query (a weapon's texture), which is noise to a reader. */
  const shownPath = $derived(item ? item.path.split('?')[0] : '')

  const listeners = new AbortController()
  onMount(() => {
    if (canvas) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      // Times the interface size (#372), so the zoomed canvas stays sharp.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * uiZoom())
      renderer.outputColorSpace = THREE.SRGBColorSpace
      // three rebuilds its state and uploads the geometry and textures again on a restore by itself
      // (it cancels the loss event's default for that), and these views keep no shadow maps or other
      // drawn-once targets, so the frame need only wait. A closed view's released context (below) is
      // never restored, since nothing calls restoreContext on it.
      canvas.addEventListener('webglcontextlost', () => (contextLost = true), { signal: listeners.signal })
      canvas.addEventListener('webglcontextrestored', () => (contextLost = false), { signal: listeners.signal })
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      listeners.abort()
      dropMesh()
      // dispose() keeps the WebGL context alive until garbage collection, and the browser drops the
      // oldest context (the viewport's) past about 16 (#201): release this one now.
      renderer?.forceContextLoss()
      renderer?.dispose()
      renderer = null
    }
  })

  // Dragging turns the model; it resumes spinning after a moment.
  let drag: { x: number; y: number } | null = null
  let resume: ReturnType<typeof setTimeout> | undefined
  function down(e: PointerEvent) {
    drag = { x: e.clientX, y: e.clientY }
    spinning = false
    clearTimeout(resume)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent) {
    if (!drag) return
    yaw += (e.clientX - drag.x) * 0.01
    pitch = Math.min(1.4, Math.max(-0.5, pitch + (e.clientY - drag.y) * 0.01))
    drag = { x: e.clientX, y: e.clientY }
  }
  function up() {
    drag = null
    resume = setTimeout(() => (spinning = true), 4000)
  }
  function wheel(e: WheelEvent) {
    distance *= e.deltaY > 0 ? 1.1 : 0.9
  }

  const yards = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))
</script>

<div class="preview">
  <div class="view" role="img" aria-label="Model preview" class:hidden={!item || item.kind === 'tex'} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel}>
    <canvas bind:this={canvas}></canvas>
  </div>
  {#if item?.kind === 'tex'}
    <div class="tex">
      {#if texUrl}<img src={texUrl} alt="" draggable="false" />{/if}
    </div>
  {/if}
  {#if !item}
    <p class="hint">Hover a tile to see it here. Drag to turn a model, scroll to zoom.</p>
  {:else}
    {#if loading}<p class="hint">Loading…</p>{/if}
    {#if failed}<p class="hint">Nothing to show (an effect-only model).</p>{/if}
    <div class="details">
      <div class="name" title={shownPath}>{item.name}</div>
      <div class="dim">{item.kind === 'tex' ? 'Texture' : item.kind === 'm2' ? 'Doodad' : 'Building'} · {item.category} · {item.zone}</div>
      {#if info}
        <div class="dim">{yards(info.w)} × {yards(info.d)} yd, {yards(info.h)} yd tall · {info.tris.toLocaleString()} tris</div>
      {/if}
      <div class="path">{shownPath}</div>
    </div>
  {/if}
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    gap: 6px;
  }
  .view {
    position: relative;
    flex: 1;
    min-height: 0;
    border-radius: 4px;
    background: radial-gradient(circle at 50% 40%, #5a6373, #2b3038 80%);
    overflow: hidden;
    cursor: grab;
  }
  .view.hidden {
    display: none;
  }
  .view:active {
    cursor: grabbing;
  }
  /* Out of flow, so the canvas's own size never stops the panel from shrinking. */
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .tex {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    border-radius: 4px;
    background: var(--bg);
    overflow: hidden;
  }
  .tex img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: auto;
  }
  .hint,
  .dim {
    color: var(--text-dim);
    font-size: 11px;
    margin: 0;
  }
  .details {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path {
    font: 10px var(--mono);
    color: var(--text-dim);
    word-break: break-all;
    max-height: 28px;
    overflow: hidden;
  }
</style>
