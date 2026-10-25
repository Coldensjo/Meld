// The Zones dialog (#247) opens with no horizontal scrollbar, with a zone picked and its weather shown: the dialog body's scrollWidth fits its clientWidth, and no control sticks out past the dialog.
// touches: frontend/src/components/ZonesDialog.svelte
const e = P.e
const { ui } = await P.state()
e.newDocument(256, 'hills', 1, 'Probe')
ui.dialog = 'zones'
const elwynn = await P.until(() => [...(P.dialog('Zones')?.querySelectorAll('button') ?? [])].find((b) => b.textContent.startsWith('Elwynn Forest')), 30000, 'Elwynn Forest in the zone list')
elwynn.click()
await P.until(() => document.querySelector('.weather[data-zone="12"] input[type=range]'), 30000, "Elwynn's weather sliders")
await P.frames(2)
const dialog = P.dialog('Zones')
const body = dialog.querySelector('.body') ?? dialog
const d = dialog.getBoundingClientRect()
const wide = [...body.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > d.right + 0.5).map((el) => el.tagName + '.' + el.className + '#' + el.id)
const out = { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, wide: wide.slice(0, 8) }
ui.dialog = null
out.ok = out.scrollWidth <= out.clientWidth && wide.length === 0
return out
