import * as THREE from 'three'
import { ModelBuilder, box, cone, cyl, dodeca, ico, prism, sphere, torus } from './builder'

export type PrefabCategory = 'building' | 'nature' | 'doodad'

export interface Prefab {
  id: string
  name: string
  category: PrefabCategory
  /** Rough radius used for placement spacing / selection. */
  radius: number
  build: () => THREE.BufferGeometry
}

// A warm, saturated palette in the spirit of classic Azeroth.
const C = {
  stone: '#8d8780',
  stoneDark: '#5f5a55',
  plaster: '#e6d6b0',
  timber: '#5a3a22',
  timberDark: '#3d2716',
  roofRed: '#a8382a',
  roofBlue: '#2f5aa8',
  window: '#ffd36b',
  hide: '#9a6b40',
  hideDark: '#6e4728',
  clothRed: '#8e1f1a',
  bone: '#e8dcc0',
  bark: '#5b3d24',
  leaf: '#4f8a2a',
  leafLight: '#73a83a',
  pine: '#2d5a2a',
  rock: '#86817b',
  moss: '#5d7a35',
  mushStalk: '#e5dcc8',
  mushCap: '#7a3fa8',
  mushSpot: '#e9d6ff',
  metal: '#3b3b40',
  gold: '#d9a23a',
  fire: '#ff8a1e',
  fireCore: '#ffe27a',
  water: '#2d6e8a',
}

function humanHouse(): THREE.BufferGeometry {
  const b = new ModelBuilder(11)
  b.add(box(6.4, 1, 5.4), C.stone, { pos: [0, 0.5, 0], jitter: 0.08 })
  b.add(box(6, 2.8, 5), C.plaster, { pos: [0, 2.4, 0] })
  b.add(box(6.6, 2.4, 5.6), C.plaster, { pos: [0, 5, 0] }) // overhanging upper floor
  for (const [x, z] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]])
    b.add(box(0.35, 3, 0.35), C.timber, { pos: [x, 2.5, z] })
  for (const z of [-2.82, 2.82]) {
    b.add(box(6.8, 0.35, 0.3), C.timber, { pos: [0, 3.9, z] })
    b.add(box(0.3, 2.4, 0.3), C.timber, { pos: [-3.3, 5, z] })
    b.add(box(0.3, 2.4, 0.3), C.timber, { pos: [3.3, 5, z] })
    b.add(box(0.25, 2.6, 0.25), C.timber, { pos: [-1.6, 5, z], rot: [0, 0, 0.6] })
    b.add(box(0.25, 2.6, 0.25), C.timber, { pos: [1.6, 5, z], rot: [0, 0, -0.6] })
  }
  b.add(prism(7.6, 3.8, 6.4), C.roofBlue, { pos: [0, 6.2, 0], jitter: 0.06 })
  b.add(box(1, 3.5, 1), C.stoneDark, { pos: [2, 8, 1.4], jitter: 0.06 })
  b.add(box(1.3, 2.2, 0.2), C.timberDark, { pos: [0, 2, 2.55] })
  for (const x of [-2, 2]) b.add(box(0.9, 0.9, 0.15), C.window, { pos: [x, 2.6, 2.55], colorVar: 0 })
  for (const x of [-1.8, 1.8]) b.add(box(0.9, 0.9, 0.15), C.window, { pos: [x, 5.2, 2.85], colorVar: 0 })
  return b.build()
}

function orcHut(): THREE.BufferGeometry {
  const b = new ModelBuilder(22)
  b.add(cyl(3, 3.3, 2.8, 9), C.hide, { pos: [0, 1.4, 0], jitter: 0.12 })
  b.add(cone(4.2, 3.8, 9), C.clothRed, { pos: [0, 4.6, 0], jitter: 0.15 })
  b.add(cyl(0.15, 0.15, 3, 5), C.timber, { pos: [0, 6.8, 0] })
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    const x = Math.cos(a) * 3.6
    const z = Math.sin(a) * 3.6
    b.add(cone(0.22, 2.2, 5), C.bone, { pos: [x, 3.2, z], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] })
  }
  b.add(box(1.4, 2, 0.3), C.hideDark, { pos: [0, 1, 3.15] })
  b.add(box(0.2, 4, 0.2), C.timber, { pos: [2.2, 2, 3.2] })
  b.add(box(1.1, 1.6, 0.05), C.clothRed, { pos: [2.75, 3.1, 3.2], colorVar: 0 })
  return b.build()
}

