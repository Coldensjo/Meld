// Open in Blender (#290): a right-click on a placed client model offers Open in Blender, and its run hands the model's
// own object type to the OpenInBlender binding (here a stand-in, so no Blender starts) and says in the status bar
// where the .blend went; a helper shape offers no such entry. The real Blender binding answers with the program it
// would start or why there is none. The export and the import script are checked by the Go tests
// (internal/wow/gltf_test.go, internal/blender/blender_test.go).
// touches: frontend/src/lib/io/blender.ts, app_blender.go, internal/blender/blender.go
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

const open = App.OpenInBlender
const calls = []
App.OpenInBlender = async (type) => {
	calls.push(type)
	return { folder: 'C:\\probe\\WestFallBarrel01-abc123', fresh: true }
}
let labels = []
let helperLabels = []
let status = ''
let info = null
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
} finally {
	App.OpenInBlender = open
}

const ok =
	labels.includes('Open in Blender') && calls.length === 1 && calls[0] === TYPE && status.includes('WestFallBarrel01-abc123') && !helperLabels.includes('Open in Blender') && info !== null && (info.program !== '' || info.error !== '')
return { ok, labels, calls, status, helperLabels, info }
