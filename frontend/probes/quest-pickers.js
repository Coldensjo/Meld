// The quest editor's pickers for its id and value columns (#704): Call of Water (96) names its start script by its commands, marked "this quest's own", and its exclusive group by the quests in it; Zamek's Distraction (1191) its end script and its condition by what it tests; The Family and the Fishing Pole (1141) its mail template by the letter's first line, whose Find lists the letters whole and a pick puts its ID in, marked changed; Avast Ye, Scallywag (1036) reads its reputation objective as Friendly, with the ranks offered; A New Threat (170) ticks no spillover from factions 1 and 2; a typed point map 1 reads Kalimdor; nothing saved; takes about 10 s.
// touches: frontend/src/components/RefField.svelte, frontend/src/components/TemplateFields.svelte, frontend/src/components/QuestEditor.svelte, frontend/src/lib/world/questFields.ts, frontend/src/lib/wow/refNames.ts, internal/vmangos/objecttables.go, internal/vmangos/quests.go, app_editors.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Quest editor"]')
const tab = (name) => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].find((b) => b.textContent.trim().startsWith(name))
const ref = (label) => [...(root()?.querySelectorAll('.ref') ?? [])].find((r) => r.querySelector('.label')?.textContent.trim() === label)
const named = (label) => {
	const t = ref(label)?.querySelector('.name')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
	return t && t !== '…' ? t : null
}
/** A plain field's label, by its label's start. */
const plain = (label) => [...root().querySelectorAll('.grid > label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim().replace(/·.*/, '').trim() === label)
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function open(entry, tabName) {
	ui.questEditor = null
	await P.frames(1)
	ui.questEditor = { entry }
	await P.until(() => tab(tabName) && [...root().querySelectorAll('span.dim')].some((d) => d.textContent.startsWith(`quest ${entry} `)), WAIT, `quest ${entry}`)
	tab(tabName).click()
	await P.frames(1)
}
const names = async (labels) => {
	await P.until(() => labels.every(named), WAIT, `the names of ${labels.join(', ')}`)
	return labels.map(named)
}

const got = {}
await open(96, 'Emotes and map')
;[got.start] = await names(['When accepted'])
type(ref('Map').querySelector('input'), '1')
await P.until(() => named('Map')?.includes('Kalimdor'), WAIT, 'the typed map')
got.map = named('Map')
tab('Requirements').click()
await P.frames(1)
;[got.group] = await names(['Exclusive group'])

await open(1191, 'Emotes and map')
;[got.end] = await names(['When handed in'])
tab('Requirements').click()
await P.frames(1)
;[got.condition] = await names(['Condition'])

await open(1141, 'Rewards')
;[got.mail] = await names(['Mail template'])
;[...ref('Mail template').querySelectorAll('button')].find((b) => b.textContent === 'Find').click()
await P.until(() => ref('Mail template').querySelectorAll('li button').length > 20, WAIT, 'the letters')
const hit = [...ref('Mail template').querySelectorAll('li button')].find((b) => !b.querySelector('.dim')?.textContent.startsWith('87'))
got.mailHit = hit?.querySelector('.dim')?.textContent.trim() ?? ''
hit?.click()
await P.frames(1)
got.mailPicked = ref('Mail template').querySelector('input').value
got.mailChanged = ref('Mail template').classList.contains('changed')

await open(1036, 'Objectives')
const repLabel = plain('Reputation')
got.rep = repLabel?.querySelector('.note')?.textContent ?? ''
got.ranks = [...(repLabel?.querySelectorAll('datalist option') ?? [])].map((o) => o.textContent)

await open(170, 'Rewards')
const spill = [...root().querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent.startsWith('Spillover'))
got.spill = [...(spill?.querySelectorAll('label.check') ?? [])].filter((l) => l.querySelector('input').checked).map((l) => l.textContent.trim())
ui.questEditor = null
await P.frames(1)

const ok =
	/command/.test(got.start) &&
	got.start.includes("this quest's own") &&
	got.map.includes('Kalimdor') &&
	got.group.includes('Call of Water') &&
	/command/.test(got.end) &&
	got.end.includes("this quest's own") &&
	got.condition.length > 3 &&
	!got.condition.startsWith('No ') &&
	got.mail.length > 3 &&
	!got.mail.startsWith('No ') &&
	got.mailHit !== '' &&
	got.mailHit.startsWith(got.mailPicked) &&
	got.mailChanged &&
	got.rep.includes('Friendly') &&
	got.ranks.includes('Exalted') &&
	got.spill.length === 2 &&
	got.spill[0].includes('faction 1')
return { ok, ...got }
