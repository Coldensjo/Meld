// A write into Meld's patch keeps what the asset server decoded (#471): in a throwaway client, Stormwind's WMO built once is served from the cache after a patch write (a fraction of its first build), the archives are open again with the new file listed, and an icon written a second time in another colour is read again, not served from the cache.
// touches: internal/wow/client.go, internal/wow/bytecache.go, internal/wow/m2cache.go, internal/mpq/*, app_sandbox.go
const App = window.go.main.App
const fetchTimed = async (url) => {
	const t = performance.now()
	const r = await fetch(url)
	const b = await r.arrayBuffer()
	return { ms: Math.round(performance.now() - t), ok: r.ok, bytes: b.byteLength, data: b }
}
const status = async () => await (await fetch('/wow/status')).json()
// The mean colour of a /wow/texture reply ("RGBA", u32 w, u32 h, pixels).
const meanColour = (buf) => {
	const v = new DataView(buf)
	const w = v.getUint32(4, true)
	const h = v.getUint32(8, true)
	const px = new Uint8Array(buf, 12, w * h * 4)
	const sum = [0, 0, 0]
	for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
	return sum.map((s) => Math.round(s / (w * h)))
}
const importIcon = async (name, colour) => {
	const c = document.createElement('canvas')
	c.width = c.height = 64
	const g = c.getContext('2d')
	g.fillStyle = colour
	g.fillRect(0, 0, 64, 64)
	const png = await new Promise((r) => c.toBlob(r, 'image/png'))
	return await App.ImportIcons([await P.sandboxFile(name + '.png', png)])
}
const wmo = '/wow/model?path=' + encodeURIComponent('World\\wmo\\Azeroth\\Buildings\\Stormwind\\Stormwind.wmo')

const sb = await P.sandboxClient()
const out = { sandbox: sb.dataDir }
try {
	const cold = await fetchTimed(wmo)
	out.cold = { ms: cold.ms, ok: cold.ok, bytes: cold.bytes }
	const files = (await status()).files

	// An icon, then a patch write of a file of its own (the icon may wait for the game to close).
	const first = await importIcon('Meld Probe Cache', 'rgb(220, 40, 40)')
	const name = first.names?.[0]
	out.icon = { name, waiting: first.waiting, refused: first.refused }
	const iconURL = '/wow/texture?path=' + encodeURIComponent(`Interface\\Icons\\${name}.blp`)
	const red = await fetchTimed(iconURL)
	out.icon.first = red.ok ? meanColour(red.data) : null
	await App.InstallMapPatch({ 'Interface\\MeldProbe\\patch-cache.txt': btoa('patch-cache') })
	const after = await status()
	out.status = { loaded: after.loaded, filesBefore: files, filesAfter: after.files }

	const warm = await fetchTimed(wmo)
	out.warm = { ms: warm.ms, ok: warm.ok, bytes: warm.bytes }

	// The same icon again in blue: read again, not the cached red.
	await importIcon('Meld Probe Cache', 'rgb(30, 60, 220)')
	const blue = await fetchTimed(iconURL)
	out.icon.second = blue.ok ? meanColour(blue.data) : null
} finally {
	out.ended = await P.endSandbox()
}

out.ok =
	out.cold.ok &&
	out.warm.ok &&
	out.warm.bytes === out.cold.bytes &&
	// The cold build parses the groups and hundreds of doodads; a cached reply only copies bytes.
	out.warm.ms < out.cold.ms / 3 &&
	out.status.loaded &&
	out.status.filesAfter > out.status.filesBefore &&
	Array.isArray(out.icon.first) &&
	out.icon.first[0] > 150 &&
	out.icon.first[2] < 100 &&
	Array.isArray(out.icon.second) &&
	out.icon.second[2] > 150 &&
	out.icon.second[0] < 100 &&
	out.ended.wasOn &&
	out.ended.realUnchanged
return out
