// New creature opens the guide (#260): the editor's New creature tab closes the editor and open the creature guide on step 1; the editor's Copy this creature asks for a name. Nothing is written to the database.
// touches: frontend/src/components/CreatureEditor.svelte, frontend/src/components/CreaturesWorkspace.svelte, frontend/src/lib/engine/SpawnActions.ts
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 300_000
const root = () => document.querySelector('[aria-label="Creature editor"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
ui.creatureEditor = { key: null, entry: 3976 }
await P.frames(1)
await P.until(() => button(root()?.querySelector('nav.tabs'), 'Creature') && root().querySelector('header h2')?.textContent.includes('Mograine'), WAIT, 'the editor')
const hasCopy = !!button(root().querySelector('header .actions'), 'Copy this creature')
button(root().querySelector('header .actions'), 'Copy this creature').click()
await P.frames(2)
const copyBar = root().querySelector('.bar input[placeholder="Name of the copy"]') !== null
button(root().querySelector('.bar'), 'Cancel').click()
await P.frames(2)
const barGone = root().querySelector('.bar input[placeholder="Name of the copy"]') === null
button(root().querySelector('nav.tabs'), 'New creature').click()
await P.frames(2)
const editorClosed = root() === null
const guide = ui.creatures === true
ui.creatures = false
await P.frames(1)
const ok = hasCopy && copyBar && barGone && editorClosed && guide && ui.creatureEditor === null
return { ok, hasCopy, copyBar, barGone, editorClosed, guide }
