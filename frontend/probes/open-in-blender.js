// Open in Blender and Import from Blender (#290): a right-click on a placed client model offers both. Open in Blender
// hands the model's own object type to the OpenInBlender binding (here a stand-in, so no Blender starts) and says in
// the status bar where the .blend went; a helper shape offers neither. Import from Blender, against the throwaway
// client (P.sandboxClient), writes a model into the client and swaps the placement for it as one undo step: the
// stand-in ImportFromBlender passes a GLB the probe makes (a coloured tetrahedron, no normals, a moved node) to the
// real ImportModelFile, so the real conversion to an M2 and BLP runs without Blender, then the new model loads, the
// asset browser lists it, and undo and redo swap the model back and forth. The real Blender binding answers with the
// program it would start or why there is none. Blender's own runs (open.py, export.py) are checked by the Go tests
// (internal/blender/blender_test.go), the GLB reader and the M2 writer by internal/wow/m2write_test.go.
// touches: frontend/src/lib/io/blender.ts, app_blender.go, internal/blender/blender.go, internal/wow/glbread.go, internal/wow/m2write.go, internal/wow/m2build.go
const e = P.e
const { editor, ui } = await P.state()
const App = window.go.main.App
e.newDocument(256, 'flat', 0, 'Probe')
editor.tool = 'select'
await P.frames(1)
const L = e.objects
const TYPE = 'm2:World\\Azeroth\\Westfall\\PassiveDoodads\\Barrel\\WestFallBarrel01.m2'
const barrel = L.add({ type: TYPE, x: 128, z: 128, yOff: 0, rotY: 0, scale: 1 })
const helper = L.add({ type: 'helper:cube:4', x: 150, z: 128, yOff: 0, rotY: 0, scale: 1 })

/** A GLB of a tetrahedron 2 yards across, light blue, without normals, its node raised one yard. */
function tetraGLB() {
	const pos = new Float32Array([-1, 0, -1, 1, 0, -1, 0, 0, 1, 0, 2, 0])
	const idx = new Uint16Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0])
	const bin = new Uint8Array(pos.byteLength + idx.byteLength)
	bin.set(new Uint8Array(pos.buffer), 0)
	bin.set(new Uint8Array(idx.buffer), pos.byteLength)
	const doc = {
		asset: { version: '2.0' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, translation: [0, 1, 0] }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
		materials: [{ name: 'Blue', pbrMetallicRoughness: { baseColorFactor: [0.3, 0.6, 1, 1] } }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, 0, -1], max: [1, 2, 1] },
			{ bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' },
		],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
			{ buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
		],
		buffers: [{ byteLength: bin.byteLength }],
	}
	let js = new TextEncoder().encode(JSON.stringify(doc))
	const pad = (b, fill) => {
		const out = new Uint8Array(Math.ceil(b.length / 4) * 4).fill(fill)
		out.set(b)
		return out
	}
	js = pad(js, 0x20)
	const b = pad(bin, 0)
	const out = new Uint8Array(12 + 8 + js.length + 8 + b.length)
	const dv = new DataView(out.buffer)
	out.set([0x67, 0x6c, 0x54, 0x46], 0) // glTF
	dv.setUint32(4, 2, true)
	dv.setUint32(8, out.length, true)
	dv.setUint32(12, js.length, true)
	dv.setUint32(16, 0x4e4f534a, true)
	out.set(js, 20)
	dv.setUint32(20 + js.length, b.length, true)
	dv.setUint32(24 + js.length, 0x004e4942, true)
	out.set(b, 28 + js.length)
	return out
}

const open = App.OpenInBlender
const importBack = App.ImportFromBlender
const calls = []
const importCalls = []
App.OpenInBlender = async (type) => {
	calls.push(type)
	return { folder: 'C:\\probe\\WestFallBarrel01-abc123', fresh: true }
}
let labels = []
let helperLabels = []
let status = ''
let info = null
const back = { skipped: '' }
try {
	const menu = await P.contextMenuOn(barrel.id)
	labels = menu.items.map((it) => it.label ?? '-')
	const item = menu.items.find((it) => it.label === 'Open in Blender')
	if (item) {
		item.run()
		await P.until(() => ui.status.includes('opened in Blender') || null, 10_000, 'the status line')
		status = ui.status
	}
	ui.contextMenu = null
	const hm = await P.contextMenuOn(helper.id)
	helperLabels = hm.items.map((it) => it.label ?? '-')
	ui.contextMenu = null
	info = await App.Blender()

	// Import from Blender, written into the throwaway client.
	if (!(await App.WowStatus()).loaded) back.skipped = 'no WoW client is loaded'
	else {
		await P.sandboxClient()
		const file = await P.sandboxFile('MeldProbeTetra.glb', tetraGLB())
		App.ImportFromBlender = async (type) => {
			importCalls.push(type)
			return App.ImportModelFile(file)
		}
		const steps = e.history.steps().length
		const m = await P.contextMenuOn(barrel.id)
		m.items.find((it) => it.label === 'Import from Blender')?.run()
		ui.contextMenu = null
		await P.until(() => L.objects.get(barrel.id).type !== TYPE || ui.status.startsWith('Could not') || null, 60_000, 'the model swapped')
		back.status = ui.status
		back.type = L.objects.get(barrel.id).type
		back.swapped = /^m2:World\\Meld\\MeldProbeTetra-[0-9a-f]{6}\\MeldProbeTetra\.m2$/.test(back.type)
		back.oneStep = e.history.steps().length === steps + 1 && e.history.peek()?.label === 'Import from Blender'
		const assets = await P.app('/src/lib/models/assets.ts')
		const api = await P.app('/src/lib/wow/api.ts')
		if (back.swapped) {
			const a = await assets.loadAsset(back.type)
			back.ready = !!a?.ready
			const path = back.type.slice(3)
			back.listed = (await api.listAssets('m2')).includes(path)
			e.history.undo()
			back.undone = L.objects.get(barrel.id).type === TYPE
			e.history.redo()
			back.redone = L.objects.get(barrel.id).type === back.type
		}
		back.sandbox = await P.endSandbox()
	}
} finally {
	App.OpenInBlender = open
	App.ImportFromBlender = importBack
}

const backOk = back.skipped !== '' || (back.swapped && back.oneStep && back.ready && back.listed && back.undone && back.redone && importCalls[0] === TYPE && back.sandbox?.realUnchanged)
const ok =
	labels.includes('Open in Blender') &&
	labels.includes('Import from Blender') &&
	calls.length === 1 &&
	calls[0] === TYPE &&
	status.includes('WestFallBarrel01-abc123') &&
	!helperLabels.includes('Open in Blender') &&
	!helperLabels.includes('Import from Blender') &&
	info !== null &&
	(info.program !== '' || info.error !== '') &&
	backOk
return { ok, labels, calls, status, helperLabels, info, importCalls, back }
