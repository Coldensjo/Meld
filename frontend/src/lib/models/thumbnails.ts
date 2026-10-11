import * as THREE from 'three'
import { PREFABS } from './prefabs'
import { objectMaterial, prefabGeometry } from '../world/ObjectLayer'

let cache: Record<string, string> | null = null

/** Renders a small preview image for every prefab (once, then cached). */
export function prefabThumbnails(size = 96): Record<string, string> {
  if (cache) return cache
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xc8d4e6, 0x403528, Math.PI))
  const sun = new THREE.DirectionalLight(0xfff2d9, Math.PI)
  sun.position.set(3, 5, 4)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500)
  const mesh = new THREE.Mesh(undefined, objectMaterial)
  scene.add(mesh)

  const out: Record<string, string> = {}
  for (const p of PREFABS) {
    const g = prefabGeometry(p.id)
    mesh.geometry = g
    const s = g.boundingSphere!
    const d = s.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05
    camera.position.set(s.center.x + d * 0.6, s.center.y + d * 0.45, s.center.z + d * 0.66)
    camera.lookAt(s.center)
    renderer.render(scene, camera)
    out[p.id] = canvas.toDataURL('image/png')
  }
  renderer.dispose()
  renderer.forceContextLoss()
  cache = out
  return out
}
