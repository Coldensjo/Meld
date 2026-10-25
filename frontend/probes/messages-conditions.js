// The creature editor's Messages tab (#160): Sputtervalve (3442) lists its one text shown under a condition (text 519 under condition 315) as an editable row, a changed condition is an unsaved edit that enables its Save and counts in the editor's unsaved changes, Revert undoes it, Add text adds a new row that its ✕ removes; nothing is written to the database.
// touches: frontend/src/components/MessagesTab.svelte, frontend/src/components/CreatureEditor.svelte, internal/vmangos/gossip.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const tab = () => root()?.querySelector('.messages')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const head = () => [...(tab()?.querySelectorAll('.head') ?? [])].find((h) => h.textContent.includes('Shown under a condition'))
const rows = () => [...(tab()?.querySelectorAll('.option') ?? [])].filter((o) => o.querySelector('.cond'))
ui.creatureEditor = { key: null, entry: 3442 }
await P.frames(1)
await P.until(() => button(root()?.querySelector('nav.tabs'), 'Messages'), WAIT, 'the editor')
button(root().querySelector('nav.tabs'), 'Messages').click()
await P.frames(1)
await P.until(() => rows().length === 1, WAIT, 'the conditioned text')
const row = rows()[0]
const heading = head().querySelector('h3').textContent.trim()
const label = row.querySelector('.line > .dim')?.textContent.trim()
const input = row.querySelector('.cond input')
const before = input.value
const text = row.querySelector('textarea').value
const saveBefore = button(row, 'Save')?.textContent.trim() ?? button(row, 'Saved')?.textContent.trim()
input.value = '316'
input.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
const saveAfter = button(row, 'Save')
const saveEnabled = !!saveAfter && !saveAfter.disabled
root().querySelector('header .actions button:last-child').click()
await P.frames(2)
const warned = root()?.querySelector('.bar.warn')?.textContent ?? ''
button(row, 'Revert').click()
await P.frames(2)
const reverted = rows()[0].querySelector('.cond input').value === before && !!button(rows()[0], 'Saved')
button(head(), 'Add text').click()
await P.frames(2)
const added = rows().length === 2 && rows()[1].querySelector('.line > .dim')?.textContent.trim() === 'new'
button(rows()[1].querySelector('.row-actions'), '✕').click()
await P.frames(2)
const removed = rows().length === 1
ui.creatureEditor = null
await P.frames(1)
const ok = heading === 'Shown under a condition (1)' && label === 'text 519' && before === '315' && text.length > 0 && saveBefore === 'Saved' && saveEnabled && warned.includes('unsaved') && reverted && added && removed
return { ok, heading, label, before, text: text.slice(0, 40), saveBefore, saveEnabled, warned, reverted, added, removed }
