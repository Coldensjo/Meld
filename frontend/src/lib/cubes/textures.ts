// The cube textures (#83), as the client draws them (crates/client/src/textures.rs): the images of
// assets/textures (one per texture but 'default', drawn by assets/textures/make_textures.py) stacked
// top to bottom in id order into one atlas, each tile framed by ATLAS_PAD texels of its own image wrapped
// round and with its mip levels, which every cube material shares; a face picks its texture with its UVs
// (mesher.ts atlasUv). It is sampled smoothed (linear with mipmaps) by default or crisp (nearest), as
// prefs.smoothTextures says (setCubeFiltering, 3dgame #123), as the client's Filtering.
//
// The images are this repository's own, imported from ../../assets/textures by Vite rather than
// copied into the editor: the build bundles them (inlined, as they are small) and `make dev` serves
// them, which vite.config.ts allows (server.fs.allow). The game and the editor so read the same files.
//
// The liquids' textures are animated (#108): their image is several frames one under the other, and the
// atlas holds the one showing now, which animateCubeAtlas swaps as time passes, each texture at its own
// pace (FRAME_SECS, the client's frame_secs), so every face with it, painted or not, flows together.
//
// Some textures glow (#125): a lit window's panes, glowing moss, runes. Their `<name>_glow.png` beside
// the image holds what of it glows; cubeGlowAtlas stacks them in the atlas's layout, black for the rest,
// and the lit cubes' material shows it as emissive, as the client's glow atlas (without bloom here).
//
// The blend mask (#84, blendMask) fades a blended edge's overlay (mesher.ts PART_BLEND) into the face.
//
// A face painted with a texture this editor does not know (an id past TEXTURES, from a newer game's world)
// shows the missing texture, a magenta and black checker in the atlas's last tile (MISSING_TILE, 3dgame
// #215), and keeps its id, so saving writes it back. One the world has a hint for (a Tibia map's item id,
// #218) shows the plain tile after it (PLAIN_TILE), light grey with a little grain, in the hint's colour.

import * as THREE from 'three'
import { TEXTURES } from './world'
import { ATLAS_PAD, ATLAS_TILE, ATLAS_TILES, MISSING_TILE, PLAIN_TILE, TEXTURE_SIZE } from './mesher'
import grass from '../../../../../assets/textures/grass.png'
import dirt from '../../../../../assets/textures/dirt.png'
import path from '../../../../../assets/textures/path.png'
import stone from '../../../../../assets/textures/stone.png'
import wood from '../../../../../assets/textures/wood.png'
import planks from '../../../../../assets/textures/planks.png'
import metal from '../../../../../assets/textures/metal.png'
import water from '../../../../../assets/textures/water.png'
import sea from '../../../../../assets/textures/sea.png'
import lava from '../../../../../assets/textures/lava.png'
import lawn from '../../../../../assets/textures/lawn.png'
import soil from '../../../../../assets/textures/soil.png'
import cobble from '../../../../../assets/textures/cobble.png'
import rock from '../../../../../assets/textures/rock.png'
import wallStone from '../../../../../assets/textures/wall_stone.png'
import stoneBrick from '../../../../../assets/textures/stone_brick.png'
import timber from '../../../../../assets/textures/timber.png'
import roof from '../../../../../assets/textures/roof.png'
import windowLit from '../../../../../assets/textures/window_lit.png'
import shutters from '../../../../../assets/textures/shutters.png'
import plaster from '../../../../../assets/textures/plaster.png'
import thatch from '../../../../../assets/textures/thatch.png'
import darkPlanks from '../../../../../assets/textures/dark_planks.png'
import mossyStone from '../../../../../assets/textures/mossy_stone.png'
import glowMoss from '../../../../../assets/textures/glow_moss.png'
import runes from '../../../../../assets/textures/runes.png'
import sand from '../../../../../assets/textures/sand.png'
import snow from '../../../../../assets/textures/snow.png'
import windowLitGlow from '../../../../../assets/textures/window_lit_glow.png'
import glowMossGlow from '../../../../../assets/textures/glow_moss_glow.png'
import runesGlow from '../../../../../assets/textures/runes_glow.png'
import blendMaskUrl from '../../../../../assets/textures/blend_mask.png'

/** Each texture's image URL, by name: TEXTURES but 'default', in id order. */
export const TEXTURE_URLS: Record<Exclude<(typeof TEXTURES)[number], 'default'>, string> = { grass, dirt, path, stone, wood, planks, metal, water, sea, lava, lawn, soil, cobble, rock, wall_stone: wallStone, stone_brick: stoneBrick, timber, roof, window_lit: windowLit, shutters, plaster, thatch, dark_planks: darkPlanks, mossy_stone: mossyStone, glow_moss: glowMoss, runes, sand, snow }

/**
 * The glowing textures' glow images (`<name>_glow.png`, the client's GLOWS): what of each glows, in its
 * colour, black elsewhere. A texture not here does not glow.
 */
