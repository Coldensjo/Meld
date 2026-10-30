// The Sound tool (#684, Tools › Sounds…): the shared sound list finds CampFireLargeLoop, whose side names its file, its folder and the game object displays that play it; the Files tab lists Sound\Doodad\CampFireLargeLoop.wav. On a throwaway copy of the client (P.sandboxClient), a WAV the probe makes is imported as zone ambience (the file under Sound\Meld, a SoundEntries row and a SoundAmbience row): the tool picks the new sound, the shared list, the Zones dialog's ambience list and /wow/sound have it, Export saves the file, and Replace… puts a longer WAV over it after the confirmation; the real patch is untouched.
// touches: frontend/src/components/SoundsWindow.svelte, frontend/src/components/SoundPicker.svelte, frontend/src/lib/ui/soundPlayer.svelte.ts, frontend/src/components/ZonesDialog.svelte, internal/vmangos/sounds.go, internal/vmangos/zonesounds.go, app_sounds.go, app_icons.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 60_000
const App = window.go.main.App
const tool = () => document.querySelector('[data-ui="SoundsWindow"]')
const side = () => tool()?.querySelector('aside')
const bar = () => tool()?.querySelector('.bar.ok')?.textContent ?? ''
const errorBar = () => tool()?.querySelector('.bar.error')?.textContent ?? ''
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
function type(input, text) {
	input.value = text
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
/** A 16-bit mono PCM WAV of `n` samples of a tone. */
function wav(n) {
	const b = new DataView(new ArrayBuffer(44 + n * 2))
	const str = (at, s) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)))
	str(0, 'RIFF')
	b.setUint32(4, 36 + n * 2, true)
	str(8, 'WAVEfmt ')
	b.setUint32(16, 16, true)
	b.setUint16(20, 1, true)
	b.setUint16(22, 1, true)
	b.setUint32(24, 22050, true)
	b.setUint32(28, 44100, true)
	b.setUint16(32, 2, true)
	b.setUint16(34, 16, true)
	str(36, 'data')
	b.setUint32(40, n * 2, true)
	for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(8000 * Math.sin(i / 8)), true)
	return new Uint8Array(b.buffer)
}
const out = {}

ui.soundsTool = { id: 0 }
await P.until(() => tool()?.querySelectorAll('[aria-label="Sounds"] li .name').length > 10, WAIT, 'the Sound tool')
type(tool().querySelector('[aria-label="Search sounds"]'), 'CampFireLargeLoop')
await P.until(() => [...tool().querySelectorAll('[aria-label="Sounds"] li .name')].some((n) => n.textContent.trim() === 'CampFireLargeLoop'), WAIT, 'the search')
;[...tool().querySelectorAll('[aria-label="Sounds"] li')]
	.find((l) => l.querySelector('.name')?.textContent.trim() === 'CampFireLargeLoop')
	.querySelector('.row')
	.click()
await P.until(() => side()?.querySelector('.name')?.textContent === 'CampFireLargeLoop', WAIT, 'the picked sound')
out.picked = {
	files: [...side().querySelectorAll('[aria-label="The sound\'s files"] .file')].map((f) => f.textContent),
	facts: side().querySelector('.facts')?.textContent.replace(/\s+/g, ' ').trim(),
	uses: side().querySelector('.uses')?.textContent.replace(/\s+/g, ' ').trim(),
	play: !!side().querySelector('[aria-label="The sound\'s files"] button.play'),
}
button(tool().querySelector('nav.tabs'), 'Files').click()
await P.until(() => tool().querySelectorAll('[aria-label="Sound files"] li .row').length > 10, WAIT, 'the files')
type(tool().querySelector('[aria-label="Search sound files"]'), 'doodad campfirelargeloop')
await P.until(() => tool().querySelectorAll('[aria-label="Sound files"] li .row').length === 1, WAIT, 'the file search')
out.file = tool().querySelector('[aria-label="Sound files"] li .row').textContent
button(tool().querySelector('nav.tabs'), 'Sounds').click()

