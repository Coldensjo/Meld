import { ui } from './editor.svelte'

// The Saving bar's state (#343): every save (the map, a compile, the spawns, the database editors'
// Save buttons) runs through these, so one bar in the middle of the window covers all of them.
// Saves may overlap (an editor's Save while a publish runs): each holds a place in a list, and the
// bar names the newest one still running. Set at the start and end of a save only, never per frame.

const running: { label: string; detail: string }[] = []

function show() {
	const top = running[running.length - 1]
	ui.saving = top ? top.label : ''
	ui.savingDetail = top ? top.detail : ''
}

/** Shows `label` ("Saving map") on the Saving bar until the returned function is called (once). */
export function startSaving(label: string): () => void {
	const entry = { label, detail: '' }
	running.push(entry)
	show()
	let ended = false
	return () => {
		if (ended) return
		ended = true
		const i = running.indexOf(entry)
		if (i >= 0) running.splice(i, 1)
		show()
	}
}

/** Runs `fn` with `label` on the Saving bar, clearing it when `fn` ends, whether or not it threw. */
export async function withSaving<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const end = startSaving(label)
	try {
		return await fn()
	} finally {
		end()
	}
}

/** Sets the progress line under the bar (a publish's log) for the newest save running; it goes with that save. */
export function savingDetail(line: string) {
	const top = running[running.length - 1]
	if (!top) return
	top.detail = line
	ui.savingDetail = line
}