export const GLOW_URLS: Record<string, string> = { window_lit: windowLitGlow, glow_moss: glowMossGlow, runes: runesGlow }

/** How long each frame of an animated texture shows, in seconds, by name (the client's frame_secs). */
export const FRAME_SECS: Record<string, number> = { water: 0.15, sea: 0.22, lava: 0.4 }

/**
 * The atlas's mip levels (the client's MIP_LEVELS): down to ATLAS_TILE / 16, where the frame is half a
 * texel and the tiles still line up with whole texels. Each is a canvas of its own (Texture.mipmaps).
 */
const MIP_LEVELS = 5

/**
 * Whether the cube textures are sampled smoothed, linear with mipmaps and 4x anisotropic, or crisp,
 * nearest-texel from the full-size level (the client's Filtering, the owner's choice in 3dgame #123):
 * Graphics › Smooth Textures, prefs.smoothTextures, set through setCubeFiltering.
 */
let smooth = true

/** An atlas texture and the canvases of its mip levels, the first its image. */
interface Atlas {
	t: THREE.CanvasTexture
	levels: HTMLCanvasElement[]
}

let atlas: Atlas | null = null
let glowAtlas: Atlas | null = null

/** The animated textures, once their images load: the image, its tile, its frames and the frame shown. */
const animations: { img: HTMLImageElement; tile: number; frames: number; secs: number; shown: number }[] = []

/**
 * An atlas of ATLAS_TILES tiles filled with `fill`, its mip levels made, v running down as in Bevy
 * (mesher.ts atlasUv), sampled as `smooth` says.
 */
function makeAtlas(fill: string): Atlas {
	const levels: HTMLCanvasElement[] = []
	for (let level = 0; level < MIP_LEVELS; level++) {
		const side = ATLAS_TILE >> level
		const canvas = document.createElement('canvas')
		canvas.width = side
		canvas.height = side * ATLAS_TILES
		const g = canvas.getContext('2d')!
		g.fillStyle = fill
		g.fillRect(0, 0, canvas.width, canvas.height)
		levels.push(canvas)
	}
	const t = new THREE.CanvasTexture(levels[0])
	t.flipY = false
	t.colorSpace = THREE.SRGBColorSpace
	t.mipmaps = levels
	t.generateMipmaps = false
	filter(t)
	return { t, levels }
}

/** Sets `t`'s filters as `smooth` says. Its mip levels are always there, so only the filters change. */
function filter(t: THREE.Texture) {
	t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter
	t.minFilter = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
	t.anisotropy = smooth ? 4 : 1
	t.needsUpdate = true
}

/**
 * Draws the square of `img` at (0, `sy`), `side` wide, into tile `tile` of `a`, scaled up by whole texels
 * to TEXTURE_SIZE and framed by ATLAS_PAD texels of itself wrapped round (the client's frame_tile), then
 * makes the tile's smaller mip levels, each the last halved.
 */
function putTile(a: Atlas, img: CanvasImageSource, sy: number, side: number, tile: number) {
	const g = a.levels[0].getContext('2d')!
	const top = tile * ATLAS_TILE
	g.save()
	g.beginPath()
	g.rect(0, top, ATLAS_TILE, ATLAS_TILE)
	g.clip()
	g.imageSmoothingEnabled = false
	g.clearRect(0, top, ATLAS_TILE, ATLAS_TILE)
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			g.drawImage(img, 0, sy, side, side, ATLAS_PAD + dx * TEXTURE_SIZE, top + ATLAS_PAD + dy * TEXTURE_SIZE, TEXTURE_SIZE, TEXTURE_SIZE)
		}
	}
	g.restore()
	for (let level = 1; level < MIP_LEVELS; level++) {
		const s = ATLAS_TILE >> level
		const lg = a.levels[level].getContext('2d')!
		// Halving with bilinear filtering takes the mean of each four texels (in sRGB, where the client
		// averages in linear light).
		lg.imageSmoothingEnabled = true
		lg.imageSmoothingQuality = 'low'
		lg.clearRect(0, tile * s, s, s)
		lg.drawImage(a.levels[level - 1], 0, tile * 2 * s, 2 * s, 2 * s, 0, tile * s, s, s)
	}
	a.t.needsUpdate = true
}

/**
 * Shows each animated texture's frame due at `secs` in the atlas, on the one clock for every chunk;
 * called every frame (CubeLayer.update). Touches the atlas only when a frame changes.
 */
export function animateCubeAtlas(secs: number) {
	for (const a of animations) {
		const frame = Math.floor(Math.max(0, secs) / a.secs) % a.frames
		if (frame === a.shown) continue
		a.shown = frame
		const side = a.img.naturalWidth
		putTile(atlas!, a.img, frame * side, side, a.tile)
	}
}

/**
 * The atlas every cube material samples, made once; its images are drawn into it as they load, so the
 * cubes show plain until then. Null where there is no document (the unit tests).
 */
