// Icons from PNG files and back (#364): the spell editor's Change icon… grid has Import PNG… and Export all as PNG…, a search narrows the export to its matches (Export 1 as PNG…), the bindings refuse a missing PNG file and folder, and Import PNG… on a PNG made in the page lists and previews the new icon in a throwaway client (#368); the real client is left alone. Tools › Icons… (#683) shows the same grid (IconGrid) with every icon, and a picked icon's name (Copy name puts it on the clipboard), its SpellIcon.dbc ID and the spells that show it.
// touches: frontend/src/components/SpellEditor.svelte, frontend/src/components/SpellIcon.svelte, frontend/src/components/IconGrid.svelte, frontend/src/components/IconsWindow.svelte, frontend/src/components/ItemLookPicker.svelte, app_icons.go, internal/vmangos/spells.go, internal/vmangos/icons.go, internal/wow/icon.go, internal/wow/blpwrite.go
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const { ui } = await P.state()
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Spell editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

ui.spellEditor = { entry: 133 }
await P.until(() => button(root()?.querySelector('.look'), 'Change icon'), WAIT, 'Fireball')
button(root().querySelector('.look'), 'Change icon').click()
await P.until(() => root().querySelectorAll('.icon-btn').length > 10, WAIT, 'the icons')
const picker = root().querySelector('.change')
const before = { import: !!button(picker, 'Import PNG'), exportText: button(picker, 'Export')?.textContent.trim() }
type(picker.querySelector('[aria-label="Search the icons"]'), 'Spell_Fire_FlameBolt')
await P.until(() => root().querySelectorAll('.icon-btn').length === 1, WAIT, 'the search')
const narrowed = { icon: root().querySelector('.icon-btn').title, exportText: button(picker, 'Export')?.textContent.trim() }

// The bindings, without a dialog: a PNG that isn't there is refused by its name, a folder that isn't there too.
const { ImportIcons, ExportIcons } = window.go.main.App
const imported = await ImportIcons(['C:/Meld-probe-missing/Probe Icon.png']).catch((e) => ({ error: String(e) }))
const exported = await ExportIcons(['Spell_Fire_FlameBolt'], 'C:/Meld-probe-missing').catch((e) => ({ error: String(e) }))

// Import PNG… for real, into a throwaway copy of the client (#368): a 64 px PNG drawn here, picked
// through a stubbed file dialog, is listed under its file's name and previewed in its colour.
const sb = await P.sandboxClient()
const canvas = document.createElement('canvas')
canvas.width = canvas.height = 64
const g = canvas.getContext('2d')
g.fillStyle = 'rgb(200, 40, 40)'
g.fillRect(0, 0, 64, 64)
const png = await new Promise((r) => canvas.toBlob(r, 'image/png'))
const file = await P.sandboxFile('Meld Probe Icon.png', png)
const App = window.go.main.App
const dialog = App.OpenIconsDialog
App.OpenIconsDialog = async () => [file]
let added
try {
	button(picker, 'Import PNG').click()
	await P.until(() => /Added|Not added/.test(root().querySelector('.change .note')?.textContent ?? '') || root().querySelector('.change .error'), WAIT, 'the import')
	const note = root().querySelector('.change .note')?.textContent ?? root().querySelector('.change .error')?.textContent
	await P.until(() => root().querySelector('.icon-btn img')?.complete, WAIT, 'the preview of the new icon')
	const img = root().querySelector('.icon-btn img')
	const c = document.createElement('canvas')
	c.width = c.height = 1
	c.getContext('2d').drawImage(img, img.naturalWidth / 2, img.naturalHeight / 2, 1, 1, 0, 0, 1, 1)
	const px = [...c.getContext('2d').getImageData(0, 0, 1, 1).data.slice(0, 3)]
	added = { note, icons: [...root().querySelectorAll('.icon-btn')].map((b) => b.title), px }
} finally {
	App.OpenIconsDialog = dialog
	ui.spellEditor = null
	await P.frames(1)
}
const ended = await P.endSandbox()
const real = await App.ListItemIcons()
const after = { realHasIt: real.some((n) => n.toLowerCase() === 'meld_probe_icon'), realIcons: real.length }

// Tools › Icons…: the shared grid lists every icon, a search and a click pick one, and the side shows
// its name, SpellIcon ID and spells; Copy name copies it.
ui.iconsTool = { icon: '' }
const tool = () => document.querySelector('[aria-label="Icons"][role="dialog"]')
await P.until(() => tool()?.querySelectorAll('.icon-btn').length > 10, WAIT, 'the Icons tool')
const toolAll = button(tool(), 'Export')?.textContent.trim()
type(tool().querySelector('[aria-label="Search the icons"]'), 'Spell_Fire_FlameBolt')
await P.until(() => tool().querySelectorAll('.icon-btn').length === 1, WAIT, 'the tool search')
tool().querySelector('.icon-btn').click()
await P.until(() => /SpellIcon \d+/.test(tool().querySelector('.uses')?.textContent ?? ''), WAIT, 'the spells of the icon')
const side = tool().querySelector('aside')
const iconsTool = {
	exportText: toolAll,
	name: side.querySelector('.name')?.textContent,
	idButton: button(side, 'Copy spell icon ID')?.textContent.trim(),
	idEnabled: !button(side, 'Copy spell icon ID')?.disabled,
	spells: [...side.querySelectorAll('.spells li')].map((l) => l.textContent.trim()),
}
button(side, 'Copy name').click()
await P.until(() => /Copied the name/.test(tool().querySelector('.bar.ok')?.textContent ?? ''), WAIT, 'Copy name')
iconsTool.clipboard = await window.runtime.ClipboardGetText().catch((e) => `(${e})`)
ui.iconsTool = null
await P.frames(1)

const ok =
	iconsTool.exportText === 'Export all as PNG…' &&
	iconsTool.name === 'Spell_Fire_FlameBolt' &&
	/^Copy spell icon ID \(\d+\)$/.test(iconsTool.idButton ?? '') &&
	iconsTool.idEnabled &&
	iconsTool.spells.some((s) => s.startsWith('Fireball')) &&
	iconsTool.clipboard === 'Spell_Fire_FlameBolt' &&
	before.import &&
	before.exportText === 'Export all as PNG…' &&
	narrowed.icon === 'Spell_Fire_FlameBolt' &&
	narrowed.exportText === 'Export 1 as PNG…' &&
	!imported.names?.length &&
	imported.refused?.length === 1 &&
	imported.refused[0].startsWith('Probe_Icon:') &&
	/not a folder/.test(exported.error ?? '') &&
	/Added Meld_Probe_Icon/.test(added.note ?? '') &&
	added.icons.length === 1 &&
	added.icons[0] === 'Meld_Probe_Icon' &&
	Math.abs(added.px[0] - 200) < 24 &&
	added.px[1] < 70 &&
	added.px[2] < 70 &&
	ended.wasOn &&
	ended.realUnchanged &&
	!after.realHasIt
return { ok, iconsTool, before, narrowed, imported, exported, sandbox: sb.dataDir, added, ended, after }
