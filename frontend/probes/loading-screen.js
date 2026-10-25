// Map Properties' loading screen (#218): a map made for the client lists the client's loading screens with their pictures, the chosen one (the Deadmines', 142) shows in the 4:3 preview, and Picture… makes the map's own: in a throwaway client (#382), a blue PNG made in the page and picked through a stubbed file dialog is written into the patch, listed as a new loading screen, chosen and previewed in its colour; the real client is left alone.
// touches: frontend/src/components/MapPropertiesDialog.svelte, internal/vmangos/loadingscreen.go
const e = P.e
const { ui } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
e.doc.meta.vmangos = { dir: 'ProbeMap', mapId: 36, info: { type: 1, name: '', areaId: 0, loadingScreen: 142, maxPlayers: 0, ghostMap: -1, ghostX: 0, ghostY: 0 } }
ui.dialog = 'mapProps'
const select = await P.until(
	() => {
		const s = document.querySelector('#mi-screen')
		return s && s.options.length > 30 ? s : null
	},
	30000,
	"the client's loading screens in the list",
)
const preview = () => {
	const c = document.querySelector('.screen canvas')
	return c && !c.classList.contains('hidden') ? c : null
}
const canvas = await P.until(preview, 30000, "the Deadmines' picture in the preview")
const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
const px = pixels(canvas)
let lit = 0
for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++
const picture = () => [...document.querySelectorAll('.screen button')].find((b) => /^(Picture|Writing)/.test(b.textContent.trim()))
const button = picture()
const errorText = () => select.closest('[role=dialog]')?.querySelector('.error')?.textContent ?? ''
const out = { screens: select.options.length, chosen: select.value, lit: +(lit / (px.length / 4)).toFixed(2), size: `${canvas.width}x${canvas.height}`, button: !!button && !button.disabled }

// Picture… for real, into a throwaway copy of the client (#382).
const sb = await P.sandboxClient()
out.sandbox = sb.dataDir
const pic = document.createElement('canvas')
pic.width = pic.height = 256
const g = pic.getContext('2d')
g.fillStyle = 'rgb(30, 60, 220)'
g.fillRect(0, 0, 256, 256)
const png = await new Promise((r) => pic.toBlob(r, 'image/png'))
const file = await P.sandboxFile('Meld Probe Screen.png', png)
const App = window.go.main.App
const dialog = App.OpenImageDialog
App.OpenImageDialog = async () => file
try {
	picture().click()
	await P.until(() => errorText() || (picture()?.textContent.trim() === 'Picture…' && select.value !== '142'), 120000, 'Picture… to write the loading screen')
	out.error = errorText()
	out.written = { screens: select.options.length, chosen: select.value, name: select.selectedOptions[0]?.textContent }
	// The preview redraws from the written BLP once the list has it.
	const blue = () => {
		const c = preview()
		if (!c) return null
		const d = pixels(c)
		let r = 0
		let gr = 0
		let b = 0
		for (let i = 0; i < d.length; i += 4) {
			r += d[i]
			gr += d[i + 1]
			b += d[i + 2]
		}
		const n = d.length / 4
		const mean = [r / n, gr / n, b / n].map(Math.round)
		return mean[2] > 180 && mean[0] < 70 ? mean : null
	}
	out.written.preview = await P.until(blue, 30000, 'the new picture in the preview').catch((err) => String(err))
} finally {
	App.OpenImageDialog = dialog
	ui.dialog = null
	await P.frames(1)
}
out.ended = await P.endSandbox()
out.realScreens = ((await App.LoadingScreens()) ?? []).length

out.ok =
	out.chosen === '142' &&
	out.lit > 0.3 &&
	out.size === '160x120' &&
	out.button &&
	!out.error &&
	out.written.screens === out.screens + 1 &&
	out.written.chosen !== '142' &&
	/ProbeMap/.test(out.written.name ?? '') &&
	Array.isArray(out.written.preview) &&
	out.ended.wasOn &&
	out.ended.realUnchanged &&
	out.realScreens === out.screens - 1
return out