export function cubeAtlas(): THREE.Texture | null {
	if (atlas) return atlas.t
	if (typeof document === 'undefined') return null
	const a = makeAtlas('#fff')
	atlas = a
	putTile(a, missingTexture(), 0, TEXTURE_SIZE, MISSING_TILE)
	putTile(a, plainTexture(), 0, TEXTURE_SIZE, PLAIN_TILE)
	TEXTURES.slice(1).forEach((name, i) => {
		const img = new Image()
		img.onload = () => {
			putTile(a, img, 0, img.naturalWidth, i)
			const frames = Math.floor(img.naturalHeight / img.naturalWidth)
			if (frames > 1 && FRAME_SECS[name]) animations.push({ img, tile: i, frames, secs: FRAME_SECS[name], shown: 0 })
		}
		img.onerror = () => console.warn(`cube texture ${name} did not load`)
		img.src = TEXTURE_URLS[name as keyof typeof TEXTURE_URLS]
	})
	return a.t
}

/** The missing texture's image: a magenta and black checker of 8 by 8 squares, TEXTURE_SIZE square. */
function missingTexture(): HTMLCanvasElement {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = TEXTURE_SIZE
	const g = canvas.getContext('2d')!
	const square = TEXTURE_SIZE / 8
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			g.fillStyle = (x + y) % 2 ? '#000' : '#f0f'
			g.fillRect(x * square, y * square, square, square)
		}
	}
	return canvas
}

/** The plain tile's image: light grey with a little grain, the same every time, TEXTURE_SIZE square. */
function plainTexture(): HTMLCanvasElement {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = TEXTURE_SIZE
	const g = canvas.getContext('2d')!
	const img = g.createImageData(TEXTURE_SIZE, TEXTURE_SIZE)
	let seed = 218
	for (let i = 0; i < TEXTURE_SIZE * TEXTURE_SIZE; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff
		const v = 225 + (seed % 31)
		img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v
		img.data[4 * i + 3] = 255
	}
	g.putImageData(img, 0, 0)
	return canvas
}

/**
 * The glow atlas, the atlas's layout holding what of each texture glows (GLOW_URLS) and black elsewhere,
 * which the lit cubes' material takes as its emissive map, made once; as cubeAtlas, its images are drawn
 * as they load. Null where there is no document (the unit tests).
 */
export function cubeGlowAtlas(): THREE.Texture | null {
	if (glowAtlas) return glowAtlas.t
	if (typeof document === 'undefined') return null
	const a = makeAtlas('#000')
	glowAtlas = a
	TEXTURES.slice(1).forEach((name, i) => {
		const url = GLOW_URLS[name]
		if (!url) return
		const img = new Image()
		img.onload = () => putTile(a, img, 0, img.naturalWidth, i)
		img.onerror = () => console.warn(`cube texture ${name}'s glow did not load`)
		img.src = url
	})
	return a.t
}

/** Samples the cube textures (the atlas, the glow atlas and the blend mask) smoothed (`on`) or crisp. */
export function setCubeFiltering(on: boolean) {
	if (on === smooth) return
	smooth = on
	if (atlas) filter(atlas.t)
	if (glowAtlas) filter(glowAtlas.t)
	if (mask) maskFilter(mask)
}

let mask: THREE.Texture | null = null

/**
 * The blend mask (#84, `blend_mask.png`, drawn by make_textures.py): how much of a blended edge's
 * overlay shows the texture beside it, 1 at the edge (v 0, the image's top row) fading on a ragged line
 * a quarter to a third of the way in, BLEND_SPAN cubes along the edge across its width. The overlays
 * (CubeLayer's blend material) read it as their alpha map on uv channel 1, repeating along the edge and
 * clamped across, filtered as the atlas is (setCubeFiltering) and v running down as in Bevy; its grey is taken as it
 * is, not decoded from sRGB. Made once; null where there is no document (the unit tests).
 */
export function blendMask(): THREE.Texture | null {
	if (mask) return mask
	if (typeof document === 'undefined') return null
	const t = new THREE.TextureLoader().load(blendMaskUrl, undefined, undefined, () => console.warn('the blend mask did not load'))
	t.flipY = false
	t.channel = 1
	t.wrapS = THREE.RepeatWrapping
	t.wrapT = THREE.ClampToEdgeWrapping
	t.generateMipmaps = false
	maskFilter(t)
	mask = t
	return t
}

/** Sets the blend mask's filters as `smooth` says: linear or nearest, without mipmaps (the client's mask_sampler). */
function maskFilter(t: THREE.Texture) {
	t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter
	t.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter
	t.needsUpdate = true
}

/** A texture's image URL, for the UI's swatches (an animated one is its frames, of which a swatch shows the first); '' for 'default', which has none. */
export const textureUrl = (id: number) => (id > 0 && id < TEXTURES.length ? TEXTURE_URLS[TEXTURES[id] as keyof typeof TEXTURE_URLS] : '')
