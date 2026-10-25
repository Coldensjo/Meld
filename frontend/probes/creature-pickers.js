// The creature editor's pickers for its client-listed and mask columns (#699): Stormwind City Guard (68) names its faction template with how it treats Alliance and Horde players, its Find lists templates by faction name and puts the picked one's ID in; Pet family and Trainer race are selects, AI offers the core's AI names, the six immunity and flag masks are tick lists, and the Looks tab's "A click sets" offers the mount; nothing saved; takes about 10 s.
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/components/RefField.svelte, frontend/src/lib/world/creatureFields.ts, frontend/src/lib/wow/refNames.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim() === name)
ui.creatureEditor = { key: null, entry: 68 }
await P.frames(1)
await P.until(() => tab('Creature'), WAIT, 'the editor')
tab('Creature').click()
await P.frames(1)
const ref = (label) => [...root().querySelectorAll('.ref')].find((r) => r.querySelector('.label')?.textContent === label)
const labelled = (text) => [...root().querySelectorAll('label, fieldset')].find((l) => (l.querySelector('legend')?.textContent ?? l.firstChild?.textContent ?? '').trim().startsWith(text))
await P.until(() => ref('Faction')?.querySelector('.name span:not(.dim)'), WAIT, 'the faction name')
const faction = { value: ref('Faction').querySelector('input').value, text: ref('Faction').querySelector('.name').textContent.replace(/\s+/g, ' ').trim() }
// Find lists the templates whole; a search by faction name narrows them, and a click puts the ID in.
;[...ref('Faction').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
const search = () => ref('Faction').querySelector('input[type=search]')
await P.until(search, WAIT, 'the faction search')
search().value = 'Darnassus'
search().dispatchEvent(new Event('input', { bubbles: true }))
const hit = () => [...ref('Faction').querySelectorAll('li button')].find((b) => b.textContent.includes('Darnassus'))
await P.until(hit, WAIT, 'a Darnassus template')
const hitText = hit().textContent.replace(/\s+/g, ' ').trim()
const hitId = hitText.match(/(\d+) ·/)?.[1]
hit().click()
await P.frames(1)
const picked = { value: ref('Faction').querySelector('input').value, text: ref('Faction').querySelector('.name').textContent.replace(/\s+/g, ' ').trim() }
const selectOptions = (text) => [...(labelled(text)?.querySelectorAll('select option') ?? [])].map((o) => o.textContent)
const pet = selectOptions('Pet family')
const race = selectOptions('Trainer race')
const aiInput = labelled('AI')?.querySelector('input')
const ai = [...(aiInput?.list?.options ?? [])].map((o) => o.value)
const masks = ['Mechanic immunities', 'School immunities', 'Immunity flags', 'Static flags 1', 'Static flags 2', 'Extra flags'].map((t) => [t, labelled(t)?.querySelectorAll('input[type=checkbox]').length ?? 0])
tab('Looks').click()
await P.frames(1)
await P.until(() => root().querySelector('.slot select'), WAIT, 'the Looks tab')
const slots = [...root().querySelector('.slot select').options].map((o) => o.textContent)
ui.creatureEditor = null
await P.frames(1)
const ok =
	faction.value === '11' &&
	/to (Alliance|both)/.test(faction.text) &&
	hitId !== undefined &&
	picked.value === hitId &&
	picked.text.includes('Darnassus') &&
	pet.includes('Wolf') &&
	race.includes('Night Elf') &&
	ai.includes('EventAI') &&
	masks.every(([, n]) => n > 0) &&
	slots.some((s) => s.startsWith('the mount'))
return { ok, faction, hitText, picked, pet: pet.length, race, ai, masks, slots }
