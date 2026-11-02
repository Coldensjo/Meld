// Lifts and elevators (#956): World › Lifts at the gnomes' elevator in Dun Morogh (Azeroth 31_41, entry 152614, guid 9290). A pick in the list selects the spawn and draws its loop from TransportAnimation.dbc (five frames, the third about 13 yd below the spawn) as a line over the map; Play moves its model through the loop. Edit loop and a new height for the third frame hand SaveLift the entry and the five frames. New lift (NewLiftEntry stood in) starts the five-frame default loop under the camera; Add move adds a sixth; Save hands SaveLift the new template's name, model and loop, then places the lift as a spawn (an undo step, undone here). SaveLift and NewLiftEntry are stood in, so nothing is written.
// touches: frontend/src/components/LiftsWindow.svelte, frontend/src/lib/engine/LiftView.ts, frontend/src/lib/world/liftMotion.ts, internal/vmangos/lifts.go, app_lifts.go
const { ui, editor } = await P.state()
const App = window.go.main.App
const real = { SaveLift: App.SaveLift, NewLiftEntry: App.NewLiftEntry }
const saved = []
App.SaveLift = async (edit) => {
	saved.push(edit)
	return { patch: '', server: true, waiting: false, restart: true }
}
App.NewLiftEntry = async () => 900002
const e = P.e
let placed = false
try {
	await P.scene({
		v: 1,
		map: { region: { mapName: 'Azeroth', x: 31, y: 41, size: 1 } },
		view: { target: [0, 0, 0], yaw: 0, pitch: 0.4, distance: 60, hour: 13 },
		prefs: { cameraFollowGround: true, showGameObjects: true },
		tool: 'select',
		selectedIds: [],
		selected: null,
		area: null,
		viewport: [1000, 600],
	})
	ui.lifts = true
	const lift = await P.until(() => editor.spawns.find((s) => s.kind === 'object' && s.entry === 152614) ?? null, 60_000, "the gnomes' elevator listed")
	const win = await P.until(() => document.querySelector('[data-ui="LiftsWindow"]') ?? null, 10_000, 'the window')
	await P.until(() => !win.textContent.includes('Reading the lifts') || null, 30_000, 'the loops read')
	const button = (label) => [...win.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
	const set = (el, v) => {
		el.value = String(v)
		el.dispatchEvent(new Event('input', { bubbles: true }))
		el.dispatchEvent(new Event('change', { bubbles: true }))
	}
	;[...win.querySelectorAll('[aria-label="Lifts"] button')].find((b) => b.textContent.includes('152614'))?.click()
	await P.frames(3)
	const V = e.lifts
	const shown = {
		selected: editor.selectedSpawn?.guid === lift.guid,
		points: V.points.length,
		visible: V.group.visible,
		drop: V.points[2] ? Math.round((V.points[2].y - lift.y) * 10) / 10 : null,
		rows: win.querySelectorAll('[aria-label="Frames"] tbody tr').length,
	}

	// Play moves the model through the loop.
	button('Play')?.click()
	await P.until(() => (V.model.visible && V.playedMs > 300) || null, 30_000, 'the preview playing')
	const playing = { flag: ui.liftPlaying, at: V.model.position.clone(), ms: V.playedMs }
	button('Stop')?.click()
	await P.frames(1)
	const stopped = !ui.liftPlaying && !V.model.visible

	// Edit loop: the third frame 20 yd down, saved.
	button('Edit loop')?.click()
	await P.frames(2)
	const ups = win.querySelectorAll('[aria-label="Frames"] input[aria-label="Up"]')
	set(ups[2], -20)
	await P.frames(2)
	const redrawn = Math.round((V.points[2].y - lift.y) * 10) / 10
	button('Save')?.click()
	await P.until(() => saved.length > 0 || null, 10_000, 'SaveLift called')
	const first = saved[0]
	const savedEdit = { entry: first.entry, new: first.new, frames: first.frames.length, z: first.frames[2].z, t: first.frames.map((f) => f.time).join(',') }

	// New lift under the camera, with a move added.
	await P.until(() => (button('New lift') && !button('New lift').disabled) || null, 30_000, 'the save done')
	button('New lift')?.click()
	await P.until(() => win.querySelector('#lift-name') ?? null, 30_000, 'the new lift drafted')
	await P.frames(2)
	const fresh = { points: V.points.length, rows: win.querySelectorAll('[aria-label="Frames"] tbody tr').length }
	button('Add move')?.click()
	await P.frames(2)
	const n = e.debug.doc.spawnLayer.spawns.length
	button('Save')?.click()
	await P.until(() => saved.length > 1 || null, 10_000, 'SaveLift called again')
	const second = saved[1]
	await P.until(() => e.debug.doc.spawnLayer.spawns.length > n || null, 30_000, 'the new lift placed')
	placed = true
	const spawn = e.debug.doc.spawnLayer.spawns.at(-1)
	const savedNew = { entry: second.entry, new: second.new, name: second.name, display: second.displayId, frames: second.frames.length, spawn: spawn.entry, type: spawn.type }

	const ok =
		shown.selected &&
		shown.points === 5 &&
		shown.visible &&
		shown.drop !== null &&
		shown.drop < -10 &&
		shown.rows === 5 &&
		playing.flag &&
		stopped &&
		redrawn === -20 &&
		savedEdit.entry === 152614 &&
		savedEdit.new === false &&
		savedEdit.frames === 5 &&
		savedEdit.z === -20 &&
		savedEdit.t === '0,1333,3333,4667,6667' &&
		fresh.points === 5 &&
		fresh.rows === 5 &&
		savedNew.entry === 900002 &&
		savedNew.new === true &&
		savedNew.name === 'New lift' &&
		savedNew.display > 0 &&
		savedNew.frames === 6 &&
		savedNew.spawn === 900002 &&
		savedNew.type === 11
	return { ok, shown, playing: { flag: playing.flag, ms: Math.round(playing.ms) }, stopped, redrawn, savedEdit, fresh, savedNew }
} finally {
	App.SaveLift = real.SaveLift
	App.NewLiftEntry = real.NewLiftEntry
	if (placed) e.history.undo()
	e.stopLiftPlay()
	ui.lifts = false
}
