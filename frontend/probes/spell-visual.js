// The spell visual composer (#361): Blizzard's Compose… lists its stages with their effect models (the falling ice on the area), Rain of Fire's area is taken for it (a lava blizzard), the area's model plays in the preview, a hovered effect model previews and a clicked one goes on the cast stage's left hand, Use this visual waits for Save with a summary of the stages (Save spell (1)), Esc leaves the composer, and Revert drops it; nothing written.
// touches: frontend/src/components/SpellVisualComposer.svelte, internal/vmangos/spellvisuals.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 120_000
const root = () => document.querySelector('[aria-label="Spell editor"]')
const comp = () => root().querySelector('[aria-label="Compose visual"]')
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
const type = (input, value) => {
	input.value = value
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const stageText = (name) =>
	[...comp().querySelectorAll('[aria-label="Stages"] button')]
		.find((b) => b.querySelector('strong').textContent === name)
		?.querySelector('.dim')
		.textContent.trim()
const caption = () => comp().querySelector('.caption')?.textContent.trim() ?? ''

// Blizzard, Rank 1 (10).
ui.spellEditor = { entry: 10 }
await P.until(() => root()?.querySelector('.look .tip'), WAIT, 'Blizzard')
const title = root().querySelector('h2').textContent.trim()
button(root().querySelector('.visual'), 'Compose').click()
await P.until(() => comp() && /Blizzard/.test(stageText('Area') ?? ''), WAIT, 'the composer')
const before = { area: stageText('Area'), channel: stageText('Channel'), precast: stageText('Precast') }

// The area from Rain of Fire: the warlock's Rank 1 (5740). Spell 3354, also Rain of Fire Rank 1, is a helper without an area, which is refused.
button(comp().querySelector('[aria-label="Stages"]'), 'Area').click()
type(comp().querySelector('[aria-label="Take from a spell"]'), 'Rain of Fire')
await P.until(() => [...comp().querySelectorAll('[aria-label="Spells to take from"] li')].some((l) => /\b5740\b/.test(l.textContent)), WAIT, 'the spell search')
const helper = [...comp().querySelectorAll('[aria-label="Spells to take from"] li')].find((l) => /\b3354\b/.test(l.textContent))
button(helper, 'Its area').click()
await P.until(() => comp().querySelector('.error'), WAIT, 'the refusal')
const refused = comp().querySelector('.error').textContent.trim()
const keptArea = stageText('Area')
const hit = [...comp().querySelectorAll('[aria-label="Spells to take from"] li')].find((l) => /\b5740\b/.test(l.textContent))
button(hit, 'Its area').click()
await P.until(() => /Rain Of Fire/i.test(stageText('Area') ?? ''), WAIT, 'the area taken')
const area = stageText('Area')
await P.until(() => comp().querySelector('.preview canvas') && /RainOfFire/i.test(caption()), WAIT, 'the area preview')
const areaCaption = caption()

// The cast stage's left hand: hover an effect to preview it, click to use it.
button(comp().querySelector('[aria-label="Stages"]'), 'Cast').click()
await P.frames(1)
button(comp().querySelector('[aria-label="Attachment points"]'), 'Left hand').click()
type(comp().querySelector('[aria-label="Search the effect models"]'), 'fire cast hand')
await P.until(() => comp().querySelector('[aria-label="Effect models"] button'), WAIT, 'the effect search')
const fx = comp().querySelector('[aria-label="Effect models"] button')
fx.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
await P.frames(1)
const hovered = caption()
fx.click()
await P.frames(1)
const leftHand = button(comp().querySelector('[aria-label="Attachment points"]'), 'Left hand').textContent.trim()
const cast = stageText('Cast')

button(comp().querySelector('.bar'), 'Use this visual').click()
await P.frames(1)
const composedOpen = !!comp()
const summary = [...root().querySelectorAll('.composed li')].map((l) => l.textContent.trim())
const visualNote = root().querySelector('.visual .dim')?.textContent.trim()
const saveText = button(root().querySelector('header .actions'), 'Save')?.textContent.trim()

// Esc leaves a second composer without changing what waits.
button(root().querySelector('.visual'), 'Compose').click()
await P.until(() => comp(), WAIT, 'the composer again')
const reopened = /Rain Of Fire/i.test(stageText('Area') ?? '')
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
await P.frames(1)
const escaped = !comp() && root().querySelectorAll('.composed li').length === summary.length

button(root().querySelector('header .actions'), 'Revert').click()
await P.frames(1)
const reverted = !root().querySelector('.composed') && !!button(root().querySelector('header .actions'), 'Saved')
ui.spellEditor = null
await P.frames(1)

const ok =
	title.startsWith('Blizzard') &&
	/Blizzard Impact Base/.test(before.area) &&
	before.channel !== 'none' &&
	/spell 3354, has no area/.test(refused) &&
	/Blizzard Impact Base/.test(keptArea) &&
	/Rain Of Fire Impact Base/.test(area) &&
	/RainOfFire_Impact_Base\.m2/i.test(areaCaption) &&
	/Fire Cast Hand/i.test(hovered) &&
	/Fire Cast Hand/i.test(leftHand) &&
	/Fire Cast Hand/i.test(cast) &&
	!composedOpen &&
	summary.some((l) => /^Area: Rain Of Fire Impact Base/.test(l)) &&
	summary.some((l) => /^Cast: .*Fire Cast Hand/.test(l)) &&
	/composed/.test(visualNote) &&
	saveText === 'Save spell (1)' &&
	reopened &&
	escaped &&
	reverted
return { ok, title, before, refused, keptArea, area, areaCaption, hovered, leftHand, cast, summary, visualNote, saveText, reopened, escaped, reverted }
