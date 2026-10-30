// The icons' import step, Replace… and Delete… (#717), on a throwaway copy of the client (P.sandboxClient): a 100 x 50 PNG with transparency made in the page, picked through a stubbed dialog from the Icons tool's Import PNG…, shows in the import step under its file's name, fitted and backed with black, and framed with the client's grey bevelled edge (cut corners) once Border is ticked; imported, the tool picks it as added in Meld's patch. Replace… puts the picture over Spell_Fire_FlameBolt (one of the client's own), which then reads as replaced; Delete… asks first, counting the spells that use it, and brings the client's icon back. Delete… of the added icon says nothing uses it and takes it out of the list. The client's own icons can't be deleted, and the real patch is untouched.
// touches: frontend/src/components/IconImportDialog.svelte, frontend/src/components/IconsWindow.svelte, frontend/src/components/IconGrid.svelte, frontend/src/lib/wow/iconPicture.ts, app_icons.go, internal/vmangos/icons.go, internal/vmangos/pending.go, internal/wow/icon.go
const { ui } = await P.state()
P.e.newDocument(256, 'flat', 0, 'Probe')
await P.frames(1)
const WAIT = 60_000
const App = window.go.main.App
const tool = () => document.querySelector('[data-ui="IconsWindow"]')
const side = () => tool()?.querySelector('aside')
const bar = () => tool()?.querySelector('.bar.ok')?.textContent ?? ''
const errorBar = () => tool()?.querySelector('.bar.error')?.textContent ?? ''
const gridNote = () => tool()?.querySelector('[data-icon-grid] .note')?.textContent ?? ''
const gridError = () => tool()?.querySelector('[data-icon-grid] .error')?.textContent ?? ''
const button = (el, text) => [...(el?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim().startsWith(text))
function type(input, text) {
	input.value = text
	input.dispatchEvent(new Event('input', { bubbles: true }))
}
const pick = async (name) => {
	type(tool().querySelector('[aria-label="Search the icons"]'), name)
	await P.until(() => [...tool().querySelectorAll('.icon-btn')].some((b) => b.title === name), WAIT, `${name} in the grid`)
	;[...tool().querySelectorAll('.icon-btn')].find((b) => b.title === name).click()
	await P.until(() => side()?.querySelector('.name')?.textContent === name && side().querySelector('.where'), WAIT, `${name} picked`)
}
/** A pixel of the import step's first preview: [r, g, b, a]. */
const previewPixel = (dlg, x, y) => [...dlg.querySelector('canvas').getContext('2d').getImageData(x, y, 1, 1).data]
const settle = () => P.frames(3)
const out = {}

const sb = await P.sandboxClient()
out.sandbox = !!sb.dataDir
const pic = document.createElement('canvas')
pic.width = 100
pic.height = 50
const g = pic.getContext('2d')
g.fillStyle = 'rgb(220, 30, 30)'
g.beginPath()
g.arc(50, 25, 20, 0, Math.PI * 2)
g.fill()
const file = await P.sandboxFile('Probe Icon Pic.png', await new Promise((r) => pic.toBlob(r, 'image/png')))
const stubs = { OpenIconsDialog: App.OpenIconsDialog, OpenImageDialog: App.OpenImageDialog }
App.OpenIconsDialog = async () => [file]
App.OpenImageDialog = async () => file
const NAME = 'Probe_Icon_Pic'
try {
	ui.iconsTool = { icon: '' }
	await P.until(() => tool()?.querySelectorAll('.icon-btn').length > 10, WAIT, 'the Icons tool')

	// Import PNG…: the import step, its options and the preview.
	button(tool().querySelector('[data-icon-grid]'), 'Import PNG').click()
	const dlg = await P.until(() => P.dialog('Import a picture as icons'), WAIT, 'the import step')
	await P.until(() => !dlg.querySelector('canvas.hidden') && dlg.querySelector('canvas'), WAIT, 'the preview')
	await settle()
	const box = (label) => [...dlg.querySelectorAll('.options label')].find((l) => l.textContent.trim() === label).querySelector('input')
	out.step = {
		name: dlg.querySelector('[aria-label="Icon name"]')?.value,
		size: dlg.querySelector('.about .dim')?.textContent,
		options: ['Fit to size', 'Border', 'Black background'].map((l) => box(l).checked),
		// Fitted, the 2:1 picture fills the width and leaves black above and below; the circle's middle is red.
		corner: previewPixel(dlg, 0, 0),
		middle: previewPixel(dlg, 32, 32),
	}
	box('Border').click()
	await settle()
	out.step.framed = { corner: previewPixel(dlg, 0, 0), top: previewPixel(dlg, 32, 1), side: previewPixel(dlg, 1, 32), inner: previewPixel(dlg, 32, 3) }
	button(dlg.querySelector('footer'), 'Import').click()
	await P.until(() => !P.dialog('Import a picture as icons') && (gridNote() || gridError()), WAIT, 'the import')
	out.imported = gridNote() || gridError()
	await P.until(() => side()?.querySelector('.name')?.textContent === NAME && side().querySelector('.where'), WAIT, 'the new icon picked')
	out.importedWhere = side().querySelector('.where').textContent.trim()

	// The client's own icon: Delete… is off until it is replaced.
	await pick('Spell_Fire_FlameBolt')
	out.clientOwn = { where: side().querySelector('.where').textContent.trim(), deleteOff: button(side(), 'Delete').disabled }
	button(side(), 'Replace').click()
	const rep = await P.until(() => P.dialog('Replace Spell_Fire_FlameBolt'), WAIT, 'the replace step')
	await P.until(() => !rep.querySelector('canvas.hidden'), WAIT, 'the replace preview')
	out.replaceStep = { name: rep.querySelector('.name')?.textContent, button: button(rep.querySelector('footer'), 'Replace')?.disabled === false }
	button(rep.querySelector('footer'), 'Replace').click()
	await P.until(() => !P.dialog('Replace Spell_Fire_FlameBolt') && (bar() || errorBar()), WAIT, 'the replace')
	out.replaced = bar() || errorBar()
	await P.until(() => /Replaced in Meld/.test(side().querySelector('.where')?.textContent ?? ''), WAIT, 'the replaced state')
	out.replacedState = await App.IconState('Spell_Fire_FlameBolt')
	await P.until(() => !button(side(), 'Delete').disabled, WAIT, 'Delete… on')

	// Delete… asks with the count, then brings the client's icon back.
	button(side(), 'Delete').click()
	let ask = await P.until(() => P.dialog('Delete an icon'), WAIT, 'the delete question')
	out.deleteText = ask.textContent.replace(/\s+/g, ' ')
	ask.querySelector('[data-confirm="yes"]').click()
	await P.until(() => /Deleted/.test(bar()) || errorBar(), WAIT, 'the delete')
	out.deleted = bar() || errorBar()
	out.afterDelete = await App.IconState('Spell_Fire_FlameBolt')

	// The added icon: nothing uses it, and it leaves the list.
	await pick(NAME)
	await P.until(() => !button(side(), 'Delete').disabled, WAIT, 'Delete… of the added icon')
	button(side(), 'Delete').click()
	ask = await P.until(() => P.dialog('Delete an icon'), WAIT, 'the second delete question')
	out.deleteAddedText = ask.textContent.replace(/\s+/g, ' ')
	ask.querySelector('[data-confirm="yes"]').click()
	await P.until(() => /Deleted Probe_Icon_Pic/.test(bar()) || errorBar(), WAIT, 'the second delete')
	out.deletedAdded = bar() || errorBar()
	out.addedState = await App.IconState(NAME)
	out.listed = ((await App.ListItemIcons()) ?? []).includes(NAME)
	out.ownRefused = await App.DeleteIcon('Spell_Fire_FireBolt').then(
		() => 'deleted',
		(e) => String(e),
	)
} finally {
	Object.assign(App, stubs)
	ui.iconsTool = null
	await P.frames(1)
}
out.ended = await P.endSandbox()

const grey = (p, lo, hi) => p[3] === 255 && p[0] >= lo && p[0] <= hi
out.ok =
	out.sandbox &&
	out.step.name === NAME &&
	/100 x 50/.test(out.step.size) &&
	out.step.options.join() === 'true,false,true' &&
	out.step.corner.join() === '0,0,0,255' &&
	out.step.middle[0] > 180 &&
	out.step.middle[3] === 255 &&
	out.step.framed.corner[3] === 0 &&
	grey(out.step.framed.top, 180, 210) &&
	grey(out.step.framed.side, 55, 85) &&
	grey(out.step.framed.inner, 0, 12) &&
	/^Added Probe_Icon_Pic/.test(out.imported) &&
	/^Added in Meld's patch/.test(out.importedWhere) &&
	/client's own/.test(out.clientOwn.where) &&
	out.clientOwn.deleteOff &&
	out.replaceStep.name === 'Spell_Fire_FlameBolt' &&
	out.replaceStep.button &&
	/^Replaced Spell_Fire_FlameBolt/.test(out.replaced) &&
	out.replacedState.inClient &&
	(out.replacedState.inPatch || out.replacedState.waiting) &&
	/\d+ spells? (and \d+ items? )?uses? this icon/.test(out.deleteText) &&
	/only spells and items are counted/.test(out.deleteText) &&
	/client's own Spell_Fire_FlameBolt shows again/.test(out.deleteText) &&
	/client's own icon shows again/.test(out.deleted) &&
	!out.afterDelete.inPatch &&
	!out.afterDelete.waiting &&
	out.afterDelete.inClient &&
	/No spell or item uses this icon/.test(out.deleteAddedText) &&
	/^Deleted Probe_Icon_Pic\.$/.test(out.deletedAdded) &&
	!out.addedState.inPatch &&
	!out.addedState.waiting &&
	!out.listed &&
	/client's own icons/.test(out.ownRefused) &&
	out.ended.realUnchanged
return out
