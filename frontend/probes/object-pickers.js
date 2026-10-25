// The game object editor's pickers for its id columns (#702): the Sunken Chest (32) names its faction template, the lock it has by what opens it, its loot list by its size; its Display box names the model; Cursor icon offers the client's cursors; Lock's Find lists the locks whole and puts the picked one's ID in; Eliza's Tombstone (37, a text) names its page by its first line, its language and its page material; nothing saved; takes about 10 s.
// touches: frontend/src/components/ObjectEditor.svelte, frontend/src/components/RefField.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/lib/world/objectFields.ts, frontend/src/lib/wow/refNames.ts, frontend/src/lib/wow/locks.ts, internal/vmangos/objecttables.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Game object editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim() === name)
const ref = (label) => [...(root()?.querySelectorAll('.ref') ?? [])].find((r) => r.querySelector('.label')?.textContent === label)
const named = (label) => ref(label)?.querySelector('.name span:not(.dim)')
const text = (label) => ref(label)?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
const labelled = (t) => [...root().querySelectorAll('label')].find((l) => (l.firstChild?.textContent ?? '').trim().startsWith(t))

async function open(entry) {
	ui.objectEditor = { key: null, entry }
	await P.frames(1)
	await P.until(() => tab('Object') && root().querySelector('.title')?.textContent.includes(String(entry)), WAIT, `object ${entry}`)
	tab('Object').click()
	await P.frames(1)
}

await open(32)
await P.until(() => named('Faction') && named('Lock') && named('Loot'), WAIT, 'the chest names')
const chest = { faction: text('Faction'), lock: text('Lock'), loot: text('Loot'), lockValue: ref('Lock').querySelector('input').value }
await P.until(() => labelled('Display')?.querySelector('.note'), WAIT, 'the display note')
const display = labelled('Display').querySelector('.note').textContent
const cursors = [...(labelled('Cursor icon')?.querySelector('input')?.list?.options ?? [])].map((o) => o.value)
// Lock's Find lists the locks whole; a pick puts its ID in.
;[...ref('Lock').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
await P.until(() => ref('Lock').querySelectorAll('li button').length > 50, WAIT, 'the lock list')
const lockHit = [...ref('Lock').querySelectorAll('li button')].find((b) => /Pick Lock/.test(b.textContent) && !b.textContent.includes(` ${chest.lockValue}`))
const lockHitText = lockHit?.textContent.replace(/\s+/g, ' ').trim() ?? ''
lockHit?.click()
await P.frames(1)
const picked = ref('Lock').querySelector('input').value
const changed = ref('Lock').classList.contains('changed')

await open(37)
await P.until(() => named('Page') && named('Language') && named('Page material'), WAIT, 'the text names')
const tomb = { page: text('Page'), language: text('Language'), material: text('Page material') }
ui.objectEditor = null
await P.frames(1)
const ok =
	chest.lockValue === '43' &&
	chest.faction.length > 3 &&
	chest.lock.length > 3 &&
	/\d+ loot rows?/.test(chest.loot) &&
	display.length > 2 &&
	cursors.includes('PickLock') &&
	lockHitText !== '' &&
	picked !== '43' &&
	lockHitText.includes(picked) &&
	changed &&
	tomb.page.length > 3 &&
	!tomb.page.startsWith('<') &&
	tomb.language.length > 2 &&
	tomb.material.length > 2
return { ok, chest, display, cursors: cursors.length, lockHitText, picked, changed, tomb }
