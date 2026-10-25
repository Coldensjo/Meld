// The game object editor's Sounds tab (#674): the Forge (1743, display 197) shows its display's ten sound slots with UndeadCampfireSmall in Custom 0; Add on the empty Stand slot opens the shared sound picker, whose search finds CampFireLargeLoop with a Play button, and a click sets the slot as one unsaved change (Save object (1), the tab marked) that Revert drops. Picked again and saved on a throwaway copy of the client (P.sandboxClient), the display's slots read back from GameObjectDisplayInfo.dbc have it, the real patch is untouched, and the world database is not written.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/ObjectSoundsTab.svelte, frontend/src/components/SoundPicker.svelte, frontend/src/lib/ui/soundPlayer.svelte.ts, internal/vmangos/objectsounds.go, app_editors.go
const { editor, ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
editor.selectedSpawn = null
const WAIT = 60_000
const FORGE = 1743
const DISPLAY = 197
const root = () => document.querySelector('[aria-label="Game object editor"]')
const tabButton = (text) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const slotRows = () => [...(root()?.querySelectorAll('[aria-label="Sound slots"] > li:not(.pick)') ?? [])]
const slot = (name) => slotRows().find((li) => li.querySelector('.slot')?.textContent.trim() === name)
const slotText = (name) => slot(name)?.querySelector('.sound')?.textContent.trim() ?? ''
const button = (li, text) => [...(li?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === text)
const saveButton = () => [...root().querySelectorAll('header button')].find((b) => b.textContent.trim().startsWith('Sav'))
const picker = () => root()?.querySelector('[aria-label="Sounds"]')
const out = {}

ui.objectEditor = { key: null, entry: FORGE }
await P.until(() => tabButton('Sounds'), WAIT, 'the forge opened')
tabButton('Sounds').click()
await P.until(() => slotRows().length === 10 && slotText('Custom 0').includes('('), WAIT, 'the slots')
out.read = {
	slots: slotRows().map((li) => li.querySelector('.slot').textContent.trim()),
	stand: slotText('Stand'),
	custom0: slotText('Custom 0'),
	note: root().querySelector('.scroll > div:not([hidden]) > p.dim')?.textContent.replace(/\s+/g, ' ').trim(),
}

/** Opens the Stand slot's picker, searches for the fire's loop and picks it. */
async function pickLoop() {
	button(slot('Stand'), 'Add').click()
	await P.until(() => picker(), WAIT, 'the picker')
	const search = root().querySelector('[aria-label="Search sounds"]')
	search.value = 'CampFireLargeLoop'
	search.dispatchEvent(new Event('input', { bubbles: true }))
	await P.until(() => [...picker().querySelectorAll('li .name')].some((n) => n.textContent.trim() === 'CampFireLargeLoop'), WAIT, 'the search')
	const li = [...picker().querySelectorAll('li')].find((l) => l.querySelector('.name')?.textContent.trim() === 'CampFireLargeLoop')
	const found = { play: !li.querySelector('button.play').disabled, file: li.querySelector('.row').title }
	li.querySelector('.row').click()
	await P.until(() => slotText('Stand').startsWith('CampFireLargeLoop'), WAIT, 'the pick')
	return found
}

out.found = await pickLoop()
out.picked = { save: saveButton().textContent.trim(), tab: tabButton('Sounds').textContent.trim(), changed: slot('Stand').classList.contains('changed'), pickerClosed: !picker() }
const revert = [...root().querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Revert')
revert.click()
await P.until(() => slotText('Stand') === 'None', WAIT, 'the revert')
out.reverted = saveButton().textContent.trim()

// Saved on a throwaway client: the slot is in GameObjectDisplayInfo.dbc there.
const sb = await P.sandboxClient()
out.sandbox = sb.dataDir
try {
	await pickLoop()
	saveButton().click()
	await P.until(() => saveButton().textContent.trim() === 'Saved', WAIT, 'the save')
	const back = await window.go.main.App.ObjectDisplaySounds(DISPLAY)
	out.saved = { sounds: back.sounds, error: root().querySelector('.error')?.textContent ?? '' }
} finally {
	out.ended = await P.endSandbox()
}
ui.objectEditor = null
await P.frames(1)

const ok =
	out.read.slots.join() === 'Stand,Open,Loop,Close,Destroy,Opened,Custom 0,Custom 1,Custom 2,Custom 3' &&
	out.read.stand === 'None' &&
	out.read.custom0.startsWith('UndeadCampfireSmall') &&
	out.read.note.includes(`display ${DISPLAY}`) &&
	out.found.play &&
	out.found.file.includes('CampFireLargeLoop') &&
	out.picked.save === 'Save object (1)' &&
	out.picked.tab === 'Sounds (1)' &&
	out.picked.changed &&
	out.picked.pickerClosed &&
	out.reverted === 'Saved' &&
	out.saved?.sounds?.[0] > 0 &&
	out.saved.sounds[6] > 0 &&
	out.saved.error === '' &&
	out.ended.realUnchanged
return { ok, ...out }
