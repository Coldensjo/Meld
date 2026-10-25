// Closing a map lets go of its models (#505): the objects-mixed benchmark map, then the buildings one opened and closed, leave the kept models, shared materials, model textures and the renderer's geometries and own textures where the first map had them (the client textures the cache keeps, uploaded when first drawn, are left out of the renderer's count, #658).
// touches: frontend/src/lib/models/assets.ts, frontend/src/lib/engine/MapDocument.ts, frontend/src/lib/world/ObjectLayer.ts
const THREE = await P.app('/node_modules/.vite/deps/three.js')
const assets = await P.app('/src/lib/models/assets.ts')
const api = await P.app('/src/lib/wow/api.ts')

// The textures on the GPU: three adds a texture's 'dispose' listener when it first uploads it and
// removes it when the texture is disposed. `renderer.info.memory.textures` counts them all, and over
// the run it also grows by client textures the cache keeps that are first drawn later: the liquids'
// animation frames (up to 30 a liquid, one as each frame comes round, so more the longer the run,
// #658), and the first map's model textures that come into view, also through a model the second map
// shares with it. Those are the cache's (`isCachedTexture`), counted by modelTextures and otherTextures
// rather than here; what is left is the textures a map, a layer or the engine made itself, and the
// cache's textures the cache has let go of (#623), which a closed map must not leave on the GPU.
const live = new Set()
const ED = THREE.EventDispatcher.prototype
const add = ED.addEventListener
const remove = ED.removeEventListener
ED.addEventListener = function (type, fn) {
	if (type === 'dispose' && this.isTexture) live.add(this)
	return add.call(this, type, fn)
}
ED.removeEventListener = function (type, fn) {
	if (type === 'dispose' && this.isTexture) live.delete(this)
	return remove.call(this, type, fn)
}

const count = () => {
	const m = P.e.renderer.info.memory
	const t = api.cachedTextureCounts()
	let own = 0
	for (const x of live) if (!api.isCachedTexture(x)) own++
	return { ...assets.keptCounts(), modelTextures: t.models, otherTextures: t.pinned, geometries: m.geometries, ownTextures: own, textures: m.textures }
}

let one, both, after, first, firstId
try {
	first = await P.loadBenchMap('objects-mixed', 600)
	firstId = P.e.activeDocumentId()
	one = count()
	await P.loadBenchMap('wmo', 40)
	const secondId = P.e.activeDocumentId()
	if (secondId === firstId) throw new Error('the buildings map did not open in a tab of its own')
	both = count()
	P.e.closeDocument(secondId)
	await P.frames(3)
	await P.settle()
	await P.frames(3)
	after = count()
} finally {
	ED.addEventListener = add
	ED.removeEventListener = remove
}

// Over the first map's numbers, allowing a few for the tufts and particles of a moving view and the
// shared textures no map owns (the room gate's mask, first uploaded by the buildings), and 2 %.
// The liquid, particle and weather textures the second map asked for stay cached (otherTextures, shared
// by every map), so they are not checked.
const near = (k) => after[k] <= one[k] + Math.max(4, one[k] * 0.02)
// And at least 90 % of what the second map added gone (all of it, less the same few, where it added only a few: the own textures of a sweep's busy page grew by 2 of the 5 the buildings added, #690).
const fell = (k) => after[k] - one[k] <= Math.max(4, (both[k] - one[k]) * 0.1)
const keys = ['models', 'materials', 'modelTextures', 'geometries', 'ownTextures']
const ok = P.e.activeDocumentId() === firstId && both.models > one.models && keys.every((k) => near(k) && fell(k))
return { ok, objects: first.objects, one, both, after }
