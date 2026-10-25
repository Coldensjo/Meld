// Thumbnails and previews let go of their models' own materials (#506): a model with a moving texture or colour built and released as a thumbnail is, and the Preview window opened and closed on it, leave the per-frame animated lists as they were.
// touches: frontend/src/lib/models/assets.ts, frontend/src/lib/wow/thumbs.ts, frontend/src/components/ModelPreviewWindow.svelte, frontend/src/components/AssetPreview.svelte
await P.scene(P.BENCH)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const assets = await P.app('/src/lib/models/assets.ts')
const api = await P.app('/src/lib/wow/api.ts')

// A model of the scene with a moving texture or colour.
const types = [...new Set([...P.e.objects.objects.values()].map((o) => o.type))].filter((t) => t.startsWith('m2:'))
let type = null
let moving = 0
for (const t of types.slice(0, 300)) {
	const m = await api.fetchMesh(t.slice(3))
	moving = m.groups.filter((g) => (g.uv && g.texture) || g.color).length
	if (moving) {
		type = t
		break
	}
}
if (!type) throw new Error('no model with a moving texture or colour in the benchmark scene')

// The scene streams its models in, and the shared materials of one it has not loaded yet join the
// animated lists as it arrives (#690: after a busy probe it arrived while the Preview window was open,
// and the count never came back to where the thumbnails left it). Load this one and let the page go
// quiet first, so only what the thumbnails and the Preview window do moves the count.
await assets.loadAsset(type.slice(3))
await P.settle()

// As thumbs.ts draws one, many times over.
const before = assets.animatedCount()
for (let i = 0; i < 50; i++) {
	const a = assets.buildWowAsset(await api.fetchMesh(type.slice(3)))
	await assets.texturesReady(a.material)
	if (i === 0 && assets.animatedCount() <= before) throw new Error('a built asset registered nothing to animate')
	assets.releaseWowAsset(a)
}
const afterThumbs = assets.animatedCount()

// The Preview window (CreaturePreview) animates the model while it is open, and lets go when closed.
const { ui } = await P.state()
ui.modelPreview = { title: 'probe', type, scale: 1 }
await P.until(() => assets.animatedCount() > afterThumbs, 60_000, 'the Preview window to register its model')
const whileOpen = assets.animatedCount()
ui.modelPreview = null
await P.until(() => assets.animatedCount() === afterThumbs, 10_000, 'the closed Preview window to release its model')
await wait(200)
const afterPreview = assets.animatedCount()

return { ok: afterThumbs === before && afterPreview === before && whileOpen > before, type, moving, before, afterThumbs, whileOpen, afterPreview }
