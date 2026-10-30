// The game object editor's Sounds tab (#674): the Forge (1743, display 197) shows its display's ten sound slots with UndeadCampfireSmall in Custom 0; Add on the empty Stand slot opens the shared sound picker, whose search finds CampFireLargeLoop with a Play button, and a click sets the slot as one unsaved change (Save object (1), the tab marked) that Revert drops. Picked again and saved on a throwaway copy of the client (P.sandboxClient), the display's slots read back from GameObjectDisplayInfo.dbc have it, the real patch is untouched, and the world database is not written. Then Give this object a display of its own (#723) copies display 197 to a new one there, with the same model and slots, while 197 keeps its own; the unsaved cleared Custom 0 moves to the copy, and the template points at it as a second unsaved change, which Revert drops.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/ObjectSoundsTab.svelte, frontend/src/components/SoundPicker.svelte, frontend/src/lib/ui/soundPlayer.svelte.ts, internal/vmangos/objectsounds.go, app_editors.go
const { editor, ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
editor.selectedSpawn = null
const WAIT = 60_000
const FORGE = 1743
const DISPLAY = 197
const root = () => document.querySelector('[data-editor="object"]')
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
// The slots show `Sound <id> (<id>)` until the SoundEntries names arrive (a separate read), so wait for the name (#852).
await P.until(() => slotRows().length === 10 && slotText('Custom 0').includes('(') && !slotText('Custom 0').startsWith('Sound '), WAIT, 'the slots and their names')
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

	// A display of its own: Custom 0 cleared first, an unsaved slot that goes along to the copy.
	const own = () => [...root().querySelectorAll('p.own button')].find((b) => b.textContent.trim() === 'Give this object a display of its own')
	await P.until(() => own(), WAIT, 'the own display button (display 197 is shared)')
	button(slot('Custom 0'), 'Clear').click()
	await P.until(() => slotText('Custom 0') === 'None', WAIT, 'the cleared slot')
	own().click()
	await P.until(() => root().querySelector('p.made') || root().querySelector('.error'), WAIT, 'the copy')
	const made = root().querySelector('p.made')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
	const id = Number(/^Display (\d+)/.exec(made)?.[1] ?? 0)
	const copy = id ? await window.go.main.App.ObjectDisplaySounds(id) : null
	const orig = await window.go.main.App.ObjectDisplaySounds(DISPLAY)
	out.own = {
		id,
		made,
		error: root().querySelector('.error')?.textContent ?? '',
		copy,
		orig,
		custom0: slotText('Custom 0'),
		save: saveButton().textContent.trim(),
		button: !!own(),
	}
	;[...root().querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Revert').click()
	await P.until(() => saveButton().textContent.trim() === 'Saved', WAIT, 'the revert of the copy')
	out.own.reverted = root().querySelector('p.made') === null
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
	out.own.id > DISPLAY &&
	out.own.error === '' &&
	out.own.made.includes(`a copy of display ${DISPLAY}`) &&
	out.own.copy?.model === out.own.orig.model &&
	out.own.copy.sounds.join() === out.own.orig.sounds.join() &&
	out.own.orig.sounds[6] > 0 &&
	out.own.custom0 === 'None' &&
	out.own.save === 'Save object (2)' &&
	!out.own.button &&
	out.own.reverted &&
	out.ended.realUnchanged
return { ok, ...out }
