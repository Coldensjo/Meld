// A picture made into a client icon in the page (#717), before Go writes it as a BLP: fitted to the
// icon's 64 x 64, backed with black under its transparent pixels and framed with the grey bevelled
// edge the client's own icons have. The fitting needs a canvas (`fitPicture`); the backing and the
// frame work on the pixels alone, so the unit tests reach them.

/** The side of the client's icons (wow.IconSize in Go). */
export const ICON_SIZE = 64

/** How far the frame reaches in from the edge: the picture is fitted inside it when both are on. */
export const FRAME_WIDTH = 4

export interface IconOptions {
	/** Scale the whole picture to fit the icon, keeping its shape; off, its middle is cut out at its own size. */
	fit: boolean
	/** Draw the client's grey bevelled frame over the edge. */
	border: boolean
	/** Paint black under the transparent pixels. */
	background: boolean
}

export const DEFAULT_ICON_OPTIONS: IconOptions = { fit: true, border: false, background: true }

/** The icon name a picture file gives: its file name without the extension, spaces as `_` (Go's CheckIconName checks it). */
export function iconNameFromFile(path: string): string {
	const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
	const dot = base.lastIndexOf('.')
	return (dot > 0 ? base.slice(0, dot) : base).trim().replace(/\s+/g, '_')
}

/** Whether a name can be an icon's (as Go's CheckIconName: letters, digits, _ and -, at most 100). */
export function iconNameOK(name: string): boolean {
	return /^[A-Za-z0-9_-]{1,100}$/.test(name)
}

/**
 * Where the picture goes in the icon: x, y, w, h in the icon's pixels. Fitted, the whole picture
 * scaled to the area (the icon, or inside the frame with `border`) keeping its shape, centred;
 * otherwise at its own size, centred, so a larger one loses its edges.
 */
export function pictureRect(w: number, h: number, o: IconOptions): { x: number; y: number; w: number; h: number } {
	const inset = o.border && o.fit ? FRAME_WIDTH : 0
	const area = ICON_SIZE - 2 * inset
	const dw = !o.fit ? w : w >= h ? area : (w * area) / h
	const dh = !o.fit ? h : h >= w ? area : (h * area) / w
	return { x: (ICON_SIZE - dw) / 2, y: (ICON_SIZE - dh) / 2, w: dw, h: dh }
}

// The frame, measured from the client's icons (Ability_Warrior_Charge, INV_Sword_04,
// Spell_Fire_FlameBolt): a dark line, two grey pixels (light along the top, mid grey down the sides,
// dark grey along the bottom; the outer of the two darker on the sides and bottom), a dark line, then
// the picture; the corners cut at 45 degrees, transparent outside the cut. `CUT` and `DIAG` place the
// cut so the corners come out as the client's do.
const CUT = 4.6
const DIAG = 1.5
const DARK: readonly [number, number, number] = [2, 4, 8]
/** The two grey pixels of each side, outer then inner: top, right, bottom, left, then the top and bottom corners. */
const GREYS: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> = [
	[
		[197, 198, 197],
		[197, 198, 197],
	],
	[
		[68, 70, 73],
		[100, 103, 106],
	],
	[
		[36, 39, 44],
		[60, 63, 68],
	],
	[
		[68, 70, 73],
		[100, 103, 106],
	],
	[
		[116, 118, 120],
		[176, 177, 177],
	],
	[
		[36, 39, 44],
		[62, 64, 66],
	],
]

/**
 * How far the pixel at x, y is inside the framed icon's outline, in pixels (negative outside a cut
 * corner), and which part of the frame is nearest: 0 top, 1 right, 2 bottom, 3 left, 4 a top
 * corner's cut, 5 a bottom corner's.
 */
export function frameDistance(x: number, y: number): { d: number; side: number } {
	const px = x + 0.5
	const py = y + 0.5
	const n = ICON_SIZE
	let d = py
	let side = 0
	const take = (v: number, s: number) => {
		if (v < d) {
			d = v
			side = s
		}
	}
	take(n - px, 1)
	take(n - py, 2)
	take(px, 3)
	take((px + py - CUT) / DIAG, 4)
	take((n - px + py - CUT) / DIAG, 4)
	take((px + n - py - CUT) / DIAG, 5)
	take((n - px + n - py - CUT) / DIAG, 5)
	return { d, side }
}

/** Paints black under the transparent pixels of an RGBA picture (each over black, so it ends opaque); with `border`, only inside the frame's outline. */
export function backWithBlack(pix: Uint8ClampedArray, border: boolean) {
	for (let y = 0; y < ICON_SIZE; y++) {
		for (let x = 0; x < ICON_SIZE; x++) {
			if (border && frameDistance(x, y).d < 0) continue
			const i = (y * ICON_SIZE + x) * 4
			const a = pix[i + 3]
			if (a === 255) continue
			pix[i] = (pix[i] * a) / 255
			pix[i + 1] = (pix[i + 1] * a) / 255
			pix[i + 2] = (pix[i + 2] * a) / 255
			pix[i + 3] = 255
		}
	}
}

/** Draws the client's icon frame over the edge of an RGBA picture, clearing the corners outside its cut. */
export function drawFrame(pix: Uint8ClampedArray) {
	for (let y = 0; y < ICON_SIZE; y++) {
		for (let x = 0; x < ICON_SIZE; x++) {
			const { d, side } = frameDistance(x, y)
			if (d >= FRAME_WIDTH) continue
			const i = (y * ICON_SIZE + x) * 4
			let c: readonly [number, number, number]
			if (d < 0) {
				pix[i] = pix[i + 1] = pix[i + 2] = pix[i + 3] = 0
				continue
			} else if (d < 1 || d >= 3) c = DARK
			else c = GREYS[side][d < 2 ? 0 : 1]
			pix[i] = c[0]
			pix[i + 1] = c[1]
			pix[i + 2] = c[2]
			pix[i + 3] = 255
		}
	}
}

/** Backs and frames a fitted picture's pixels as the options say (the canvas has drawn the picture). */
export function finishIcon(pix: Uint8ClampedArray, o: IconOptions) {
	if (o.background) backWithBlack(pix, o.border)
	if (o.border) drawFrame(pix)
}

/** The icon's pixels from a picture: fitted (or cut) by a canvas, then backed and framed. RGBA, not premultiplied, row 0 at the top. */
export function makeIcon(img: CanvasImageSource, w: number, h: number, o: IconOptions): Uint8ClampedArray<ArrayBuffer> {
	const c = document.createElement('canvas')
	c.width = c.height = ICON_SIZE
	const ctx = c.getContext('2d', { willReadFrequently: true })
	if (!ctx) throw new Error('no 2D canvas')
	ctx.imageSmoothingEnabled = true
	ctx.imageSmoothingQuality = 'high'
	const r = pictureRect(w, h, o)
	ctx.drawImage(img, r.x, r.y, r.w, r.h)
	const data = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data
	finishIcon(data, o)
	return data
}
