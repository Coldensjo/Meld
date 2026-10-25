import { tick } from 'svelte'
import type { Engine } from '../engine/Engine'
import { editor, prefs, setStatus, wow } from '../state/editor.svelte'
import { hasBackend } from './backend'
import { fromMapData } from './mapData'
import { openWowRegion } from './region'
import { LoadMap, Quit, SetUnsaved } from '../../../wailsjs/go/main/App'
import { flushPrefs, savePref } from '../state/prefs'
import { endAutosave } from './recovery'
import { engineRef } from '../state/engineRef'

// The session is what the editor had open when it was last closed: every tab that is a saved map
// file or a block of the client's tiles, each with its camera, and which tab was active. It is kept
// in the preferences (`prefs.session`, saved on its own through `savePref`) a few seconds after it changes and on quit, and opened again
// at the next start so the owner carries on where they were. Untitled maps are not kept: they have
// no file to come back from.

export interface SessionView {
	target: [number, number, number]
	yaw: number
	pitch: number
	distance: number
}

export interface SessionTab {
	map: { file: string } | { region: { mapName: string; x: number; y: number; size: number } } | { world: { mapName: string } }
	view: SessionView
}

export interface Session {
	tabs: SessionTab[]
	/** Index into `tabs` of the active one. */
	active: number
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** The open tabs worth coming back to, as the next start will open them. */
export function sessionState(engine: Engine): Session {
	const tabs: SessionTab[] = []
	let active = 0
	for (const d of engine.documents) {
		const isActive = d === engine.activeDocument()
		const file = isActive ? editor.filePath : d.meta.filePath
		const region = d.meta.region
		let map: SessionTab['map'] | null = null
		if (file) map = { file }
		else if (region) map = { region: { mapName: region.mapName, x: region.x, y: region.y, size: region.size } }
		else if (d.world) map = { world: { mapName: d.world.mapName } }
		if (!map) continue
		let view: SessionView
		if (isActive) {
			const v = engine.sceneView()
			view = { target: v.target.map(round) as SessionView['target'], yaw: round(v.yaw), pitch: round(v.pitch), distance: round(v.distance) }
		} else if (d.camera) {
			const c = d.camera
			view = { target: [round(c.target.x), round(c.target.y), round(c.target.z)], yaw: round(c.yaw), pitch: round(c.pitch), distance: round(c.distance) }
		} else continue
		if (isActive) active = tabs.length
		tabs.push({ map, view })
	}
	return { tabs, active }
}

let lastSaved = ''

/** Writes the session into the preferences when it differs from what they hold. */
export function saveSession(engine: Engine) {
	if (!hasBackend()) return
	const s = sessionState(engine)
	const key = JSON.stringify(s)
	if (key === lastSaved) return
	lastSaved = key
	prefs.session = s
	void savePref('session')
}

/** Quits after writing the session and the preferences, so the next start opens the same tabs. */
export async function quitNow() {
	if (!hasBackend()) return
	if (engineRef.current) saveSession(engineRef.current)
	await flushPrefs()
	await endAutosave()
	// The author chose to quit: closing the window must not ask again (#188).
	await SetUnsaved(false)
	Quit()
}

/** Keeps the session in the preferences while the app runs: every few seconds when it changed. Returns a stop function. */
export function startSessionSaving(engine: Engine) {
	const timer = setInterval(() => saveSession(engine), 3000)
	return () => clearInterval(timer)
}

/**
 * A page opened with `?nosession` (the probes' page) starts on a blank map instead of the last
 * session: a region the restore opens takes the active tab a probe has just made, and its spawns,
 * read seconds later, land in it (#250).
 */
export const skipRestore = typeof location !== 'undefined' && /[?&]nosession(?:[&=]|$)/.test(location.search)

/**
 * Opens the last session's tabs again and puts their cameras back. Region tabs need the client,
 * so they wait for it to load; without one they are skipped. The active tab ends up on top.
 */
export async function restoreSession(engine: Engine): Promise<void> {
	if (!hasBackend() || skipRestore) return
	const s = prefs.session
	try {
		// The preferences check the session's shape on load; this keeps a bad one from stopping startup anyway.
		if (!s.tabs.length) return
		lastSaved = JSON.stringify(s)
		if (s.tabs.some((t) => 'region' in t.map || 'world' in t.map)) await untilLoaded()
	} catch (err) {
		console.warn('could not read the last session', err)
		return
	}
	let activeId: number | null = null
	for (let i = 0; i < s.tabs.length; i++) {
		const t = s.tabs[i]
		try {
			if ('region' in t.map) {
				if (!wow.loaded) continue
				const r = t.map.region
				await openWowRegion(engine, r.mapName, r.x, r.y, r.size)
				if (editor.regionMap !== r.mapName) continue
			} else if ('world' in t.map) {
				if (!wow.loaded) continue
				engine.openWorld(t.map.world.mapName, { x: t.view.target[0], z: t.view.target[2] })
			} else {
				if (!engine.focusPath(t.map.file)) engine.openDocument(fromMapData(await LoadMap(t.map.file)), t.map.file)
			}
		} catch (err) {
			console.warn('could not reopen', t.map, err)
			continue
		}
		await tick()
		engine.setSceneView({ ...t.view, hour: engine.sceneView().hour })
		if (i === s.active) activeId = engine.activeDocumentId()
	}
	if (activeId !== null) engine.switchDocument(activeId)
	if (activeId !== null) setStatus('Opened where you left off.', 4000)
}

function untilLoaded(): Promise<void> {
	return new Promise((resolve) => {
		const poll = setInterval(() => {
			if (!wow.loading) {
				clearInterval(poll)
				resolve()
			}
		}, 100)
	})
}
