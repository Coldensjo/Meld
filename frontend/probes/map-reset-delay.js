// Map Properties' Reset after (days) (#963): a raid made for the client shows the field at 0, a typed 7 lands in the map's info as one undo step, Publish's map_template
// row in the Changes window writes it as reset_delay, and a world map hides the field. Nothing is
// written: PublishPending only builds.
// touches: frontend/src/components/MapPropertiesDialog.svelte, frontend/src/lib/engine/mapInfo.ts, internal/vmangos/publish.go, internal/vmangos/mapfiles.go
const { ui } = await P.state()
const out = {}
// A map saved before the field reads it as 0 (defaultMapInfo, tests/mapData.test.ts), as here.
const doc = P.e.newVmangosDocument(1, 'flat', 0, { dir: 'ProbeReset', mapId: 1997, info: { type: 2, name: '', areaId: 0, loadingScreen: 0, maxPlayers: 40, resetDelay: 0, ghostMap: -1, ghostX: 0, ghostY: 0 } })
await P.frames(3)
const box = () => [...document.querySelectorAll('[data-ui="Modal"] header h2')].find((h) => h.textContent.trim().startsWith('Changes'))?.closest('.dialog') ?? null
try {
	ui.dialog = 'mapProps'
	const field = await P.until(() => document.querySelector('#mi-reset'), 30000, 'the Reset after field')
	out.shown = field.value
	out.hint = /Required level/.test(field.nextElementSibling?.nextElementSibling?.textContent ?? '')
	field.value = '7'
	field.dispatchEvent(new Event('change', { bubbles: true }))
	await P.frames(2)
	out.saved = P.e.debug.doc.meta.vmangos.info.resetDelay
	out.step = P.e.history.peek()?.label ?? null
	ui.dialog = null
	await P.frames(1)

	ui.dialog = 'changes'
	await P.until(() => box()?.textContent.includes('map_template') || null, 60000, 'the Changes window lists the publish')
	const sqlButton = [...box().querySelectorAll('button')].find((b) => b.textContent.trim() === 'SQL')
	sqlButton?.click()
	await P.frames(2)
	const sql = box()?.querySelector('pre')?.textContent ?? ''
	out.sql = sql.includes('VALUES (1997, 0, 0, 2, 0, 40, 7, -1,') && sql.includes('reset_delay = VALUES(reset_delay)')
	ui.dialog = null
	await P.frames(1)

	P.e.setMapInfo({ ...P.e.debug.doc.meta.vmangos.info, type: 0 })
	ui.dialog = 'mapProps'
	await P.until(() => document.querySelector('#mi-players'), 30000, 'Map Properties again')
	out.hiddenOnWorld = !document.querySelector('#mi-reset')
} finally {
	ui.dialog = null
	P.e.closeDocument(doc.id)
}
out.ok = out.shown === '0' && out.hint && out.saved === 7 && out.step === 'Map info' && out.sql && out.hiddenOnWorld
return out