function watchTower(): THREE.BufferGeometry {
  const b = new ModelBuilder(33)
  b.add(cyl(2.2, 2.7, 10, 8), C.stone, { pos: [0, 5, 0], jitter: 0.1 })
  b.add(cyl(2.9, 2.9, 1.2, 8), C.stoneDark, { pos: [0, 10.4, 0], jitter: 0.06 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    b.add(box(0.8, 0.8, 0.8), C.stone, { pos: [Math.cos(a) * 2.6, 11.3, Math.sin(a) * 2.6], rot: [0, -a, 0] })
  }
  b.add(cone(3.4, 4.5, 8), C.roofBlue, { pos: [0, 13.5, 0], jitter: 0.08 })
  b.add(cyl(0.08, 0.08, 2.5, 4), C.timber, { pos: [0, 16.8, 0] })
  b.add(box(1.4, 0.8, 0.05), C.gold, { pos: [0.7, 17.5, 0], colorVar: 0 })
  b.add(box(1.4, 2.2, 0.3), C.timberDark, { pos: [0, 1.1, 2.55] })
  for (const y of [4, 7.5]) b.add(box(0.5, 1, 0.3), C.window, { pos: [0, y, 2.45], colorVar: 0 })
  return b.build()
}

function stoneWall(): THREE.BufferGeometry {
  const b = new ModelBuilder(44)
  b.add(box(6, 2.8, 1.2), C.stone, { pos: [0, 1.4, 0], jitter: 0.1 })
  for (let i = 0; i < 4; i++) b.add(box(0.9, 0.8, 1.3), C.stone, { pos: [-2.4 + i * 1.6, 3.2, 0], jitter: 0.06 })
  b.add(box(6.1, 0.3, 1.3), C.stoneDark, { pos: [0, 0.15, 0] })
  return b.build()
}

function oak(): THREE.BufferGeometry {
  const b = new ModelBuilder(55)
  b.add(cyl(0.35, 0.6, 4.5, 6), C.bark, { pos: [0, 2.25, 0], jitter: 0.08 })
  b.add(cyl(0.15, 0.25, 2, 5), C.bark, { pos: [0.7, 3.6, 0], rot: [0, 0, -0.8] })
  b.add(ico(2.4, 0), C.leaf, { pos: [0, 5.6, 0], jitter: 0.35 })
  b.add(ico(1.8, 0), C.leafLight, { pos: [1.4, 5, 0.6], jitter: 0.3 })
  b.add(ico(1.7, 0), C.leaf, { pos: [-1.3, 5.1, -0.4], jitter: 0.3 })
  b.add(ico(1.5, 0), C.leafLight, { pos: [0.2, 6.8, -0.5], jitter: 0.25 })
  return b.build()
}

function pine(): THREE.BufferGeometry {
  const b = new ModelBuilder(66)
  b.add(cyl(0.25, 0.4, 2.5, 6), C.bark, { pos: [0, 1.25, 0] })
  b.add(cone(2.2, 3, 7), C.pine, { pos: [0, 3.2, 0], jitter: 0.15 })
  b.add(cone(1.7, 2.6, 7), C.pine, { pos: [0, 4.9, 0], jitter: 0.12, rot: [0, 0.3, 0] })
  b.add(cone(1.1, 2.2, 7), C.pine, { pos: [0, 6.4, 0], jitter: 0.1, rot: [0, 0.6, 0] })
  return b.build()
}

function bush(): THREE.BufferGeometry {
  const b = new ModelBuilder(77)
  b.add(ico(1, 0), C.leaf, { pos: [0, 0.7, 0], jitter: 0.2, scale: [1.2, 0.8, 1.2] })
  b.add(ico(0.7, 0), C.leafLight, { pos: [0.8, 0.5, 0.3], jitter: 0.15 })
  b.add(ico(0.6, 0), C.leaf, { pos: [-0.6, 0.45, -0.4], jitter: 0.15 })
  return b.build()
}

function rock(): THREE.BufferGeometry {
  const b = new ModelBuilder(88)
  b.add(dodeca(1.4), C.rock, { pos: [0, 0.6, 0], jitter: 0.3, scale: [1.3, 0.8, 1] })
  b.add(dodeca(0.7), C.rock, { pos: [1.3, 0.3, 0.5], jitter: 0.15 })
  b.add(dodeca(0.9), C.moss, { pos: [-0.2, 1.3, 0], jitter: 0.2, scale: [1, 0.25, 0.8] })
  return b.build()
}

function giantMushroom(): THREE.BufferGeometry {
  const b = new ModelBuilder(99)
  b.add(cyl(0.35, 0.55, 3.5, 7), C.mushStalk, { pos: [0, 1.75, 0], jitter: 0.06, rot: [0.08, 0, 0.05] })
  b.add(sphere(2, 9, 5), C.mushCap, { pos: [0.1, 3.6, 0.15], scale: [1, 0.45, 1], jitter: 0.08 })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    b.add(ico(0.22, 0), C.mushSpot, { pos: [Math.cos(a) * 1.2, 4.2, Math.sin(a) * 1.2], colorVar: 0 })
  }
  return b.build()
}

