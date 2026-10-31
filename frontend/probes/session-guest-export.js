// A guest in a shared session cannot compile, publish or launch the session's map (#1005): the File and Game menu items for it are off with the reason as their tooltip, and the actions refuse with a status line; a tab of the guest's own keeps them. The session state is set by hand (no transport needed).
// touches: frontend/src/lib/session/**, frontend/src/lib/ui/menus.ts, frontend/src/components/MenuBar.svelte, frontend/src/lib/io/compile.ts, frontend/src/lib/io/publish.ts, frontend/src/lib/io/game.ts
// timeout: 120
const e = P.e
const { ui } = await P.state()
const S = await P.app('/src/lib/session/shared.svelte.ts')
const compile = await P.app('/src/lib/io/compile.ts')
const game = await P.app('/src/lib/io/game.ts')
const publish = await P.app('/src/lib/io/publish.ts')
const { shared } = S
e.newDocument(64, 'flat', 0, 'Session Map')
await P.frames(2)
const sessionDoc = e.activeDocumentId()
e.newDocument(64, 'flat', 0, 'Mine')
await P.frames(2)
const mineDoc = e.activeDocumentId()
const WANT = ['Compile to Client', 'Compile to Server', 'Compile All', 'Launch World of Warcraft', 'Launch Benilla', 'Play Here']
const items = async (menu) => {
	;[...document.querySelectorAll('.menubar .menu > .title')].find((t) => t.textContent.trim() === menu).click()
	await P.frames(2)
	const out = [...document.querySelectorAll('.menubar .dropdown [role="menuitem"]')].map((b) => ({ label: b.querySelector('.label').textContent.trim(), disabled: b.disabled, title: b.title }))
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
	await P.frames(2)
	return out
}
const state = async () => {
	const all = [...(await items('File')), ...(await items('Game'))].filter((i) => WANT.includes(i.label))
	return { all, off: all.filter((i) => i.disabled && i.title.includes('host exports')).length, on: all.filter((i) => !i.title).length }
}
let guestSession, guestOther, host, refused
try {
	shared.role = 'guest'
	shared.docId = sessionDoc
	e.switchDocument(sessionDoc)
	await P.frames(3)
	guestSession = { active: e.activeDocumentId() === sessionDoc, ...(await state()) }
	// The actions refuse in the session's map.
	ui.status = ''
	await compile.compileRegion(e, 'client')
	const said = ui.status
	ui.status = ''
	await game.playHere(e)
	await publish.publishVmangosMap(e)
	refused = { compile: said, busy: !ui.busy, said: /host exports/.test(said) && /host exports/.test(ui.status) }
	e.switchDocument(mineDoc)
	await P.frames(3)
	guestOther = { active: e.activeDocumentId() === mineDoc, ...(await state()) }
	shared.role = 'host'
	await P.frames(2)
	host = await state()
} finally {
	shared.role = ''
	shared.docId = 0
}
const none = guestSession.all.length
const ok = guestSession.active && none >= 3 && guestSession.off === none && guestOther.active && guestOther.off === 0 && host.off === 0 && refused.busy && refused.said
return { ok, guestSession, guestOther, host, refused }
