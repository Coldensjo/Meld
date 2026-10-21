// Closing a map lets go of its models (#505): the objects-mixed benchmark map, then the buildings one opened and closed, leave the kept models, shared materials, model textures and the renderer's geometries and textures about where the first map had them (the liquid, particle and weather textures, shared by every map, stay).
const assets = await P.app('/src/lib/models/assets.ts')
const api = await P.app('/src/lib/wow/api.ts')
const count = () => {
	const m = P.e.renderer.info.memory
	const t = api.cachedTextureCounts()
	return { ...assets.keptCounts(), modelTextures: t.models, otherTextures: t.pinned, geometries: m.geometries, textures: m.textures }
}

const first = await P.benchMap('objects-mixed', 600)
const firstId = P.e.activeDocumentId()
const one = count()
await P.benchMap('wmo', 40)
const secondId = P.e.activeDocumentId()
if (secondId === firstId) throw new Error('the buildings map did not open in a tab of its own')
const both = count()
P.e.closeDocument(secondId)
await P.frames(3)
await P.settle()
await P.frames(3)
const after = count()

// The renderer's textures less the shared ones the second map brought (its WMOs' lava frames).
after.textures -= after.otherTextures - one.otherTextures
// Over the first map's numbers, allowing a few for the tufts and particles of a moving view, and 3 %
// of the textures for the shared ones uploaded only when first drawn, which no map owns (#623: the
// liquids' animation frames, a frame at a time as each comes round, the room gate's mask, and the
// first map's model textures that came into view; a closed map's own textures are all disposed).
const near = (k) => after[k] <= one[k] + Math.max(4, one[k] * (k === 'textures' ? 0.03 : 0.02))
const fell = (k) => both[k] - after[k] >= (both[k] - one[k]) * 0.9
const keys = ['models', 'materials', 'modelTextures', 'geometries', 'textures']
const ok = P.e.activeDocumentId() === firstId && both.models > one.models && keys.every((k) => near(k) && fell(k))
return { ok, objects: first.objects, one, both, after }