function grassTuft(): THREE.BufferGeometry {
  const b = new ModelBuilder(111)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    const r = b.random(0.1, 0.45)
    b.add(cone(0.12, b.random(0.6, 1.1), 3), i % 2 ? C.leaf : C.leafLight, {
      pos: [Math.cos(a) * r, 0.4, Math.sin(a) * r],
      rot: [b.random(-0.3, 0.3), 0, b.random(-0.3, 0.3)],
    })
  }
  return b.build()
}

function barrel(): THREE.BufferGeometry {
  const b = new ModelBuilder(122)
  b.add(cyl(0.45, 0.45, 1.1, 8), C.timber, { pos: [0, 0.55, 0] })
  b.add(cyl(0.5, 0.5, 0.5, 8), C.timber, { pos: [0, 0.55, 0] })
  for (const y of [0.2, 0.9]) b.add(torus(0.47, 0.04), C.metal, { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0] })
  return b.build()
}

function crate(): THREE.BufferGeometry {
  const b = new ModelBuilder(133)
  b.add(box(1, 1, 1), C.timber, { pos: [0, 0.5, 0] })
  for (const [x, z, ry] of [[0, 0.51, 0], [0, -0.51, 0], [0.51, 0, Math.PI / 2], [-0.51, 0, Math.PI / 2]] as const) {
    b.add(box(0.12, 1.3, 0.04), C.timberDark, { pos: [x, 0.5, z], rot: [0, ry, Math.PI / 4] })
  }
  return b.build()
}

function fence(): THREE.BufferGeometry {
  const b = new ModelBuilder(144)
  for (const x of [-1.5, 0, 1.5]) b.add(box(0.2, 1.3, 0.2), C.timber, { pos: [x, 0.65, 0], jitter: 0.03 })
  for (const y of [0.45, 0.95]) b.add(box(3.2, 0.12, 0.08), C.timber, { pos: [0, y, 0.12], rot: [0, 0, b.random(-0.04, 0.04)] })
  return b.build()
}

function lampPost(): THREE.BufferGeometry {
  const b = new ModelBuilder(155)
  b.add(cyl(0.12, 0.18, 3.5, 6), C.metal, { pos: [0, 1.75, 0] })
  b.add(box(0.8, 0.1, 0.1), C.metal, { pos: [0.3, 3.4, 0] })
  b.add(box(0.4, 0.5, 0.4), C.window, { pos: [0.6, 3.05, 0], colorVar: 0 })
  b.add(cone(0.35, 0.3, 4), C.metal, { pos: [0.6, 3.45, 0], rot: [0, Math.PI / 4, 0] })
  return b.build()
}

