// Tools › Import from Another Client… (#858): with the throwaway client as the current one and the real client opened as the other, the dialog lists the other client's models, "Only what this client lacks" hides them all (the two are the same), a search shows thumbnails drawn from /wowx, a chosen tile imports as "already" in this client (nothing written), and closing the dialog closes the other client. The copy itself (an asset's files and what it needs into the patch, the clash rules) is tested in Go: internal/wow/import_test.go and app_otherclient_test.go.
// touches: frontend/src/components/OtherClientDialog.svelte, frontend/src/lib/wow/otherClient.svelte.ts, app_otherclient.go, internal/wow/import.go, frontend/src/lib/wow/api.ts, frontend/src/lib/wow/thumbs.ts
const { ui, prefs } = await P.state()
const App = window.go.main.App
// The real client, read before the sandbox takes its place as the current one.
const realData = (await App.WowStatus()).path
if (!realData) return { ok: true, skipped: 'no WoW client is set' }
await P.sandboxClient()
const saved = prefs.otherClients

const WAIT = 120_000
const root = () => P.dialog('Import from another client')
const button = (text) => [...(root()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === text)
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const statusText = () => root()?.querySelector('.status')?.textContent.trim() ?? ''

try {
	ui.dialog = 'otherClient'
	await P.until(() => root(), WAIT, 'the dialog')
	type(root().querySelector('input[aria-label="Client folder"]'), realData)
	await P.frames(1)
	button('Add').click()
	await P.until(() => statusText().includes('read only') || root().querySelector('.status .err'), WAIT, 'the other client to open')
	const opened = (await App.OtherClientStatus()).loaded
	const listed = prefs.otherClients.some((c) => c.path === realData)

	// The two clients are the same, so nothing is lacking.
	await P.until(() => root().querySelector('.grid-wrap .hint')?.textContent.includes('has all of them'), WAIT, 'the lacking filter')
	const lackingNone = true

	const lackBox = [...root().querySelectorAll('label.check input')][0]
	lackBox.click()
	type(root().querySelector('input[aria-label="Search"]'), 'barrel')
	await P.until(() => root().querySelector('.grid-wrap .tile'), WAIT, 'the tiles')
	const tiles = root().querySelectorAll('.grid-wrap .tile').length
	const badge = root().querySelector('.grid-wrap .tile .badge')?.textContent.trim()
	await P.until(() => root().querySelector('.grid-wrap .tile img')?.complete, WAIT, 'a thumbnail')
	const thumb = !!root().querySelector('.grid-wrap .tile img')
	// The other client's model maps the other client's textures, fetched from /wowx (the thumbnail may come from the disk cache).
	const api = await P.app('/src/lib/wow/api.ts')
	const { clientId } = await P.app('/src/lib/wow/otherClient.svelte.ts')
	const tilePath = root()
		.querySelector('.grid-wrap .tile')
		.title.replace(/ \(this client has a file there\)$/, '')
	const mesh = await api.fetchMesh(api.otherPath(clientId(realData), tilePath))
	const tagged = mesh.groups.length > 0 && mesh.groups.every((g) => !g.texture || g.texture.startsWith('@'))
	const texture = mesh.groups.find((g) => g.texture)?.texture
	const texLoaded = texture ? !!(await api.loadTexture(texture, true)).image : true
	if (texture) api.releaseTexture(texture)

	root().querySelector('.grid-wrap .tile').click()
	await P.frames(1)
	const chosen = root().querySelector('.chosen')?.textContent.trim()
	button('Import').click()
	await P.until(() => root().querySelector('.result'), WAIT, 'the import')
	const result = root().querySelector('.result').textContent.trim()
	const already = result.includes('this client has already')

	button('Close').click()
	let otherOpen = true
	for (let i = 0; i < 300 && otherOpen; i++) {
		await P.frames(1)
		otherOpen = (await App.OtherClientStatus()).loaded
	}
	const closed = !root() && !otherOpen
	const sandbox = await P.endSandbox()

	const ok = opened && listed && lackingNone && tiles > 0 && badge === 'has' && thumb && tagged && texLoaded && chosen === '1 asset chosen' && already && closed && sandbox.realUnchanged
	return { ok, realData, opened, listed, tiles, badge, thumb, tagged, texture, texLoaded, chosen, result, closed, realUnchanged: sandbox.realUnchanged }
} finally {
	prefs.otherClients = saved
	ui.dialog = null
}
