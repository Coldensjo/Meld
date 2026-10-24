// A world's sprite sheet (3dgame #224): the pictures it holds for texture ids the game does not have
// yet (CubeWorld.images, a Tibia map's flat item sprites), in the cells CubeWorld.spriteSlot gives them,
// SPRITE_COLS a row, each framed by SPRITE_PAD pixels of itself wrapped round as the atlas's tiles are,
// v running down as the atlas's (flipY off). The mesher's PART_SPRITE and PART_OVERLAY faces sample it;
// CubeLayer makes one a world and makes it again when the world's pictures change. The pictures are
// drawn crisp up close, as the pixel art they are, and smoothed with mipmaps far off.
//
// The mip levels are made here, cell by cell, each from the level above it in the same cell, as the
// atlas's are (textures.ts putTile), down to SPRITE_LEVELS, where the frame is still a whole pixel: a
// level the GPU made of the whole sheet mixed a cell's edge with the cell beside it, or with the clear
// space after the last picture, so at a distance a black line ran down the seam between two cubes
// (3dgame #228).

import * as THREE from 'three'
import type { CubeWorld } from './world'
import { SPRITE_CELL, SPRITE_COLS, SPRITE_LEVELS, SPRITE_PAD, SPRITE_SIZE, spriteRows } from './mesher'

/** The sprite sheet of `world` as a texture; its pictures are drawn in as they decode. Null where there is no document (the unit tests). */
export function spriteSheet(world: CubeWorld): THREE.CanvasTexture | null {
	if (typeof document === 'undefined') return null
	const rows = spriteRows(world.images.size)
	// One canvas a mip level, the first the sheet itself. They start clear, so a border's see-through
	// pixels stay so (3dgame #226); a face drawn before its picture loads shows nothing until it does.
	const levels: HTMLCanvasElement[] = []
	for (let level = 0; level < SPRITE_LEVELS; level++) {
		const canvas = document.createElement('canvas')
		canvas.width = (SPRITE_COLS * SPRITE_CELL) >> level
		canvas.height = (rows * SPRITE_CELL) >> level
		levels.push(canvas)
	}
	const t = new THREE.CanvasTexture(levels[0])
	t.flipY = false
	t.colorSpace = THREE.SRGBColorSpace
	t.mipmaps = levels
	t.generateMipmaps = false
	t.magFilter = THREE.NearestFilter
	t.minFilter = THREE.LinearMipmapLinearFilter
	t.anisotropy = 4
	const g = levels[0].getContext('2d')!
	for (const [id, png] of world.images) {
		const slot = world.spriteSlot(id)
		if (slot < 0) continue
		const img = new Image()
		img.onload = () => {
			const col = slot % SPRITE_COLS
			const row = Math.floor(slot / SPRITE_COLS)
			const x0 = col * SPRITE_CELL
			const y0 = row * SPRITE_CELL
			g.save()
			g.beginPath()
			g.rect(x0, y0, SPRITE_CELL, SPRITE_CELL)
			g.clip()
			g.imageSmoothingEnabled = false
			g.clearRect(x0, y0, SPRITE_CELL, SPRITE_CELL)
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x0 + SPRITE_PAD + dx * SPRITE_SIZE, y0 + SPRITE_PAD + dy * SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE)
			}
			g.restore()
			// Each smaller level of the cell, the last halved: the mean of each four pixels.
			for (let level = 1; level < SPRITE_LEVELS; level++) {
				const s = SPRITE_CELL >> level
				const lg = levels[level].getContext('2d')!
				lg.imageSmoothingEnabled = true
				lg.imageSmoothingQuality = 'low'
				lg.clearRect(col * s, row * s, s, s)
				lg.drawImage(levels[level - 1], col * 2 * s, row * 2 * s, 2 * s, 2 * s, col * s, row * s, s, s)
			}
			t.needsUpdate = true
		}
		img.onerror = () => console.warn(`texture ${id}'s picture did not load`)
		img.src = `data:image/png;base64,${png}`
	}
	return t
}
