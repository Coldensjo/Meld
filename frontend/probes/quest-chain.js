// The quest editor's Chain tab (#948): Westfall's The Defias Brotherhood (166, the chain's last quest) draws its seven steps from 65 to 166 left to right, each box naming its giver (Gryan Stoutmantle for the first) and zone, with no problem flagged; a box opens its quest in the editor.
// touches: frontend/src/components/QuestChainView.svelte, frontend/src/components/LayeredGraph.svelte, frontend/src/lib/world/questGraph.ts, frontend/src/lib/world/questChain.ts, frontend/src/lib/ui/layered.ts, internal/vmangos/questchain.go, frontend/src/components/QuestEditor.svelte
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[data-editor="quest"]')
const view = () => root()?.querySelector('[data-ui="QuestChainView"]')
const box = (entry) => view()?.querySelector(`.quest[data-entry="${entry}"]`)
const CHAIN = [65, 132, 135, 141, 142, 155, 166]

ui.questEditor = { entry: 166 }
await P.until(() => [...(root()?.querySelectorAll('nav.tabs button') ?? [])].some((b) => b.textContent.trim() === 'Chain'), WAIT, 'the quest')
;[...root().querySelectorAll('nav.tabs button')].find((b) => b.textContent.trim() === 'Chain').click()
const t0 = performance.now()
await P.until(() => CHAIN.every(box) && !box(65).textContent.includes('…'), WAIT, 'the chain with its zones')
const ms = Math.round(performance.now() - t0)
const lefts = CHAIN.map((e) => box(e).getBoundingClientRect().left)
const ordered = lefts.every((x, i) => i === 0 || x > lefts[i - 1])
const first = box(65).textContent.replace(/\s+/g, ' ').trim()
const problems = view().querySelectorAll('[aria-label="Chain problems"] li').length
const arrows = view().querySelectorAll('path.edge').length
const rootMarked = box(166).classList.contains('root')

box(65).click()
await P.until(() => ui.questEditor?.entry === 65, WAIT, 'quest 65 opened')
await P.until(() => box(65)?.classList.contains('root'), WAIT, 'the chain of 65')
const reopened = ui.questEditor.entry
ui.questEditor = null
await P.frames(1)

const ok = ordered && first.includes('Gryan Stoutmantle') && first.includes('Westfall') && problems === 0 && arrows >= CHAIN.length - 1 && rootMarked && reopened === 65
return { ok, ms, ordered, first, problems, arrows, rootMarked, reopened }
