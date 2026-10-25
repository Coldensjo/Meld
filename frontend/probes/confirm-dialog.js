// The app's confirm dialog (#581) in place of the native confirm(): Delete stack in the brush stack dialog asks in a themed Modal over it, which takes the focus, Esc answers no (the stack stays, the stack dialog stays open, the focus goes back to Delete stack), and the yes button deletes it.
// touches: frontend/src/lib/state/confirm.ts, frontend/src/components/AppDialogs.svelte, frontend/src/components/BrushStackDialog.svelte, frontend/src/components/Modal.svelte
const { prefs, ui } = await P.state()
const { newStackItem } = await P.app('/src/lib/tools/brushStack.ts')
const stacksWas = prefs.brushStacks
const activeWas = prefs.brushStack
const press = (key) => {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
	;(document.activeElement ?? document.body).dispatchEvent(ev)
}
const r = {}
try {
	const name = 'Probe stack 581'
	prefs.brushStacks = [...stacksWas, { name, items: [newStackItem('sculpt')] }]
	prefs.brushStack = name
	ui.dialog = 'stack'
	const stackDlg = await P.until(() => P.dialog('Brush stack'), 20_000, 'the brush stack dialog')
	const del = [...stackDlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete stack')
	del.focus()
	del.click()
	const ask = await P.until(() => P.dialog('Delete stack'), 20_000, 'the confirm dialog')
	await P.until(() => ask.contains(document.activeElement), 20_000, 'focus in the confirm dialog')
	r.text = ask.querySelector('.body p')?.textContent ?? ''
	r.danger = ask.querySelector('[data-confirm="yes"]')?.classList.contains('danger') ?? false
	r.onTop =
		document
			.elementFromPoint(
				...(() => {
					const b = ask.getBoundingClientRect()
					return [b.x + b.width / 2, b.y + b.height / 2]
				})(),
			)
			?.closest('[role=dialog]') === ask
	press('Escape')
	await P.frames(2)
	r.closedOnEsc = !P.dialog('Delete stack')
	r.stackDialogStays = ui.dialog === 'stack' && !!document.body.contains(stackDlg)
	r.keptOnNo = prefs.brushStacks.some((s) => s.name === name)
	r.focusBack = document.activeElement === del
	del.click()
	const ask2 = await P.until(() => P.dialog('Delete stack'), 20_000, 'the confirm dialog again')
	ask2.querySelector('[data-confirm="yes"]').click()
	await P.frames(2)
	r.deletedOnYes = !prefs.brushStacks.some((s) => s.name === name)
	r.ok = r.text.includes(name) && r.danger && r.onTop && r.closedOnEsc && r.stackDialogStays && r.keptOnNo && r.focusBack && r.deletedOnYes
	return r
} finally {
	ui.confirm = null
	ui.dialog = null
	prefs.brushStacks = stacksWas
	prefs.brushStack = activeWas
}
