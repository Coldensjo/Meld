// Run with: bun test tests/iconPicture.test.ts
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { ICON_SIZE, finishIcon, frameDistance, iconNameFromFile, iconNameOK, pictureRect } from '../src/lib/wow/iconPicture.ts'

const px = (pix: Uint8ClampedArray, x: number, y: number) => [...pix.subarray((y * ICON_SIZE + x) * 4, (y * ICON_SIZE + x) * 4 + 4)]
const lum = (p: number[]) => Math.round((p[0] + p[1] + p[2]) / 3)

/** A transparent picture with an opaque red square in its middle. */
function picture(): Uint8ClampedArray {
	const pix = new Uint8ClampedArray(ICON_SIZE * ICON_SIZE * 4)
	for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) pix.set([255, 0, 0, 255], (y * ICON_SIZE + x) * 4)
	return pix
}

test('a file gives its name without the extension, spaces as underscores', () => {
	assert.equal(iconNameFromFile('C:\\art\\My Icon 2.png'), 'My_Icon_2')
	assert.equal(iconNameFromFile('/home/me/INV_Misc_Thing.PNG'), 'INV_Misc_Thing')
	assert.ok(iconNameOK('Spell-Fire_2'))
	assert.ok(!iconNameOK('bad.name'))
	assert.ok(!iconNameOK(''))
	assert.ok(!iconNameOK('a'.repeat(101)))
})

test('fit scales the whole picture into the icon, inside the frame with a border; off keeps its size', () => {
	assert.deepEqual(pictureRect(128, 64, { fit: true, border: false, background: false }), { x: 0, y: 16, w: 64, h: 32 })
	assert.deepEqual(pictureRect(200, 200, { fit: true, border: true, background: false }), { x: 4, y: 4, w: 56, h: 56 })
	assert.deepEqual(pictureRect(100, 40, { fit: false, border: true, background: false }), { x: -18, y: 12, w: 100, h: 40 })
})

test('the frame matches the client icons: dark, two grey, dark, with cut corners', () => {
	const pix = picture()
	finishIcon(pix, { fit: true, border: true, background: true })
	// Down the middle of the top: dark, light grey twice, dark, then the black backing.
	assert.deepEqual(
		[0, 1, 2, 3, 4].map((y) => lum(px(pix, 32, y))),
		[5, 197, 197, 5, 0],
	)
	// Across the left: dark, mid grey (the outer darker), dark; the bottom darker still.
	assert.deepEqual(
		[0, 1, 2, 3].map((x) => lum(px(pix, x, 32))),
		[5, 70, 103, 5],
	)
	assert.deepEqual(
		[63, 62, 61, 60].map((y) => lum(px(pix, 32, y))),
		[5, 40, 64, 5],
	)
	// The corners are cut: transparent outside, framed on the cut.
	assert.equal(px(pix, 0, 0)[3], 0)
	assert.equal(px(pix, 3, 0)[3], 0)
	assert.equal(px(pix, 63, 63)[3], 0)
	assert.equal(px(pix, 4, 0)[3], 255)
	assert.ok(frameDistance(0, 0).d < 0)
	assert.equal(frameDistance(2, 4).side, 4)
	assert.equal(frameDistance(2, 60).side, 5)
	// The picture is kept, the transparent rest backed with black.
	assert.deepEqual(px(pix, 32, 32), [255, 0, 0, 255])
	assert.deepEqual(px(pix, 10, 10), [0, 0, 0, 255])
})

test('the black backing goes only under transparent pixels, and without a border over the whole icon', () => {
	const pix = picture()
	pix.set([200, 100, 50, 128], 0)
	finishIcon(pix, { fit: true, border: false, background: true })
	assert.deepEqual(px(pix, 0, 0), [100, 50, 25, 255])
	assert.deepEqual(px(pix, 63, 63), [0, 0, 0, 255])
	assert.deepEqual(px(pix, 30, 30), [255, 0, 0, 255])
	const clear = picture()
	finishIcon(clear, { fit: true, border: false, background: false })
	assert.equal(px(clear, 0, 0)[3], 0)
})
