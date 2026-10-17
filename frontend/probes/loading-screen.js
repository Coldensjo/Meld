// Map Properties' loading screen (#218): a map made for the client lists the client's loading screens with their pictures, the chosen one (the Deadmines', 142) shows in the 4:3 preview, and the Picture… button that makes the map's own is there. Picture… itself is not pressed: it writes the client's patch.
const e = P.e
const { ui } = await P.state()
e.newDocument(256, 'flat', 0, 'Probe')
e.doc.meta.vmangos = { dir: 'ProbeMap', mapId: 36, info: { type: 1, name: '', areaId: 0, loadingScreen: 142, maxPlayers: 0, ghostMap: -1, ghostX: 0, ghostY: 0 } }
ui.dialog = 'mapProps'
const select = await P.until(() => {
	const s = document.querySelector('#mi-screen')
	return s && s.options.length > 30 ? s : null
}, 30000, "the client's loading screens in the list")
const canvas = await P.until(() => {
	const c = document.querySelector('.screen canvas')
	return c && !c.classList.contains('hidden') ? c : null
}, 30000, "the Deadmines' picture in the preview")
const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
let lit = 0
for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++
const button = [...document.querySelectorAll('.screen button')].find((b) => b.textContent.startsWith('Picture'))
const out = { screens: select.options.length, chosen: select.value, lit: +(lit / (px.length / 4)).toFixed(2), size: `${canvas.width}x${canvas.height}`, button: !!button && !button.disabled }
ui.dialog = null
out.ok = out.chosen === '142' && out.lit > 0.3 && out.size === '160x120' && out.button
return out
