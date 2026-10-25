// The Portals and area triggers dialog (#718) holds its text: on Azeroth with the Deadmines entrance (trigger 78, a teleport) picked, as a sphere and as a box, at the default size and at 150 % interface size, in both themes, the dialog body has no horizontal scrollbar, no element sticks out past the dialog or past its own field row, and every label and button fits its box.
// touches: frontend/src/components/PortalsDialog.svelte
const { ui, prefs } = await P.state()
const before = { uiScale: prefs.uiScale, theme: prefs.theme }
const r = { runs: [] }
const check = (tag) => {
	const dialog = P.dialog('Portals and area triggers')
	const body = dialog.querySelector('.body') ?? dialog
	const d = dialog.getBoundingClientRect()
	const name = (el) => el.tagName + '.' + el.className + (el.textContent ? ' "' + el.textContent.trim().slice(0, 30) + '"' : '')
	const all = [...body.querySelectorAll('*')]
	// Past the dialog's right edge.
	const wide = all.filter((el) => el.getBoundingClientRect().right > d.right + 0.5).map(name)
	// Text cut by its own box (a label or button narrower than its words), or a row whose children run past it.
	const cut = all
		.filter((el) => (el.matches('label, button, .k, .row, legend, .form, .group') || el.tagName === 'SPAN') && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'visible' && el.clientWidth > 0)
		.map(name)
	const run = { tag, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, wide: wide.slice(0, 6), cut: cut.slice(0, 6) }
	run.ok = run.scrollWidth <= run.clientWidth && !wide.length && !cut.length
	r.runs.push(run)
}
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 28, y: 53, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.3, distance: 30, hour: 13 },
		prefs: { cameraFollowGround: false },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	ui.dialog = 'portals'
	const entry = await P.until(() => [...(P.dialog('Portals and area triggers')?.querySelectorAll('.list button') ?? [])].find((b) => b.textContent.includes('Deadmines - Entrance')), 60000, 'the Deadmines entrance in the list')
	entry.click()
	await P.until(() => P.dialog('Portals and area triggers')?.querySelector('#at-map'), 10000, 'the teleport fields')
	const dialog = () => P.dialog('Portals and area triggers')
	r.teleport = dialog().querySelector('#at-map')?.value === '36'
	for (const theme of ['dark', 'light']) {
		prefs.theme = theme
		for (const scale of [1, 1.5]) {
			prefs.uiScale = scale
			await P.frames(4)
			check(`${theme} ${scale} sphere`)
		}
	}
	// The box fields: switch the shape (an unsaved edit, dropped when the dialog closes below).
	const box = [...dialog().querySelectorAll('input[type=radio]')][1]
	box.click()
	await P.until(() => dialog().querySelector('#at-yaw'), 5000, 'the box fields')
	for (const scale of [1, 1.5]) {
		prefs.uiScale = scale
		await P.frames(4)
		check(`${prefs.theme} ${scale} box`)
	}
} finally {
	prefs.uiScale = before.uiScale
	prefs.theme = before.theme
	ui.dialog = null
	P.e.endTriggerEdit()
	await P.frames(2)
}
r.ok = r.teleport && r.runs.length === 6 && r.runs.every((x) => x.ok)
return r
