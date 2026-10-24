// Draws a cube world's mood regions (3dgame #143, moodRegions.ts) while the Cubes tool's Mood mode is
// on: each region as the outline of its box in a colour of its mood (moods.ts regionColour) over a faint
// fill, with the mood's name over its middle; the selected region's outline yellow. A region whose
// mood the game's moods file has not got is grey, its name with a '?'. Regions are few, so they are
// drawn again whole when something changes (CubeLayer.update asks).

import * as THREE from 'three'
import type { CubeWorld } from './world'
import { CUBE_HEIGHT, CUBE_SIZE } from './shapes'
import { layerBottom } from './mesher'
import { MOODS, regionColour } from '../engine/moods'

const COLOUR_SELECTED = 0xffe066

/** A box from (0, 0, 0) to (1, 1, 1), scaled and placed for each region. */
const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5))
const unitFill = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)

/** Materials by mood name, made once. */
const edgeMaterials = new Map<string, THREE.LineBasicMaterial>()
const fillMaterials = new Map<string, THREE.MeshBasicMaterial>()
const labelMaterials = new Map<string, THREE.SpriteMaterial | null>()
const selectedEdges = new THREE.LineBasicMaterial({ color: COLOUR_SELECTED, depthTest: false, transparent: true, opacity: 0.95, fog: false })

function colourOf(mood: string): THREE.Color {
	const [r, g, b] = regionColour(MOODS, mood)
	return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
}

function edgeMaterial(mood: string): THREE.LineBasicMaterial {
	let m = edgeMaterials.get(mood)
	if (!m) {
		m = new THREE.LineBasicMaterial({ color: colourOf(mood), depthTest: false, transparent: true, opacity: 0.8, fog: false })
		edgeMaterials.set(mood, m)
	}
	return m
}

function fillMaterial(mood: string): THREE.MeshBasicMaterial {
	let m = fillMaterials.get(mood)
	if (!m) {
		m = new THREE.MeshBasicMaterial({ color: colourOf(mood), transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, fog: false })
		fillMaterials.set(mood, m)
	}
	return m
}

/** The mood's name tag, null without a document (the unit tests). */
function labelMaterial(mood: string): THREE.SpriteMaterial | null {
	if (typeof document === 'undefined') return null
	if (labelMaterials.has(mood)) return labelMaterials.get(mood)!
	const known = MOODS.raw.has(mood)
	const c = document.createElement('canvas')
	c.width = 256
	c.height = 64
	const g = c.getContext('2d')!
	g.font = 'bold 36px sans-serif'
	g.textAlign = 'center'
	g.textBaseline = 'middle'
	g.lineWidth = 6
	g.strokeStyle = 'rgba(0, 0, 0, 0.85)'
	g.fillStyle = known ? `#${colourOf(mood).getHexString(THREE.SRGBColorSpace)}` : '#c0c0c0'
	const text = known ? mood : `${mood || '(no mood)'}?`
	g.strokeText(text, 128, 32, 248)
	g.fillText(text, 128, 32, 248)
	const t = new THREE.CanvasTexture(c)
	t.colorSpace = THREE.SRGBColorSpace
	const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false })
	labelMaterials.set(mood, m)
	return m
}

export class MoodMarks {
	readonly group = new THREE.Group()

	constructor() {
		this.group.name = 'mood regions'
		this.group.visible = false
	}

	/** Draws the regions again, those reaching a layer `shown` leaves, with region `selected` marked. */
	draw(world: CubeWorld, shown: (layer: number) => boolean, selected: number | null) {
		this.clear()
		world.moods.forEach((r, i) => {
			let any = false
			for (let l = r.min.layer; l <= r.max.layer && !any; l++) any = shown(l)
			if (!any) return
			const x = r.min.x * CUBE_SIZE
			const z = r.min.z * CUBE_SIZE
			const y = layerBottom(r.max.layer)
			const w = (r.max.x - r.min.x + 1) * CUBE_SIZE
			const d = (r.max.z - r.min.z + 1) * CUBE_SIZE
			const h = (r.max.layer - r.min.layer + 1) * CUBE_HEIGHT
			const edges = new THREE.LineSegments(unitEdges, i === selected ? selectedEdges : edgeMaterial(r.mood))
			edges.position.set(x, y, z)
			edges.scale.set(w, h, d)
			edges.renderOrder = 9
			edges.name = `mood region ${i}`
			const fill = new THREE.Mesh(unitFill, fillMaterial(r.mood))
			fill.position.set(x, y, z)
			fill.scale.set(w, h, d)
			fill.name = `mood region fill ${i}`
			this.group.add(edges, fill)
			const label = labelMaterial(r.mood)
			if (label) {
				const s = new THREE.Sprite(label)
				s.position.set(x + w / 2, y + h + 0.6, z + d / 2)
				s.scale.set(4, 1, 1)
				s.renderOrder = 11
				s.name = `mood region label ${i}`
				this.group.add(s)
			}
		})
	}

	clear() {
		for (const c of [...this.group.children]) c.removeFromParent()
	}

	dispose() {
		this.clear()
		this.group.removeFromParent()
	}
}