const stubs = { OpenSoundFileDialog: App.OpenSoundFileDialog, ExportSoundsDialog: App.ExportSoundsDialog }
const sb = await P.sandboxClient()
try {
	const first = await P.sandboxFile('MeldProbeChime.wav', wav(4410))
	const longer = await P.sandboxFile('MeldProbeChime2.wav', wav(8820))
	const scratch = first.slice(0, Math.max(first.lastIndexOf('\\'), first.lastIndexOf('/')))
	App.OpenSoundFileDialog = async () => first
	App.ExportSoundsDialog = async () => scratch

	button(tool().querySelector('header'), 'Import sound').click()
	await P.until(() => side()?.querySelector('[aria-label="Sound name"]'), WAIT, 'the import form')
	out.form = { name: side().querySelector('[aria-label="Sound name"]').value, kind: side().querySelector('input[name="sound-kind"]:checked')?.value }
	side().querySelector('input[name="sound-kind"][value="ambience"]').click()
	button(side(), 'Import').click()
	await P.until(() => /Imported/.test(bar()) || errorBar(), WAIT, 'the import')
	out.imported = { note: bar(), error: errorBar() }
	await P.until(() => side()?.querySelector('.name')?.textContent === 'MeldProbeChime', WAIT, 'the new sound picked')
	out.newSound = {
		files: [...side().querySelectorAll('[aria-label="The sound\'s files"] .file')].map((f) => f.textContent),
		meta: side().querySelector('.name + .dim')?.textContent,
		uses: side().querySelector('.uses')?.textContent.replace(/\s+/g, ' ').trim(),
		listed: [...tool().querySelectorAll('[aria-label="Sounds"] li .name')].map((n) => n.textContent.trim()).includes('MeldProbeChime'),
	}
	const path = 'Sound\\Meld\\MeldProbeChime.wav'
	const zones = await App.ZoneSounds()
	out.zoneAmbience = zones.ambience.find((a) => a.file === path) ?? null
	const entries = await App.SoundEntries()
	out.entry = entries.find((e) => e.name === 'MeldProbeChime') ?? null
	const served = await fetch(`/wow/sound?path=${encodeURIComponent(path)}`)
	out.served = { status: served.status, bytes: (await served.arrayBuffer()).byteLength }

	button(side(), 'Export file').click()
	await P.until(() => /Saved MeldProbeChime\.wav/.test(bar()) || errorBar(), WAIT, 'the export')
	out.exported = bar() || errorBar()

	App.OpenSoundFileDialog = async () => longer
	button(side().querySelector('[aria-label="The sound\'s files"]'), 'Replace').click()
	const ask = await P.until(() => P.dialog('Replace a client sound'), WAIT, 'the confirmation')
	out.confirmText = ask.textContent.replace(/\s+/g, ' ')
	ask.querySelector('[data-confirm="yes"]').click()
	await P.until(() => /Replaced/.test(bar()) || errorBar(), WAIT, 'the replace')
	out.replaced = bar() || errorBar()
	const again = await fetch(`/wow/sound?path=${encodeURIComponent(path)}`)
	out.servedAfter = { status: again.status, bytes: (await again.arrayBuffer()).byteLength }
} finally {
	Object.assign(App, stubs)
	ui.confirm = null
	out.ended = await P.endSandbox()
}
ui.soundsTool = null
await P.frames(1)

const ok =
	out.picked.files.includes('CampFireLargeLoop.wav') &&
	out.picked.facts.includes('Sound\\Doodad') &&
	/game object display/.test(out.picked.uses) &&
	out.picked.play &&
	out.file === 'Sound\\Doodad\\CampFireLargeLoop.wav' &&
	out.form.name === 'MeldProbeChime' &&
	out.form.kind === 'sound' &&
	out.imported.error === '' &&
	/SoundAmbience \d+/.test(out.imported.note) &&
	out.newSound.files.join() === 'MeldProbeChime.wav' &&
	/imported/.test(out.newSound.meta) &&
	/type 50/.test(out.newSound.meta) &&
	/Ambience: SoundAmbience \d+/.test(out.newSound.uses) &&
	out.newSound.listed &&
	out.zoneAmbience?.name === 'MeldProbeChime' &&
	out.entry?.file === 'Sound\\Meld\\MeldProbeChime.wav' &&
	out.served.status === 200 &&
	out.served.bytes === 44 + 4410 * 2 &&
	/Saved MeldProbeChime\.wav in/.test(out.exported) &&
	out.confirmText.includes('MeldProbeChime') &&
	/^Replaced/.test(out.replaced) &&
	out.servedAfter.status === 200 &&
	out.servedAfter.bytes === 44 + 8820 * 2 &&
	out.ended.realUnchanged
return { ok, sandbox: sb.dataDir, ...out }
