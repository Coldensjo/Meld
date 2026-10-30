// An import that wrote over the current client's copy of a file (#922): against a stand-in ImportOtherAssets that answers one model and its texture replaced, the page loads the kept model again (a new asset, the old one let go of after the swap), forgets the replaced texture (the next load is a new texture) and makes the model's thumbnail again. Nothing is written; the real copy and its clash rules are tested in Go (internal/wow/import_test.go).
// touches: frontend/src/lib/wow/otherClient.svelte.ts, frontend/src/lib/wow/replaced.ts, frontend/src/lib/models/assets.ts, frontend/src/lib/wow/thumbs.ts, frontend/src/lib/wow/thumbQueue.ts, frontend/src/lib/wow/api.ts
const App = window.go.main.App
if (!(await App.WowStatus()).loaded) return { ok: true, skipped: 'no WoW client is loaded' }
const assets = await P.app('/src/lib/models/assets.ts')
const api = await P.app('/src/lib/wow/api.ts')
const thumbs = await P.app('/src/lib/wow/thumbs.ts')
const { importOther } = await P.app('/src/lib/wow/otherClient.svelte.ts')

const WAIT = 120_000
const path = (await api.listAssets('m2')).find((p) => /barrel/i.test(p))
if (!path) return { ok: false, error: 'no barrel model in the client' }
const type = 'm2:' + path
const before = await assets.loadAsset(type)
const mats = Array.isArray(before.material) ? before.material : [before.material]
const texture = mats.map((m) => m.userData.texture).find(Boolean)
const oldTex = texture ? await api.loadTexture(texture, true) : null

// The thumbnail, made (or read from the disk cache) once.
const made = () => new Promise((res) => thumbs.requestThumb(type, res, () => res('')))
const thumbBefore = await made()
const forgotten = []
const onForgotten = (e) => forgotten.push(...e.detail)
window.addEventListener(thumbs.THUMBS_FORGOTTEN, onForgotten)

const realImport = App.ImportOtherAssets
try {
	App.ImportOtherAssets = async (paths) => ({ imported: paths, present: [], refused: [], differs: [], kept: [], missing: [], replaced: [path, ...(texture ? [texture] : [])], files: 2, bytes: 1, waiting: false })
	await importOther([path], { replaceAssets: true, replaceNeeded: true })
	await P.until(() => assets.isKept(type) && assets.getAsset(type) !== before, WAIT, 'the model loaded again')
	const after = assets.getAsset(type)
	const newTex = texture ? await api.loadTexture(texture, true) : null
	const textureNew = !texture || newTex !== oldTex
	await P.until(() => forgotten.includes(type.toLowerCase()), WAIT, 'the thumbnail forgotten')
	const thumbAfter = await made()
	const thumbNew = !!thumbAfter && thumbAfter !== thumbBefore
	// The old asset is let go of once the layers had time to swap theirs in.
	await new Promise((r) => setTimeout(r, 2500))
	const oldReleased = (Array.isArray(before.material) ? before.material : [before.material]).every((m) => m.userData.released || after.material.includes?.(m) || m === after.material)
	const ok = after.ready && textureNew && thumbNew && oldReleased
	return { ok, path, texture, ready: after.ready, textureNew, thumbNew, oldReleased, forgotten }
} finally {
	App.ImportOtherAssets = realImport
	window.removeEventListener(thumbs.THUMBS_FORGOTTEN, onForgotten)
}
