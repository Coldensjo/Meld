// The Saving bar (#343): a save that runs past 400 ms shows what it saves in the middle of the window,
// a quick one never shows it, overlapping saves name the newest, a publish's log line shows under
// it, and it goes when the last save ends, even one that threw.
// touches: frontend/src/components/SavingBar.svelte, frontend/src/lib/state/saving.ts
await P.frames(3)
const { startSaving, withSaving, savingDetail } = await P.app('/src/lib/state/saving.ts')
const wait = (ms) => new Promise((done) => setTimeout(done, ms))
const bar = () => document.querySelector('[data-ui="SavingBar"]')
const text = () => bar()?.textContent.replace(/\s+/g, ' ').trim() ?? ''

// A quick save never shows it.
await withSaving('Saving quick', () => wait(100))
await wait(450)
const quickHidden = !bar()

// A slow one shows it after the delay, centred.
const end = startSaving('Saving map')
const early = !!bar()
await wait(550)
const shown = !!bar()
const r = bar()?.getBoundingClientRect()
const centred = !!r && Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 2 && Math.abs(r.top + r.height / 2 - window.innerHeight / 2) <= 2
const label = text()

// A second save on top names itself, with a log line; when it ends the first shows again.
const end2 = startSaving('Publishing test')
savingDetail('Writing tiles…')
await P.frames(2)
const nested = text()
end2()
await P.frames(2)
const back = text()

// A save that throws still clears it.
end()
let threw = false
try {
	await withSaving('Saving broken', async () => {
		await wait(500)
		throw new Error('refused')
	})
} catch {
	threw = true
}
await P.frames(2)
const cleared = !bar()

return {
	ok: quickHidden && !early && shown && centred && label === 'Saving map…' && nested === 'Publishing test… Writing tiles…' && back === 'Saving map…' && threw && cleared,
	quickHidden,
	early,
	shown,
	centred,
	label,
	nested,
	back,
	threw,
	cleared,
}