function campfire(): THREE.BufferGeometry {
  const b = new ModelBuilder(166)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    b.add(dodeca(0.25), C.rock, { pos: [Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8], jitter: 0.05 })
  }
  b.add(cyl(0.1, 0.1, 1.2, 5), C.bark, { pos: [0, 0.25, 0], rot: [0, 0.4, Math.PI / 2.3] })
  b.add(cyl(0.1, 0.1, 1.2, 5), C.bark, { pos: [0, 0.25, 0], rot: [0, -0.9, Math.PI / 2.3] })
  b.add(cone(0.45, 1.1, 5), C.fire, { pos: [0, 0.75, 0], colorVar: 0 })
  b.add(cone(0.25, 0.8, 5), C.fireCore, { pos: [0, 0.65, 0], colorVar: 0, rot: [0, 0.5, 0] })
  return b.build()
}

function well(): THREE.BufferGeometry {
  const b = new ModelBuilder(177)
  b.add(cyl(1.2, 1.3, 1, 9), C.stone, { pos: [0, 0.5, 0], jitter: 0.06 })
  b.add(cyl(0.95, 0.95, 0.1, 9), C.water, { pos: [0, 0.9, 0], colorVar: 0 })
  for (const x of [-1.1, 1.1]) b.add(box(0.2, 2.4, 0.2), C.timber, { pos: [x, 1.7, 0] })
  b.add(cyl(0.1, 0.1, 2.4, 5), C.timberDark, { pos: [0, 2.3, 0], rot: [0, 0, Math.PI / 2] })
  b.add(prism(3, 1.1, 1.8), C.roofRed, { pos: [0, 2.9, 0], jitter: 0.04 })
  return b.build()
}

function signpost(): THREE.BufferGeometry {
  const b = new ModelBuilder(188)
  b.add(box(0.18, 2.6, 0.18), C.timber, { pos: [0, 1.3, 0] })
  b.add(box(1.4, 0.35, 0.08), C.plaster, { pos: [0.5, 2.2, 0], rot: [0, 0.2, 0] })
  b.add(box(1.4, 0.35, 0.08), C.plaster, { pos: [-0.4, 1.7, 0], rot: [0, -0.5, 0] })
  return b.build()
}

export const PREFABS: Prefab[] = [
  { id: 'human_house', name: 'Human House', category: 'building', radius: 4.5, build: humanHouse },
  { id: 'orc_hut', name: 'Orc Hut', category: 'building', radius: 4.2, build: orcHut },
  { id: 'watch_tower', name: 'Watch Tower', category: 'building', radius: 3.2, build: watchTower },
  { id: 'stone_wall', name: 'Stone Wall', category: 'building', radius: 3.2, build: stoneWall },
  { id: 'oak', name: 'Oak Tree', category: 'nature', radius: 2.5, build: oak },
  { id: 'pine', name: 'Pine Tree', category: 'nature', radius: 2, build: pine },
  { id: 'bush', name: 'Bush', category: 'nature', radius: 1.2, build: bush },
  { id: 'rock', name: 'Rock', category: 'nature', radius: 1.8, build: rock },
  { id: 'mushroom', name: 'Giant Mushroom', category: 'nature', radius: 2, build: giantMushroom },
  { id: 'grass', name: 'Grass Tuft', category: 'nature', radius: 0.5, build: grassTuft },
  { id: 'barrel', name: 'Barrel', category: 'doodad', radius: 0.6, build: barrel },
  { id: 'crate', name: 'Crate', category: 'doodad', radius: 0.7, build: crate },
  { id: 'fence', name: 'Fence', category: 'doodad', radius: 1.6, build: fence },
  { id: 'lamppost', name: 'Lamp Post', category: 'doodad', radius: 0.6, build: lampPost },
  { id: 'campfire', name: 'Campfire', category: 'doodad', radius: 1, build: campfire },
  { id: 'well', name: 'Well', category: 'doodad', radius: 1.5, build: well },
  { id: 'signpost', name: 'Signpost', category: 'doodad', radius: 0.8, build: signpost },
]

export const PREFAB_BY_ID = new Map(PREFABS.map((p) => [p.id, p]))
