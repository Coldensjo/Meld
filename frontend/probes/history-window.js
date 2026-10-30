// The History window on the browser page (#909): with no native windows (server mode) Edit › History
// still opens the in-page window, which lists the active map's steps, dims the undone ones, and goes to a
// step on a click. The desktop app opens it as its own OS window instead (docs/tests/ui.md, "History as
// its own OS window"), which no probe can drive.
// touches: frontend/src/components/HistoryWindow.svelte, frontend/src/components/HistoryList.svelte, frontend/src/lib/toolwin/, frontend/src/main.ts
const e = P.e
const { ui } = await P.state()
e.newDocument(64, 'flat', 1, 'History')
await P.frames(3)
const cmd = (label) => ({ label, undo() {}, redo() {} })
e.history.push(cmd('First'))
e.history.push(cmd('Second'))
e.history.push(cmd('Third'))
const settle = async () => {
	await P.frames(3)
	await new Promise((r) => setTimeout(r, 50))
}
ui.history = true
await settle()
const box = () => document.querySelector('[data-ui="HistoryWindow"]')
const buttons = () => [...(box()?.querySelectorAll('ol button') ?? [])]
const opened = !!box()
const labels = buttons().map((b) => b.querySelector('.label')?.textContent)
const count = box()?.querySelector('.count')?.textContent ?? ''
// Back to the first step: the two after it undone (dimmed), the first current.
buttons()[1]?.click()
await settle()
const position = e.history.position
const undone = buttons().filter((b) => b.classList.contains('undone')).length
const current = buttons().findIndex((b) => b.classList.contains('current'))
// Its Close button closes it and clears Edit › History's check.
box()?.querySelector('.close')?.click()
await settle()
const closed = !box() && ui.history === false
return {
	ok: opened && labels.join() === 'Opened,First,Second,Third' && count.startsWith('3 /') && position === 1 && undone === 2 && current === 1 && closed,
	opened,
	labels,
	count,
	position,
	undone,
	current,
	closed,
}
