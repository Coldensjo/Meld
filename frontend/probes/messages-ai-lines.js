// The creature editor's Messages tab (#160): a Crushridge Ogre (2252) lists its three aggro lines ("I'll crush you!" and two more, one script run by its aggro event) as editable rows, an edited line enables its Save and counts in the editor's unsaved changes, and Revert undoes it; nothing is written to the database.
// touches: frontend/src/components/MessagesTab.svelte, frontend/src/components/CreatureEditor.svelte, internal/vmangos/gossip.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="creature"]')
const tab = () => root()?.querySelector('.messages')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const rows = () => [...(tab()?.querySelectorAll('.ai-line') ?? [])]
ui.creatureEditor = { key: null, entry: 2252 }
await P.frames(1)
await P.until(() => button(root()?.querySelector('nav.tabs'), 'Messages'), WAIT, 'the editor')
button(root().querySelector('nav.tabs'), 'Messages').click()
await P.frames(1)
await P.until(() => rows().length > 0, WAIT, 'the AI lines')
const texts = rows().map((r) => r.querySelector('input').value)
const label = rows()[0].querySelector('.line > .dim')?.textContent.trim()
const row = rows()[0]
const input = row.querySelector('input')
const before = input.value
const savedBefore = !!button(row, 'Saved')
input.value = before + ' Probe'
input.dispatchEvent(new Event('input', { bubbles: true }))
await P.frames(2)
const save = button(row, 'Save')
const saveEnabled = !!save && !save.disabled && save.textContent.trim() === 'Save'
root().querySelector('header .actions button:last-child').click()
await P.frames(2)
const warned = root()?.querySelector('.bar.warn')?.textContent ?? ''
button(row, 'Revert').click()
await P.frames(2)
const reverted = rows()[0].querySelector('input').value === before && !!button(rows()[0], 'Saved')
ui.creatureEditor = null
await P.frames(1)
const ok = texts.length === 3 && texts.includes("I'll crush you!") && /aggro/i.test(label ?? '') && savedBefore && saveEnabled && warned.includes('unsaved') && reverted
return { ok, texts, label, savedBefore, saveEnabled, warned, reverted }
