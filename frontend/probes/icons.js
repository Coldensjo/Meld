// Icons from PNG files and back (#364): the spell editor's Change icon… grid has Import PNG… and Export all as PNG…, a search narrows the export to its matches (Export 1 as PNG…), and the bindings refuse a missing PNG file (named after the file, nothing written) and a missing folder; nothing written.
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
ui.spellEditor = null
await P.frames(1)

const ok =
	before.import &&
	before.exportText === 'Export all as PNG…' &&
	narrowed.icon === 'Spell_Fire_FlameBolt' &&
	narrowed.exportText === 'Export 1 as PNG…' &&
	!imported.names?.length &&
	imported.refused?.length === 1 &&
	imported.refused[0].startsWith('Probe_Icon:') &&
	/not a folder/.test(exported.error ?? '')
return { ok, before, narrowed, imported, exported }
