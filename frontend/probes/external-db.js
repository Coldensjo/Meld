// File › Connect to External Database (#856): the File menu's Connect entry picks a mangosd.conf (BrowseExternalConf stood in with the local server folder's own run/mangosd.conf, so the "external" database is the local one and no other server is reached), the warning names the conf and its world database, Cancel leaves Meld on the local databases, Connect puts the External database cell in the status bar, turns the server controls off (their header says why, Start Server is disabled) and gives the File menu a Disconnect entry, a database binding (SearchCreatures) still answers, and Disconnect brings the local server back. Go's side (the conf replacing the folder's databases, never starting or stopping one, the bindings refused while connected, a database that doesn't answer refused) is internal/vmangos/external_test.go and app_external_test.go.
// touches: frontend/src/lib/io/external.ts, frontend/src/components/AppDialogs.svelte, frontend/src/components/StatusBar.svelte, frontend/src/components/MenuBar.svelte, app_external.go, internal/vmangos/external.go, app_server.go
const { ui } = await P.state()
const App = window.go.main.App
const server = await App.VmangosPath()
if (!server) return { ok: true, skipped: 'no VMaNGOS server folder is set' }
const sep = server.includes('\\') ? '\\' : '/'
const conf = [server.replace(/[\\/]+$/, ''), 'run', 'mangosd.conf'].join(sep)
const info = await App.ReadExternalDatabase(conf).catch((err) => String(err))
if (typeof info === 'string') return { ok: true, skipped: `the server folder's mangosd.conf can't be read: ${info}` }
if (await App.ExternalDatabaseInfo().then((i) => i.conf)) return { ok: false, error: 'an external database was already connected before the probe' }

const WAIT = 30_000
const title = () => [...document.querySelectorAll('.menubar .menu > .title')].find((b) => b.textContent.trim() === 'File')
const openFile = async () => {
	if (!document.querySelector('.menubar .dropdown')) title().click()
	await P.frames(1)
}
const closeMenu = async () => {
	if (document.querySelector('.menubar .dropdown')) title().click()
	await P.frames(1)
}
const item = (label) => [...document.querySelectorAll('.menubar .dropdown .item')].find((b) => b.querySelector('.label')?.textContent.trim().startsWith(label))
const header = () => [...document.querySelectorAll('.menubar .dropdown .header')].map((h) => h.textContent.trim()).find((t) => t.startsWith('VMaNGOS server'))
const cell = () => document.querySelector('[data-external-db]')
const dialogName = 'Connect to an external database?'

const realBrowse = App.BrowseExternalConf
App.BrowseExternalConf = async () => conf
const out = {}
try {
	// Cancel: nothing connects.
	await openFile()
	item('Connect to External Database')?.click()
	await P.until(() => P.dialog(dialogName), WAIT, 'the warning')
	const warning = P.dialog(dialogName).textContent
	out.warningNames = warning.includes(conf) && warning.includes(info.world.name) && warning.includes(`${info.world.host}:${info.world.port}`) && warning.includes('live server')
	;[...P.dialog(dialogName).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel').click()
	await P.frames(2)
	out.cancelLocal = !P.dialog(dialogName) && !(await App.ExternalDatabaseInfo()).conf && !cell() && ui.externalDbPending === null

	// Connect.
	await openFile()
	item('Connect to External Database')?.click()
	await P.until(() => P.dialog(dialogName), WAIT, 'the warning again')
	;[...P.dialog(dialogName).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Connect').click()
	await P.until(() => cell() || ui.status.startsWith('Not connected'), WAIT, 'the connection')
	if (!cell()) return { ok: true, skipped: `the server's world database doesn't answer: ${ui.status}` }
	out.cell = cell().textContent.trim()
	out.goConnected = (await App.ExternalDatabaseInfo()).conf === conf
	await openFile()
	await P.until(() => header()?.includes('external'), WAIT, 'the server header')
	out.header = header()
	out.startOff = item('Start Server')?.disabled === true
	out.disconnectShown = !!item('Disconnect External Database')
	await closeMenu()
	out.startRefused = await App.StartServer().then(
		() => 'started',
		(err) => String(err),
	)
	out.search = await App.SearchCreatures('a').then(
		(r) => (r ?? []).length,
		(err) => String(err),
	)

	// Disconnect.
	await openFile()
	item('Disconnect External Database')?.click()
	await P.until(() => !cell(), WAIT, 'the disconnect')
	out.goLocal = !(await App.ExternalDatabaseInfo()).conf
	await openFile()
	out.connectBack = !!item('Connect to External Database')
	await closeMenu()
} finally {
	App.BrowseExternalConf = realBrowse
	await closeMenu()
	if ((await App.ExternalDatabaseInfo()).conf) await App.DisconnectExternalDatabase()
	ui.externalDb = null
}

const ok =
	out.warningNames &&
	out.cancelLocal &&
	out.cell.includes(info.world.name) &&
	out.goConnected &&
	out.startOff &&
	out.disconnectShown &&
	out.startRefused.includes('external database') &&
	typeof out.search === 'number' &&
	out.goLocal &&
	out.connectBack
return { ok, conf, ...out }
