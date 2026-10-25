// The new-creature guide's "How it looks" step: the display picker, the weapon picker and the preview stay inside the page, the preview in view and not covered (#221).
// touches: frontend/src/components/CreaturesWorkspace.svelte, frontend/src/components/DisplayPicker.svelte, frontend/src/components/WeaponPicker.svelte, frontend/src/components/CreaturePreview.svelte
const { ui } = await P.state()
ui.creatures = true
await P.frames(5)
const q = (s) => document.querySelector(s)
const type = async (el, v) => {
	el.value = v
	el.dispatchEvent(new Event('input', { bubbles: true }))
	await P.frames(2)
}
const next = async () => {
	const b = [...document.querySelectorAll('footer button')].find((x) => x.textContent.trim() === 'Next')
	b.click()
	await P.frames(3)
}
await type(q('input[placeholder="Gregor the Smith"]'), 'Probe')
await next()
await P.until(() => q('input[name="faction"]'), 60_000, 'factions')
q('input[name="faction"]').click()
await P.frames(3)
await next()
await P.until(() => q('.looks'), 60_000, 'looks')
await P.frames(20)
const looks = q('.looks').getBoundingClientRect()
const pick = q('.looks .pick').getBoundingClientRect()
const show = q('.looks .show').getBoundingClientRect()
const page = q('.page')
const pr = page.getBoundingClientRect()
page.scrollTop = 0
await P.frames(3)
const topShow = q('.looks .show').getBoundingClientRect()
page.scrollTop = page.scrollHeight
await P.frames(3)
const botShow = q('.looks .show').getBoundingClientRect()
const botPick = q('.looks .pick').getBoundingClientRect()
const botPage = page.getBoundingClientRect()
const inside = botShow.top >= botPage.top - 1 && botShow.bottom <= botPage.bottom + 1
const contained = looks.bottom >= pick.bottom - 1
const noOverlap = show.left >= pick.right - 1
return {
	ok: contained && noOverlap && inside,
	contained,
	noOverlap,
	inside,
	looks: [looks.top, looks.bottom],
	pick: [pick.top, pick.bottom],
	show: [show.left, show.top, show.bottom],
	pickRight: pick.right,
	botShow: [botShow.top, botShow.bottom],
	page: [pr.top, pr.bottom],
}
