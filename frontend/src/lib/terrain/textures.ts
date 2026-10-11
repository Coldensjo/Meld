import * as THREE from 'three'
import { LAYERS } from './layers'

// Flat-colour stand-ins used for paint layers until (or unless) a WoW tileset
// texture is assigned. The app itself ships no texture assets.

let cache: THREE.DataTexture[] | null = null

export function getFallbackTextures(): THREE.DataTexture[] {
  if (cache) return cache
  cache = LAYERS.map((l) => {
    const c = new THREE.Color(l.swatch)
    const data = new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255])
    const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    t.colorSpace = THREE.SRGBColorSpace
    t.needsUpdate = true
    return t
  })
  return cache
}
